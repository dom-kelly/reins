import { spawnSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { packageRoot } from '../lib/repo.ts'
import { bodyField, prRefFromCommand } from './merge-policy.ts'

// Runs the real `reins policy` against a stubbed `gh` (fixtures/gh), one
// simulated PR per case, in a product with mealplanner-like tiers. A bypass here
// would let an agent merge to production.

let product: string
const GREEN = '[{"name":"validate","conclusion":"SUCCESS"}]'
const BUGBOT =
	'[{"name":"validate","conclusion":"SUCCESS"},{"name":"Cursor Bugbot","conclusion":"SUCCESS"}]'

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

function policy(pr: Record<string, string>) {
	const res = spawnSync(
		'node',
		[
			'--disable-warning=ExperimentalWarning',
			path.join(packageRoot, 'bin/reins.ts'),
			'policy',
			'7',
		],
		{
			cwd: product,
			encoding: 'utf8',
			env: {
				...process.env,
				PATH: `${path.join(packageRoot, 'src/policy/fixtures')}:${process.env.PATH}`,
				CHECKS: GREEN,
				...pr,
			},
		},
	)
	const out = `${res.stdout}\n${res.stderr}`.trim().split('\n')
	return { allowed: res.status === 0, message: out.at(-1) ?? '' }
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
			/not green/,
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
