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

## Checkers in `validate`

| Lane                   | Catches                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `format:check`, `lint` | Formatting and correctness lint                                                              |
| `typecheck`, `test`    | Types and behavior                                                                           |
| `npx reins check`      | Decision record numbers, broken doc links, skill frontmatter, the primitives map, repo rules |
| `audit:prod`           | Production dependency vulnerabilities (moderate and above)                                   |

Add a product-specific checker as a script with a test, wired into `validate`;
the shared ones come from the harness. Candidates that have not yet earned a
place are in [growth.md](./growth.md).

## Agent guardrails

`.claude/settings.json` applies to every Claude Code session in this repo:

- `git push` and `gh pr merge` always ask the owner.
- A PreToolUse hook (`the harness guard hook (`npx reins hook guard-bash`)`)
  blocks force-pushes, `--no-verify`, `git reset --hard`, and `git clean -f`,
  with a message saying what to do instead.
- The guard and typecheck hooks refuse to run (exit 2) when the harness is not
  installed, so an uninstalled harness blocks rather than silently allows;
  `npm install` fixes it. The Stop hook only warns, since an agent cannot repair
  a hook that will not run.

Git hooks (`.husky/`) format staged files on commit and run typecheck and tests
on push, skipping them for docs-only diffs. They apply to any agent, not only
Claude Code.

## Growth

Routines, feature flags, previews, instrumentation, and the heavier checkers are
not installed. Each is listed in [growth.md](./growth.md) with the trigger that
justifies it. Add one only in a PR that names the trigger that fired.

## Cost

Report what each shipped change cost (tokens or dollars, when the platform
exposes it) and which model did the work. Cost alone never kills an idea; the
question is whether value clearly exceeds it. Lower the cost where you can, and
raise the value.
