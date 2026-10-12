import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import {
	mapPath,
	riskLevels,
	summarizeChanges,
	type PrimitivesMap,
	type Risk,
} from '../checks/primitives.ts'
import {
	configFile,
	legacyConfigFile,
	readConfig,
	type HarnessConfig,
} from '../lib/config.ts'

/** `reins.json` → `policy`. Mirrors kody's ship-pr tiers:
 *    low    green CI
 *    medium + every gate reviewer's check passed and its findings addressed
 *    high   + every required reviewer has reviewed the current head
 *  `authority` says who merges at each tier; "owner" parks the PR. */
export type PolicyConfig = {
	/** The npm script that is the local gate; also the default CI check name. */
	gate?: string
	/** The CI check that must be SUCCESS. Default: the gate name. */
	ciCheck?: string
	authority?: Partial<Record<Risk, 'agent' | 'owner'>>
	reviewers?: {
		/** Medium and high: the check must pass, and threads this login opened must be addressed. */
		gate?: Array<{ check: string; login: string }>
		/** High: these logins must have reviewed the PR's current head commit. */
		required?: Array<string>
		/** Logins whose unresolved threads must be answered. Default: gate logins + required. */
		findingsFrom?: Array<string>
		/** Checks whose status never blocks (a reviewer that stays "pending" after reviewing). */
		ignoreChecks?: Array<string>
	}
	/** Route `gh pr merge` through the policy in the guard hook. Default true. */
	enforceOnMerge?: boolean
	/** Medium and high merged by an agent need a `## Independent review` comment
	 *  for the head (or an earlier commit on the branch). Default true. */
	independentReview?: boolean
}

export type Verdict = {
	allowed: boolean
	risk?: Risk
	/** The reason it is not allowed, or how it was allowed. */
	message: string
	/** Progress lines, for the hook's stderr. */
	lines: Array<string>
	/** Set when the refusal is for something that may still arrive (a check
	 *  running, a review not yet posted): `--wait` polls while this is set. */
	waiting?: string
	/** Set when the refusal is that `gh` could not be read; `--wait` retries a
	 *  few times before believing it. */
	unread?: boolean
}

export type WaitOptions = {
	intervalMs?: number
	timeoutMs?: number
	/** Injected by tests. */
	evaluate?: typeof evaluateMerge
	sleep?: (ms: number) => Promise<void>
	/** Called with a progress line each time what we wait for changes. */
	onWait?: (line: string) => void
}

/** A reply that settles a finding: the fixing commit, or a reason. This is
 *  an honour system — the policy checks the words, not the diff. */
const addressed = /^\s*(Fixed in [0-9a-f]{7,}|wontfix:)/i
const testFile = /\.(test|spec)\.[cm]?[jt]sx?$/
/** A check that has not finished: a running check run has no conclusion. */
const notFinished = new Set([
	'',
	'PENDING',
	'EXPECTED',
	'QUEUED',
	'IN_PROGRESS',
])
/** The review comment ship-pr posts: first line, then the sha it looked at. */
const reviewHeading = '## Independent review'
const reviewHead = /^head:\s*([0-9a-f]{7,40})\b/im

function rank(risk: Risk) {
	return riskLevels.indexOf(risk)
}

function max(a: Risk, b: Risk): Risk {
	return rank(a) >= rank(b) ? a : b
}

