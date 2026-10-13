import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
	applyRelease,
	compareVersions,
	formatEntry,
	fragmentFiles,
	latestTag,
	nextVersion,
	parseFragment,
	planRelease,
} from './release.ts'

test('a fragment is a bump kind then the changelog text', () => {
	expect(parseFragment('changes/a.md', 'patch\n\n- Fixed.\n')).toEqual({
		file: 'changes/a.md',
		kind: 'patch',
		note: '- Fixed.',
	})
	expect(parseFragment('changes/a.md', '\nMinor\n- New.\n').kind).toBe('minor')
	expect(() => parseFragment('changes/a.md', 'major\n- x')).toThrow(
		/first line must be one of patch, minor/,
	)
	expect(() => parseFragment('changes/a.md', 'patch\n\n')).toThrow(
		/no changelog text/,
	)
})

test('versions compare numerically and bump below 1.0 without a major', () => {
	expect(compareVersions('0.4.10', '0.4.9')).toBeGreaterThan(0)
	expect(compareVersions('v0.4.1', '0.4.1')).toBe(0)
	expect(nextVersion('0.4.9', 'patch')).toBe('0.4.10')
	expect(nextVersion('0.4.9', 'minor')).toBe('0.5.0')
})

async function repo(root: string, version: string, tags: Array<string>) {
	const git = (...args: Array<string>) =>
		execFileSync('git', args, { cwd: root, stdio: 'ignore' })
	git('init', '-q', '-b', 'main')
	await mkdir(path.join(root, 'plugin/.claude-plugin'), { recursive: true })
	await writeFile(
		path.join(root, 'package.json'),
		`${JSON.stringify({ name: 'x', version }, null, '\t')}\n`,
	)
	await writeFile(
		path.join(root, 'package-lock.json'),
		`${JSON.stringify({ name: 'x', version, packages: { '': { name: 'x', version } } }, null, '\t')}\n`,
	)
	await writeFile(
		path.join(root, 'plugin/.claude-plugin/plugin.json'),
		`${JSON.stringify({ name: 'x', version }, null, '\t')}\n`,
	)
	await writeFile(
		path.join(root, 'CHANGELOG.md'),
		'# Changelog\n\nIntro.\n\n## [0.4.1] - 2026-10-12\n\n- Before.\n',
	)
	await mkdir(path.join(root, 'changes'))
	await writeFile(path.join(root, 'changes/README.md'), '# notes\n')
	await mkdir(path.join(root, 'scaffold/app-node'), { recursive: true })
	const spec = `git+https://github.com/dom-kelly/reins.git#semver:^${version.split('.').slice(0, 2).join('.')}.0`
	await writeFile(
		path.join(root, 'scaffold/app-node/package.json'),
		`${JSON.stringify({ devDependencies: { '@dom-kelly/reins': spec } }, null, '\t')}\n`,
	)
	await writeFile(path.join(root, 'README.md'), `npm i -D "${spec}"\n`)
	git('add', '.')
	git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base')
	for (const tag of tags) git('tag', tag)
	return git
}

test('a release folds the notes into the changelog and writes the version everywhere', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'reins-release-'))
	try {
		await repo(root, '0.4.1', ['v0.4.0', 'v0.4.1', 'not-a-version'])
		expect(latestTag(root)).toBe('0.4.1')
		expect(planRelease(root)).toBeUndefined()
		await writeFile(path.join(root, 'changes/b-fix.md'), 'patch\n\n- A fix.\n')
		await writeFile(
			path.join(root, 'changes/a-feature.md'),
			'minor\n\n- A feature,\n  wrapped.\n',
		)
		expect(fragmentFiles(root)).toEqual([
			'changes/a-feature.md',
			'changes/b-fix.md',
		])
		const plan = planRelease(root)!
		expect(plan).toMatchObject({
			from: '0.4.1',
			version: '0.5.0',
			kind: 'minor',
		})
		expect(formatEntry(plan, '2026-10-13')).toBe(
			'## [0.5.0] - 2026-10-13\n\n- A feature,\n  wrapped.\n\n- A fix.',
		)
		const { files } = applyRelease(root, plan, '2026-10-13')
		expect(files).toEqual([
			'package.json',
			'package-lock.json',
			'plugin/.claude-plugin/plugin.json',
			'scaffold/app-node/package.json',
			'README.md',
			'CHANGELOG.md',
			'changes/a-feature.md',
			'changes/b-fix.md',
		])
		// A minor moves the range products pin.
		for (const file of ['scaffold/app-node/package.json', 'README.md']) {
			expect(await readFile(path.join(root, file), 'utf8'), file).toContain(
				'#semver:^0.5.0',
			)
		}
		for (const file of files.slice(0, 3)) {
			expect(
				JSON.parse(await readFile(path.join(root, file), 'utf8')).version,
				file,
			).toBe('0.5.0')
		}
		expect(
			JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
				.packages[''].version,
		).toBe('0.5.0')
		expect(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8')).toBe(
			'# Changelog\n\nIntro.\n\n## [0.5.0] - 2026-10-13\n\n- A feature,\n  wrapped.\n\n- A fix.\n\n## [0.4.1] - 2026-10-12\n\n- Before.\n',
		)
		expect(fragmentFiles(root)).toEqual([])
		// The notes are gone, so the same tree releases nothing more.
		expect(planRelease(root)).toBeUndefined()
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

// A by-hand bump (the old rule, still accepted) that merged but was not
// tagged yet is the real floor; a note on top of it bumps from there.
test('a release moves from package.json when it is ahead of the newest tag', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'reins-release-ahead-'))
	try {
		await repo(root, '0.4.3', ['v0.4.1'])
		await writeFile(path.join(root, 'changes/c.md'), 'patch\n\n- c\n')
		const plan = planRelease(root)!
		expect(plan).toMatchObject({ from: '0.4.3', version: '0.4.4' })
		// A patch leaves the range alone.
		expect(applyRelease(root, plan, '2026-10-13').files).not.toContain(
			'README.md',
		)
		expect(await readFile(path.join(root, 'README.md'), 'utf8')).toContain(
			'#semver:^0.4.0',
		)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
