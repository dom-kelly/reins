import { spawnSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	writeFileSync,
} from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configFile, legacyConfigFile } from './config.ts'
import { packageRoot } from './repo.ts'

/** templates/manifest.json: which files the harness writes into a product. */
export type TemplateManifest = {
	/** Written by new/adopt and kept in step by sync (three-way merge). */
	managed: Array<string>
	/** Written once if absent; the product owns them afterwards. */
	owned: Array<string>
}

export type TemplateVars = { name: string }

export const defaultTemplatesDir = path.join(packageRoot, 'templates')

/** Pristine copies of managed files as last applied, so sync can merge. */
export const baseDir = '.reins/base'
/** Where the copies lived before the package was called reins (decision 0006). */
export const legacyBaseDir = '.harness/base'

/** The package a product's hooks and scripts call as `npx reins`. */
export const dependencyName = '@dom-kelly/reins'
export const dependencySpec = 'git+https://github.com/dom-kelly/reins.git'
const legacyDependencyName = '@dom-kelly/harness'

export function loadManifest(templatesDir = defaultTemplatesDir) {
	return JSON.parse(
		readFileSync(path.join(templatesDir, 'manifest.json'), 'utf8'),
	) as TemplateManifest
}

export function render(content: string, vars: TemplateVars) {
	return content.replaceAll('{{name}}', vars.name)
}

function readIfExists(file: string) {
	return existsSync(file) ? readFileSync(file, 'utf8') : undefined
}

function writeFile(file: string, content: string) {
	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content)
}

/** Keeps a package.json's indentation when writing it back. */
export function jsonIndent(source: string) {
	return /^\t/m.test(source) ? '\t' : 2
}

type PackageScripts = {
	scripts?: Record<string, string>
	devDependencies?: Record<string, string>
}

/** Maps an object's entries, keeping their order; the first key wins when two
 *  map to the same one. */
function remap(
	entries: Record<string, string>,
	map: (key: string, value: string) => [string, string],
) {
	const out: Record<string, string> = {}
	for (const [key, value] of Object.entries(entries)) {
		const [k, v] = map(key, value)
		out[k] ??= v
	}
	return out
}

function sameJson(a: object | undefined, b: object) {
	return JSON.stringify(a ?? {}) === JSON.stringify(b)
}

/** Points a product's package.json at reins: the devDependency, the injected
 *  `harness`/`harness:check` scripts and every `npx harness` in a script, so
 *  nothing is left that `npx` could resolve from the public registry. Returns
 *  the new source, or undefined when nothing named the old package. */
export function migratePackageJson(source: string): string | undefined {
	const pkg = JSON.parse(source) as PackageScripts
	const scripts = remap(pkg.scripts ?? {}, (key, value) => [
		key.replace(/^harness(?=$|:)/, 'reins'),
		value
			.replace(/^harness(?= |$)/, 'reins')
			.replaceAll('npx harness ', 'npx reins '),
	])
	const devDependencies = remap(pkg.devDependencies ?? {}, (key, value) =>
		key === legacyDependencyName
			? [dependencyName, dependencySpec]
			: [key, value],
	)
	if (
		sameJson(pkg.scripts, scripts) &&
		sameJson(pkg.devDependencies, devDependencies)
	) {
		return undefined
	}
	if (pkg.scripts) pkg.scripts = scripts
	if (pkg.devDependencies) pkg.devDependencies = devDependencies
	return `${JSON.stringify(pkg, null, jsonIndent(source))}\n`
}

/** Moves a product from the old names (`harness.json`, `.harness/base`, the
 *  `@dom-kelly/harness` dependency) to the reins ones where only the old
 *  exist. Returns what happened, one line each, so adopt and sync can say so. */
export function migrateLegacyNames(root: string): Array<string> {
	const lines: Array<string> = []
	for (const [from, to] of [
		[legacyConfigFile, configFile],
		[legacyBaseDir, baseDir],
	] as const) {
		const source = path.join(root, from)
		const target = path.join(root, to)
		if (!existsSync(source)) continue
		if (existsSync(target)) {
			lines.push(`${from} left in place (${to} exists; delete the old one)`)
			continue
		}
		mkdirSync(path.dirname(target), { recursive: true })
		renameSync(source, target)
		lines.push(`${from} → ${to}`)
		if (from === legacyBaseDir) {
			try {
				// .harness/ held nothing but the base copies; drop it once empty.
				rmdirSync(path.join(root, path.dirname(legacyBaseDir)))
			} catch {
				// not empty: leave it alone
			}
		}
	}
	const pkgFile = path.join(root, 'package.json')
	if (existsSync(pkgFile)) {
		const migrated = migratePackageJson(readFileSync(pkgFile, 'utf8'))
		if (migrated !== undefined) {
			writeFileSync(pkgFile, migrated)
			lines.push(
				`package.json → ${dependencyName} and npx reins (run npm install)`,
			)
		}
	}
	return lines
}

export type ApplyReport = { written: Array<string>; kept: Array<string> }

