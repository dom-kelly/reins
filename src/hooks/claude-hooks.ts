import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { readConfig, type HarnessConfig } from '../lib/config.ts'

/** Git exports GIT_DIR (absolute in a worktree) to its hooks. A script that
 *  then runs git in another directory, as a test fixture does, would act on
 *  the developer's repo instead; drop the variables so git finds the repo from
 *  its cwd. */
function withoutGitEnv(env = process.env) {
	const clean = { ...env }
	for (const key of [
		'GIT_DIR',
		'GIT_WORK_TREE',
		'GIT_INDEX_FILE',
		'GIT_PREFIX',
	])
		delete clean[key]
	return clean
}

/** Runs an npm script with the Node from .nvmrc when nvm is installed: hooks
 *  inherit the shell's default Node, which may not be the one the project's
 *  native bindings were built for. Returns { status, output }. */
export function runNpmScript(root: string, script: string) {
	const nvm = path.join(
		process.env.NVM_DIR ?? path.join(homedir(), '.nvm'),
		'nvm.sh',
	)
	const options = { cwd: root, encoding: 'utf8', env: withoutGitEnv() } as const
	const result = existsSync(nvm)
		? spawnSync(
				'bash',
				[
					'-c',
					`. "${nvm}" >/dev/null 2>&1; nvm use --silent >/dev/null 2>&1; npm run -s "$0"`,
					script,
				],
				options,
			)
		: spawnSync('npm', ['run', '-s', script], options)
	return {
		status: result.status ?? 1,
		output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
	}
}

function hasScript(root: string, script: string) {
	const file = path.join(root, 'package.json')
	if (!existsSync(file)) return false
	const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
		scripts?: Record<string, string>
	}
	return Boolean(pkg.scripts?.[script])
}

const tail = (text: string, n = 40) =>
	text.trim().split('\n').slice(-n).join('\n')

/** PostToolUse on Edit|Write: typecheck after a TypeScript edit; exit 2 feeds
 *  the errors back to the agent. */
export function runTypecheckHook(
	root: string,
	input = readFileSync(0, 'utf8'),
) {
	const file =
		(JSON.parse(input) as { tool_input?: { file_path?: string } }).tool_input
			?.file_path ?? ''
	if (!/\.(ts|tsx|mts|cts)$/.test(file)) return 0
	if (!hasScript(root, 'typecheck')) return 0
	const { status, output } = runNpmScript(root, 'typecheck')
	if (status === 0) return 0
	console.error(`Typecheck failed after editing ${file}:\n${tail(output)}`)
	return 2
}

/** The script the Stop hook runs: `hooks.stopGate` when a product's merge
 *  gate is too slow for the hook's budget, else the gate itself. */
export function stopGateScript(config: HarnessConfig | undefined) {
	return config?.hooks?.stopGate ?? config?.policy?.gate ?? 'validate'
}

/** Stop: when the working tree has changes, the stop gate must pass before
 *  the agent finishes. A second refusal in a row lets it stop and report
 *  instead of looping. */
export function runGateOnStopHook(
	root: string,
	input = readFileSync(0, 'utf8'),
) {
	const parsed = JSON.parse(input) as { stop_hook_active?: boolean }
	if (parsed.stop_hook_active) return 0
	let dirty: string
	try {
		dirty = execFileSync('git', ['status', '--porcelain'], {
			cwd: root,
			encoding: 'utf8',
		})
	} catch {
		return 0
	}
	if (!dirty.trim()) return 0
	const gate = stopGateScript(readConfig(root))
	if (!hasScript(root, gate)) {
		// Not a block (nothing to run), but say so: a misconfigured stop gate
		// must not be invisible. Claude Code drops stderr from a hook that exits
		// 0; a systemMessage on stdout is shown to the user.
		console.log(
			JSON.stringify({
				systemMessage: `validate-on-stop: no "${gate}" script in package.json, so nothing ran (set hooks.stopGate or policy.gate in reins.json)`,
			}),
		)
		return 0
	}
	const { status, output } = runNpmScript(root, gate)
	if (status === 0) return 0
	console.error(
		`npm run ${gate} failed. Fix it before finishing, or tell the user why you cannot:\n${tail(output)}`,
	)
	return 2
}
