import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
		) as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } }
		const guardCommand = settings.hooks.PreToolUse[0]!.hooks[0]!.command
		const uninstalled = runGuard(guardCommand, product, dir)
		expect(uninstalled.status, uninstalled.stderr).toBe(2)
		expect(uninstalled.stderr).toContain('the harness guard did not run')

		const pkgFile = path.join(product, 'package.json')
		const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
		pkg.devDependencies['@dom-kelly/reins'] = `file:${path.join(dir, tarball)}`
		writeFileSync(pkgFile, `${JSON.stringify(pkg, null, '\t')}\n`)

		const install = run('npm', ['install', '--no-audit', '--no-fund'], product)
		expect(install.code, install.out).toBe(0)

		const helpText = run('npx', ['reins', '--help'], product)
		expect(helpText.code, helpText.out).toBe(0)
		expect(helpText.out).toContain('reins sync')

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
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})
