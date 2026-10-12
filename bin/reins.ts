#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import {
	changedFiles,
	formatChangeSummary,
	loadMap,
	summarizeChanges,
} from '../src/checks/primitives.ts'
import { reportChecks, runChecks } from '../src/checks/run.ts'
import { adoptRepo, formatAdoptReport } from '../src/cli/adopt.ts'
import { parseArgs } from '../src/cli/args.ts'
import { doctor, formatDoctor } from '../src/cli/doctor.ts'
import { createProduct } from '../src/cli/new.ts'
import { runGitHook } from '../src/hooks/git-hooks.ts'
import {
	runGateOnStopHook,
	runTypecheckHook,
} from '../src/hooks/claude-hooks.ts'
import { runGuardBash } from '../src/hooks/guard-bash.ts'
import { evaluateMerge } from '../src/policy/merge-policy.ts'
import { packageVersion, readConfig } from '../src/lib/config.ts'
import { findRepoRoot } from '../src/lib/repo.ts'
import {
	formatSyncReport,
	hasChanges,
	syncTemplates,
} from '../src/lib/templates.ts'

const help = `reins ${packageVersion} — the agent harness, as a CLI

  reins new <dir> [--name x] [--no-install] [--no-git]   start a product
  reins adopt [--name x]        apply the harness to this repo, keeping your files
  reins sync [--check]          bring managed files up to date (three-way merge)
  reins check [--docs]          decisions, links, skills, primitives map, repo rules
  reins classify [--base ref | --stdin] [--json]   primitives a change touches
  reins doctor                  what a fresh session needs to know
  reins policy [pr|url|branch]  may an agent merge this PR? (risk tiers, reviewers, authority)
  reins hook <guard-bash | typecheck | validate-on-stop | pre-commit | pre-push | node-version>
`

async function main(): Promise<number> {
	const { command, positionals, flags, options } = parseArgs(
		process.argv.slice(2),
	)
	const root = findRepoRoot()
	switch (command) {
		case 'new': {
			const dir = positionals[0]
			if (!dir) throw new Error('reins new <dir>')
			const { root: created, report } = createProduct(dir, {
				name: options.get('--name'),
				install: !flags.has('--no-install'),
				git: !flags.has('--no-git'),
			})
			console.log(
				`created ${created} (${report.written.length} files). Next: cd ${dir} && npm run validate`,
			)
			return 0
		}
		case 'adopt': {
			console.log(
				formatAdoptReport(adoptRepo(root, { name: options.get('--name') })),
			)
			return 0
		}
		case 'sync': {
			const config = readConfig(root)
			if (!config)
				throw new Error('no reins.json here; run `reins adopt` first')
			const check = flags.has('--check')
			const report = await syncTemplates(root, config.product, { check })
			console.log(formatSyncReport(report, check))
			if (report.missingBase.length || report.conflicts.length) return 1
			return check && hasChanges(report) ? 1 : 0
		}
		case 'check': {
			return reportChecks(
				await runChecks(root, { docsOnly: flags.has('--docs') }),
			)
		}
		case 'classify': {
			const map = loadMap(root)
			const files = flags.has('--stdin')
				? readFileSync(0, 'utf8')
						.split('\n')
						.map((l) => l.trim())
						.filter(Boolean)
				: changedFiles(root, options.get('--base') ?? 'origin/main')
			const summary = summarizeChanges(map, files)
			console.log(
				flags.has('--json')
					? JSON.stringify(summary)
					: formatChangeSummary(map, summary),
			)
			return 0
		}
		case 'doctor': {
			const items = doctor(root)
			console.log(formatDoctor(items))
			return items.every((i) => i.ok) ? 0 : 1
		}
		case 'policy': {
			const verdict = evaluateMerge(root, positionals[0])
			for (const line of verdict.lines) console.error(line)
			console.error(verdict.message)
			return verdict.allowed ? 0 : 2
		}
		case 'hook': {
			const hook = positionals[0]
			if (hook === 'guard-bash') return runGuardBash()
			if (hook === 'typecheck') return runTypecheckHook(root)
			if (hook === 'validate-on-stop') return runGateOnStopHook(root)
			if (
				hook === 'pre-commit' ||
				hook === 'pre-push' ||
				hook === 'node-version'
			) {
				return runGitHook(root, hook)
			}
			throw new Error(`unknown hook ${hook}`)
		}
		case undefined:
		case '--help':
		case '-h':
			console.log(help)
			return 0
		default:
			throw new Error(`unknown command ${command}\n${help}`)
	}
}

main().then(
	(code) => process.exit(code),
	(error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	},
)
