import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { checkNodeVersion } from '../checks/node-version.ts'
import { packageVersion, readConfig } from '../lib/config.ts'
import { packageRoot } from '../lib/repo.ts'

type Item = { label: string; ok: boolean; fix: string }

/** What a fresh session needs to know before doing anything. */
export function doctor(root: string): Array<Item> {
	const config = readConfig(root)
	const nodeIssue = checkNodeVersion(root)
	// `gh auth token` is local and reflects the active account; `gh auth status` fails on any stale secondary account.
	const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' })
	return [
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
			label: config
				? `reins.json present (synced from ${config.harness}; this CLI is ${packageVersion})`
				: 'reins.json present',
			ok: config !== undefined,
			fix: 'npx reins adopt',
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
}

export function formatDoctor(items: ReadonlyArray<Item>) {
	return items
		.map((i) => (i.ok ? `✅ ${i.label}` : `❌ ${i.label} → ${i.fix}`))
		.join('\n')
}
