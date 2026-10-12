import { execFileSync } from 'node:child_process'
import {
	existsSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import path from 'node:path'

/** A change note: one file per PR under `changes/`, so two PRs that ship code
 *  share no file and merge in any order (decision 0011). The first non-empty
 *  line is the bump kind; the rest is the changelog text. */
export type Fragment = {
	file: string
	kind: BumpKind
	note: string
}

export type BumpKind = 'patch' | 'minor'

export const fragmentsDir = 'changes'

const kinds: ReadonlyArray<BumpKind> = ['patch', 'minor']

/** The files under `changes/` that are change notes: every `.md` but the
 *  README that explains the format. */
export function fragmentFiles(root: string): Array<string> {
	const dir = path.join(root, fragmentsDir)
	if (!existsSync(dir)) return []
	return readdirSync(dir)
		.filter((name) => name.endsWith('.md') && name !== 'README.md')
		.toSorted()
		.map((name) => `${fragmentsDir}/${name}`)
}

export function parseFragment(file: string, source: string): Fragment {
	const lines = source.split('\n')
	const first = lines.findIndex((line) => line.trim() !== '')
	const head = first === -1 ? '' : lines[first]!.trim().toLowerCase()
	if (!kinds.includes(head as BumpKind)) {
		throw new Error(
			`${file}: the first line must be one of ${kinds.join(', ')} (the bump kind), got "${head}"`,
		)
	}
	const note = lines
		.slice(first + 1)
		.join('\n')
		.trim()
	if (!note) throw new Error(`${file}: no changelog text after the bump kind`)
	return { file, kind: head as BumpKind, note }
}

export function readFragments(root: string): Array<Fragment> {
	return fragmentFiles(root).map((file) =>
		parseFragment(file, readFileSync(path.join(root, file), 'utf8')),
	)
}

type Version = [number, number, number]

export function parseVersion(version: string): Version {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
	if (!match) throw new Error(`not a release version: ${version}`)
	return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function compareVersions(a: string, b: string) {
	const [x, y] = [parseVersion(a), parseVersion(b)]
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!
	return 0
}

/** The next version after `from`: the highest kind among the fragments
 *  wins. Below 1.0 nothing is a major (decision 0007). */
export function nextVersion(from: string, kind: BumpKind) {
	const [major, minor, patch] = parseVersion(from)
	return kind === 'minor'
		? `${major}.${minor + 1}.0`
		: `${major}.${minor}.${patch + 1}`
}

export function highestKind(fragments: ReadonlyArray<Fragment>): BumpKind {
	return fragments.some((f) => f.kind === 'minor') ? 'minor' : 'patch'
}

/** The newest `v<version>` tag, by version. */
export function latestTag(root: string): string | undefined {
	const tags = execFileSync('git', ['tag', '--list', 'v*'], {
		cwd: root,
		encoding: 'utf8',
	})
		.split('\n')
		.map((t) => t.trim())
		.filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
	if (!tags.length) return undefined
	return tags.toSorted(compareVersions).at(-1)!.slice(1)
}

export function packageVersionOf(root: string) {
	return (
		JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
			version: string
		}
	).version
}

export type ReleasePlan = {
	/** What the release moves from: the newest tag or package.json, whichever
	 *  is higher (a by-hand bump merged but not yet tagged counts). */
	from: string
	version: string
	kind: BumpKind
	fragments: Array<Fragment>
}

/** What a release from the current fragments would be, or undefined when
 *  there is nothing to release. */
export function planRelease(root: string): ReleasePlan | undefined {
	const fragments = readFragments(root)
	if (!fragments.length) return undefined
	const tag = latestTag(root)
	const pkg = packageVersionOf(root)
	const from = tag && compareVersions(tag, pkg) > 0 ? tag : pkg
	const kind = highestKind(fragments)
	return { from, version: nextVersion(from, kind), kind, fragments }
}

/** The CHANGELOG.md entry: the notes as they were written, in file order. */
export function formatEntry(plan: ReleasePlan, date: string) {
	return [
		`## [${plan.version}] - ${date}`,
		...plan.fragments.map((f) => f.note),
	].join('\n\n')
}

function writeJson(
	file: string,
	update: (data: Record<string, unknown>) => void,
) {
	const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
	update(data)
	writeFileSync(file, `${JSON.stringify(data, null, '\t')}\n`)
}

/** Write the release into the tree: the version into package.json,
 *  package-lock.json and the plugin manifest, the entry into CHANGELOG.md
 *  above the previous one, and the fragments deleted. Git is the caller's. */
export function applyRelease(
	root: string,
	plan: ReleasePlan,
	date = new Date().toISOString().slice(0, 10),
) {
	writeJson(path.join(root, 'package.json'), (pkg) => {
		pkg.version = plan.version
	})
	const lock = path.join(root, 'package-lock.json')
	if (existsSync(lock)) {
		writeJson(lock, (data) => {
			data.version = plan.version
			const packages = data.packages as Record<string, { version?: string }>
			if (packages?.['']) packages[''].version = plan.version
		})
	}
	const plugin = path.join(root, 'plugin/.claude-plugin/plugin.json')
	if (existsSync(plugin)) {
		writeJson(plugin, (data) => {
			data.version = plan.version
		})
	}
	// A new minor moves the range products are told to pin (the scaffold's
	// spec, which a test keeps on the current major.minor, and the README).
	const [major, minor] = parseVersion(plan.version)
	const [fromMajor, fromMinor] = parseVersion(plan.from)
	const specFiles = ['scaffold/app-node/package.json', 'README.md']
	const specMoved: Array<string> = []
	if (major !== fromMajor || minor !== fromMinor) {
		const from = `#semver:^${fromMajor}.${fromMinor}.0`
		const to = `#semver:^${major}.${minor}.0`
		for (const rel of specFiles) {
			const file = path.join(root, rel)
			if (!existsSync(file)) continue
			const source = readFileSync(file, 'utf8')
			if (!source.includes(from)) continue
			writeFileSync(file, source.replaceAll(from, to))
			specMoved.push(rel)
		}
	}
	const changelog = path.join(root, 'CHANGELOG.md')
	const current = existsSync(changelog)
		? readFileSync(changelog, 'utf8')
		: '# Changelog\n'
	const at = current.search(/^## \[/m)
	const entry = formatEntry(plan, date)
	const next =
		at === -1
			? `${current.trimEnd()}\n\n${entry}\n`
			: `${current.slice(0, at)}${entry}\n\n${current.slice(at)}`
	writeFileSync(changelog, next)
	for (const f of plan.fragments) unlinkSync(path.join(root, f.file))
	return {
		files: [
			'package.json',
			...(existsSync(lock) ? ['package-lock.json'] : []),
			...(existsSync(plugin) ? ['plugin/.claude-plugin/plugin.json'] : []),
			...specMoved,
			'CHANGELOG.md',
			...plan.fragments.map((f) => f.file),
		],
	}
}