export function gh(args: Array<string>, cwd: string) {
	return execFileSync('gh', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim()
}

/** Exactly one `**Name:** \`value\`` line, with an allowed value: never a
 *  substring, never a second contradicting line. */
export function bodyField(
	body: string,
	name: string,
	allowed: ReadonlyArray<string>,
) {
	const lines = body
		.split('\n')
		.filter((line) => line.startsWith(`**${name}:**`))
	if (lines.length !== 1) return undefined
	const match = new RegExp(
		`^\\*\\*${name}:\\*\\*\\s+\`(${allowed.join('|')})\`\\s*$`,
	).exec(lines[0]!)
	return match?.[1]
}

/** The policy's inputs come from `origin/main`, not the working tree, so a PR
 *  cannot lower its own floors or change who may merge it. Falls back to the
 *  working tree only when there is no `origin/main` (a repo not yet pushed). */
export function policySources(root: string): {
	config: HarnessConfig | undefined
	map: PrimitivesMap
	from: string
} {
	const show = (file: string) => {
		try {
			return execFileSync('git', ['show', `origin/main:${file}`], {
				cwd: root,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			})
		} catch {
			return undefined
		}
	}
	const mapSource = show(mapPath)
	if (mapSource !== undefined) {
		// A product that has not migrated still has `harness.json` on main.
		const configSource = show(configFile) ?? show(legacyConfigFile)
		return {
			config: configSource
				? (JSON.parse(configSource) as HarnessConfig)
				: undefined,
			map: parse(mapSource) as PrimitivesMap,
			from: 'origin/main',
		}
	}
	const mapFile = path.join(root, mapPath)
	if (!existsSync(mapFile)) throw new Error(`${mapPath} is missing`)
	return {
		config: readConfig(root),
		map: parse(readFileSync(mapFile, 'utf8')) as PrimitivesMap,
		from: 'working tree (no origin/main)',
	}
}

type PullRequest = {
	isDraft: boolean
	baseRefName: string
	headRefOid: string
	body: string
	statusCheckRollup: Array<{
		name?: string
		context?: string
		conclusion?: string | null
		state?: string
	}> | null
}

type PullFile = { status: string; filename: string; previous_filename?: string }

type Threads = {
	data: {
		repository: {
			pullRequest: {
				reviewThreads: {
					nodes: Array<{
						isResolved: boolean
						comments: {
							nodes: Array<{ author: { login: string }; body?: string }>
						}
					}>
				}
				reviews: {
					nodes: Array<{
						author: { login: string }
						state: string
						commit: { oid: string } | null
					}>
				}
			}
		}
	}
}

/** Which check runs and which reviewer/commenter logins have ever appeared
 *  on the repo's recent PRs. A reviewer named in `policy.reviewers` that is
 *  absent here is not installed on the repo. */
export type Presence = {
	/** PRs looked at; under `minPresenceHistory` is too little to judge. */
	prs: number
	checks: Set<string>
	logins: Set<string>
}

/** Fewer PRs than this and a reviewer's absence proves nothing. */
export const minPresenceHistory = 3
/** How many recent PRs the lookup reads. */
export const presenceWindow = 20

type RecentPulls = {
	data: {
		repository: {
			pullRequests: {
				nodes: Array<{
					number: number
					reviews: { nodes: Array<{ author: { login: string } | null }> }
					comments: { nodes: Array<{ author: { login: string } | null }> }
					commits: {
						nodes: Array<{
							commit: {
								statusCheckRollup: {
									contexts: {
										nodes: Array<{ name?: string; context?: string }>
									}
								} | null
							}
						}>
					}
				}>
			}
		}
	}
}

/** GitHub's REST API names a bot `cursor[bot]`; GraphQL and reins.json say `cursor`. */
export function botLogin(login: string) {
	return login.replace(/\[bot\]$/, '')
}

/** Lives for the process: `--wait` looks up once, however many polls. */
const presenceCache = new Map<string, Presence>()

/** For an in-process caller (doctor's tests) that simulates several repos. */
export function forgetPresence() {
	presenceCache.clear()
}

/** One GraphQL call: the last `presenceWindow` PRs (open or closed) with the
 *  check runs and status contexts on each head and the logins of every review
 *  and comment. Cached per repo for the process, so `--wait` looks once. */
export function reviewerPresence(root: string, repo: string): Presence {
	const cached = presenceCache.get(repo)
	if (cached) return cached
	const [owner, name] = repo.split('/')
	const recent = JSON.parse(
		gh(
			[
				'api',
				'graphql',
				'-f',
				`owner=${owner}`,
				'-f',
				`name=${name}`,
				'-F',
				`first=${presenceWindow}`,
				'-f',
				'query=query($owner:String!,$name:String!,$first:Int!){repository(owner:$owner,name:$name){pullRequests(first:$first,orderBy:{field:CREATED_AT,direction:DESC}){nodes{number reviews(first:100){nodes{author{login}}} comments(first:100){nodes{author{login}}} commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{... on CheckRun{name} ... on StatusContext{context}}}}}}}}}}}',
			],
			root,
		),
	) as RecentPulls
	const pulls = recent.data.repository.pullRequests.nodes
	const presence: Presence = {
		prs: pulls.length,
		checks: new Set(
			pulls.flatMap((p) =>
				p.commits.nodes.flatMap(
					(c) =>
						c.commit.statusCheckRollup?.contexts.nodes.flatMap(
							(n) => n.name ?? n.context ?? [],
						) ?? [],
				),
			),
		),
		logins: new Set(
			pulls.flatMap((p) =>
				[...p.reviews.nodes, ...p.comments.nodes].flatMap((n) =>
					n.author ? [botLogin(n.author.login)] : [],
				),
			),
		),
	}
	presenceCache.set(repo, presence)
	return presence
}

/** The refusal (and doctor line) for a reviewer that is declared but absent. */
export function neverRan(
	name: string,
	kind: 'gate check' | 'required reviewer' | 'findings reviewer',
) {
	return `\`${name}\` is configured in reins.json as a ${kind} but has never run on this repo`
}
export const neverRanFix =
	'install the app or remove it from `policy.reviewers`'

export function evaluateMerge(root: string, prRef?: string): Verdict {
	const lines: Array<string> = []
	const no = (message: string): Verdict => ({
		allowed: false,
		message: `Merge refused: ${message}. See docs/contributing/shipping-policy.md.`,
		lines,
	})
	const wait = (what: string): Verdict => ({
		...no(`waiting for ${what}`),
		waiting: what,
	})
	const unread = (message: string): Verdict => ({
		...no(message),
		unread: true,
	})

	let sources: ReturnType<typeof policySources>
	try {
		sources = policySources(root)
	} catch (error) {
		return no(
			`couldn't read the policy (${error instanceof Error ? error.message : String(error)})`,
		)
	}
	lines.push(`policy: config and primitives from ${sources.from}`)
	const policy = sources.config?.policy ?? {}
	const gate = policy.gate ?? 'validate'
	const ciCheck = policy.ciCheck ?? gate
	const authority = {
		low: 'agent',
		medium: 'agent',
		high: 'owner',
		...policy.authority,
	}
	const reviewers = policy.reviewers ?? {}
	const gateReviewers = reviewers.gate ?? []
	const required = reviewers.required ?? []
	const findingsFrom = reviewers.findingsFrom ?? [
		...gateReviewers.map((g) => g.login),
		...required,
	]
	const ignoreChecks = new Set(reviewers.ignoreChecks ?? [])

	// The PR: a number, URL or branch given on the command, else the current branch's.
	let pr: string
	let repo: string
	let info: PullRequest
	let files: Array<PullFile>
	try {
		pr = gh(
			[
				'pr',
				'view',
				...(prRef ? [prRef] : []),
				'--json',
				'number',
				'--jq',
				'.number',
			],
			root,
		)
		if (!/^\d+$/.test(pr))
			throw new Error(`no PR for ${prRef ?? 'this branch'}`)
		repo = gh(
			['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
			root,
		)
		info = JSON.parse(
			gh(
				[
					'pr',
					'view',
					pr,
					'--json',
					'isDraft,baseRefName,headRefOid,body,statusCheckRollup',
				],
				root,
			),
		)
		files = gh(
			[
				'api',
				'--paginate',
				`repos/${repo}/pulls/${pr}/files`,
				'--jq',
				'.[] | {status, filename, previous_filename}',
			],
			root,
		)
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line) as PullFile)
	} catch (error) {
		return unread(
			`couldn't read the PR (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
		)
	}
	if (info.isDraft) return no(`PR #${pr} is a draft`)
	if (info.baseRefName !== 'main') return no(`PR #${pr} doesn't target main`)

	// Tests may be added or changed, never removed — nor renamed into something else.
	const removedTests = files.filter(
		(f) =>
			(f.status === 'removed' && testFile.test(f.filename)) ||
			(f.previous_filename &&
				testFile.test(f.previous_filename) &&
				!testFile.test(f.filename)),
	)
	if (removedTests.length) {
		return no(
			`it deletes tests: ${removedTests.map((f) => f.previous_filename ?? f.filename).join(', ')}`,
		)
	}

	// Risk = the highest of the declared Change, the primitives' floors and the Door.
	const change = bodyField(info.body ?? '', 'Change', [
		'composes',
		'extends',
		'adds',
	])
	if (!change)
		return no(
			'the PR needs exactly one Change line, set to one of `composes` / `extends` / `adds`',
		)
	const declared: Risk =
		change === 'composes' ? 'low' : change === 'extends' ? 'medium' : 'high'
	const door = bodyField(info.body ?? '', 'Door', ['two-way', 'one-way'])
	if (!door)
		return no(
			'the PR needs exactly one Door line, set to one of `two-way` / `one-way`',
		)
	const doorRisk: Risk = door === 'two-way' ? 'low' : 'high'
	// A rename also carries its old path, so moving a high-risk file somewhere
	// low-risk is still judged by where it came from.
	const paths = files.flatMap((f) =>
		f.previous_filename ? [f.filename, f.previous_filename] : [f.filename],
	)
	const summary = summarizeChanges(sources.map, paths)
	const risk = max(max(declared, summary.floor), doorRisk)
	lines.push(
		`policy: PR #${pr} declared=${change} floor=${summary.floor} (${summary.primitives.map((p) => p.id).join(',')}) door=${doorRisk}`,
		`policy: PR #${pr} risk=${risk}`,
	)

	// Every tier: green CI on the current head. A check still running, or the
	// gate check not yet reported (it takes a minute to appear after a push),
	// is waited for; a failed one is refused.
	const checks = (info.statusCheckRollup ?? []).map((c) => ({
		name: c.name ?? c.context ?? '',
		state: c.conclusion ?? c.state ?? '',
	}))
	const ci = checks.find((c) => c.name === ciCheck)
	if (!ci) return wait(`the ${ciCheck} check to start on ${info.headRefOid}`)
	if (notFinished.has(ci.state))
		return wait(`the ${ciCheck} check to finish on ${info.headRefOid}`)
	if (ci.state !== 'SUCCESS') return no(`the ${ciCheck} check hasn't passed`)
	// A failed check is refused before a slow one is waited for.
	const unsettled = checks.filter((c) => !ignoreChecks.has(c.name))
	const red = unsettled.filter(
		(c) =>
			!notFinished.has(c.state) &&
			!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(c.state),
	)
	if (red.length)
		return no(
			`checks not green: ${red.map((c) => `${c.name}=${c.state}`).join(' ')}`,
		)
	const running = unsettled.filter((c) => notFinished.has(c.state))
	if (running.length)
		return wait(
			`checks to finish: ${running.map((c) => `${c.name}=${c.state || 'RUNNING'}`).join(' ')}`,
		)

	const park = (why: string): Verdict => ({
		allowed: false,
		risk,
		message: `Merge needs the user (${risk} risk, ${why}): hand PR #${pr} to the user.`,
		lines,
	})
	const yes = (why: string): Verdict => ({
		allowed: true,
		risk,
		message: `policy: ${risk} risk, ${why} — agent may merge.`,
		lines,
	})
	if (risk === 'low') {
		return authority.low === 'agent' ? yes('CI green') : park('CI green')
	}

	// A reviewer is waited for only if it exists on the repo: one that has
	// never run here (the app is not installed) is a configuration error, and
	// `--wait` must not sit out its timeout on it. The current PR's own checks
	// and reviews count as having appeared; with too little history, or when
	// the lookup fails, the wait stands.
	const seen = (
		own: Iterable<string>,
		of: 'checks' | 'logins',
		name: string,
	): boolean | undefined => {
		if ([...own].includes(name)) return true
		let presence: Presence
		try {
			presence = reviewerPresence(root, repo)
		} catch {
			return undefined
		}
		if (presence.prs < minPresenceHistory) return undefined
		return presence[of].has(name)
	}

	// Medium and high: gate reviewers passed, their findings addressed. Every
	// unmet reviewer is checked for presence before any is waited for, so one
	// that is installed but pending cannot hide one that is not installed.
	const gateUnmet = gateReviewers
		.map((g) => g.check)
		.filter(
			(check) => !checks.some((c) => c.name === check && c.state === 'SUCCESS'),
		)
	for (const check of gateUnmet) {
		if (
			seen(
				checks.map((c) => c.name),
				'checks',
				check,
			) === false
		)
			return no(`${neverRan(check, 'gate check')}: ${neverRanFix}`)
	}
	if (gateUnmet.length) return wait(`${gateUnmet[0]} to pass (risk=${risk})`)
	let threads: Threads
	try {
		const [owner, name] = repo.split('/')
		threads = JSON.parse(
			gh(
				[
					'api',
					'graphql',
					'-f',
					`owner=${owner}`,
					'-f',
					`name=${name}`,
					'-F',
					`pr=${pr}`,
					'-f',
					'query=query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved comments(first:50){nodes{author{login} body}}}} reviews(first:100){nodes{author{login} state commit{oid}}}}}}',
				],
				root,
			),
		)
	} catch {
		return unread("couldn't read review threads")
	}
	const pull = threads.data.repository.pullRequest
	const open = pull.reviewThreads.nodes.filter((t) => {
		if (t.isResolved) return false
		const [first, ...replies] = t.comments.nodes
		if (!first || !findingsFrom.includes(first.author.login)) return false
		return !replies.some((r) => addressed.test(r.body ?? ''))
	})
	if (open.length) {
		const from = [
			...new Set(open.map((t) => t.comments.nodes[0]!.author.login)),
		].join(' ')
		return no(
			`${open.length} review finding(s) from ${from} not addressed — fix and reply 'Fixed in <sha>: …', or reply 'wontfix: <reason>'`,
		)
	}
	// An agent merging medium or high needs the fresh-context review that
	// ship-pr posts, on this head or an earlier commit of the branch. Like
	// `Fixed in`, this checks that the review happened, not its quality. Only
	// a missing comment is waited for; a wrong one needs the agent to act.
	if (authority[risk] === 'agent' && (policy.independentReview ?? true)) {
		let review: ReturnType<typeof independentReview>
		try {
			review = independentReview(root, repo, pr, info.headRefOid)
		} catch {
			return unread("couldn't read the PR's comments")
		}
		if (review.missing) return wait(`${review.missing} (risk=${risk})`)
		if (review.wrong) return no(`${review.wrong} (risk=${risk})`)
		lines.push(`policy: PR #${pr} independent review found for the head`)
	}
	if (risk === 'medium') {
		const why = gateReviewers.length
			? 'CI and reviewers green, findings addressed'
			: 'CI green'
		return authority.medium === 'agent' ? yes(why) : park(why)
	}

	// High: every required reviewer has a submitted review on the current head.
	const reviewed = new Set(
		pull.reviews.nodes
			.filter((r) => r.state !== 'PENDING' && r.commit?.oid === info.headRefOid)
			.map((r) => r.author.login),
	)
	const everReviewed = pull.reviews.nodes.map((r) => botLogin(r.author.login))
	const requiredUnmet = required.filter((login) => !reviewed.has(login))
	for (const login of requiredUnmet) {
		if (seen(everReviewed, 'logins', login) === false)
			return no(`${neverRan(login, 'required reviewer')}: ${neverRanFix}`)
	}
	if (requiredUnmet.length)
		return wait(
			`a review from ${requiredUnmet[0]} on the current commit (risk=high)`,
		)
	const why = required.length ? 'all reviewers done' : 'CI green'
	return authority.high === 'agent' ? yes(why) : park(why)
}

/** Whether a `## Independent review` comment covers `head`: `missing` when
 *  none is posted yet, `wrong` when one is but names no commit of the PR. The
 *  `head:` may be an earlier commit of the branch (fixes pushed after the
 *  review keep it valid; a rebase does not), matched by prefix. */
function independentReview(
	root: string,
	repo: string,
	pr: string,
	head: string,
): { missing?: string; wrong?: string } {
	const comments = gh(
		[
			'api',
			'--paginate',
			`repos/${repo}/issues/${pr}/comments`,
			'--jq',
			'.[] | {body}',
		],
		root,
	)
		.split('\n')
		.filter(Boolean)
		.map((line) => (JSON.parse(line) as { body?: string }).body ?? '')
		.filter((body) => body.split('\n')[0]?.trim() === reviewHeading)
	if (!comments.length) {
		return {
			missing: `an independent review: post a comment whose first line is '${reviewHeading}' with 'head: ${head}'`,
		}
	}
	const shas = comments.flatMap((body) => reviewHead.exec(body)?.[1] ?? [])
	if (!shas.length) {
		return {
			wrong: `the independent review comment names no commit; add 'head: ${head}'`,
		}
	}
	const commits = gh(
		[
			'api',
			'--paginate',
			`repos/${repo}/pulls/${pr}/commits`,
			'--jq',
			'.[].sha',
		],
		root,
	)
		.split('\n')
		.filter(Boolean)
	commits.push(head)
	const onBranch = (sha: string) =>
		commits.some((c) => c.toLowerCase().startsWith(sha.toLowerCase()))
	if (shas.some(onBranch)) return {}
	return {
		wrong: `the independent review names no commit of this branch (head: ${shas.join(', ')}; the head is ${head})`,
	}
}

/** `reins policy --wait`: re-evaluates every `intervalMs` while the verdict
 *  waits on something that may still arrive, reading the head afresh each
 *  time so a push during the wait is followed. Gives up after `timeoutMs`
 *  with `timedOut` set and the message saying what it was still waiting for. */
export async function waitForMerge(
	root: string,
	prRef: string | undefined,
	{
		intervalMs = 20_000,
		timeoutMs = 20 * 60_000,
		evaluate = evaluateMerge,
		sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		onWait = (line) => console.error(line),
	}: WaitOptions = {},
): Promise<Verdict & { timedOut?: boolean }> {
	const started = Date.now()
	let last: string | undefined
	let polls = 0
	let unread = 0
	for (;;) {
		const verdict = evaluate(root, prRef)
		polls++
		// A read that fails once we have seen the PR is more likely a blip in
		// gh or the network than a refusal; the first poll fails fast on a bad
		// PR reference.
		if (verdict.unread && polls > 1 && ++unread <= 3) {
			await sleep(intervalMs)
			continue
		}
		if (verdict.waiting === undefined) return verdict
		unread = 0
		if (verdict.waiting !== last) {
			onWait(`policy: waiting for ${verdict.waiting}`)
			last = verdict.waiting
		}
		if (Date.now() - started >= timeoutMs) {
			return {
				...verdict,
				timedOut: true,
				message: `policy: gave up after ${Math.round(timeoutMs / 1000)}s, still waiting for ${verdict.waiting}.`,
			}
		}
		await sleep(intervalMs)
	}
}

/** The PR a `gh pr merge …` command names (number, URL or branch), if any. */
export function prRefFromCommand(command: string) {
	const tail = /\bmerge\b([^;&|]*)/.exec(command)?.[1] ?? ''
	const tokens = tail.trim().split(/\s+/).filter(Boolean)
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!
		if (token.startsWith('-')) {
			// options that take a value
			if (
				/^(-m|--match-head-commit|-b|--body|-t|--subject|-A|--author-email|-R|--repo)$/.test(
					token,
				)
			)
				i++
			continue
		}
		return token.replace(/^#/, '')
	}
	return undefined
}
