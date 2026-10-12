import { spawnSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { packageRoot } from '../lib/repo.ts'
import {
	bodyField,
	prRefFromCommand,
	waitForMerge,
	type Verdict,
} from './merge-policy.ts'

// Runs the real `reins policy` against a stubbed `gh` (fixtures/gh), one
// simulated PR per case, in a product with mealplanner-like tiers. A bypass here
// would let an agent merge to production.

let product: string
const GREEN = '[{"name":"validate","conclusion":"SUCCESS"}]'
const BUGBOT =
	'[{"name":"validate","conclusion":"SUCCESS"},{"name":"Cursor Bugbot","conclusion":"SUCCESS"}]'
/** The comment ship-pr posts after the fresh-context review. */
const review = (head = 'abc1234', ...findings: Array<string>) =>
	JSON.stringify([
		['## Independent review', `head: ${head}`, '', ...findings].join('\n'),
	])

beforeAll(async () => {
	// The stub must be executable to shadow gh via PATH; editors can drop the bit.
	chmodSync(path.join(packageRoot, 'src/policy/fixtures/gh'), 0o755)
	product = await mkdtemp(path.join(tmpdir(), 'harness-policy-'))
	await mkdir(path.join(product, 'docs/contributing/architecture'), {
		recursive: true,
	})
	await mkdir(path.join(product, 'app/routes'), { recursive: true })
	await mkdir(path.join(product, 'drizzle'), { recursive: true })
	await mkdir(path.join(product, '.claude'), { recursive: true })
	await writeFile(
		path.join(product, 'docs/contributing/architecture/primitives.yaml'),
		`version: 1
unowned: [docs/, tests/]
unowned_suffixes: [.test.ts]
groups: [{ id: g, name: G }]
primitives:
  - { id: planner, group: g, name: Planner, summary: '', code: [app/routes/plan.tsx], floor: low }
  - { id: shopping, group: g, name: Shopping, summary: '', code: [app/routes/shopping.tsx], floor: medium }
  - { id: data, group: g, name: Data, summary: '', code: [drizzle/], floor: high }
  - { id: harness, group: g, name: Harness, summary: '', code: [.claude/], floor: high }
`,
	)
	await writeFile(
		path.join(product, 'reins.json'),
		JSON.stringify({
			harness: '0',
			product: { name: 'demo' },
			policy: {
				gate: 'validate',
				authority: { high: 'owner' },
				reviewers: {
					gate: [{ check: 'Cursor Bugbot', login: 'cursor' }],
					required: ['coderabbitai', 'devin-ai-integration'],
					findingsFrom: ['cursor', 'devin-ai-integration'],
					ignoreChecks: ['CodeRabbit'],
				},
			},
		}),
	)
})

afterAll(async () => {
	await rm(product, { recursive: true, force: true })
})

// Every simulated PR carries a valid independent review unless a case says
// otherwise, so the medium/high cases below exercise the rule's happy path.
function policy(pr: Record<string, string>, args: Array<string> = []) {
	const res = spawnSync(
		'node',
		[
			'--disable-warning=ExperimentalWarning',
			path.join(packageRoot, 'bin/reins.ts'),
			'policy',
			'7',
			...args,
		],
		{
			cwd: product,
			encoding: 'utf8',
			timeout: 30_000,
			env: {
				...process.env,
				PATH: `${path.join(packageRoot, 'src/policy/fixtures')}:${process.env.PATH}`,
				CHECKS: GREEN,
				COMMENTS: review(),
				...pr,
			},
		},
	)
	const out = `${res.stdout}\n${res.stderr}`.trim().split('\n')
	return {
		allowed: res.status === 0,
		status: res.status,
		message: out.at(-1) ?? '',
	}
}

describe('merge policy: who may merge', () => {
	it.each([
		['docs only, composes', { FILES: 'modified:docs/x.md' }, true, /low risk/],
		[
			'planner page, composes',
			{ FILES: 'modified:app/routes/plan.tsx' },
			true,
			/low risk/,
		],
		[
			'planner page, extends',
			{ FILES: 'modified:app/routes/plan.tsx', CHANGE: 'extends' },
			false,
			/Cursor Bugbot/,
		],
		[
			'shopping floor',
			{ FILES: 'modified:app/routes/shopping.tsx' },
			false,
			/risk=medium/,
		],
		[
			'shopping + Bugbot',
			{ FILES: 'modified:app/routes/shopping.tsx', CHECKS: BUGBOT },
			true,
			/medium risk/,
		],
		[
			'migration is high, parks',
			{
				FILES: 'added:drizzle/0009.sql',
				CHECKS: BUGBOT,
				REVIEWERS: 'coderabbitai devin-ai-integration',
			},
			false,
			/needs the user/,
		],
		[
			'high without required reviewers',
			{ FILES: 'added:drizzle/0009.sql', CHECKS: BUGBOT },
			false,
			/waiting for a review from coderabbitai/,
		],
		[
			'unmapped file is high',
			{ FILES: 'added:lib/new.ts', CHECKS: BUGBOT },
			false,
			/risk=high/,
		],
		[
			'one-way door is high',
			{ FILES: 'modified:docs/x.md', DOOR: 'one-way', CHECKS: BUGBOT },
			false,
			/risk=high/,
		],
		[
			'red CI',
			{
				FILES: 'modified:docs/x.md',
				CHECKS: '[{"name":"validate","conclusion":"FAILURE"}]',
			},
			false,
			/validate check/,
		],
		[
			'CodeRabbit stuck pending is ignored',
			{
				FILES: 'modified:docs/x.md',
				CHECKS:
					'[{"name":"validate","conclusion":"SUCCESS"},{"name":"CodeRabbit","state":"PENDING"}]',
			},
			true,
			/low risk/,
		],
		[
			'another check pending blocks',
			{
				FILES: 'modified:docs/x.md',
				CHECKS:
					'[{"name":"validate","conclusion":"SUCCESS"},{"name":"other","state":"PENDING"}]',
			},
			false,
			/waiting for checks to finish: other=PENDING/,
		],
		[
			'a running check run (no conclusion yet) blocks',
			{
				FILES: 'modified:docs/x.md',
				CHECKS:
					'[{"name":"validate","conclusion":"SUCCESS"},{"name":"other","status":"IN_PROGRESS"}]',
			},
			false,
			/waiting for checks to finish: other=RUNNING/,
		],
		[
			'the gate check not yet reported is waited for, not refused',
			{ FILES: 'modified:docs/x.md', CHECKS: '[]' },
			false,
			/waiting for the validate check to start on abc1234/,
		],
		[
			'the gate check as a pending status context is waited for',
			{
				FILES: 'modified:docs/x.md',
				CHECKS: '[{"context":"validate","state":"PENDING"}]',
			},
			false,
			/waiting for the validate check to finish/,
		],
		[
			'a failed check is refused before a running one is waited for',
			{
				FILES: 'modified:docs/x.md',
				CHECKS:
					'[{"name":"validate","conclusion":"SUCCESS"},{"name":"slow","status":"IN_PROGRESS"},{"name":"fast","conclusion":"FAILURE"}]',
			},
			false,
			/checks not green: fast=FAILURE/,
		],
		[
			'deleting a test',
			{ FILES: 'removed:tests/app/meals.test.ts' },
			false,
			/deletes tests/,
		],
		[
			'renaming a harness file into docs/ stays high',
			{ FILES: 'renamed:.claude/hooks/x.sh>docs/notes.md', CHECKS: BUGBOT },
			false,
			/risk=high/,
		],
		[
			'renaming within docs/ stays low',
			{ FILES: 'renamed:docs/a.md>docs/b.md' },
			true,
			/low risk/,
		],
	])('%s', (_name, pr, allowed, message) => {
		const result = policy(pr)
		expect(result.message).toMatch(message)
		expect(result.allowed).toBe(allowed)
	})
})

describe("merge policy: PR body can't be gamed", () => {
	it.each([
		["Door 'not two-way'", { DOOR: 'not two-way' }, /exactly one Door/],
		["Change 'discomposes'", { CHANGE: 'discomposes' }, /exactly one Change/],
		[
			'template left unfilled',
			{ CHANGE: 'composes` | `extends` | `adds' },
			/exactly one Change/,
		],
		['no Change line', { CHANGE: '' }, /exactly one Change/],
		[
			'two Door lines',
			{ DOOR: 'two-way`\n**Door:** `one-way' },
			/exactly one Door/,
		],
		[
			'two Change lines',
			{ CHANGE: 'composes`\n**Change:** `adds' },
			/exactly one Change/,
		],
	])('%s is refused', (_name, body, message) => {
		const result = policy({ FILES: 'modified:docs/x.md', ...body })
		expect(result.message).toMatch(message)
		expect(result.allowed).toBe(false)
	})
})

const thread = (reply?: string) =>
	JSON.stringify([
		{
			isResolved: false,
			comments: {
				nodes: [
					{ author: { login: 'cursor' }, body: 'bug' },
					...(reply ? [{ author: { login: 'dom-kelly' }, body: reply }] : []),
				],
			},
		},
	])

describe('merge policy: review findings (medium)', () => {
	const medium = { FILES: 'modified:app/routes/shopping.tsx', CHECKS: BUGBOT }

	it('blocks on an unanswered Bugbot finding', () => {
		expect(policy({ ...medium, THREADS: thread() })).toMatchObject({
			allowed: false,
		})
	})
	it('ignores unresolved threads from reviewers not in findingsFrom', () => {
		const other = JSON.stringify([
			{
				isResolved: false,
				comments: {
					nodes: [{ author: { login: 'coderabbitai' }, body: 'nit' }],
				},
			},
		])
		expect(policy({ ...medium, THREADS: other })).toMatchObject({
			allowed: true,
		})
	})
	it('a resolved thread is addressed', () => {
		const resolved = JSON.stringify([
			{
				isResolved: true,
				comments: { nodes: [{ author: { login: 'cursor' }, body: 'bug' }] },
			},
		])
		expect(policy({ ...medium, THREADS: resolved })).toMatchObject({
			allowed: true,
		})
	})
	it("doesn't count a vague reply", () => {
		expect(policy({ ...medium, THREADS: thread('thanks!') })).toMatchObject({
			allowed: false,
		})
	})
	it.each(['Fixed in abc1234: guard null', 'wontfix: intentional'])(
		'accepts %j',
		(reply) => {
			expect(policy({ ...medium, THREADS: thread(reply) })).toMatchObject({
				allowed: true,
			})
		},
	)
})

describe('merge policy: independent review (medium and high merged by an agent)', () => {
	const medium = { FILES: 'modified:app/routes/shopping.tsx', CHECKS: BUGBOT }

	it('allows with a review comment for the head', () => {
		expect(policy({ ...medium, COMMENTS: review('abc1234') })).toMatchObject({
			allowed: true,
		})
	})
	it('refuses without one, saying what to post', () => {
		const result = policy({ ...medium, COMMENTS: '[]' })
		expect(result.message).toMatch(
			/waiting for an independent review: post a comment whose first line is '## Independent review' with 'head: abc1234' \(risk=medium\)/,
		)
		expect(result.allowed).toBe(false)
	})
	it('refuses a comment that names a sha not on the branch, without waiting', () => {
		const result = policy(
			{ ...medium, COMMENTS: review('9999999'), COMMITS: 'def5678 abc1234' },
			['--wait'],
		)
		expect(result.message).toMatch(
			/Merge refused: the independent review names no commit of this branch \(head: 9999999; the head is abc1234\)/,
		)
		expect(result.status).toBe(2)
	})
	it('accepts a review of an earlier commit on the branch (fixes pushed after it)', () => {
		expect(
			policy({
				...medium,
				COMMENTS: review('def5678', '- nit\nFixed in abc1234: nit'),
				COMMITS: 'def5678 abc1234',
			}),
		).toMatchObject({ allowed: true })
	})
	it('matches the sha by prefix, whatever the case', () => {
		const long = 'ABC1234ABC1234ABC1234ABC1234ABC1234ABC12'
		expect(
			policy({
				...medium,
				HEAD: long.toLowerCase(),
				COMMENTS: review('abc1234ab'),
			}),
		).toMatchObject({ allowed: true })
		expect(
			policy({ ...medium, HEAD: long.toLowerCase(), COMMENTS: review(long) }),
		).toMatchObject({ allowed: true })
	})
	it('one valid review among stale ones is enough', () => {
		expect(
			policy({
				...medium,
				COMMENTS: JSON.stringify([
					'## Independent review\nhead: 9999999',
					'## Independent review\nhead: abc1234\nNo defects found',
				]),
			}),
		).toMatchObject({ allowed: true })
	})
	it('refuses a comment with no head line, without waiting', () => {
		const result = policy(
			{
				...medium,
				COMMENTS: JSON.stringify(['## Independent review\nNo defects found']),
			},
			['--wait'],
		)
		expect(result.message).toMatch(/names no commit; add 'head: abc1234'/)
		expect(result.status).toBe(2)
	})
	it('ignores a comment whose first line is something else', () => {
		const result = policy({
			...medium,
			COMMENTS: JSON.stringify([
				'Review notes\n## Independent review\nhead: abc1234',
			]),
		})
		expect(result.allowed).toBe(false)
	})
	it('low risk never needs it', () => {
		expect(
			policy({ FILES: 'modified:docs/x.md', COMMENTS: '[]' }),
		).toMatchObject({ allowed: true })
	})
	it('an owner tier parks without asking for it', () => {
		const result = policy({
			FILES: 'added:drizzle/0009.sql',
			CHECKS: BUGBOT,
			REVIEWERS: 'coderabbitai devin-ai-integration',
			COMMENTS: '[]',
		})
		expect(result.message).toMatch(/needs the user/)
		expect(result.allowed).toBe(false)
	})
	it('high merged by an agent needs it', async () => {
		const file = path.join(product, 'reins.json')
		const before = await import('node:fs').then((fs) =>
			fs.readFileSync(file, 'utf8'),
		)
		const cfg = JSON.parse(before)
		cfg.policy.authority = { high: 'agent' }
		cfg.policy.reviewers = {}
		await writeFile(file, JSON.stringify(cfg))
		try {
			const high = { FILES: 'added:drizzle/0009.sql' }
			expect(policy({ ...high, COMMENTS: '[]' }).message).toMatch(
				/independent review.*\(risk=high\)/,
			)
			expect(policy(high)).toMatchObject({ allowed: true })
		} finally {
			await writeFile(file, before)
		}
	})
	it('policy.independentReview: false switches it off', async () => {
		const file = path.join(product, 'reins.json')
		const before = await import('node:fs').then((fs) =>
			fs.readFileSync(file, 'utf8'),
		)
		const cfg = JSON.parse(before)
		cfg.policy.independentReview = false
		await writeFile(file, JSON.stringify(cfg))
		try {
			expect(policy({ ...medium, COMMENTS: '[]' })).toMatchObject({
				allowed: true,
			})
		} finally {
			await writeFile(file, before)
		}
	})
})

/** The exact refusal for a reviewer that reins.json names but the repo has never seen. */
const refusal = (name: string, kind: string) =>
	`Merge refused: \`${name}\` is configured in reins.json as a ${kind} but has never run on this repo: install the app or remove it from \`policy.reviewers\`. See docs/contributing/shipping-policy.md.`

describe('merge policy: a declared reviewer must exist on the repo', () => {
	const medium = { FILES: 'modified:app/routes/shopping.tsx' }
	const high = { FILES: 'added:drizzle/0009.sql', CHECKS: BUGBOT }
	/** Three PRs on which no reviewer app has ever run. */
	const bare = JSON.stringify([
		{ checks: ['validate'], logins: ['dom-kelly'] },
		{ checks: ['validate'] },
		{ checks: ['validate'] },
	])
	it('refuses at once, not waits, for a gate check that has never appeared', () => {
		const result = policy({ ...medium, PRS: bare }, ['--wait'])
		expect(result.message).toBe(refusal('Cursor Bugbot', 'gate check'))
		expect(result.status).toBe(2)
	})
	it('refuses at once for a required login that has never appeared', () => {
		const result = policy({ ...high, PRS: bare, REVIEWERS: 'coderabbitai' }, [
			'--wait',
		])
		expect(result.message).toBe(
			refusal('devin-ai-integration', 'required reviewer'),
		)
		expect(result.status).toBe(2)
	})
	it('still waits for a reviewer that appeared on an earlier PR but not this head', () => {
		// The default history has Bugbot's check, and devin's login with a
		// `[bot]` suffix that GitHub's REST API adds.
		const gate = policy(medium, ['--wait', '--timeout', '0'])
		expect(gate.message).toMatch(/still waiting for Cursor Bugbot to pass/)
		expect(gate.status).toBe(1)
		const required = policy({ ...high, REVIEWERS: 'coderabbitai' }, [
			'--wait',
			'--timeout',
			'0',
		])
		expect(required.message).toMatch(
			/still waiting for a review from devin-ai-integration on the current commit/,
		)
		expect(required.status).toBe(1)
	})
	it("counts the current PR's own checks and reviews as having appeared", () => {
		const result = policy(
			{
				...high,
				PRS: bare,
				REVIEWERS: 'coderabbitai devin-ai-integration@def5678',
			},
			['--wait', '--timeout', '0'],
		)
		expect(result.message).toMatch(
			/still waiting for a review from devin-ai-integration/,
		)
		expect(result.status).toBe(1)
	})
	it('falls back to waiting with fewer than three PRs of history', () => {
		const two = JSON.stringify([{ checks: ['validate'] }, { checks: [] }])
		const result = policy({ ...medium, PRS: two }, ['--wait', '--timeout', '0'])
		expect(result.message).toMatch(/still waiting for Cursor Bugbot to pass/)
		expect(result.status).toBe(1)
	})
	it('falls back to waiting when the lookup fails', () => {
		const result = policy({ ...medium, PRS: 'fail' }, [
			'--wait',
			'--timeout',
			'0',
		])
		expect(result.message).toMatch(/still waiting for Cursor Bugbot to pass/)
		expect(result.status).toBe(1)
	})
})

const pending = (what: string): Verdict => ({
	allowed: false,
	message: `Merge refused: waiting for ${what}.`,
	lines: [],
	waiting: what,
})

describe('merge policy: --wait', () => {
	const done: Verdict = { allowed: true, message: 'ok', lines: ['l'] }

	it('polls while the verdict waits on something, then returns it', async () => {
		const verdicts = [pending('ci'), pending('ci'), pending('review'), done]
		const slept: Array<number> = []
		const waited: Array<string> = []
		const result = await waitForMerge('.', '7', {
			intervalMs: 5,
			evaluate: () => verdicts.shift()!,
			sleep: async (ms) => {
				slept.push(ms)
			},
			onWait: (line) => waited.push(line),
		})
		expect(result).toEqual(done)
		expect(slept).toEqual([5, 5, 5])
		// One progress line per change of reason, not per poll.
		expect(waited).toEqual([
			'policy: waiting for ci',
			'policy: waiting for review',
		])
	})
	it('returns a refusal at once', async () => {
		const no: Verdict = {
			allowed: false,
			message: 'Merge refused: x.',
			lines: [],
		}
		let polls = 0
		const result = await waitForMerge('.', '7', {
			evaluate: () => (polls++, no),
			sleep: async () => {},
			onWait: () => {},
		})
		expect(result).toEqual(no)
		expect(polls).toBe(1)
	})
	it('retries a few failed reads mid-wait, but not on the first poll', async () => {
		const unread: Verdict = {
			allowed: false,
			message: "Merge refused: couldn't read the PR.",
			lines: [],
			unread: true,
		}
		const blips = [pending('ci'), unread, unread, done]
		const result = await waitForMerge('.', '7', {
			evaluate: () => blips.shift()!,
			sleep: async () => {},
			onWait: () => {},
		})
		expect(result).toEqual(done)
		const first = await waitForMerge('.', '7', {
			evaluate: () => unread,
			sleep: async () => {},
			onWait: () => {},
		})
		expect(first).toEqual(unread)
		const persistent = [pending('ci'), unread, unread, unread, unread]
		expect(
			await waitForMerge('.', '7', {
				evaluate: () => persistent.shift()!,
				sleep: async () => {},
				onWait: () => {},
			}),
		).toEqual(unread)
	})
	it('gives up after the timeout, saying what it was still waiting for', async () => {
		const result = await waitForMerge('.', '7', {
			timeoutMs: 0,
			evaluate: () => pending('the validate check to finish on abc1234'),
			sleep: async () => {},
			onWait: () => {},
		})
		expect(result.timedOut).toBe(true)
		expect(result.allowed).toBe(false)
		expect(result.message).toBe(
			'policy: gave up after 0s, still waiting for the validate check to finish on abc1234.',
		)
	})
	it('from the CLI: --timeout is valued, exit 1 on timeout, 0 when nothing is pending', () => {
		const running = {
			FILES: 'modified:docs/x.md',
			CHECKS: '[{"name":"validate","status":"IN_PROGRESS"}]',
		}
		const timedOut = policy(running, ['--wait', '--timeout', '0'])
		expect(timedOut.status).toBe(1)
		expect(timedOut.message).toMatch(
			/gave up after 0s, still waiting for the validate check to finish on abc1234/,
		)
		expect(policy({ FILES: 'modified:docs/x.md' }, ['--wait'])).toMatchObject({
			status: 0,
		})
		expect(
			policy(
				{ ...running, CHECKS: '[{"name":"validate","conclusion":"FAILURE"}]' },
				['--wait'],
			),
		).toMatchObject({ status: 2 })
	})
})

describe('merge policy: config comes from origin/main, not the working tree', () => {
	it('ignores an uncommitted change to authority or floors', async () => {
		const { execFileSync } = await import('node:child_process')
		const git = (...args: Array<string>) =>
			execFileSync('git', args, { cwd: product, stdio: 'ignore' })
		git('init', '-q', '-b', 'main')
		git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.')
		git(
			'-c',
			'user.email=t@t',
			'-c',
			'user.name=t',
			'commit',
			'-q',
			'-m',
			'base',
		)
		git('update-ref', 'refs/remotes/origin/main', 'HEAD')
		const file = path.join(product, 'reins.json')
		const before = await import('node:fs').then((fs) =>
			fs.readFileSync(file, 'utf8'),
		)
		const cfg = JSON.parse(before)
		cfg.policy.authority = { high: 'agent' }
		cfg.policy.reviewers = {}
		await writeFile(file, JSON.stringify(cfg))
		try {
			const result = policy({
				FILES: 'added:drizzle/0009.sql',
				CHECKS: BUGBOT,
				REVIEWERS: 'coderabbitai devin-ai-integration',
			})
			expect(result.message).toMatch(/needs the user/)
			expect(result.allowed).toBe(false)
		} finally {
			await writeFile(file, before)
			await rm(path.join(product, '.git'), { recursive: true, force: true })
		}
	})
	it('reads harness.json from origin/main until the product has migrated', async () => {
		const { execFileSync } = await import('node:child_process')
		const git = (...args: Array<string>) =>
			execFileSync('git', args, { cwd: product, stdio: 'ignore' })
		const file = path.join(product, 'reins.json')
		const legacy = path.join(product, 'harness.json')
		const before = await import('node:fs').then((fs) =>
			fs.readFileSync(file, 'utf8'),
		)
		const cfg = JSON.parse(before)
		cfg.policy.authority = { high: 'agent' }
		cfg.policy.reviewers = {}
		await writeFile(legacy, JSON.stringify(cfg))
		await rm(file)
		git('init', '-q', '-b', 'main')
		git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.')
		git(
			'-c',
			'user.email=t@t',
			'-c',
			'user.name=t',
			'commit',
			'-q',
			'-m',
			'base',
		)
		git('update-ref', 'refs/remotes/origin/main', 'HEAD')
		try {
			// Without the old name the default (high: owner) would park this.
			expect(
				policy({ FILES: 'added:drizzle/0009.sql', CHECKS: BUGBOT }),
			).toMatchObject({ allowed: true })
		} finally {
			await writeFile(file, before)
			await rm(legacy)
			await rm(path.join(product, '.git'), { recursive: true, force: true })
		}
	})
})

describe('merge policy: authority is per repo', () => {
	it('parks medium when the repo says owner', async () => {
		const file = path.join(product, 'reins.json')
		const before = await import('node:fs').then((fs) =>
			fs.readFileSync(file, 'utf8'),
		)
		const cfg = JSON.parse(before)
		cfg.policy.authority = { medium: 'owner' }
		await writeFile(file, JSON.stringify(cfg))
		try {
			expect(
				policy({ FILES: 'modified:app/routes/shopping.tsx', CHECKS: BUGBOT }),
			).toMatchObject({ allowed: false })
		} finally {
			await writeFile(file, before)
		}
	})
	it('lets an agent merge high risk when the repo says so', async () => {
		const file = path.join(product, 'reins.json')
		const before = await import('node:fs').then((fs) =>
			fs.readFileSync(file, 'utf8'),
		)
		const cfg = JSON.parse(before)
		cfg.policy.authority = { high: 'agent' }
		cfg.policy.reviewers = {}
		await writeFile(file, JSON.stringify(cfg))
		try {
			expect(policy({ FILES: 'added:drizzle/0009.sql' })).toMatchObject({
				allowed: true,
			})
		} finally {
			await writeFile(file, before)
		}
	})
})

it('body fields and PR numbers parse exactly', () => {
	expect(bodyField('**Door:** `two-way`', 'Door', ['two-way', 'one-way'])).toBe(
		'two-way',
	)
	expect(
		bodyField('**Door:** `two-way` | `one-way`', 'Door', [
			'two-way',
			'one-way',
		]),
	).toBeUndefined()
	expect(
		bodyField('**Door:** `two-way`\n**Door:** `one-way`', 'Door', [
			'two-way',
			'one-way',
		]),
	).toBeUndefined()
	expect(prRefFromCommand('gh pr merge 42 --squash')).toBe('42')
	expect(prRefFromCommand('gh pr merge --squash #7')).toBe('7')
	expect(prRefFromCommand('gh pr merge --squash')).toBeUndefined()
	expect(
		prRefFromCommand('gh pr merge https://github.com/o/r/pull/99 --squash'),
	).toBe('https://github.com/o/r/pull/99')
	expect(
		prRefFromCommand('gh pr merge my-branch --match-head-commit abc --squash'),
	).toBe('my-branch')
	expect(prRefFromCommand('gh pr merge --match-head-commit abc 12')).toBe('12')
})
