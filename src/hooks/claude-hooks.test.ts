import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import {
	runGateOnStopHook,
	runNpmScript,
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
		for (const dir of ['src', 'dist', 'generated', 'node_modules/dep'])
			await mkdir(path.join(root, dir), { recursive: true })
		for (const file of [
			'src/a.ts',
			'src/b.js',
			'dist/a.ts',
			'generated/a.ts',
			'node_modules/dep/a.ts',
		])
			await writeFile(path.join(root, file), '')
		await writeFile(path.join(elsewhere, 'a.ts'), '')

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
		expect(typecheckTarget(root, path.join(root, 'src/a.ts'), undefined)).toBe(
			'src/a.ts',
		)
		for (const file of [
			path.join(elsewhere, 'a.ts'),
			path.join(root, '../a.ts'),
			path.join(root, 'dist/a.ts'),
			path.join(root, 'node_modules/dep/a.ts'),
			path.join(root, 'generated/a.ts'),
		]) {
			expect(run(file), file).toBe(0)
			expect(errors, file).not.toHaveBeenCalled()
			expect(notices, file).not.toHaveBeenCalled()
		}
		// A prefix is a path segment: `generated/` does not cover `generated2/`.
		expect(
			typecheckTarget(root, path.join(root, 'generated2/a.ts'), {
				...base,
				hooks: { typecheckIgnore: ['generated'] },
			}),
		).toBe('generated2/a.ts')

		// A missing script is named, not silently skipped.
		await configure({ ...base, hooks: { typecheck: 'nope' } })
		expect(run(path.join(root, 'src/a.ts'))).toBe(0)
		expect(errors).not.toHaveBeenCalled()
		expect(notices).toHaveBeenCalledTimes(1)
		expect(notice()).toMatch(/no "nope" script/)
	} finally {
		errors.mockRestore()
		notices.mockRestore()
		await rm(root, { recursive: true, force: true })
		await rm(elsewhere, { recursive: true, force: true })
	}
})
