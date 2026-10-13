import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { PolicyConfig } from '../policy/merge-policy.ts'
import { packageRoot } from './repo.ts'

export const configFile = 'reins.json'
/** The config file's name before the package was called reins (decision
 *  0006); read until `reins adopt` or `reins sync` renames it. */
export const legacyConfigFile = 'harness.json'

/** `reins.json` in a product repo: what the harness needs to know about it. */
export type HarnessConfig = {
	/** The harness version these templates were last synced from. */
	harness: string
	product: { name: string }
	checks?: {
		/** Max lines for AGENTS.md (a map, not the docs). Default 20. */
		agentsMaxLines?: number
		/** Paths whose committed files are never edited, only added (migrations). */
		appendOnly?: Array<string>
		/** The one package manager; other lockfiles are refused. Default npm. */
		lockfile?: 'npm' | 'pnpm' | 'yarn' | 'bun'
		/** Path prefixes whose markdown links are not checked (mirrors of files
		 *  that live elsewhere, e.g. the harness repo's copies of its templates). */
		ignoreLinksIn?: Array<string>
		/** Path prefixes that ship: a change under them since origin/main needs a
		 *  change note under `changes/` (first line `patch` or `minor`, then the
		 *  changelog text) or a new package.json version with a `## [version]`
		 *  entry in CHANGELOG.md. */
		bumpVersionWhen?: Array<string>
	}
	guard?: {
		/** Extra Bash patterns the guard hook refuses (regex source + reason). */
		blocked?: Array<{ pattern: string; reason: string }>
	}
	hooks?: {
		/** The npm script the Claude Code Stop hook runs when the tree is dirty.
		 *  Defaults to `policy.gate`. Keep it under about a minute: the hook has
		 *  a 300 second budget and a timeout does not block, so a slow gate fails
		 *  open on exactly the runs that matter. */
		stopGate?: string
		/** The npm script the Claude Code PostToolUse typecheck hook runs after
		 *  a TypeScript edit. Default `typecheck`. Point it at a fast script
		 *  (one project, no typegen) when the full one is slow: it runs on
		 *  every edit. */
		typecheck?: string
		/** Path prefixes, relative to the repo root, whose edits do not trigger
		 *  the typecheck hook (generated or vendored code). A `node_modules`,
		 *  `dist`, `build` or `.react-router` directory anywhere in the tree is
		 *  always skipped. */
		typecheckIgnore?: Array<string>
	}
	/** Who may merge at each risk tier and which reviewers must have spoken. */
	policy?: PolicyConfig
}

export const packageVersion: string = JSON.parse(
	readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
).version

/** Where a product keeps its config: `reins.json`, or the old name until it
 *  has migrated. Undefined when it has neither. */
export function findConfigFile(root: string) {
	for (const name of [configFile, legacyConfigFile]) {
		const file = path.join(root, name)
		if (existsSync(file)) return file
	}
	return undefined
}

export function readConfig(root: string): HarnessConfig | undefined {
	const file = findConfigFile(root)
	if (!file) return undefined
	return JSON.parse(readFileSync(file, 'utf8')) as HarnessConfig
}

export function writeConfig(root: string, config: HarnessConfig) {
	writeFileSync(
		path.join(root, configFile),
		`${JSON.stringify(config, null, '\t')}\n`,
	)
}
