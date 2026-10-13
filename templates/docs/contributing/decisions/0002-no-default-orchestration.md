<!-- reins: owned. Written once as a starting point; sync never changes it again,
     so make it yours. What reins touches: docs/contributing/getting-started.md -->

# 0002: No multi-agent orchestration by default

- **Status:** accepted
- **Date:** 2026-10-01

## Context

Fanning out to many sub-agents looks productive but adds coordination cost,
merge conflicts, and review → recheck → re-review chains ("orchestration
theater") that consume more attention than they save.

## Decision

One implementer is the default. Fan out only when the owner asks for it when
work splits into non-conflicting slices by file ownership, and the orchestrator
does final QA itself.

## Consequences

Large programs take longer wall-clock but produce fewer conflicting PRs. Revisit
if slices routinely sit idle waiting on a single implementer while touching
disjoint files.
