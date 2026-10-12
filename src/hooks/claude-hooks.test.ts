import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
