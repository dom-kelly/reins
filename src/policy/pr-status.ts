import { writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readConfig } from '../lib/config.ts'
import { gh, type Verdict } from './merge-policy.ts'

/** The PR's status, written by the policy on every evaluation (decision
 *  0010): two state labels say who acts, a risk label says the tier, the
 *  owner is assigned when parked, and one comment carries the reason. The
 *  engine is the only writer; agents and owners never set these by hand. */

export type State = 'needs-owner' | 'agent-merges'
export const stateLabels: ReadonlyArray<State> = ['needs-owner', 'agent-merges']
export const riskLabels = ['risk:low', 'risk:medium', 'risk:high'] as const
/** The first line of the status comment, so it can be found and updated. */
export const statusMarker = '<!-- reins:policy -->'

const labelSpecs: ReadonlyArray<{
	name: string
	color: string
	description: string
}> = [
	{
		name: 'needs-owner',
		color: 'd73a4a',
		description: 'The shipping policy parked this PR for the owner to merge',
	},
	{
		name: 'agent-merges',
		color: '0e8a16',
		description: 'The agent merges this PR when the shipping policy passes',
	},
	{
		name: 'risk:low',
		color: 'c5def5',
		description: 'Shipping policy: low risk',
	},
	{
		name: 'risk:medium',
		color: 'fbca04',
		description: 'Shipping policy: medium risk',
	},
	{
		name: 'risk:high',
		color: 'e99695',
		description: 'Shipping policy: high risk',
	},
]

/** Who acts next, and the one-line reason. Parked is the owner's; everything
 *  else (allowed, waiting, refused) is the agent's to finish. */
export function prStatus(verdict: Verdict): { state: State; summary: string } {
	const risk = verdict.risk ?? 'unknown'
	if (verdict.parked) {
		const why = /\((.*)\): hand PR/.exec(verdict.message)?.[1] ?? ''
		return {
			state: 'needs-owner',
			summary: `**Needs owner.** ${why}; \`policy.authority.${risk}\` is \`owner\`. Merge with \`gh pr merge ${verdict.pr ?? '<n>'} --squash --delete-branch\`, or comment what to change.`,
		}
	}
	if (verdict.allowed) {
		const why = /^policy: (.*) — agent may merge\.$/.exec(verdict.message)?.[1]
		return {
			state: 'agent-merges',
			summary: `**Agent merges.** ${why ?? `${risk} risk`}. Nothing needed from the owner.`,
		}
	}
	if (verdict.waiting) {
		return {
			state: 'agent-merges',
			summary: `**Agent merges.** Waiting for ${verdict.waiting}. Nothing needed from the owner.`,
		}
	}
	const reason =
		/^Merge refused: (.*)\. See docs\/contributing\/shipping-policy\.md\.$/.exec(
			verdict.message,
		)?.[1] ?? verdict.message
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
	const policy = readConfig(root)?.policy ?? {}
	if (policy.publish === false) return
	const step = (name: string, run: () => void) => {
		try {
			run()
		} catch (error) {
			verdict.lines.push(
				`policy: could not write PR status (${name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
			)
		}
	}
	const issue = `repos/${repo}/issues/${pr}`
	const wanted = desiredLabels(verdict)

	step('labels', () => {
		for (const { name, color, description } of labelSpecs) {
			gh(
				[
					'label',
					'create',
					name,
					'--color',
					color,
					'--description',
					description,
					'--force',
				],
				root,
			)
		}
		const current = gh(['api', `${issue}/labels`, '--jq', '.[].name'], root)
			.split('\n')
			.filter(Boolean)
		const ours = new Set<string>([...stateLabels, ...riskLabels])
		for (const name of current) {
			if (ours.has(name) && !wanted.includes(name)) {
				gh(['api', '-X', 'DELETE', `${issue}/labels/${name}`], root)
			}
		}
		const missing = wanted.filter((name) => !current.includes(name))
		if (missing.length) {
			gh(
				[
					'api',
					'-X',
					'POST',
					`${issue}/labels`,
					...missing.flatMap((name) => ['-f', `labels[]=${name}`]),
				],
				root,
			)
		}
	})

	if (verdict.parked) {
		step('assignee', () => {
			const login =
				policy.owner ??
				(verdict.owner?.type === 'User' ? verdict.owner.login : undefined)
			if (!login) return
			const assigned = (
				JSON.parse(gh(['pr', 'view', pr, '--json', 'assignees'], root)) as {
					assignees: Array<{ login: string }>
				}
			).assignees.map((a) => a.login)
			if (assigned.includes(login)) return
			gh(
				[
					'api',
					'-X',
					'POST',
					`${issue}/assignees`,
					'-f',
					`assignees[]=${login}`,
				],
				root,
			)
		})
	}

	step('comment', () => {
		const body = statusComment(verdict)
		const existing = gh(
			[
				'api',
				'--paginate',
				`${issue}/comments`,
				'--jq',
				`.[] | select(.body | startswith("${statusMarker}")) | {id, body}`,
			],
			root,
		)
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { id: number; body: string })[0]
		if (existing?.body === body) return
		const dir = mkdtempSync(path.join(tmpdir(), 'reins-status-'))
		try {
			const file = path.join(dir, 'body.md')
			writeFileSync(file, body)
			gh(
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
				root,
			)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
}
