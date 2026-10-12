import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The harness package itself: templates and scaffold live here. Found by
 *  walking up from this module, so it works from src/ and from dist/src/. */
export const packageRoot = (() => {
	let dir = path.dirname(fileURLToPath(import.meta.url))
	for (let i = 0; i < 6; i++) {
		const file = path.join(dir, 'package.json')
		if (existsSync(file)) {
			const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string }
			if (pkg.name === '@dom-kelly/reins') return dir
		}
		dir = path.dirname(dir)
	}
	throw new Error('reins: cannot find the package root')
})()

/** The repo the CLI acts on: the git toplevel of `from`, else `from` itself. */
export function findRepoRoot(from = process.cwd()) {
	try {
		return execFileSync('git', ['rev-parse', '--show-toplevel'], {
			cwd: from,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim()
	} catch {
		return path.resolve(from)
	}
}

const skippedDirs = new Set([
	'node_modules',
	'.git',
	'.tmp',
	'coverage',
	'.harness',
	'.reins',
])

/** Lists files under `relativeDir` (posix paths relative to `root`), following
 *  symlinked directories once each. */
export async function listFiles(
	root: string,
	relativeDir: string,
	include: (relativePath: string) => boolean,
): Promise<Array<string>> {
	const results: Array<string> = []
	const visited = new Set<string>()
	async function walk(dir: string) {
		const absolute = path.join(root, dir)
		let real: string
		try {
			real = await realpath(absolute)
		} catch {
			return
		}
		if (visited.has(real)) return
		visited.add(real)
		let entries
		try {
			entries = await readdir(absolute, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			const rel = dir === '.' ? entry.name : path.posix.join(dir, entry.name)
			let isDirectory = entry.isDirectory()
			if (entry.isSymbolicLink()) {
				try {
					isDirectory = (await stat(path.join(root, rel))).isDirectory()
				} catch {
					continue
				}
			}
			if (isDirectory) {
				if (!skippedDirs.has(entry.name)) await walk(rel)
			} else if (include(rel)) {
				results.push(rel)
			}
		}
	}
	await walk(relativeDir)
	return results.toSorted()
}

export function readRepoFile(root: string, relativePath: string) {
	return readFile(path.join(root, relativePath), 'utf8')
}

export function isExecutedDirectly(importMetaUrl: string) {
	return process.argv[1] === fileURLToPath(importMetaUrl)
}

export type CheckIssue = { file: string; line?: number; message: string }

export type CheckResult = {
	name: string
	issues: Array<CheckIssue>
	remediation: string
}

export function formatResult({ name, issues, remediation }: CheckResult) {
	if (issues.length === 0) return `✅ ${name}: ok`
	const lines = [`❌ ${name}: ${issues.length} issue(s)`]
	for (const issue of issues) {
		const location = issue.line ? `${issue.file}:${issue.line}` : issue.file
		lines.push(`  ${location} — ${issue.message}`)
	}
	lines.push(`  ${remediation}`)
	return lines.join('\n')
}
