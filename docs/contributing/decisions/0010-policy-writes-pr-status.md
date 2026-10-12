# 0010: The policy writes the PR's status; the owner reads GitHub, not the terminal

- **Status:** accepted
- **Date:** 2026-10-12

## Context

`reins policy` has always produced a three-way verdict (the agent may merge, the
PR is parked for the owner, or it is refused with a reason) and printed it to
stderr. Nothing reached the PR. An owner with several agent PRs open could not
tell from GitHub which ones were theirs to merge, and the `ship-pr` wrap-up
reported a status of "Ready" that no document defined. kody has the same gap:
its `needs-kent` label is only ever applied to issues, and PR status there is a
free-text `STATUS:` line whose vocabulary drifts. A second gap showed up in
practice: a merge the policy allowed was still stopped by Claude Code's own
permission prompt, so an "agent merges" tier did not actually let the agent
merge.

## Decision

The policy engine is the single writer of a PR's status, on every evaluation
(`reins policy`, `--wait` on each change of reason, and the guard on
`gh pr merge`): exactly one of the labels `needs-owner` / `agent-merges`, plus
`risk:<tier>` once known; the owner assigned when parked (`policy.owner`, or the
repo owner of a user-owned repo); and one marker-delimited `## Shipping policy`
comment updated in place with the reason and, when parked, the merge command.
Labels are created on first use; nothing else on the PR is touched; a failed
write is reported and never changes the verdict. The agent's summary uses the
same three words: `Shipped`, `Needs you: <action>`, `Blocked: <what>`. The repo
owner's review threads are findings by default (`policy.ownerFindings`), so a
comment from the owner is answered, not merely read. The settings template
allow-lists `gh pr merge`, because the guard runs the policy on every merge and
is the gate; a second prompt gated nothing.

## Consequences

The owner filters the PR list on `needs-owner` and trusts it. Headless and cloud
agents get the same behaviour, since this is `gh`, not a Claude plugin. An
organisation-owned repo must set `policy.owner` to be assigned. Each evaluation
costs a handful of extra `gh` calls. A product that wants silence sets
`policy.publish: false`.

Revisit if GitHub gains a first-class "needs a human" state for PRs, or if the
owner wants the signal somewhere other than GitHub (kody posts to Discord), in
which case this stays the source and that becomes a second writer.
