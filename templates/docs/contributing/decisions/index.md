# Decision records

A **steering veto list**. Open it before proposing a new primitive, surface,
dependency, or storage home. Code and architecture docs describe how the system
works; this folder records product-shaped decisions **already made**, usually a
"no" with a revisit-if, so the next agent does not re-propose them.

## When to add a record

Write one after deciding **not** to build something an agent will otherwise
suggest again, or after a one-way-door choice. Copy
[0000-template.md](./0000-template.md) to the next unused number with a
kebab-case slug. Half a page is enough.

Do not write a record for every PR, for UI tweaks, or for a library choice the
code already makes obvious. A record is written **after** the decision; it is
not a design brief for a PR. `npx reins check` (one lane of `validate`) rejects
duplicate numbers, a heading number that does not match the filename, and
records missing from this index.

When a later record changes a decision, mark the old one `superseded by NNNN`
instead of editing or deleting it.

## Steering list

- [0001 — One local gate; no CI-only checks](./0001-one-local-gate.md)
- [0002 — No multi-agent orchestration by default](./0002-no-default-orchestration.md)

## Historical

Superseded records and point-in-time implementation notes. They stay for
context; they no longer steer.

- _none yet_
