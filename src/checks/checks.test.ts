import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { findBlockedReason, guardDecision } from '../hooks/guard-bash.ts'
import { isDocsOnly, parsePrePushInput } from '../hooks/git-hooks.ts'
import { findDecisionIssues } from './decisions.ts'
import { extractRelativeLinks } from './doc-links.ts'
import { nodeVersionIssue } from './node-version.ts'
import {
	classifyFiles,
	riskFloor,
	summarizeChanges,
	validateMap,
	type PrimitivesMap,
} from './primitives.ts'
import { checkRepoRules } from './repo-rules.ts'
import { findSkillIssues } from './skills.ts'

test('decision records reject duplicates and unindexed files', () => {
	const issues = findDecisionIssues(
		['index.md', '0000-template.md', '0001-a.md', '0001-b.md', '0002-c-lab.md'],
		'./0001-a.md ./0001-b.md',
	)
	expect(issues.map((i) => i.message)).toEqual([
		'duplicate number 0001 (also 0001-a.md)',
		'not linked from decisions/index.md',
	])
})

test('decision headings must match their number', () => {
	const issues = findDecisionIssues(
		['index.md', '0003-x.md'],
		'./0003-x.md',
		new Map([['0003-x.md', '# 0004: wrong']]),
	)
	expect(issues.map((i) => i.message)).toEqual([
		'first heading must start with "# 0003:"',
	])
})

test('relative links are extracted; urls, anchors and html comments skipped', () => {
	expect(
		extractRelativeLinks('[a](./x.md#h) [b](https://x.dev) [c](#top)'),
	).toEqual([{ target: './x.md', line: 1 }])
	expect(extractRelativeLinks('<!-- see [x](./missing.md) -->')).toEqual([])
})

test('skills need matching name and a real description', () => {
	const ok = `---\nname: demo\ndescription: Does a thing. Use when the user asks for the thing to happen.\n---\n# Demo`
	expect(findSkillIssues('.claude/skills/demo/SKILL.md', ok)).toEqual([])
	expect(findSkillIssues('.claude/skills/other/SKILL.md', ok)).toHaveLength(1)
})

const map: PrimitivesMap = {
	version: 1,
	unowned: ['docs/', 'tests/'],
	unowned_suffixes: ['.test.ts'],
	groups: [{ id: 'g', name: 'G' }],
	primitives: [
		{ id: 'app', group: 'g', name: 'App', summary: '', code: ['src'] },
		{
			id: 'api',
			group: 'g',
			name: 'API',
			summary: '',
			code: ['src/api'],
			floor: 'medium',
		},
		{
			id: 'harness',
			group: 'g',
			name: 'Harness',
			summary: '',
			code: ['docs/contributing/shipping-policy.md', '.claude/'],
			floor: 'high',
		},
	],
}

test('classification: longest root wins, including unowned prefixes', () => {
	const { touched, unowned, excluded } = classifyFiles(map, [
		'src/api/x.ts',
		'src/y.ts',
		'src/y.test.ts',
		'docs/contributing/shipping-policy.md',
		'docs/contributing/index.md',
		'lib/new.ts',
	])
	expect(Object.fromEntries(touched)).toEqual({
		api: ['src/api/x.ts'],
		app: ['src/y.ts'],
		harness: ['docs/contributing/shipping-policy.md'],
	})
	expect(unowned).toEqual(['lib/new.ts'])
	expect(excluded).toEqual(['src/y.test.ts', 'docs/contributing/index.md'])
})

test('risk floor is the highest touched floor; unmapped code is high', () => {
	const floor = (files: Array<string>) =>
		riskFloor(map, classifyFiles(map, files))
	expect(floor(['docs/contributing/index.md'])).toBe('low')
	expect(floor(['src/y.ts'])).toBe('low')
	expect(floor(['src/y.ts', 'src/api/x.ts'])).toBe('medium')
	expect(floor(['src/api/x.ts', '.claude/settings.json'])).toBe('high')
	expect(floor(['lib/new.ts'])).toBe('high')
	expect(summarizeChanges(map, ['src/api/x.ts']).primitives[0]).toMatchObject({
		id: 'api',
		floor: 'medium',
	})
})

