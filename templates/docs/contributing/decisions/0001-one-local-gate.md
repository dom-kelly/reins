<!-- reins: owned. Written once as a starting point; sync never changes it again,
     so make it yours. What reins touches: docs/contributing/getting-started.md -->

# 0001: One local gate; no CI-only checks

- **Status:** accepted
- **Date:** 2026-10-01

## Context

Agents iterate locally. A check that only runs in CI turns every failure into a
push-wait-read-logs loop and burns human attention on relaying CI output.

## Decision

`npm run validate` is the single authoritative gate. CI runs exactly the same
script. A new check is added to `validate` or not at all.

## Consequences

`validate` must stay fast enough to run before every review; slow suites get
parallelized or sharded, not moved to CI-only. Revisit if a check genuinely
needs infrastructure that cannot exist locally (for example, a deploy smoke
test), and then document it as a post-merge verification, not a gate.
