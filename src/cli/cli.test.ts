import { existsSync } from 'node:fs'
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { checkDocLinks } from '../checks/doc-links.ts'
import { runChecks } from '../checks/run.ts'
import {
	configFile,
	legacyConfigFile,
	packageVersion,
	readConfig,
	writeConfig,
} from '../lib/config.ts'
import { listFiles, packageRoot } from '../lib/repo.ts'
import {
	applyTemplates,
	baseDir,
	dependencySpec,
	legacyBaseDir,
	loadManifest,
	mergeThreeWay,
	migratePackageJson,
	syncTemplates,
} from '../lib/templates.ts'
import { adoptRepo, patchPackageJson } from './adopt.ts'
import { parseArgs } from './args.ts'
import { doctor, doctorPassed, formatDoctor } from './doctor.ts'
import { createProduct } from './new.ts'

async function tmp(prefix: string) {
	return mkdtemp(path.join(tmpdir(), `harness-${prefix}-`))
}

test('new: a product has every template, reins.json, and passes the checks', async () => {
	const dir = await tmp('new')
	try {
		const { root, report } = createProduct(path.join(dir, 'my-product'), {
			install: false,
			git: false,
		})
		expect(report.written).toContain('CLAUDE.md')
		expect(existsSync(path.join(root, 'src/server.ts'))).toBe(true)
		expect(existsSync(path.join(root, '.gitignore'))).toBe(true)
		expect(existsSync(path.join(root, 'gitignore'))).toBe(false)
		expect(existsSync(path.join(root, baseDir, 'CLAUDE.md'))).toBe(true)
		expect(readConfig(root)?.product.name).toBe('my-product')
		expect(await readFile(path.join(root, 'package.json'), 'utf8')).toContain(
			'"name": "my-product"',
		)
		const results = await runChecks(root)
		expect(results.flatMap((r) => r.issues)).toEqual([])
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

test('adopt keeps existing files and only adds to package.json', async () => {
	const root = await tmp('adopt')
	try {
		await writeFile(
			path.join(root, 'package.json'),
			JSON.stringify({ name: 'meals', scripts: { test: 'vitest run' } }),
		)
		await writeFile(path.join(root, 'CLAUDE.md'), '# mine\n')
		const result = adoptRepo(root)
		expect(result.name).toBe('meals')
		expect(result.report.kept).toContain('CLAUDE.md')
		expect(await readFile(path.join(root, 'CLAUDE.md'), 'utf8')).toBe(
			'# mine\n',
		)
		expect(result.report.written).toContain('.claude/skills/ship-pr/SKILL.md')
		const pkg = JSON.parse(
			await readFile(path.join(root, 'package.json'), 'utf8'),
		)
		expect(pkg.scripts.test).toBe('vitest run')
		expect(pkg.scripts.reins).toBe('reins')
		expect(pkg.devDependencies['@dom-kelly/reins']).toBe(dependencySpec)
		expect(patchPackageJson(JSON.stringify(pkg)).added).toEqual([])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('products pin the harness to a semver range on tags, the same in adopt and the scaffold', async () => {
	const [major, minor] = packageVersion.split('.')
	expect(dependencySpec).toBe(
		`git+https://github.com/dom-kelly/reins.git#semver:^${major}.${minor}.0`,
	)
	const scaffold = JSON.parse(
		await readFile(
			path.join(packageRoot, 'scaffold/app-node/package.json'),
			'utf8',
		),
	)
	expect(
		scaffold.devDependencies['@dom-kelly/reins'],
		'scaffold/app-node/package.json must pin the current major.minor',
	).toBe(dependencySpec)
})

async function fakeTemplates(dir: string, files: Record<string, string>) {
	for (const [rel, content] of Object.entries(files)) {
		await mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
		await writeFile(path.join(dir, rel), content)
	}
	await writeFile(
		path.join(dir, 'manifest.json'),
		JSON.stringify({
			managed: Object.keys(files).filter((f) => f.startsWith('managed')),
			owned: Object.keys(files).filter((f) => f.startsWith('owned')),
		}),
	)
}

test('sync: updates untouched files, merges edited ones, flags conflicts, never touches owned', async () => {
	const dir = await tmp('sync')
	const root = path.join(dir, 'repo')
	const templates = path.join(dir, 'templates')
	try {
		await mkdir(root)
		await fakeTemplates(templates, {
			'managed/plain.md': 'a\nb\nc\n',
			'managed/edited.md': 'one\ntwo\nthree\n',
			'managed/clash.md': 'left\n',
			'managed/named.md': 'Product: {{name}}\n',
			'owned/mine.md': 'template\n',
		})
		const vars = { name: 'meals' }
		applyTemplates(root, vars, { overwrite: true, templatesDir: templates })
		expect(await readFile(path.join(root, 'managed/named.md'), 'utf8')).toBe(
			'Product: meals\n',
		)
		// local edits
		await writeFile(
			path.join(root, 'managed/edited.md'),
			'one\ntwo\nthree\nfour\n',
		)
		await writeFile(path.join(root, 'managed/clash.md'), 'mine\n')
		await writeFile(path.join(root, 'owned/mine.md'), 'changed by product\n')
		// template changes
		await fakeTemplates(templates, {
			'managed/plain.md': 'a\nb\nc\nd\n',
			'managed/edited.md': 'zero\none\ntwo\nthree\n',
			'managed/clash.md': 'theirs\n',
			'managed/named.md': 'Product: {{name}}\n',
			'managed/added.md': 'new\n',
			'owned/mine.md': 'template v2\n',
		})

		const dry = await syncTemplates(root, vars, {
			check: true,
			templatesDir: templates,
		})
		expect(dry).toMatchObject({
			created: ['managed/added.md'],
			updated: ['managed/plain.md'],
			merged: ['managed/edited.md'],
			conflicts: ['managed/clash.md'],
			unchanged: ['managed/named.md'],
		})
		expect(await readFile(path.join(root, 'managed/plain.md'), 'utf8')).toBe(
			'a\nb\nc\n',
		)

		const report = await syncTemplates(root, vars, { templatesDir: templates })
		expect(report).toEqual(dry)
		expect(await readFile(path.join(root, 'managed/plain.md'), 'utf8')).toBe(
			'a\nb\nc\nd\n',
		)
		expect(await readFile(path.join(root, 'managed/edited.md'), 'utf8')).toBe(
			'zero\none\ntwo\nthree\nfour\n',
		)
		expect(
			await readFile(path.join(root, 'managed/clash.md'), 'utf8'),
		).toContain('<<<<<<<')
		expect(await readFile(path.join(root, 'managed/added.md'), 'utf8')).toBe(
			'new\n',
		)
		expect(await readFile(path.join(root, 'owned/mine.md'), 'utf8')).toBe(
			'changed by product\n',
		)
		expect(
			await readFile(path.join(root, baseDir, 'managed/edited.md'), 'utf8'),
		).toBe('zero\none\ntwo\nthree\n')

		const again = await syncTemplates(root, vars, {
			check: true,
			templatesDir: templates,
		})
		expect(again.created.concat(again.updated, again.merged)).toEqual([])
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

test('the harness uses the same skills it ships (copies, not a symlink)', async () => {
	const templateSkills = path.join(packageRoot, 'templates/.claude/skills')
	const names = await readdir(templateSkills)
	expect(names.length).toBeGreaterThan(0)
	for (const name of names) {
		const rel = path.join(name, 'SKILL.md')
		expect(
			await readFile(path.join(packageRoot, '.claude/skills', rel), 'utf8'),
			`${rel} differs: cp -R templates/.claude/skills .claude/`,
		).toBe(await readFile(path.join(templateSkills, rel), 'utf8'))
	}
})

/** Wording that was once true and is now wrong. The link and decision checks
 *  do not see this kind of drift, so each phrase here was found by a review
 *  after it had shipped. Add a phrase when a doc is corrected; the reason says
 *  what replaced it. */
const retiredPhrases: ReadonlyArray<{ phrase: string; why: string }> = [
	{ phrase: 'npx harness', why: 'the bin is `reins` (decision 0006)' },
	{ phrase: 'harness.json', why: 'the config is `reins.json` (decision 0006)' },
	{
		phrase: '.harness/',
		why: 'base copies live under `.reins/` (decision 0006)',
	},
	{
		phrase: 'always ask the owner',
		why: 'the guard refuses pushes to main and runs the policy on merge; the prompts went with decision 0005',
	},
	{
		phrase: 'licence is unstated',
		why: 'kody is FSL-1.1-ALv2 (docs/contributing/gotchas.md)',
	},
	{
		phrase: '(`npx harness hook ',
		why: 'a nested-backtick fragment that once mangled the guardrails bullet',
	},
]
// A record of the rename has to quote the old names; nothing else may.
const retiredPhraseExemptions: Record<string, ReadonlyArray<string>> = {
	'docs/contributing/decisions/0006-named-reins.md': [
		'npx harness',
		'harness.json',
		'.harness/',
	],
}

test('retired phrases do not reappear in shipped or repo docs', async () => {
	const files = ['README.md', 'CLAUDE.md']
	for (const dir of ['templates', 'docs']) {
		files.push(...(await listFiles(packageRoot, dir, (f) => f.endsWith('.md'))))
	}
	expect(files.length).toBeGreaterThan(10)
	const found: Array<string> = []
	for (const file of files) {
		const source = await readFile(path.join(packageRoot, file), 'utf8')
		const allowed = retiredPhraseExemptions[file] ?? []
		for (const { phrase, why } of retiredPhrases) {
			if (!allowed.includes(phrase) && source.includes(phrase)) {
				found.push(`${file}: "${phrase}" is retired; ${why}`)
			}
		}
	}
	expect(found).toEqual([])
})

// A template that is in neither list is never written, so it would ship to
// nobody; an entry with no file would break every new/adopt/sync.
test('every template is in the manifest exactly once, and every entry exists', async () => {
	const templates = path.join(packageRoot, 'templates')
	const onDisk = (
		await readdir(templates, { recursive: true, withFileTypes: true })
	)
		.filter((entry) => entry.isFile())
		.map((entry) =>
			path.relative(templates, path.join(entry.parentPath, entry.name)),
		)
		// Finder leaves .DS_Store behind; it is gitignored, not a template.
		.filter((rel) => rel !== 'manifest.json' && !rel.endsWith('.DS_Store'))
		.toSorted()
	const { managed, owned } = loadManifest()
	const listed = [...managed, ...owned]
	expect(listed.toSorted()).toEqual(onDisk)
	expect(new Set(listed).size).toBe(listed.length)
})

// Workflows are dogfooded by copy, like the skills; validate.yml differs on
// purpose (the harness clones no git dependency), so it is not compared.
test('the merged-branch workflow is the same file the harness ships', async () => {
	const rel = '.github/workflows/merged-branch.yml'
	expect(
		await readFile(path.join(packageRoot, rel), 'utf8'),
		`${rel} differs: cp templates/${rel} ${rel}`,
	).toBe(await readFile(path.join(packageRoot, 'templates', rel), 'utf8'))
})

type Hook = { command: string; onFailure?: string }
type Settings = { hooks: Record<string, Array<{ hooks: Array<Hook> }>> }

async function hooksByEvent(file: string) {
	const settings = JSON.parse(await readFile(file, 'utf8')) as Settings
	return Object.fromEntries(
		Object.entries(settings.hooks).map(([event, entries]) => [
			event,
			entries.flatMap((entry) => entry.hooks),
		]),
	)
}

// Claude Code reads hook exit 1 as "not blocking", so a hook that cannot start
// would silently switch the guard off; and a bare `npx reins` falls back to
// the public registry, where an unrelated `harness` package exists. The Stop
// hook is the exception: exit 2 there sends the agent back to a repair it
// cannot make (the guard blocks `npm install` too), so it only warns.
test('Claude hook commands fail closed when the harness is not installed', async () => {
	const blocks = / \|\| \{ \[ \$\? -eq 2 \] \|\| echo '[^']+' >&2; exit 2; \}$/
	const warns =
		/ \|\| \{ \[ \$\? -eq 2 \] && exit 2; echo '[^']+' >&2; exit 1; \}$/
	for (const [file, start] of [
		['templates/.claude/settings.json', 'npx --no-install reins hook '],
		['.claude/settings.json', 'node '],
	] as const) {
		const hooks = await hooksByEvent(path.join(packageRoot, file))
		expect(Object.keys(hooks).toSorted()).toEqual([
			'PostToolUse',
			'PreToolUse',
			'Stop',
		])
		for (const [event, entries] of Object.entries(hooks)) {
			expect(entries, `${file} ${event}`).toHaveLength(1)
			const [hook] = entries
			expect(hook!.command.startsWith(start), `${file} ${event}`).toBe(true)
			if (event === 'Stop') {
				expect(hook!.command, `${file} ${event}`).toMatch(warns)
				expect(hook!.onFailure).toBeUndefined()
			} else {
				expect(hook!.command, `${file} ${event}`).toMatch(blocks)
				// Covers a timeout as well, on Claude Code 2.1.295+.
				expect(hook!.onFailure, `${file} ${event}`).toBe('block')
			}
		}
	}
})

// The husky lines take the same precaution; npx's own message for a missing
// package ("'reins@*' is not in this registry") points at the wrong place,
// so the line names the fix, but only when the bin really is absent, so a
// failed hook is not mislabelled.
test('every `npx reins hook` a template ships carries --no-install', async () => {
	for (const hook of ['pre-commit', 'pre-push']) {
		expect(
			await readFile(path.join(packageRoot, 'templates/.husky', hook), 'utf8'),
		).toBe(
			`npx --no-install reins hook ${hook} || { [ -x node_modules/.bin/reins ] || echo 'reins is not installed: run npm install' >&2; exit 1; }\n`,
		)
	}
	// Prose may name the command; anything that runs it must not install it.
	const files = await listFiles(
		packageRoot,
		'templates',
		(f) => !f.endsWith('.md'),
	)
	expect(files.length).toBeGreaterThan(3)
	const bare: Array<string> = []
	for (const file of files) {
		const source = await readFile(path.join(packageRoot, file), 'utf8')
		for (const [command] of source.matchAll(/npx(?: \S+)* reins hook\b/g)) {
			if (!command.includes(' --no-install ')) bare.push(`${file}: ${command}`)
		}
	}
	expect(bare).toEqual([])
})

test('doctor reports whether the harness is installed in the repo itself', async () => {
	const root = await tmp('doctor')
	try {
		const label = "reins installed in this repo's node_modules"
		const before = doctor(root).find((i) => i.label === label)
		expect(before).toMatchObject({ ok: false, fix: 'npm install' })
		const installed = path.join(root, 'node_modules/@dom-kelly/reins')
		await mkdir(installed, { recursive: true })
		await writeFile(path.join(installed, 'package.json'), '{}')
		expect(doctor(root).find((i) => i.label === label)?.ok).toBe(true)
		// The harness repo runs its hooks from source, so it passes without one.
		expect(doctor(packageRoot).find((i) => i.label === label)?.ok).toBe(true)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('sync records the CLI version in reins.json; --check does not', async () => {
	const dir = await tmp('sync-version')
	const root = path.join(dir, 'repo')
	const templates = path.join(dir, 'templates')
	try {
		await mkdir(root)
		await fakeTemplates(templates, { 'managed/a.md': 'a\n' })
		const vars = { name: 'meals' }
		applyTemplates(root, vars, { overwrite: true, templatesDir: templates })
		writeConfig(root, { harness: '0.0.1', product: vars })
		await syncTemplates(root, vars, { check: true, templatesDir: templates })
		expect(readConfig(root)?.harness).toBe('0.0.1')
		await syncTemplates(root, vars, { templatesDir: templates })
		expect(readConfig(root)).toEqual({ harness: packageVersion, product: vars })
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

test('doctor: an info item never fails the run and prints as a note', async () => {
	const root = await tmp('doctor-info')
	try {
		// No GitHub origin here, so there is no line about GitHub's auto-delete.
		const items = doctor(root)
		expect(items.some((i) => i.info)).toBe(false)
		const info = {
			label: 'GitHub does not delete merged branches itself',
			ok: false,
			fix: 'gh repo edit --delete-branch-on-merge',
			info: true,
		}
		expect(doctorPassed([{ label: 'x', ok: true, fix: '' }, info])).toBe(true)
		expect(doctorPassed([{ label: 'x', ok: false, fix: 'y' }, info])).toBe(
			false,
		)
		expect(formatDoctor([info])).toBe(
			'ℹ️ GitHub does not delete merged branches itself → gh repo edit --delete-branch-on-merge',
		)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('doctor suggests a fast stop gate when the merge gate is not validate', async () => {
	const root = await tmp('doctor-stop-gate')
	try {
		const item = () =>
			doctor(root).find((i) => i.label.startsWith('the Stop hook runs'))
		const base = { harness: packageVersion, product: { name: 'x' } }
		writeConfig(root, { ...base, policy: { gate: 'validate' } })
		expect(item()).toBeUndefined()
		writeConfig(root, { ...base, policy: { gate: 'verify' } })
		expect(item()).toMatchObject({ ok: false, info: true })
		expect(item()?.label).toContain('(verify)')
		writeConfig(root, {
			...base,
			policy: { gate: 'verify' },
			hooks: { stopGate: 'verify:quick' },
		})
		expect(item()).toBeUndefined()
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('doctor asks for a sync when reins.json was synced from another version', async () => {
	const root = await tmp('doctor-version')
	try {
		const item = () =>
			doctor(root).find((i) => i.label.startsWith('reins.json'))
		expect(item()).toMatchObject({ ok: false, fix: 'npx reins adopt' })
		writeConfig(root, { harness: '0.0.1', product: { name: 'x' } })
		expect(item()).toMatchObject({
			ok: false,
			fix: 'npx reins sync',
			label: `reins.json synced from 0.0.1 (this CLI is ${packageVersion})`,
		})
		writeConfig(root, { harness: packageVersion, product: { name: 'x' } })
		expect(item()?.ok).toBe(true)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('three-way merge keeps both sides when they touch different lines', async () => {
	const merged = await mergeThreeWay(
		'1\n2\n3\nmine\n',
		'1\n2\n3\n',
		'0\n1\n2\n3\n',
	)
	expect(merged).toEqual({ content: '0\n1\n2\n3\nmine\n', conflicts: false })
})

test('arguments: options take the next token, flags do not, the rest are positionals', () => {
	expect(parseArgs(['new', '--name', 'foo', './dir', '--no-install'])).toEqual({
		command: 'new',
		positionals: ['./dir'],
		flags: new Set(['--no-install']),
		options: new Map([['--name', 'foo']]),
	})
	expect(() => parseArgs(['new', '--name'])).toThrow(/needs a value/)
	expect(parseArgs([]).command).toBeUndefined()
})

test('sync reports a managed file with no recorded base instead of skipping it', async () => {
	const dir = await tmp('nobase')
	const root = path.join(dir, 'repo')
	const templates = path.join(dir, 'templates')
	try {
		await mkdir(root)
		await fakeTemplates(templates, { 'managed/a.md': 'v2\n' })
		await writeFile(path.join(root, 'managed/a.md'), 'v1\n').catch(async () => {
			await mkdir(path.join(root, 'managed'))
			await writeFile(path.join(root, 'managed/a.md'), 'v1\n')
		})
		const report = await syncTemplates(
			root,
			{ name: 'x' },
			{ templatesDir: templates },
		)
		expect(report.missingBase).toEqual(['managed/a.md'])
		expect(await readFile(path.join(root, 'managed/a.md'), 'utf8')).toBe('v1\n')
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

test('adopt works in a repo with no package.json and keeps 2-space indentation', async () => {
	const root = await tmp('adopt-bare')
	try {
		const result = adoptRepo(root, { name: 'bare' })
		expect(result.name).toBe('bare')
		const pkg = JSON.parse(
			await readFile(path.join(root, 'package.json'), 'utf8'),
		)
		expect(pkg.scripts.prepare).toBe('husky')
		expect(pkg.devDependencies.husky).toBeDefined()
		const spaced = patchPackageJson('{\n  "name": "x"\n}\n')
		expect(spaced.source.startsWith('{\n  "name"')).toBe(true)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('doc link check can ignore mirrored paths', async () => {
	const root = await tmp('links')
	try {
		await mkdir(path.join(root, 'mirror'))
		await writeFile(path.join(root, 'mirror/a.md'), '[x](./missing.md)')
		expect((await checkDocLinks(root)).issues).toHaveLength(1)
		expect((await checkDocLinks(root, ['mirror/'])).issues).toEqual([])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

/** A product as the harness left it before decision 0006: `harness.json` and
 *  `.harness/base`, with a local edit to one managed file. */
async function legacyProduct(dir: string, templates: string) {
	const root = path.join(dir, 'repo')
	await mkdir(root)
	await fakeTemplates(templates, {
		'managed/a.md': 'a1\n',
		'managed/b.md': 'one\ntwo\nthree\n',
	})
	const vars = { name: 'old' }
	applyTemplates(root, vars, { overwrite: true, templatesDir: templates })
	writeConfig(root, {
		harness: '0.0.1',
		product: vars,
		policy: { authority: { high: 'owner' } },
	})
	await writeFile(path.join(root, 'managed/b.md'), 'one\ntwo\nthree\nmine\n')
	await writeFile(path.join(root, 'package.json'), legacyPackageJson)
	await rename(path.join(root, configFile), path.join(root, legacyConfigFile))
	await mkdir(path.join(root, path.dirname(legacyBaseDir)), { recursive: true })
	await rename(path.join(root, baseDir), path.join(root, legacyBaseDir))
	await rm(path.join(root, path.dirname(baseDir)), { recursive: true })
	return { root, vars }
}

const legacyPackageJson = `${JSON.stringify(
	{
		name: 'old',
		scripts: {
			test: 'vitest run',
			harness: 'harness',
			'harness:check': 'harness check',
			validate: 'concurrently "npm:test" "npx harness check"',
		},
		devDependencies: {
			'@dom-kelly/harness': 'git+https://github.com/dom-kelly/harness.git',
			prettier: '^3.6.0',
		},
	},
	null,
	'\t',
)}\n`

const renamedAll = [
	`${legacyConfigFile} → ${configFile}`,
	`${legacyBaseDir} → ${baseDir}`,
	`package.json → @dom-kelly/reins (${dependencySpec}) and npx reins (run npm install)`,
]

/** Old names gone, config and base copies intact, package.json pointed at
 *  reins (adopt also adds its own scripts and dependencies, so match, not equal). */
async function expectMigrated(root: string, baseA: string) {
	expect(existsSync(path.join(root, legacyConfigFile))).toBe(false)
	expect(existsSync(path.join(root, path.dirname(legacyBaseDir)))).toBe(false)
	expect(readConfig(root)?.policy).toEqual({ authority: { high: 'owner' } })
	expect(await readFile(path.join(root, baseDir, 'managed/a.md'), 'utf8')).toBe(
		baseA,
	)
	const pkg = JSON.parse(
		await readFile(path.join(root, 'package.json'), 'utf8'),
	)
	expect(pkg.scripts).toMatchObject({
		test: 'vitest run',
		reins: 'reins',
		'reins:check': 'reins check',
		validate: 'concurrently "npm:test" "npx reins check"',
	})
	expect(pkg.devDependencies).toMatchObject({
		'@dom-kelly/reins': dependencySpec,
		prettier: '^3.6.0',
	})
	expect(JSON.stringify(pkg)).not.toContain('harness')
}

test('adopt renames harness.json and .harness/base to the reins names, losing nothing', async () => {
	const dir = await tmp('migrate-adopt')
	try {
		const { root } = await legacyProduct(dir, path.join(dir, 'templates'))
		const result = adoptRepo(root)
		expect(result.renamed).toEqual(renamedAll)
		await expectMigrated(root, 'a1\n')
		expect(readConfig(root)?.product.name).toBe('old')
		expect(await readFile(path.join(root, 'managed/b.md'), 'utf8')).toBe(
			'one\ntwo\nthree\nmine\n',
		)
		expect(adoptRepo(root).renamed).toEqual([])
		// A stale old file next to the new one is reported, never overwritten.
		await writeFile(path.join(root, legacyConfigFile), '{"stale":1}\n')
		expect(adoptRepo(root).renamed).toEqual([
			`${legacyConfigFile} left in place (${configFile} exists; delete the old one)`,
		])
		expect(readConfig(root)?.product.name).toBe('old')
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

test('sync migrates the old names and merges from the moved base; --check only reads them', async () => {
	const dir = await tmp('migrate-sync')
	const templates = path.join(dir, 'templates')
	try {
		const { root, vars } = await legacyProduct(dir, templates)
		await fakeTemplates(templates, {
			'managed/a.md': 'a2\n',
			'managed/b.md': 'zero\none\ntwo\nthree\n',
		})

		const dry = await syncTemplates(root, vars, {
			check: true,
			templatesDir: templates,
		})
		expect(dry).toMatchObject({
			renamed: [],
			missingBase: [],
			updated: ['managed/a.md'],
			merged: ['managed/b.md'],
		})
		expect(existsSync(path.join(root, legacyConfigFile))).toBe(true)
		expect(existsSync(path.join(root, legacyBaseDir))).toBe(true)
		expect(existsSync(path.join(root, path.dirname(baseDir)))).toBe(false)
		expect(readConfig(root)?.product.name).toBe('old')
		expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(
			legacyPackageJson,
		)

		const report = await syncTemplates(root, vars, { templatesDir: templates })
		expect(report).toMatchObject({
			renamed: renamedAll,
			missingBase: [],
			updated: ['managed/a.md'],
			merged: ['managed/b.md'],
			conflicts: [],
		})
		await expectMigrated(root, 'a2\n')
		expect(await readFile(path.join(root, 'managed/b.md'), 'utf8')).toBe(
			'zero\none\ntwo\nthree\nmine\n',
		)
		expect(
			await readFile(path.join(root, baseDir, 'managed/a.md'), 'utf8'),
		).toBe('a2\n')
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

const pinned = (spec: string) =>
	`{\n  "devDependencies": {\n    "@dom-kelly/reins": "${spec}"\n  }\n}\n`

test('package.json migration touches only what named the old package or tracked main', () => {
	expect(migratePackageJson('{\n  "name": "x",\n  "scripts": {}\n}\n')).toBe(
		undefined,
	)
	// An unpinned URL tracks main (the problem decision 0007 fixes); a pin of
	// the product's own is left alone.
	const bare = 'git+https://github.com/dom-kelly/reins.git'
	expect(migratePackageJson(pinned(bare))).toBe(pinned(dependencySpec))
	expect(migratePackageJson(pinned(`${bare}#v0.1.0`))).toBe(undefined)
	expect(
		migratePackageJson(
			'{\n  "scripts": { "harness": "harness", "reins": "reins" },\n  "devDependencies": { "@dom-kelly/reins": "file:x", "@dom-kelly/harness": "y" }\n}\n',
		),
	).toBe(
		'{\n  "scripts": {\n    "reins": "reins"\n  },\n  "devDependencies": {\n    "@dom-kelly/reins": "file:x"\n  }\n}\n',
	)
})
