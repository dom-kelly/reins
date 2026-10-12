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

function git(root: string, args: Array<string>) {
	return execFileSync('git', args, {
		cwd: root,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	})
}

/** Where this branch left `ref`: a branch behind main must not be judged on
 *  main's later changes. Falls back to `ref` itself (no HEAD yet, or `ref`
 *  missing, which the callers treat as nothing to compare). */
function mergeBase(root: string, ref: string) {
	try {
		return git(root, ['merge-base', ref, 'HEAD']).trim()
	} catch {
		return ref
	}
}

/** Files that differ between `ref` and the working tree under `prefixes`, or
 *  undefined when the ref does not exist (a fresh repo has no origin/main). */
function changedSince(root: string, ref: string, prefixes: Array<string>) {
	try {
		return git(root, ['diff', '--name-only', ref, '--', ...prefixes])
			.split('\n')
			.filter(Boolean)
	} catch {
		return undefined
	}
}

function versionOf(source: string) {
	return (JSON.parse(source) as { version?: string }).version
}

/** A change to shipped code needs a release: a bumped package.json version and
 *  a `## [version]` heading in CHANGELOG.md, so merging main tags a release
 *  that products pick up by a semver range rather than tracking main. */
function versionBumpIssues(
	root: string,
	prefixes: Array<string>,
	baseRef: string,
	base: string,
): Array<CheckIssue> {
	const changed = changedSince(root, base, prefixes)
	if (!changed?.length) return []
	let baseVersion: string | undefined
	try {
		baseVersion = versionOf(git(root, ['show', `${base}:package.json`]))
	} catch {
		return [] // no package.json on the base yet; nothing to compare
	}
	const pkgFile = path.join(root, 'package.json')
	const version = existsSync(pkgFile)
		? versionOf(readFileSync(pkgFile, 'utf8'))
		: undefined
	const what = `${changed.length} shipped file(s) changed since ${baseRef} (${changed[0]}${changed.length > 1 ? ', …' : ''})`
	if (!version || version === baseVersion) {
		return [
			{
				file: 'package.json',
				message: `${what} but version is still ${baseVersion}; bump it (patch for fixes, minor for new behaviour) and add \`## [<new version>]\` to CHANGELOG.md`,
			},
		]
	}
	const changelog = path.join(root, 'CHANGELOG.md')
	const heading = `## [${version}]`
	const entry = existsSync(changelog)
		? readFileSync(changelog, 'utf8')
				.split('\n')
				.some((line) => line.startsWith(heading))
		: false
	if (!entry) {
		return [
			{
				file: 'CHANGELOG.md',
				message: `${what} and version is ${version}, but CHANGELOG.md has no \`${heading}\` heading; add one saying what changed`,
			},
		]
	}
	return []
}

/** Gotchas that became checks: one package manager, a short AGENTS.md,
 *  append-only paths (applied migrations are never edited) and a version bump
 *  with a changelog entry when shipped code changes. */
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
	const base = mergeBase(root, baseRef)
	for (const prefix of checks.appendOnly ?? []) {
		let changed: string
		try {
			changed = git(root, [
				'diff',
				'--name-only',
				'--diff-filter=MDR',
				base,
				'--',
				prefix,
			])
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
	if (checks.bumpVersionWhen?.length) {
		issues.push(
			...versionBumpIssues(root, checks.bumpVersionWhen, baseRef, base),
		)
	}
	return {
		name: 'repo rules',
		issues,
		remediation: 'See reins.json → checks for the rules this repo has chosen.',
	}
}
