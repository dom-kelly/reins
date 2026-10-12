# 0011: Releases come from change notes; the workflow writes the version

- **Status:** accepted
- **Date:** 2026-10-12
- **Amends:** [0007](./0007-versioned-by-tag.md)

## Context

Decision 0007 made every PR that ships code bump `package.json` and add a
`## [version]` heading to `CHANGELOG.md`, so that merging main tags a release.
It also said to revisit "if two releases a day make the per-PR bump a nuisance".
Main took five such PRs on 2026-10-12, and two open at once (#24 and #26) each
claimed 0.4.2: whichever merged second had to rebase, renumber and re-heading,
and until then its author waited on the other. The version number was the only
file two independent PRs shared, and it put them on one critical path. Neither
reference harness has this: kody has no package version at all, and OpenAI's
write-up describes short-lived PRs with nothing to serialise on.

## Decision

A PR that ships code adds one change note under `changes/`: any file name, first
line `patch` or `minor`, then the changelog text. It does not touch
`package.json` or `CHANGELOG.md`. The repo rules check accepts a note as the
alternative to the bump-with-heading, which stays accepted, so a product that
set `checks.bumpVersionWhen` sees no change until it chooses to use notes.

The release workflow, on every push to main, folds the notes into `CHANGELOG.md`
under the next version (the highest kind among the notes, from the newest tag or
`package.json`, whichever is higher), writes that version into `package.json`,
`package-lock.json` and the plugin manifest, deletes the notes, commits to main
and tags. `scripts/release.ts` is that step, runnable by hand with `--check`.

The commit to main needs an identity the branch ruleset lets through: the reins
bot, a GitHub App installed on the repo whose token the workflow mints. Until
the bot exists the workflow tags by-hand bumps as before and leaves the notes
with a warning; nothing breaks, releases wait.

## Consequences

Two PRs that ship code share no file, so they merge in any order with no rebase.
A release is still a deliberate act, moved from "pick the number" to "say patch
or minor"; the number is arithmetic. The changelog on main is written by the
workflow, so a merge is followed within a minute by a release commit from the
bot; `git log main` shows one such commit per release. The first release under
this decision is 0.5.0.

The bot is the first non-human identity on the repo. It exists to push one kind
of commit; it is not a merge authority (decision 0005 stands) and it holds no
other power than the ruleset bypass. Revisit if the bot's commits ever need to
carry anything but a release, or if products want the same flow (then it becomes
a `reins release` command rather than a script).
