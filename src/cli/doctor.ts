import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { checkNodeVersion } from '../checks/node-version.ts'
import { packageVersion, readConfig } from '../lib/config.ts'
import { packageRoot } from '../lib/repo.ts'

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
	const result = spawnSync(
		'gh',
		['api', 'repos/{owner}/{repo}', '-q', '.delete_branch_on_merge'],
		{ cwd: root, encoding: 'utf8', timeout: 10_000 },
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

/** What a fresh session needs to know before doing anything. */
export function doctor(root: string): Array<Item> {
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
	const autoDelete = gh.status === 0 ? autoDeleteItem(root) : undefined
	if (autoDelete) items.push(autoDelete)
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
