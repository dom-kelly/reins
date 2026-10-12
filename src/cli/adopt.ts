import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { packageVersion, readConfig, writeConfig } from '../lib/config.ts'
import {
	applyTemplates,
	dependencyName,
	dependencySpec,
	jsonIndent,
	migrateLegacyNames,
	type ApplyReport,
} from '../lib/templates.ts'

/** What the templates' hooks and scripts expect a product to have. */
export const expectedDevDependencies = {
	[dependencyName]: dependencySpec,
	husky: '^9.1.7',
	'lint-staged': '^16.1.0',
	prettier: '^3.6.0',
	oxlint: '^1.14.0',
}

type PackageJson = {
	name?: string
	scripts?: Record<string, string>
	devDependencies?: Record<string, string>
}

/** Adds what the harness needs to an existing package.json without touching
 *  anything that is already there. Keeps the file's indentation. */
export function patchPackageJson(source: string) {
	const pkg = JSON.parse(source) as PackageJson
	const indent = jsonIndent(source)
	const added: Array<string> = []
	pkg.devDependencies ??= {}
	for (const [name, spec] of Object.entries(expectedDevDependencies)) {
		if (!pkg.devDependencies[name]) {
			pkg.devDependencies[name] = spec
			added.push(`devDependencies.${name}`)
		}
	}
	pkg.scripts ??= {}
	for (const [key, value] of Object.entries({
		reins: 'reins',
		'reins:check': 'reins check',
		prepare: 'husky',
	})) {
		if (!pkg.scripts[key]) {
			pkg.scripts[key] = value
			added.push(`scripts.${key}`)
		}
	}
	return { source: `${JSON.stringify(pkg, null, indent)}\n`, added, pkg }
}

/** reins adopt: apply the templates to an existing repo, keeping every file
 *  that already exists, and record it in reins.json. */
export function adoptRepo(root: string, { name }: { name?: string } = {}) {
	// Before anything reads or writes config, so the old names do not linger.
	const renamed = migrateLegacyNames(root)
	const pkgFile = path.join(root, 'package.json')
	const pkgSource = existsSync(pkgFile) ? readFileSync(pkgFile, 'utf8') : '{}\n'
	const patched = patchPackageJson(pkgSource)
	const productName = name ?? patched.pkg.name ?? path.basename(root)
	const report: ApplyReport = applyTemplates(
		root,
		{ name: productName },
		{ overwrite: false },
	)
	writeFileSync(pkgFile, patched.source)
	const existing = readConfig(root)
	writeConfig(root, {
		...existing,
		harness: packageVersion,
		product: existing?.product ?? { name: productName },
	})
	return { report, packageAdded: patched.added, name: productName, renamed }
}

export function formatAdoptReport(result: ReturnType<typeof adoptRepo>) {
	const lines = [
		...result.renamed.map((r) => `renamed ${r}`),
		`adopt: ${result.name} now uses the harness (reins.json written)`,
		`  written: ${result.report.written.length} file(s)`,
		`  kept as-is (yours; sync will merge future template changes into them): ${result.report.kept.length} file(s)`,
	]
	if (result.packageAdded.length) {
		lines.push(`  package.json: added ${result.packageAdded.join(', ')}`)
	}
	lines.push(
		'',
		'Next:',
		'  1. npm install   (installs the harness, husky, lint-staged, prettier, oxlint if they were missing)',
		'  2. add `npx reins check` to your validate/verify script',
		'  3. .husky/* and .claude/settings.json call `npx reins hook …`; a lint-staged config in package.json is optional',
		'  4. fill docs/contributing/architecture/primitives.yaml for your code (scan, unowned, floors, invariants)',
		'  5. commit, including .reins/base/',
	)
	return lines.join('\n')
}
