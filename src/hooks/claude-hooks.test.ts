import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import {
	runGateOnStopHook,
	runNpmScript,
	stopGateScript,
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
	const base = { harness: '0', product: { name: 'x' } }
	const run = () => {
		errors.mockClear()
		return runGateOnStopHook(root, '{}')
	}
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

		// Falls back to the gate, and names it in the failure.
		await dirtyRepo(root, { ...base, policy: { gate: 'bad' } })
		expect(run()).toBe(2)
		expect(errors.mock.calls[0]?.[0]).toMatch(/^npm run bad failed/)

		// Falls back to validate; missing here, so nothing runs but a notice says so.
		await dirtyRepo(root, base)
		expect(run()).toBe(0)
		expect(errors).toHaveBeenCalledTimes(1)
		expect(errors.mock.calls[0]?.[0]).toMatch(/no "validate" script/)

		// A misspelt stop gate is named too.
		await dirtyRepo(root, { ...base, hooks: { stopGate: 'nope' } })
		expect(run()).toBe(0)
		expect(errors.mock.calls[0]?.[0]).toMatch(/no "nope" script/)

		// A second refusal in a row lets the agent stop.
		await dirtyRepo(root, { ...base, policy: { gate: 'bad' } })
		expect(runGateOnStopHook(root, '{"stop_hook_active":true}')).toBe(0)
	} finally {
		errors.mockRestore()
		await rm(root, { recursive: true, force: true })
	}
})
