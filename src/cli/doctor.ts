import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { checkNodeVersion } from '../checks/node-version.ts'
import { packageVersion, readConfig } from '../lib/config.ts'
import { packageRoot } from '../lib/repo.ts'
import {
	gh as runGh,
	minPresenceHistory,
	neverRan,
	neverRanFix,
	reviewerPresence,
	type PolicyConfig,
} from '../policy/merge-policy.ts'

type Item = {
	label: string
	ok: boolean
	fix: string
	/** Worth knowing, not a failure: doctor still exits 0. */
	info?: boolean
}

/** Whether GitHub itself deletes a merged PR's head branch, read from the
 *  repo's origin. The merged-branch workflow deletes it either way, so this
 *  only informs; with no gh, no GitHub origin or no access there is no line. */
function autoDeleteItem(root: string): Item | undefined {
	// gh would read GH_REPO before the cwd's origin; this is about this repo.
	const env = { ...process.env }
	delete env.GH_REPO
	const result = spawnSync(
		'gh',
		['api', 'repos/{owner}/{repo}', '-q', '.delete_branch_on_merge'],
		{ cwd: root, env, encoding: 'utf8', timeout: 10_000 },
	)
	if (result.status !== 0) return undefined
	const on = result.stdout.trim() === 'true'
	return {
		label: on
			? 'GitHub deletes merged branches itself (delete_branch_on_merge)'
			: 'GitHub does not delete merged branches itself; the merged-branch workflow does',
		ok: on,
		fix: 'gh repo edit --delete-branch-on-merge',
		info: true,
	}
}

type ClaudeSettings = {
	extraKnownMarketplaces?: Record<
		string,
		{ source?: { source?: string; path?: string } }
	>
	enabledPlugins?: Record<string, boolean>
}

/** Releases before 0.3.0 shipped no plugin (decision 0009). */
function predatesPlugin(version: string) {
	const [major = 0, minor = 0] = version.split('.').map(Number)
	return major === 0 && minor < 3
}

/** The skills come from the reins plugin, which Claude Code loads in place
 *  from a `directory` marketplace that .claude/settings.json declares
 *  (decision 0009). Two offline lines: is it declared, and is it on disk. */
function pluginItems(root: string): Array<Item> {
	const file = path.join(root, '.claude/settings.json')
	let settings: ClaudeSettings | undefined
	try {
		settings = JSON.parse(readFileSync(file, 'utf8')) as ClaudeSettings
	} catch {
		settings = undefined
	}
	const source = settings?.extraKnownMarketplaces?.reins?.source
	const declared =
		settings?.enabledPlugins?.['reins@reins'] === true &&
		source?.source === 'directory' &&
		typeof source.path === 'string'
	const marketplace = declared
		? path.resolve(root, source.path!, '.claude-plugin/marketplace.json')
		: undefined
	const installedPkg = path.join(
		root,
		'node_modules/@dom-kelly/reins/package.json',
	)
	let installed: string | undefined
	try {
		installed = (
			JSON.parse(readFileSync(installedPkg, 'utf8')) as { version?: string }
		).version
	} catch {
		installed = undefined
	}
	return [
		{
			label: declared
				? `.claude/settings.json loads the reins plugin (/reins:*) from ${source!.path}`
				: '.claude/settings.json does not load the reins plugin (extraKnownMarketplaces.reins + enabledPlugins reins@reins)',
			ok: declared,
			fix: 'npx reins sync',
		},
		{
			label: marketplace
				? `the reins marketplace is on disk (${path.relative(root, marketplace)})`
				: 'the reins marketplace location is unknown until .claude/settings.json declares it',
			ok: marketplace !== undefined && existsSync(marketplace),
			fix:
				installed && predatesPlugin(installed)
					? `npm update @dom-kelly/reins (installed ${installed} predates the plugin; the spec may need #semver:^0.3.0)`
					: 'npm install',
		},
	]
}

const unchecked = (why: string, fix: string): Array<Item> => [
	{
		label: `policy.reviewers not checked against the repo: ${why}`,
		ok: false,
		fix,
		info: true,
	},
]

/** Every reviewer `policy.reviewers` names must be installed on the repo:
 *  one that has never run here is a configuration error the policy refuses
 *  on, so it is a failure here. With no gh, no readable repo or too little
 *  history the line only informs. */