/** new: overwrite everything. adopt: keep what exists, record it as managed. */
export function applyTemplates(
	root: string,
	vars: TemplateVars,
	{
		overwrite,
		templatesDir = defaultTemplatesDir,
	}: {
		overwrite: boolean
		templatesDir?: string
	},
): ApplyReport {
	const manifest = loadManifest(templatesDir)
	const report: ApplyReport = { written: [], kept: [] }
	for (const rel of manifest.managed) {
		const rendered = render(
			readFileSync(path.join(templatesDir, rel), 'utf8'),
			vars,
		)
		const target = path.join(root, rel)
		if (overwrite || !existsSync(target)) {
			writeFile(target, rendered)
			report.written.push(rel)
		} else {
			report.kept.push(rel)
		}
		writeFile(path.join(root, baseDir, rel), rendered)
	}
	for (const rel of manifest.owned) {
		const target = path.join(root, rel)
		if (existsSync(target)) {
			report.kept.push(rel)
			continue
		}
		writeFile(
			target,
			render(readFileSync(path.join(templatesDir, rel), 'utf8'), vars),
		)
		report.written.push(rel)
	}
	return report
}

export type SyncReport = {
	/** Old names moved to the reins ones (`old → new`), see migrateLegacyNames. */
	renamed: Array<string>
	/** Managed files with no .reins/base copy: run `reins adopt` to record one. */
	missingBase: Array<string>
	created: Array<string>
	updated: Array<string>
	merged: Array<string>
	conflicts: Array<string>
	unchanged: Array<string>
}

export function hasChanges(report: SyncReport) {
	return (
		report.created.length +
			report.updated.length +
			report.merged.length +
			report.conflicts.length >
		0
	)
}

/** Three-way merge via git: ours = the product's copy, base = the template as
 *  last applied, theirs = the current template. Returns the merged text and
 *  whether conflict markers were left in it. */
export async function mergeThreeWay(
	ours: string,
	base: string,
	theirs: string,
) {
	const dir = await mkdtemp(path.join(tmpdir(), 'harness-merge-'))
	try {
		const files = { ours, base, theirs }
		for (const [name, content] of Object.entries(files)) {
			writeFileSync(path.join(dir, name), content)
		}
		const result = spawnSync(
			'git',
			[
				'merge-file',
				'-p',
				'-L',
				'yours',
				'-L',
				'previous template',
				'-L',
				'new template',
				path.join(dir, 'ours'),
				path.join(dir, 'base'),
				path.join(dir, 'theirs'),
			],
			{ encoding: 'utf8' },
		)
		if (result.status === null || result.status < 0) {
			throw new Error(`git merge-file failed: ${result.stderr}`)
		}
		return { content: result.stdout, conflicts: result.status > 0 }
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

/** Brings managed files up to the current templates, keeping local edits.
 *  With `check`, reports what would change and writes nothing. */
export async function syncTemplates(
	root: string,
	vars: TemplateVars,
	{
		check = false,
		templatesDir = defaultTemplatesDir,
	}: {
		check?: boolean
		templatesDir?: string
	} = {},
): Promise<SyncReport> {
	const manifest = loadManifest(templatesDir)
	const report: SyncReport = {
		renamed: check ? [] : migrateLegacyNames(root),
		missingBase: [],
		created: [],
		updated: [],
		merged: [],
		conflicts: [],
		unchanged: [],
	}
	const write = (rel: string, content: string) => {
		if (!check) writeFile(path.join(root, rel), content)
	}
	const writeBase = (rel: string, content: string) => {
		if (!check) writeFile(path.join(root, baseDir, rel), content)
	}
	// --check renames nothing, so it reads the base copies where they still are.
	const baseFrom =
		!existsSync(path.join(root, baseDir)) &&
		existsSync(path.join(root, legacyBaseDir))
			? legacyBaseDir
			: baseDir
	for (const rel of manifest.managed) {
		const theirs = render(
			readFileSync(path.join(templatesDir, rel), 'utf8'),
			vars,
		)
		const ours = readIfExists(path.join(root, rel))
		const base = readIfExists(path.join(root, baseFrom, rel))
		if (ours !== undefined && base === undefined && ours !== theirs) {
			report.missingBase.push(rel)
			continue
		}
		if (ours === undefined) {
			write(rel, theirs)
			writeBase(rel, theirs)
			report.created.push(rel)
		} else if (theirs === base || ours === theirs || base === undefined) {
			writeBase(rel, theirs)
			report.unchanged.push(rel)
		} else if (ours === base) {
			write(rel, theirs)
			writeBase(rel, theirs)
			report.updated.push(rel)
		} else {
			const merged = await mergeThreeWay(ours, base!, theirs)
			write(rel, merged.content)
			writeBase(rel, theirs)
			;(merged.conflicts ? report.conflicts : report.merged).push(rel)
		}
	}
	for (const rel of manifest.owned) {
		if (!existsSync(path.join(root, rel))) {
			write(
				rel,
				render(readFileSync(path.join(templatesDir, rel), 'utf8'), vars),
			)
			report.created.push(rel)
		}
	}
	return report
}

export function formatSyncReport(report: SyncReport, check: boolean) {
	const verb = check ? 'would be' : 'were'
	const lines: Array<string> = []
	const section = (label: string, items: Array<string>) => {
		if (items.length) lines.push(`${label}: ${items.join(', ')}`)
	}
	section(`created`, report.created)
	section(`updated (no local edits)`, report.updated)
	section(`merged (local edits kept)`, report.merged)
	section(`CONFLICTS (resolve the markers)`, report.conflicts)
	section(
		`NO BASE RECORDED (run \`reins adopt\` to record one, then sync again)`,
		report.missingBase,
	)
	const renamed = report.renamed.map((r) => `renamed ${r}\n`).join('')
	if (lines.length === 0) return `${renamed}sync: everything is up to date`
	return `${renamed}sync: ${lines.length} group(s) of files ${verb} changed\n${lines.map((l) => `  ${l}`).join('\n')}`
}
