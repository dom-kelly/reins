import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import {
	runGateOnStopHook,
	runNpmScript,
	runSessionStartHook,
	runTypecheckHook,
	stopGateScript,
	typecheckScript,
	typecheckTarget,
} from './claude-hooks.ts'

// Git exports an absolute GIT_DIR to hooks run from a worktree. The test suite
// run by pre-push then did `git init` in a temp dir and committed into the
// real repo.
test('an npm script run by a hook does not inherit GIT_DIR', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'harness-hook-env-'))
	const saved = process.env.GIT_DIR
	process.env.GIT_DIR = '/nowhere/.git'
	try {
		await writeFile(
			path.join(root, 'package.json'),
			JSON.stringify({ scripts: { show: 'echo "dir=[$GIT_DIR]"' } }),
		)
		const { status, output } = runNpmScript(root, 'show')
		expect(status, output).toBe(0)
		expect(output).toContain('dir=[]')
	} finally {
		if (saved === undefined) delete process.env.GIT_DIR
		else process.env.GIT_DIR = saved
		await rm(root, { recursive: true, force: true })
	}
})

const nvmDir = path.resolve(process.env.NVM_DIR ?? path.join(homedir(), '.nvm'))
const nvmInstalled = existsSync(path.join(nvmDir, 'nvm.sh'))
const major = process.versions.node.split('.')[0]!
/** Whether nvm can select this test's own major (CI gets Node from
 *  setup-node, with nvm present but empty). */
const nvmHasMajor =
	nvmInstalled &&
	existsSync(path.join(nvmDir, 'versions/node')) &&
	readdirSync(path.join(nvmDir, 'versions/node')).some((v) =>
		v.startsWith(`v${major}.`),
	)

/** Runs `fn` with these variables set in process.env (undefined = unset),
 *  restoring the originals afterwards. */
async function withEnv(
	vars: Record<string, string | undefined>,
	fn: () => Promise<void>,
) {
	const saved = Object.fromEntries(
		Object.keys(vars).map((k) => [k, process.env[k]]),
	)
	for (const [k, v] of Object.entries(vars))
		if (v === undefined) delete process.env[k]
		else process.env[k] = v
	try {
		await fn()
	} finally {
		for (const [k, v] of Object.entries(saved))
			if (v === undefined) delete process.env[k]
			else process.env[k] = v
	}
}