function reviewerItems(
	root: string,
	reviewers: NonNullable<PolicyConfig['reviewers']>,
	ghOk: boolean,
): Array<Item> {
	const gate = reviewers.gate ?? []
	const required = reviewers.required ?? []
	const findingsFrom = reviewers.findingsFrom ?? [
		...gate.map((g) => g.login),
		...required,
	]
	const named = [
		...gate.map((g) => ({ name: g.check, kind: 'gate check' as const })),
		...required.map((name) => ({ name, kind: 'required reviewer' as const })),
		...findingsFrom
			.filter((name) => !required.includes(name))
			.map((name) => ({ name, kind: 'findings reviewer' as const })),
	]
	if (!named.length) return []
	if (!ghOk) return unchecked('gh is not authenticated', 'gh auth login')
	let presence: ReturnType<typeof reviewerPresence>
	try {
		const repo = runGh(
			['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
			root,
		)
		presence = reviewerPresence(root, repo)
	} catch {
		return unchecked(
			"couldn't read the repo's PRs",
			'run again where gh can see the GitHub repo',
		)
	}
	if (presence.prs < minPresenceHistory)
		return unchecked(
			`only ${presence.prs} PR(s) so far (needs ${minPresenceHistory})`,
			'run again once the repo has a few PRs',
		)
	// A gate login is the app behind its check, which may pass without
	// posting a review, so the check's presence vouches for the login.
	const checkOf = new Map(gate.map((g) => [g.login, g.check]))
	return named.map(({ name, kind }) => {
		const ok =
			kind === 'gate check'
				? presence.checks.has(name)
				: presence.logins.has(name) ||
					presence.checks.has(checkOf.get(name) ?? '')
		return {
			label: ok
				? `\`${name}\` (${kind}) has run on this repo`
				: neverRan(name, kind),
			ok,
			fix: neverRanFix,
		}
	})
}

export type DoctorOptions = {
	/** Skip the lines that read GitHub (branch auto-delete, reviewer
	 *  presence); the rest is the local file system and `gh auth token`. The
	 *  SessionStart hook runs this way so a session opens in about a second. */
	offline?: boolean
}

/** What a fresh session needs to know before doing anything. */
export function doctor(
	root: string,
	{ offline = false }: DoctorOptions = {},
): Array<Item> {
	const config = readConfig(root)
	const nodeIssue = checkNodeVersion(root)
	// `gh auth token` is local and reflects the active account; `gh auth status` fails on any stale secondary account.
	const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' })
	const items: Array<Item> = [
		{
			label: `node matches .nvmrc (have ${process.versions.node})`,
			ok: nodeIssue === undefined,
			fix: nodeIssue ?? '',
		},
		{
			label: 'node_modules installed',
			ok: existsSync(path.join(root, 'node_modules')),
			fix: 'npm install',
		},
		{
			// This CLI may be a global or linked copy; the hooks in .claude/settings.json
			// need the product's own. The harness repo runs its hooks from source.
			label: "reins installed in this repo's node_modules",
			ok:
				root === packageRoot ||
				existsSync(
					path.join(root, 'node_modules/@dom-kelly/reins/package.json'),
				),
			fix: 'npm install',
		},
		...pluginItems(root),
		{
			// The harness repo does not sync from itself, so its own field is not compared.
			label: config
				? `reins.json synced from ${config.harness} (this CLI is ${packageVersion})`
				: 'reins.json present',
			ok:
				config !== undefined &&
				(root === packageRoot || config.harness === packageVersion),
			fix: config ? 'npx reins sync' : 'npx reins adopt',
		},
		{
			label: 'git hooks installed',
			ok: existsSync(path.join(root, '.husky', '_')),
			fix: 'npm run prepare',
		},
		{
			label: 'gh authenticated (active account)',
			ok: gh.status === 0,
			fix: 'gh auth login',
		},
	]
	const autoDelete =
		!offline && gh.status === 0 ? autoDeleteItem(root) : undefined
	if (autoDelete) items.push(autoDelete)
	if (!offline && config?.policy?.reviewers)
		items.push(...reviewerItems(root, config.policy.reviewers, gh.status === 0))
	// The Stop hook has a 300 second budget and fails open on a timeout, so a
	// gate slower than `validate` wants a fast stop gate of its own.
	const gate = config?.policy?.gate
	if (gate && gate !== 'validate' && !config?.hooks?.stopGate)
		items.push({
			label: `the Stop hook runs the merge gate (${gate}); a slow gate times out and fails open`,
			ok: false,
			fix: 'set hooks.stopGate in reins.json to a script that finishes in about a minute',
			info: true,
		})
	return items
}

export function doctorPassed(items: ReadonlyArray<Item>) {
	return items.every((i) => i.ok || i.info)
}

export function formatDoctor(items: ReadonlyArray<Item>) {
	return items
		.map((i) =>
			i.ok ? `✅ ${i.label}` : `${i.info ? 'ℹ️' : '❌'} ${i.label} → ${i.fix}`,
		)
		.join('\n')
}
