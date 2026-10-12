import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { HarnessConfig } from '../lib/config.ts'
import type { CheckIssue, CheckResult } from '../lib/repo.ts'

const lockfiles = {
	npm: 'package-lock.json',
	pnpm: 'pnpm-lock.yaml',
	yarn: 'yarn.lock',
	bun: 'bun.lockb',
} as const

/** Gotchas that became checks: one package manager, a short AGENTS.md, and
 *  append-only paths (applied migrations are never edited). */
export function checkRepoRules(
	root: string,
	config: HarnessConfig | undefined,
	baseRef = 'origin/main',
): CheckResult {
	const issues: Array<CheckIssue> = []
	const checks = config?.checks ?? {}
	const manager = checks.lockfile ?? 'npm'
	for (const [name, file] of Object.entries(lockfiles)) {
		if (name !== manager && existsSync(path.join(root, file))) {
			issues.push({
				file,
				message: `this repo uses ${manager} (${lockfiles[manager]}); delete it`,
			})
		}
	}
	const agents = path.join(root, 'AGENTS.md')
	const maxLines = checks.agentsMaxLines ?? 20
	if (existsSync(agents)) {
		const lines = readFileSync(agents, 'utf8').trimEnd().split('\n').length
		if (lines > maxLines) {
			issues.push({
				file: 'AGENTS.md',
				message: `${lines} lines (max ${maxLines}); it is a map — move detail into docs/`,
			})
		}
	}
	for (const prefix of checks.appendOnly ?? []) {
		let changed: string
		try {
			changed = execFileSync(
				'git',
				['diff', '--name-only', '--diff-filter=MDR', baseRef, '--', prefix],
				{ cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
			)
		} catch {
			continue // no such ref yet (fresh repo); nothing to compare
		}
		for (const file of changed.split('\n').filter(Boolean)) {
			issues.push({
				file,
				message: `files under ${prefix} are append-only; add a new one instead of editing`,
			})
		}
	}
	return {
		name: 'repo rules',
		issues,
		remediation: 'See reins.json → checks for the rules this repo has chosen.',
	}
}