// Claude Code runs the hooks through `npx reins hook …`, and npm exports its
// config to what it runs: the hook arrives with npm_config_prefix set to the
// prefix of whatever Node ran npx. When that Node is not nvm's (Homebrew's,
// say), nvm refuses to switch and, before this test, the hook silently ran the
// product's gate on the wrong Node (rollup: "Cannot find module
// @rollup/rollup-darwin-x64" under an x64 Node 23 on an arm64 Mac). A `node`
// shim first on a PATH with no nvm bin in it stands in for the hook's own Node
// (given an nvm bin, nvm edits that entry in place instead of prepending), and
// the version the hook believes it runs on is passed in.
test('a hook runs the Node in .nvmrc, switching with nvm only when its own Node is wrong', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'harness-hook-nvm-'))
	const shim = path.join(root, 'shim')
	const prefix = path.join(root, 'prefix')
	try {
		await mkdir(shim)
		await mkdir(prefix)
		await writeFile(path.join(shim, 'node'), '#!/bin/sh\necho shim\n')
		await chmod(path.join(shim, 'node'), 0o755)
		// npm resolves from the same PATH, which may hold no other npm (a
		// machine with Node from nvm only): this test's own, whose `env node`
		// shebang still lands on the shim.
		await symlink(
			path.join(path.dirname(process.execPath), 'npm'),
			path.join(shim, 'npm'),
		)
		await writeFile(
			path.join(root, 'package.json'),
			JSON.stringify({ scripts: { show: 'node -p process.version' } }),
		)
		const pathWithoutNvm = (process.env.PATH ?? '')
			.split(path.delimiter)
			.filter((dir) => !dir.startsWith(`${nvmDir}${path.sep}`))
		await withEnv(
			{
				npm_config_prefix: prefix,
				NVM_BIN: undefined,
				NVM_INC: undefined,
				PATH: [shim, ...pathWithoutNvm].join(path.delimiter),
			},
			async () => {
				// No .nvmrc: nothing to match, the hook's Node (the shim) runs
				// (npm's own shebang resolves to it, so "shim" is npm's output).
				let run = runNpmScript(root, 'show')
				expect(run.status, run.output).toBe(0)
				expect(run.output).toContain('shim')

				// The hook's Node matches: used as is, nvm not consulted (CI has
				// nvm but no Node in it; a matching setup-node Node must do).
				await writeFile(path.join(root, '.nvmrc'), `${major}\n`)
				run = runNpmScript(root, 'show')
				expect(run.status, run.output).toBe(0)
				expect(run.output).toContain('shim')

				// The hook's Node is wrong: nvm selects the one in .nvmrc despite
				// the foreign prefix (main's code printed "shim" here), or says
				// why it cannot.
				run = runNpmScript(root, 'show', '1.0.0')
				if (nvmHasMajor) {
					expect(run.status, run.output).toBe(0)
					expect(run.ran).toBe(true)
					expect(run.output).toContain(`v${major}.`)
				} else {
					expect(run.status, run.output).toBe(2)
					expect(run.ran).toBe(false)
					expect(run.output).toMatch(
						/^npm run show did not run: node \d+ .* have 1\.0\.0\. The hooks run on the Node Claude Code was started with/,
					)
					if (nvmInstalled)
						expect(run.output).toContain('nvm could not select it')
				}
				expect(run.output).not.toContain('shim')

				// An .nvmrc only nvm can read (an alias): no version is claimed, so
				// the hook's Node is used as is rather than refused with NaN.
				await writeFile(path.join(root, '.nvmrc'), 'lts/*\n')
				run = runNpmScript(root, 'show', '1.0.0')
				expect(run.status, run.output).toBe(0)
				expect(run.output).toContain('shim')

				// A Node nothing can supply: the script does not run on the shim.
				await writeFile(path.join(root, '.nvmrc'), '999\n')
				run = runNpmScript(root, 'show', '1.0.0')
				expect(run.status, run.output).toBe(2)
				expect(run.ran).toBe(false)
				expect(run.output).toMatch(
					/^npm run show did not run: node 999 .* have 1\.0\.0\./,
				)
				expect(run.output).not.toContain('shim')
			},
		)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

/** A dirty repo with trivial scripts, so the Stop hook has something to run. */
async function dirtyRepo(
	root: string,
	config: Record<string, unknown> | undefined,
) {
	execFileSync('git', ['init', '-q'], { cwd: root })
	await writeFile(
		path.join(root, 'package.json'),
		JSON.stringify({ scripts: { ok: 'exit 0', bad: 'exit 1' } }),
	)
	if (config)
		await writeFile(path.join(root, 'reins.json'), JSON.stringify(config))
	// Untracked files make `git status --porcelain` non-empty.
	await writeFile(path.join(root, 'change.txt'), 'x')
}

test('the Stop hook runs hooks.stopGate, else policy.gate, else validate', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'harness-stop-gate-'))
	const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
	const notices = vi.spyOn(console, 'log').mockImplementation(() => {})
	const base = { harness: '0', product: { name: 'x' } }
	const run = () => {
		errors.mockClear()
		notices.mockClear()
		return runGateOnStopHook(root, '{}')
	}
	// Claude Code shows a hook's stdout only as JSON with a systemMessage.
	const notice = () =>
		(JSON.parse(notices.mock.calls[0]?.[0]) as { systemMessage: string })
			.systemMessage
	try {
		await dirtyRepo(root, undefined)
		expect(stopGateScript(undefined)).toBe('validate')
		expect(stopGateScript({ ...base, policy: { gate: 'bad' } })).toBe('bad')
		expect(
			stopGateScript({
				...base,
				policy: { gate: 'bad' },
				hooks: { stopGate: 'ok' },
			}),
		).toBe('ok')

		// stopGate overrides the gate: the gate would fail, the stop gate passes.
		await dirtyRepo(root, {
			...base,
			policy: { gate: 'bad' },
			hooks: { stopGate: 'ok' },
		})
		expect(run()).toBe(0)
		expect(errors).not.toHaveBeenCalled()
		expect(notices).not.toHaveBeenCalled()

		// Falls back to the gate, and names it in the failure.
		await dirtyRepo(root, { ...base, policy: { gate: 'bad' } })
		expect(run()).toBe(2)
		expect(errors.mock.calls[0]?.[0]).toMatch(/^npm run bad failed/)

		// Falls back to validate; missing here, so nothing runs but a notice says so.
		await dirtyRepo(root, base)
		expect(run()).toBe(0)
		expect(errors).not.toHaveBeenCalled()
		expect(notices).toHaveBeenCalledTimes(1)
		expect(notice()).toMatch(/no "validate" script/)

		// A misspelt stop gate is named too.
		await dirtyRepo(root, { ...base, hooks: { stopGate: 'nope' } })
		expect(run()).toBe(0)
		expect(notice()).toMatch(/no "nope" script/)

		// A second refusal in a row lets the agent stop.
		await dirtyRepo(root, { ...base, policy: { gate: 'bad' } })
		expect(runGateOnStopHook(root, '{"stop_hook_active":true}')).toBe(0)
	} finally {
		errors.mockRestore()
		notices.mockRestore()
		await rm(root, { recursive: true, force: true })
	}
})

