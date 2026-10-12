import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
	gh,
	policySources,
	writeFailurePrefix,
	type PolicyConfig,
	type Verdict,
} from './merge-policy.ts'

/** The PR's status, written by the policy on every evaluation (decision
 *  0010): a state label says who merges, a risk label says the tier, the
 *  owner is assigned once a parked PR is theirs to merge, and one comment
 *  carries the reason. The engine is the only writer; agents and owners never
 *  set these by hand. */

export type State = 'needs-owner' | 'agent-merges'
export const stateLabels: ReadonlyArray<State> = ['needs-owner', 'agent-merges']
export const riskLabels = ['risk:low', 'risk:medium', 'risk:high'] as const
/** The first line of the status comment, so it can be found and updated. */
export const statusMarker = '<!-- reins:policy -->'
/** A `gh` call that hangs must not hang the guard hook. */
const callTimeout = 20_000

const labelSpecs: Record<string, { color: string; description: string }> = {
	'needs-owner': {
		color: 'd73a4a',
		description: 'The shipping policy says the owner merges this PR',
	},
	'agent-merges': {
		color: '0e8a16',
		description: 'The agent merges this PR when the shipping policy passes',
	},
	'risk:low': { color: 'c5def5', description: 'Shipping policy: low risk' },
	'risk:medium': {
		color: 'fbca04',
		description: 'Shipping policy: medium risk',
	},
	'risk:high': { color: 'e99695', description: 'Shipping policy: high risk' },
}

/** Who merges, and the one-line reason. The owner's once the tier says
 *  `owner`, whether or not it is green yet; the agent's otherwise. */
export function prStatus(verdict: Verdict): { state: State; summary: string } {
	const risk = verdict.risk ?? 'unknown'
	const reason = verdict.reason ?? verdict.message
	if (verdict.parked) {
		return {
			state: 'needs-owner',
			summary: `**Needs owner.** ${risk} risk, ${reason}; \`policy.authority.${risk}\` is \`owner\`. Merge with \`gh pr merge ${verdict.pr ?? '<n>'} --squash --delete-branch\`, or comment what to change.`,
		}
	}
	if (verdict.authority === 'owner') {
		const what = verdict.timedOut
			? `the agent stopped waiting for ${verdict.waiting}; it re-runs the policy when it returns`
			: verdict.waiting
				? `waiting for ${verdict.waiting}`
				: `not yet: ${reason}; the agent is on it`
		return {
			state: 'needs-owner',
			summary: `**Needs owner, not yet mergeable.** ${risk} risk, ${what}. The owner merges once the policy passes.`,
		}
	}
	if (verdict.allowed) {
		return {
			state: 'agent-merges',
			summary: `**Agent merges.** ${risk} risk, ${reason}. Nothing needed from the owner.`,
		}
	}
	if (verdict.timedOut) {
		return {
			state: 'agent-merges',
			summary: `**Agent merges.** Stopped waiting for ${verdict.waiting} (timed out); the agent re-runs the policy when it returns. Nothing needed from the owner.`,
		}
	}
	if (verdict.waiting) {
		return {
			state: 'agent-merges',
			summary: `**Agent merges.** Waiting for ${verdict.waiting}. Nothing needed from the owner.`,
		}
	}
	return {
		state: 'agent-merges',
		summary: `**Agent merges.** Not yet: ${reason}. The agent is on it; nothing needed from the owner.`,
	}
}

export function desiredLabels(verdict: Verdict): Array<string> {
	const { state } = prStatus(verdict)
	return verdict.risk ? [state, `risk:${verdict.risk}`] : [state]
}

export function statusComment(verdict: Verdict) {
	return [
		statusMarker,
		'## Shipping policy',
		'',
		prStatus(verdict).summary,
		'',
		'_Written by `npx reins policy` on every evaluation. Labels `needs-owner` / `agent-merges` / `risk:<tier>` say the same._',
		'',
	].join('\n')
}

/** Writes the status to the PR. Never changes the verdict: a step that fails
 *  adds a `policy: could not write PR status` line and the rest still run. */
