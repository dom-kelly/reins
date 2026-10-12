# Documentation principles

## Where docs go

- `CLAUDE.md` — the map. Links only, plus the one-line product summary.
- `docs/contributing/` — how the system works and how to change it.
- `docs/contributing/decisions/` — point-in-time "no" decisions.
- Skills — repeatable workflows, thin: steps plus the docs they rely on. The
  harness's ship as `/reins:*` (change them in reins, not here); a workflow of
  this product's own goes in `.claude/skills/` under a name of its own.
- Code comments — only for a non-obvious _why_ that a reader of that line needs.

## How to write them

- Describe the present. "The cache expires after an hour", not "we now expire
  the cache". History belongs in PR descriptions and decision records.
- One topic per doc; link instead of repeating.
- Prefer a checker over a should-list. If a doc prescribes a rule a script could
  check, write the script (see
  [harness-engineering.md](./harness-engineering.md)).
- Update the closest doc in the same change that alters the behavior.
- When a doc outgrows one topic, turn it into a directory with an `index.md`
  that links focused leaves. Agents load only the leaf they need.
- Detail an agent needs only after running a command belongs in that command's
  output (error messages, `--help`), not in a doc it must read first.
- Mermaid diagrams are welcome where a sequence or flow is clearer than prose.