test('the typecheck hook runs hooks.typecheck, else typecheck, only for files it should check', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'harness-typecheck-'))
	const elsewhere = await mkdtemp(path.join(tmpdir(), 'harness-elsewhere-'))
	const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
	const notices = vi.spyOn(console, 'log').mockImplementation(() => {})
	const base = { harness: '0', product: { name: 'x' } }
	const run = (file: string) => {
		errors.mockClear()
		notices.mockClear()
		return runTypecheckHook(
			root,
			JSON.stringify({ tool_input: { file_path: file } }),
		)
	}
	const notice = () =>
		(JSON.parse(notices.mock.calls[0]?.[0]) as { systemMessage: string })
			.systemMessage
	const configure = (config: Record<string, unknown> | undefined) =>
		config
			? writeFile(path.join(root, 'reins.json'), JSON.stringify(config))
			: rm(path.join(root, 'reins.json'), { force: true })
	try {
		// `typecheck` fails, so a run that reaches it is visible as exit 2.
		await writeFile(
			path.join(root, 'package.json'),
			JSON.stringify({ scripts: { typecheck: 'exit 1', ok: 'exit 0' } }),
		)
		for (const dir of [
			'src',
			'dist',
			'generated',
			'node_modules/dep',
			'packages/x/node_modules/dep',
			'..cache',
		])
			await mkdir(path.join(root, dir), { recursive: true })
		for (const file of [
			'src/a.ts',
			'src/b.js',
			'dist/a.ts',
			'generated/a.ts',
			'node_modules/dep/a.ts',
			'packages/x/node_modules/dep/a.ts',
			'..cache/a.ts',
		])
			await writeFile(path.join(root, file), '')
		await writeFile(path.join(elsewhere, 'a.ts'), '')
		// An in-repo symlink to outside the repo is still an in-repo edit.
		await symlink(
			path.join(elsewhere, 'a.ts'),
			path.join(root, 'src/linked.ts'),
		)
		// A root reached through a symlink (macOS /var -> /private/var) with a
		// file path typed through the same link, or not through it at all.
		const link = path.join(elsewhere, 'repo-link')
		await symlink(root, link)

		expect(typecheckScript(undefined)).toBe('typecheck')
		expect(typecheckScript({ ...base, hooks: { typecheck: 'ok' } })).toBe('ok')

		// Default: a .ts edit in the repo runs `typecheck`; a .js edit does not.
		await configure(undefined)
		expect(run(path.join(root, 'src/a.ts'))).toBe(2)
		expect(errors.mock.calls[0]?.[0]).toMatch(/^Typecheck failed after editing/)
		expect(run(path.join(root, 'src/b.js'))).toBe(0)
		expect(errors).not.toHaveBeenCalled()

		// Override: hooks.typecheck names the script.
		await configure({ ...base, hooks: { typecheck: 'ok' } })
		expect(run(path.join(root, 'src/a.ts'))).toBe(0)
		expect(errors).not.toHaveBeenCalled()
		expect(notices).not.toHaveBeenCalled()

		// Outside the repo root (by resolved path), and under an always-ignored
		// or configured prefix: nothing runs, nothing is said.
		await configure({ ...base, hooks: { typecheckIgnore: ['generated/'] } })
		for (const [r, file] of [
			[root, path.join(root, 'src/a.ts')],
			[root, path.join(root, 'src/new.ts')], // not written yet
			[root, path.join(root, 'src/linked.ts')],
			[root, path.join(root, '..cache/a.ts')],
			[link, path.join(link, 'src/a.ts')],
			[link, path.join(root, 'src/a.ts')],
			[root, path.join(link, 'src/a.ts')],
		]) {
			expect(typecheckTarget(r!, file!, undefined), file).toMatch(/\.ts$/)
		}
		for (const file of [
			path.join(elsewhere, 'a.ts'),
			path.join(root, '../a.ts'),
			path.join(root, 'dist/a.ts'),
			path.join(root, 'node_modules/dep/a.ts'),
			path.join(root, 'packages/x/node_modules/dep/a.ts'),
			path.join(root, 'generated/a.ts'),
		]) {
			expect(run(file), file).toBe(0)
			expect(errors, file).not.toHaveBeenCalled()
			expect(notices, file).not.toHaveBeenCalled()
		}
		// A prefix matches whole segments however it is spelt, and an empty
		// or `.` entry ignores nothing rather than everything.
		const target = (prefix: string, file: string) =>
			typecheckTarget(root, path.join(root, file), {
				...base,
				hooks: { typecheckIgnore: [prefix] },
			})
		expect(target('generated', 'generated2/a.ts')).toBe('generated2/a.ts')
		expect(target('./generated//', 'generated/a.ts')).toBeUndefined()
		expect(target('', 'src/a.ts')).toBe('src/a.ts')
		expect(target('.', 'src/a.ts')).toBe('src/a.ts')

		// A broken reins.json is reported, and the default script still runs.
		await writeFile(path.join(root, 'reins.json'), '{')
		expect(run(path.join(root, 'src/a.ts'))).toBe(2)
		expect(notice()).toMatch(/cannot read reins.json/)

		// A missing script is named, not silently skipped.
		await configure({ ...base, hooks: { typecheck: 'nope' } })
		expect(run(path.join(root, 'src/a.ts'))).toBe(0)
		expect(errors).not.toHaveBeenCalled()
		expect(notices).toHaveBeenCalledTimes(1)
		expect(notice()).toMatch(/no "nope" script/)
	} finally {
		errors.mockRestore()
		notices.mockRestore()
		await rm(path.join(elsewhere, 'repo-link'), { force: true })
		await rm(root, { recursive: true, force: true })
		await rm(elsewhere, { recursive: true, force: true })
	}
})

// A session that opens on a bare clone must hear what is missing, in its
// context (stdout), and still open: the fix is the agent's first job, not a
// reason to refuse it.
test('the session-start hook reports the doctor lines and never blocks', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'harness-session-start-'))
	const log = vi.spyOn(console, 'log').mockImplementation(() => {})
	try {
		expect(runSessionStartHook(root)).toBe(0)
		const output = log.mock.calls.map((c) => c.join(' ')).join('\n')
		expect(output).toMatch(
			/^reins doctor: \d+ thing\(s\) to fix before starting work/,
		)
		expect(output).toContain('❌ node_modules installed → npm install')
		expect(output).toContain('→ npx reins adopt')
	} finally {
		log.mockRestore()
		await rm(root, { recursive: true, force: true })
	}
})
