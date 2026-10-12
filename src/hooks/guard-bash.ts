import { readFileSync } from 'node:fs'
import { readConfig, type HarnessConfig } from '../lib/config.ts'
import { findRepoRoot } from '../lib/repo.ts'
import { evaluateMerge, prRefFromCommand } from '../policy/merge-policy.ts'

export type BlockedPattern = { regex: RegExp; reason: string }

// `git`, with any -C/-c/--flag options, then `push`, then anything up to a
// command separator.
const gitPush = String.raw`\bgit\b(?:\s+-[Cc]\s*\S+|\s+--\S+)*\s+push\b[^|;&]*`

/** Always refused, in any product. */
export const defaultBlocked: ReadonlyArray<BlockedPattern> = [
	{
		regex: new RegExp(
			`${gitPush}\\s(?:--force(?:-with-lease)?|-[a-zA-Z]*f[a-zA-Z]*)\\b`,
		),
		reason:
			'Force-pushing is never allowed. Rebase onto the latest base and push normally, or stop and report.',
	},
	{
		regex: new RegExp(
			String.raw`${gitPush}[\s:+'"](?:refs/heads/)?(?:main|master)(?![\w./-])`,
		),
		reason:
			'Pushing straight to main bypasses the PR, CI and the shipping policy. Push a branch and open a PR.',
	},
	{
		regex: /\bgit\s+commit\b[^|;&]*\s(?:--no-verify|-n)\b/,
		reason:
			'Skipping git hooks hides failures. Fix what the hook reports; if the hook is wrong, fix the hook.',
	},
	{
		regex: new RegExp(`${gitPush}\\s--no-verify\\b`),
		reason:
			'Skipping git hooks hides failures. Fix what the hook reports; if the hook is wrong, fix the hook.',
	},
	{
		regex: /\bgit\s+(?:reset\s+--hard|clean\b[^|;&]*\s(?:-[a-zA-Z]*f|--force))/,
		reason:
			'Destructive git commands discard work. Ask the owner first, naming exactly what would be lost.',
	},
	{
		regex: /\bgh\s+pr\s+merge\b[^|;&]*\s--(?:admin|auto)\b/,
		reason:
			'Merging with --admin or --auto skips the shipping policy. Use a plain `gh pr merge` or hand it to the owner.',
	},
]

export function findBlockedReason(
	command: string,
	extra: ReadonlyArray<BlockedPattern> = [],
) {
	return [...defaultBlocked, ...extra].find(({ regex }) => regex.test(command))
		?.reason
}

const ghMerge = /\bgh\s+pr\s+merge\b/
const apiMerge =
	/\bgh\s+api\b[^|;&]*(\/merge\b|mergePullRequest|enablePullRequestAutoMerge)/
const mergeElsewhere = /\bgh\s+pr\s+merge\b[^|;&]*\s(?:-R|--repo)\b/

/** The decision for one hook input. A bad custom pattern blocks rather than
 *  silently disabling the guard: exit 1 would be treated as "not blocking". */
export function guardDecision(
	input: string,
	config: HarnessConfig | undefined,
	root?: string,
): string | undefined {
	const parsed = JSON.parse(input) as { tool_input?: { command?: string } }
	const command = parsed.tool_input?.command ?? ''
	if (apiMerge.test(command)) {
		return 'Merging through the API skips the shipping policy. Use `gh pr merge`.'
	}
	if (mergeElsewhere.test(command)) {
		return 'Merging in another repo skips its shipping policy. Run the merge from that repo.'
	}
	const extra: Array<BlockedPattern> = []
	for (const { pattern, reason } of config?.guard?.blocked ?? []) {
		try {
			extra.push({ regex: new RegExp(pattern), reason })
		} catch (error) {
			return `reins.json guard.blocked has an invalid pattern ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}. Fix it before running commands.`
		}
	}
	const blocked = findBlockedReason(command, extra)
	if (blocked) return blocked
	// Merging to main is gated by the policy (kody's tiers), not by a pattern.
	if (
		root &&
		ghMerge.test(command) &&
		(config?.policy?.enforceOnMerge ?? true)
	) {
		const verdict = evaluateMerge(root, prRefFromCommand(command))
		for (const line of verdict.lines) console.error(line)
		if (!verdict.allowed) return verdict.message
		console.error(verdict.message)
	}
	return undefined
}

/** Claude Code PreToolUse hook for Bash: exit 2 refuses the command and shows
 *  the reason to the agent. */
export function runGuardBash(input = readFileSync(0, 'utf8')) {
	// Anything unexpected blocks: exit 1 would be read as "not blocking".
	let reason: string | undefined
	try {
		const root = findRepoRoot()
		reason = guardDecision(input, readConfig(root), root)
	} catch (error) {
		reason = `the guard hook failed (${error instanceof Error ? error.message : String(error)}); fix that before running commands`
	}
	if (reason) {
		console.error(`Blocked by the harness: ${reason}`)
		return 2
	}
	return 0
}