test('map validation reports unknown groups, invariants, floors and paths', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'harness-map-'))
	try {
		await mkdir(path.join(root, 'src'), { recursive: true })
		const bad: PrimitivesMap = {
			...map,
			invariants: [{ id: 'known', statement: 's' }],
			primitives: [
				{
					id: 'app',
					group: 'nope',
					name: 'App',
					summary: 'x'.repeat(121),
					code: ['src'],
					docs: ['docs/missing.md'],
					invariants: ['missing'],
					floor: 'extreme' as never,
				},
			],
		}
		expect(validateMap(bad, root, []).map((i) => i.message)).toEqual([
			'app: summary must be one line, at most 120 chars',
			'app: floor must be low, medium or high',
			'app: unknown invariant id missing',
			'app: unknown group nope',
			'app: path docs/missing.md does not exist',
		])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('docs-only detection', () => {
	expect(
		isDocsOnly(['docs/a.md', 'README.md', '.agents/skills/x/SKILL.md']),
	).toBe(true)
	expect(isDocsOnly(['docs/a.md', 'src/x.ts'])).toBe(false)
	expect(isDocsOnly([])).toBe(false)
})

test('pre-push input skips deleted refs', () => {
	const zero = '0'.repeat(40)
	const a = 'a'.repeat(40)
	const b = 'b'.repeat(40)
	const input = `refs/heads/x ${a} refs/heads/x ${b}\n(delete) ${zero} refs/heads/y ${a}\n`
	expect(parsePrePushInput(input)).toEqual([{ localSha: a, remoteSha: b }])
})

test('git hooks require the node major in .nvmrc', () => {
	expect(nodeVersionIssue('22.22.0', '22\n')).toBeUndefined()
	expect(nodeVersionIssue('22.9.0', '22')).toMatch(/>= 22.18/)
	expect(nodeVersionIssue('23.6.1', '22')).toMatch(/have 23.6.1/)
	expect(nodeVersionIssue('24.1.0', 'v24.1')).toBeUndefined()
	expect(nodeVersionIssue('24.0.5', '24.1')).toBeDefined()
})

test('guard blocks force push, push to main, no-verify, destructive resets, admin merges', () => {
	expect(findBlockedReason('git push --force origin x')).toBeDefined()
	expect(findBlockedReason('git push -f')).toBeDefined()
	expect(
		findBlockedReason('git push origin x --force-with-lease'),
	).toBeDefined()
	expect(findBlockedReason('git push origin main')).toBeDefined()
	expect(findBlockedReason('git push origin HEAD:main')).toBeDefined()
	expect(findBlockedReason('git push origin main;')).toBeDefined()
	expect(findBlockedReason('sh -c "git push origin main"')).toBeDefined()
	expect(findBlockedReason('git -C . push origin main')).toBeDefined()
	expect(
		findBlockedReason('git push origin HEAD:refs/heads/main'),
	).toBeDefined()
	expect(findBlockedReason('git push origin +main')).toBeDefined()
	expect(findBlockedReason('git push -fu origin x')).toBeDefined()
	expect(findBlockedReason('git commit -n -m x')).toBeDefined()
	expect(findBlockedReason('git clean --force')).toBeDefined()
	expect(findBlockedReason('git push -n origin feature')).toBeUndefined()
	expect(findBlockedReason('git commit -m x --no-verify')).toBeDefined()
	expect(findBlockedReason('git reset --hard HEAD~1')).toBeDefined()
	expect(findBlockedReason('gh pr merge 7 --admin')).toBeDefined()
	expect(findBlockedReason('git push -u origin feature')).toBeUndefined()
	expect(findBlockedReason('git push origin maintenance-fix')).toBeUndefined()
	expect(findBlockedReason('gh pr merge 7 --squash')).toBeUndefined()
	expect(findBlockedReason('git status')).toBeUndefined()
	expect(
		findBlockedReason('npx wrangler deploy', [
			{ regex: /wrangler\s+deploy/, reason: 'deploying' },
		]),
	).toBe('deploying')
})

test('repo rules: one lockfile and a short AGENTS.md', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'harness-rules-'))
	try {
		await writeFile(path.join(root, 'pnpm-lock.yaml'), '')
		await writeFile(path.join(root, 'AGENTS.md'), 'x\n'.repeat(25))
		const { issues } = checkRepoRules(root, {
			harness: '0',
			product: { name: 'x' },
		})
		expect(issues.map((i) => i.file)).toEqual(['pnpm-lock.yaml', 'AGENTS.md'])
		const relaxed = checkRepoRules(root, {
			harness: '0',
			product: { name: 'x' },
			checks: { lockfile: 'pnpm', agentsMaxLines: 30 },
		})
		expect(relaxed.issues).toEqual([])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

/** A repo whose origin/main is its first commit, so `git diff origin/main`
 *  sees the working tree's edits. */
async function repoWithMain(root: string, files: Record<string, string>) {
	const git = (...args: Array<string>) =>
		execFileSync('git', args, { cwd: root, stdio: 'ignore' })
	git('init', '-q', '-b', 'main')
	for (const [name, content] of Object.entries(files)) {
		await mkdir(path.dirname(path.join(root, name)), { recursive: true })
		await writeFile(path.join(root, name), content)
	}
	git('add', '.')
	git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base')
	git('update-ref', 'refs/remotes/origin/main', 'HEAD')
}

test('repo rules: shipped changes need a version bump and a changelog entry', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'harness-bump-'))
	try {
		await repoWithMain(root, {
			'package.json': '{ "version": "0.1.0" }\n',
			'CHANGELOG.md': '# Changelog\n\n## [0.1.0]\n\n- first\n',
			'src/a.ts': 'export const a = 1\n',
			'docs/a.md': 'docs\n',
		})
		const config = {
			harness: '0',
			product: { name: 'x' },
			checks: { bumpVersionWhen: ['src/', 'package.json'] },
		}
		const messages = () =>
			checkRepoRules(root, config).issues.map((i) => `${i.file}: ${i.message}`)
		// A rule that is not configured never looks at git.
		expect(
			checkRepoRules(root, { harness: '0', product: { name: 'x' } }).issues,
		).toEqual([])
		expect(messages()).toEqual([])
		await writeFile(path.join(root, 'docs/a.md'), 'docs changed\n')
		expect(messages()).toEqual([])
		await writeFile(path.join(root, 'src/a.ts'), 'export const a = 2\n')
		expect(messages()).toEqual([
			expect.stringMatching(
				/^package\.json: 1 shipped file\(s\) changed since origin\/main \(src\/a\.ts\) but version is still 0\.1\.0; bump it/,
			),
		])
		await writeFile(path.join(root, 'package.json'), '{ "version": "0.2.0" }\n')
		expect(messages()).toEqual([
			expect.stringMatching(/^CHANGELOG\.md: .*no `## \[0\.2\.0\]` heading/),
		])
		await writeFile(
			path.join(root, 'CHANGELOG.md'),
			'# Changelog\n\n## [0.2.0] - 2026-10-12\n\n- more\n\n## [0.1.0]\n\n- first\n',
		)
		expect(messages()).toEqual([])
		// No origin/main (a fresh repo): nothing to compare, so no issue.
		execFileSync('git', ['update-ref', '-d', 'refs/remotes/origin/main'], {
			cwd: root,
		})
		expect(messages()).toEqual([])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('guard decision reads hook input and blocks on a broken custom pattern', () => {
	const input = JSON.stringify({
		tool_input: { command: 'npx wrangler deploy' },
	})
	expect(guardDecision(input, undefined)).toBeUndefined()
	expect(
		guardDecision(input, {
			harness: '0',
			product: { name: 'x' },
			guard: {
				blocked: [{ pattern: 'wrangler\\s+deploy', reason: 'deploys' }],
			},
		}),
	).toBe('deploys')
	expect(
		guardDecision(input, {
			harness: '0',
			product: { name: 'x' },
			guard: { blocked: [{ pattern: '(', reason: 'broken' }] },
		}),
	).toMatch(/invalid pattern/)
})

const cmd = (command: string) => JSON.stringify({ tool_input: { command } })

test('guard refuses API and cross-repo merges, and blocks when the policy cannot run', () => {
	expect(
		guardDecision(cmd('gh api -X PUT repos/o/r/pulls/7/merge'), undefined),
	).toMatch(/API/)
	expect(
		guardDecision(
			cmd("gh api graphql -f query='mutation{mergePullRequest(input:{})}'"),
			undefined,
		),
	).toMatch(/API/)
	expect(
		guardDecision(cmd('gh pr merge 7 --repo other/repo'), undefined),
	).toMatch(/another repo/)
	expect(
		guardDecision(
			cmd('gh pr merge 7 --squash'),
			undefined,
			'/nonexistent-root-for-policy',
		),
	).toMatch(/Merge refused/)
	expect(
		guardDecision(
			cmd('gh pr merge 7'),
			{
				harness: '0',
				product: { name: 'x' },
				policy: { enforceOnMerge: false },
			},
			'/nonexistent',
		),
	).toBeUndefined()
})
