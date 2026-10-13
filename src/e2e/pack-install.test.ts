import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'
import { packageRoot } from '../lib/repo.ts'

function run(command: string, args: Array<string>, cwd: string) {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
	return {
		code: result.status,
		out: `${result.stdout}\n${result.stderr}`,
	}
}

const pushToMain = JSON.stringify({
	tool_input: { command: 'git push origin main' },
})

/** The PreToolUse hook exactly as Claude Code runs it: `sh -c`, JSON on
 *  stdin. The npm prefix points at an empty dir so a globally linked `reins`
 *  on the developer's machine cannot stand in for the product's own. */
function runGuard(command: string, cwd: string, emptyPrefix: string) {
	return spawnSync('sh', ['-c', command], {
		cwd,
		encoding: 'utf8',
		input: pushToMain,
		env: { ...process.env, npm_config_prefix: emptyPrefix },
	})
}

// The harness uses itself: pack the package, create a product with the packed
// CLI, install the tarball into the product, and run the product's own gate,
// which calls `npx reins check` from node_modules. Unit tests run the source;
// only this proves the package as installed.
test('a product built from the packed package passes its own validate', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'harness-e2e-'))
	try {
		const pack = run('npm', ['pack', '--pack-destination', dir], packageRoot)
		expect(pack.code, pack.out).toBe(0)
		const tarball = (await readdir(dir)).find((f) => f.endsWith('.tgz'))!
		expect(tarball).toMatch(/^dom-kelly-reins-.*\.tgz$/)

		const cli = path.join(packageRoot, 'dist/bin/reins.js')
		expect(existsSync(cli), 'npm pack should have built dist/').toBe(true)
		const product = path.join(dir, 'demo-product')
		const created = run(
			'node',
			[cli, 'new', product, '--no-install', '--no-git'],
			dir,
		)
		expect(created.code, created.out).toBe(0)

		// Before install, the hook command Claude Code would run must block
		// (exit 2) and say why, not fail quietly or fetch `reins` from npm.
		const settings = JSON.parse(
			readFileSync(path.join(product, '.claude/settings.json'), 'utf8'),
		) as {
			hooks: Record<
				'PreToolUse' | 'PostToolUse' | 'SessionStart',
				Array<{ hooks: Array<{ command: string }> }>
			>
		}
		const guardCommand = settings.hooks.PreToolUse[0]!.hooks[0]!.command
		const uninstalled = runGuard(guardCommand, product, dir)
		expect(uninstalled.status, uninstalled.stderr).toBe(2)
		expect(uninstalled.stderr).toContain('the harness guard did not run')
		// The SessionStart hook instead opens the session and says what to
		// run, on stdout, where the agent reads it.
		const startCommand = settings.hooks.SessionStart[0]!.hooks[0]!.command
		const unstarted = runGuard(startCommand, product, dir)
		expect(unstarted.status, unstarted.stderr).toBe(0)
		expect(unstarted.stdout).toContain(
			'the harness session-start hook did not run',
		)

		const pkgFile = path.join(product, 'package.json')
		const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
		pkg.devDependencies['@dom-kelly/reins'] = `file:${path.join(dir, tarball)}`
		writeFileSync(pkgFile, `${JSON.stringify(pkg, null, '\t')}\n`)

		const install = run('npm', ['install', '--no-audit', '--no-fund'], product)
		expect(install.code, install.out).toBe(0)
		// Installed, the same command runs the product's own copy and reports.
		const started = runGuard(startCommand, product, dir)
		expect(started.status, started.stderr).toBe(0)
		expect(started.stdout).toContain('reins doctor:')
		expect(started.stdout).toContain(
			"✅ reins installed in this repo's node_modules",
		)

		// The skills travel with the package and load in place from here
		// (decision 0009), so `files` must pack the plugin and its marketplace.
		const installedReins = path.join(product, 'node_modules/@dom-kelly/reins')
		for (const rel of [
			'.claude-plugin/marketplace.json',
			'plugin/.claude-plugin/plugin.json',
			'plugin/skills/ship-pr/SKILL.md',
		]) {
			expect(existsSync(path.join(installedReins, rel)), rel).toBe(true)
		}
		expect(
			JSON.parse(
				readFileSync(
					path.join(installedReins, 'plugin/.claude-plugin/plugin.json'),
					'utf8',
				),
			).version,
		).toBe(
			JSON.parse(
				readFileSync(path.join(installedReins, 'package.json'), 'utf8'),
			).version,
		)
		expect(existsSync(path.join(product, '.claude/skills'))).toBe(false)

		const helpText = run('npx', ['reins', '--help'], product)
		expect(helpText.code, helpText.out).toBe(0)
		expect(helpText.out).toContain('reins sync')

		// The CLI is the only contract (decision 0004): `exports` makes a deep
		// import of dist/ fail at resolution, while package.json stays
		// resolvable so tooling can read the installed version.
		const deepImport = run(
			'node',
			[
				'-e',
				"import('@dom-kelly/reins/dist/bin/reins.js').then(() => process.exit(0), (e) => { console.error(e.code); process.exit(1) })",
			],
			product,
		)
		expect(deepImport.code, deepImport.out).toBe(1)
		expect(deepImport.out).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
		const pkgJson = run(
			'node',
			['-e', "console.log(require.resolve('@dom-kelly/reins/package.json'))"],
			product,
		)
		expect(pkgJson.code, pkgJson.out).toBe(0)
		expect(pkgJson.out).toContain(path.join('@dom-kelly/reins', 'package.json'))

		const format = run('npx', ['prettier', '--check', '.'], product)
		expect(format.code, format.out).toBe(0)
		const validate = run('npm', ['run', '-s', 'validate'], product)
		expect(validate.code, validate.out).toBe(0)

		const sync = run('npx', ['reins', 'sync', '--check'], product)
		expect(sync.code, sync.out).toBe(0)

		const guard = spawnSync('npx', ['reins', 'hook', 'guard-bash'], {
			cwd: product,
			encoding: 'utf8',
			input: pushToMain,
		})
		expect(guard.status).toBe(2)
		// Through the real command line the guard's own refusal comes back, not
		// the "did not run" message.
		const installed = runGuard(guardCommand, product, dir)
		expect(installed.status, installed.stderr).toBe(2)
		expect(installed.stderr).toContain('Pushing straight to main')
		expect(installed.stderr).not.toContain('did not run')

		// The typecheck hook the same way, with npm's prefix outside nvm as it
		// is when the session's Node is not nvm's: the product's typecheck must
		// run and pass, not be skipped or refused. The Node running this test
		// matches the product's .nvmrc, so it is used as is; the switch to
		// another is unit-tested.
		const typecheckCommand = settings.hooks.PostToolUse[0]!.hooks[0]!.command
		const edited = (await readdir(path.join(product, 'src'))).find((f) =>
			f.endsWith('.ts'),
		)!
		const typecheck = spawnSync('sh', ['-c', typecheckCommand], {
			cwd: product,
			encoding: 'utf8',
			input: JSON.stringify({
				tool_input: { file_path: path.join(product, 'src', edited) },
			}),
			env: { ...process.env, npm_config_prefix: dir },
		})
		expect(typecheck.status, `${typecheck.stdout}\n${typecheck.stderr}`).toBe(0)
		expect(typecheck.stdout).toBe('')
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

// Products install from a git URL, not a tarball: npm fetches the repo at the
// resolved commit into a temp dir with no dist/ and no node_modules (a clone
// here; for GitHub, the tarball of the commit, so no .git), installs the
// devDependencies there, runs scripts/prepare.mjs (twice: on that install and
// again when it packs) and packs what is left. A devDependency missing from
// package.json or a prepare that expects an existing build fails only on this
// path. npm takes HEAD, so uncommitted changes are not exercised (the pre-push
// hook tests the working tree, not the pushed commits; commit first). Semver
// tag resolution is not exercised either: the spec pins the sha.
test('a product that installs the package from git passes its own validate', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'harness-e2e-git-'))
	try {
		// Scaffold with the built CLI as a product would. Always rebuild: a
		// dist/ left by another branch would scaffold from the wrong source.
		const build = run('npm', ['run', '-s', 'build'], packageRoot)
		expect(build.code, build.out).toBe(0)
		const cli = path.join(packageRoot, 'dist/bin/reins.js')
		const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: packageRoot,
			encoding: 'utf8',
		}).trim()

		const product = path.join(dir, 'demo-product')
		const created = run(
			'node',
			[cli, 'new', product, '--no-install', '--no-git'],
			dir,
		)
		expect(created.code, created.out).toBe(0)

		const pkgFile = path.join(product, 'package.json')
		const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
		// A file URL, so a checkout path with a space or # still parses.
		pkg.devDependencies['@dom-kelly/reins'] =
			`git+${pathToFileURL(packageRoot).href}#${sha}`
		writeFileSync(pkgFile, `${JSON.stringify(pkg, null, '\t')}\n`)

		// npm folds the clone's install and prepare output into its own error
		// output, so the whole output is the failure message.
		const install = run('npm', ['install', '--no-audit', '--no-fund'], product)
		expect(install.code, `npm install from git failed:\n${install.out}`).toBe(0)
		const installedCli = path.join(
			product,
			'node_modules/@dom-kelly/reins/dist/bin/reins.js',
		)
		expect(
			existsSync(installedCli),
			'prepare in the clone should have built dist/',
		).toBe(true)

		const helpText = run('npx', ['reins', '--help'], product)
		expect(helpText.code, helpText.out).toBe(0)
		expect(helpText.out).toContain('reins sync')

		const validate = run('npm', ['run', '-s', 'validate'], product)
		expect(validate.code, validate.out).toBe(0)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})
