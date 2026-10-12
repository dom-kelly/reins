# 0005: Merge authority is per repo; the harness lets agents merge every tier

- **Status:** accepted
- **Date:** 2026-10-09

## Context

The first policy parked every high-risk PR for the owner. In a product whose
merges deploy to production that is right. In this repo a merge deploys nothing:
products pick a change up only on their next `npm update` and `reins sync`, and
a bad release is undone by the next one. Parking the harness's own PRs made the
owner a rubber stamp and defeated the loop.

## Decision

`reins.json` → `policy.authority` sets who merges at each tier per repo. This
repo sets every tier to `agent`: an agent merges once the gate is green and, for
medium and high, an independent fresh-context review has been applied. Products
default to `high: owner`.

## Consequences

The policy reads its configuration from `origin/main`, so a PR that changes
authority is itself judged under the rules it is changing. Permission prompts
for `git push` and `gh pr merge` are gone from the template: the guard refuses
pushes to main and routes merges through the policy.

An agent can merge a change to the merge policy itself here. The checks on that
are the e2e lane, the policy's own tests and the review step in `ship-pr`, not a
human. Revisit if a self-merged change breaks a product twice, in which case set
`high: owner` and look at a server-side check.