export function publishStatus(root: string, verdict: Verdict) {
	const { pr, repo } = verdict
	if (!pr || !repo || verdict.unread) return
	// The same source as the verdict (origin/main), so a branch cannot turn
	// its own status off; and never a throw, whatever the working tree holds.
	let policy: PolicyConfig = {}
	try {
		policy = policySources(root).config?.policy ?? {}
	} catch {
		policy = {}
	}
	if (policy.publish === false) return
	const call = (args: Array<string>) => gh(args, root, callTimeout)
	const step = (name: string, run: () => void) => {
		try {
			run()
		} catch (error) {
			verdict.lines.push(
				`${writeFailurePrefix} (${name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
			)
		}
	}
	const issue = `repos/${repo}/issues/${pr}`
	const wanted = desiredLabels(verdict)

	step('labels', () => {
		// Only what this PR needs, and only when the repo lacks it: a product
		// that defined or recoloured one of these keeps its version.
		const existing = call(['label', 'list', '--json', 'name', '--limit', '500'])
		const names = new Set(
			(JSON.parse(existing || '[]') as Array<{ name: string }>).map(
				(l) => l.name,
			),
		)
		for (const name of wanted) {
			if (names.has(name)) continue
			const spec = labelSpecs[name]!
			call([
				'label',
				'create',
				name,
				'--color',
				spec.color,
				'--description',
				spec.description,
			])
		}
		const current = call(['api', `${issue}/labels`, '--jq', '.[].name'])
			.split('\n')
			.filter(Boolean)
		const ours = new Set<string>([...stateLabels, ...riskLabels])
		for (const name of current) {
			if (ours.has(name) && !wanted.includes(name)) {
				call([
					'api',
					'-X',
					'DELETE',
					`${issue}/labels/${encodeURIComponent(name)}`,
				])
			}
		}
		const missing = wanted.filter((name) => !current.includes(name))
		if (missing.length) {
			call([
				'api',
				'-X',
				'POST',
				`${issue}/labels`,
				...missing.flatMap((name) => ['-f', `labels[]=${name}`]),
			])
		}
	})

	if (verdict.parked) {
		step('assignee', () => {
			const login =
				policy.owner ??
				(verdict.owner?.type === 'User' ? verdict.owner.login : undefined)
			if (!login) return
			const assigned = (
				JSON.parse(call(['pr', 'view', pr, '--json', 'assignees'])) as {
					assignees: Array<{ login: string }>
				}
			).assignees.map((a) => a.login)
			if (assigned.includes(login)) return
			call([
				'api',
				'-X',
				'POST',
				`${issue}/assignees`,
				'-f',
				`assignees[]=${login}`,
			])
		})
	}

	step('comment', () => {
		const body = statusComment(verdict)
		const marked = call([
			'api',
			'--paginate',
			`${issue}/comments`,
			'--jq',
			`.[] | select(.body | startswith("${statusMarker}")) | {id, body, login: .user.login}`,
		])
			.split('\n')
			.filter(Boolean)
			.map(
				(line) =>
					JSON.parse(line) as { id: number; body: string; login: string },
			)
		// Prefer the comment this token wrote: anyone can post the marker, and
		// patching someone else's comment would fail on every run.
		let me: string | undefined
		try {
			me = call(['api', 'user', '--jq', '.login'])
		} catch {
			me = undefined
		}
		const existing = marked.find((c) => c.login === me) ?? marked[0]
		if (existing?.body.trimEnd() === body.trimEnd()) return
		const dir = mkdtempSync(path.join(tmpdir(), 'reins-status-'))
		try {
			const file = path.join(dir, 'body.md')
			writeFileSync(file, body)
			call(
				existing
					? [
							'api',
							'-X',
							'PATCH',
							`repos/${repo}/issues/comments/${existing.id}`,
							'-F',
							`body=@${file}`,
						]
					: ['api', '-X', 'POST', `${issue}/comments`, '-F', `body=@${file}`],
			)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
}
