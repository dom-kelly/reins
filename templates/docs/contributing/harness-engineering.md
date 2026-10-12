# Harness engineering

This repository uses an agent-first workflow. Humans steer outcomes; agents
execute implementation. Human attention is the scarce resource, so every change
should leave the harness a little stronger, not only the product.

Background: OpenAI, "Harness engineering: leveraging Codex in an agent-first
world" (https://openai.com/index/harness-engineering/), as practised in
[kentcdodds/kody](https://github.com/kentcdodds/kody).

## Principles

- Repository-local knowledge is the source of truth. Knowledge that only lives
  in a chat thread or an agent's memory will be lost.
- [CLAUDE.md](../../CLAUDE.md) is a map. Detail lives in focused docs here.
- Small enforceable rules beat long fragile instructions.
- Boring, composable abstractions beat opaque magic.
- Done is falsifiable: a command, a test, or observable app behavior.
- The harness ships the loop, not an inventory. A guardrail earns its place by
  catching a mistake that happened ([growth.md](./growth.md)).

## The loop

Run this for every feature, fix, and refactor:

1. **Intent.** State the goal and acceptance criteria in the task or PR.
2. **Implement.** Smallest change that meets the criteria.
3. **Evaluate.** Targeted tests while iterating; `npm run validate` before
   review; `verify-app` when behavior is user-visible.
4. **Capture.** Write what you learned into docs, tests, or tooling in the same
   change.
5. **Promote.** If a mistake repeats, encode it (see the ladder below).

## Hard way → agent → software

Work moves through three stages:

1. **Do it the hard way first** (by hand, or by talking it through with an
   agent) until you understand what the work really is.
2. **Hand it to an agent** once you are doing the same thing repeatedly. Ask of
   everything you do: could an agent do this reliably?
3. **Turn the agent's repeatable steps into deterministic software** (a script,
   a checker, a package). Software is cheaper, faster, more reliable, and usable
   by any agent, not locked into one tool's memory or automations.

Agents do not feel pain, so they will not push work into stage 3 on their own.
[gotchas.md](./gotchas.md) is where the pressure collects: every entry is a
candidate for a checker, and a gotcha that becomes a checker gets deleted.

## The enforcement ladder

When a mistake repeats, encode it in the strongest cheap guardrail that works:

1. **Lint, types, or a `validate` checker** — when the violation is visible in
   the file without guessing. Put the _why_ and the fix in the error message.
2. **Tests** — when the failure is behavioral and a static rule would guess.
3. **Scripts** — when the workflow is multi-step and a command can own it.
4. **Docs** — last, and only when no cheap checker is possible. Point at the
   check or test that backs the doc.

Rule of thumb: if a reviewer makes the same comment twice, encode it.

A papercut that belongs to the harness (a hook, check, skill or template that
reins ships) is not this repo's to encode: open an issue on
[dom-kelly/reins](https://github.com/dom-kelly/reins/issues) labelled
`friction`, with the command, the output and what you expected, rather than
working around it here.

## Checkers in `validate`

| Lane                   | Catches                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `format:check`, `lint` | Formatting and correctness lint                                                              |
| `typecheck`, `test`    | Types and behavior                                                                           |
| `npx reins check`      | Decision record numbers, broken doc links, skill frontmatter, the primitives map, repo rules |
| `audit:prod`           | Production dependency vulnerabilities (moderate and above)                                   |

`reins check` reads `reins.json` → `checks`. The repo rules use `lockfile` (the
one package manager, default `npm`; other lockfiles are refused),
`agentsMaxLines` (default 20), `appendOnly` (paths whose committed files are
only ever added, such as migrations) and `bumpVersionWhen` (path prefixes whose
change needs a version bump and a `CHANGELOG.md` entry). The link check, which
also runs on docs-only commits, uses `ignoreLinksIn` (path prefixes it skips).

Add a product-specific checker as a script with a test, wired into `validate`;
the shared ones come from the harness. Candidates that have not yet earned a
place are in [growth.md](./growth.md).

## Agent guardrails

`.claude/settings.json` applies to every Claude Code session in this repo:

- It registers the reins plugin (`extraKnownMarketplaces` → a `directory`
  marketplace at `./node_modules/@dom-kelly/reins`, `enabledPlugins`
  `reins@reins`), so the skills load in place as `/reins:<name>` and the
  lockfile pins their version exactly as it pins the hooks below. They load
  after the workspace trust dialog, not in cloud or headless sessions; run
  `/reload-plugins` after `npm update`.

- A PreToolUse hook on Bash, the harness guard (`npx reins hook guard-bash`),
  refuses force-pushes (`--force`, `-f`, `--force-with-lease`), a push to `main`
  or `master`, `--no-verify` on commit or push, `git reset --hard` and
  `git clean -f`, `gh pr merge --admin` or `--auto`, a merge through the API or
  in another repo, and a `gh pr merge` without `--delete-branch`, each with a
  message saying what to do instead. `guard.blocked` in `reins.json` adds
  product-specific patterns.
- On any other `gh pr merge` the guard runs the
  [shipping policy](./shipping-policy.md) (`npx reins policy <pr>`) and lets the
  merge through only when it passes; otherwise it prints what the policy is
  waiting for (a reviewer, an unanswered finding, or the owner). Each run also
  writes the verdict to the PR as labels (`needs-owner` / `agent-merges`,
  `risk:<tier>`), an assignee when parked, and one `## Shipping policy` comment,
  so the owner reads GitHub, not the terminal
  ([shipping-policy.md](./shipping-policy.md), "Status on the PR").
  `npx reins policy <pr> --wait` waits for CI and the reviews on the current
  head and then gives the verdict, so an agent neither polls `gh pr checks` nor
  re-runs the policy by hand. The harness holds neither a branch push nor an
  in-policy merge for the owner; the policy involves the owner only where
  `policy.authority` says so.
- The Stop hook runs `hooks.stopGate` from `reins.json` (default: the gate,
  `policy.gate`) whenever the working tree is dirty, and sends the agent back to
  fix a failure. It has a 300 second budget and a timeout does not block, so a
  product whose gate is slow (builds, end-to-end tests) points it at a fast
  script instead, for example a `verify:quick` that runs checks, lint, typecheck
  and unit tests. The merge gate stays complete; the stop gate stays fast.
- The PostToolUse typecheck hook runs `hooks.typecheck` from `reins.json`
  (default: `typecheck`) after every TypeScript edit and skips files outside the
  repo, under `node_modules/`, `dist/`, `build/`, `.react-router/`, or any
  prefix in `hooks.typecheckIgnore`; a product whose typecheck is slow (typegen,
  several projects) points it at a fast script.
- The guard and typecheck hooks refuse to run (exit 2) when the harness is not
  installed, so an uninstalled harness blocks rather than silently allows;
  `npm install` fixes it. The Stop hook only warns, since an agent cannot repair
  a hook that will not run.

Git hooks (`.husky/`) check the Node version, format staged files on commit when
a lint-staged config is present (the scaffold has one; an adopted repo adds its
own), run the `reins check` lanes, and for non-docs diffs typecheck (on commit
and push) and run the tests (on push). They apply to any agent, not only Claude
Code.

## Growth

Routines, feature flags, previews, instrumentation, and the heavier checkers are
not installed. Each is listed in [growth.md](./growth.md) with the trigger that
justifies it. Add one only in a PR that names the trigger that fired.

## Cost

Report what each shipped change cost (tokens or dollars, when the platform
exposes it) and which model did the work. Cost alone never kills an idea; the
question is whether value clearly exceeds it. Lower the cost where you can, and
raise the value.
