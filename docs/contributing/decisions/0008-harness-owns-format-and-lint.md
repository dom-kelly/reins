# 0008: The harness owns the format and lint toolchain; the product keeps the rest

- **Status:** accepted
- **Date:** 2026-10-12

## Context

Decision 0004 said "product tooling (test runner, typechecker, build) stays the
product's; the harness only owns its checks, hooks, templates and policy." The
code never matched it. `reins adopt` (`expectedDevDependencies` in
`src/cli/adopt.ts`) adds `oxlint`, `prettier`, `husky` and `lint-staged` to any
repo's devDependencies, and `templates/manifest.json` lists `.oxlintrc.json`,
`.prettierrc.json` and `.prettierignore` as managed files, kept in step by
`reins sync`. The scaffold's `validate` script, the pre-commit hook (which runs
`lint-staged` when it is configured) and `validate:fix` (which the code-style
doc and the Claude settings point agents at) all assume those tools. A review
flagged the gap: a product on eslint or biome would end up with two linters and
the decision gave no answer on which one was meant to stay.

## Decision

The harness standardises the **format and lint toolchain**: `prettier`, `oxlint`
and `lint-staged` run from the husky hooks, with the shared `.oxlintrc.json`,
`.prettierrc.json` and `.prettierignore` as managed files. The git hooks, the
`validate` lanes and the agent guardrails assume them, and one shared config is
one fewer thing to review per product. The product keeps its **test runner,
typechecker and build**; the harness does not pick, pin or configure those.
Decision 0004 is amended to say exactly that.

## Consequences

`reins adopt` is expected to add the four packages and the three config files;
that is not a bug. A repo that already uses eslint or biome gets oxlint and
prettier alongside and should remove its own linter and formatter rather than
run two. The escape hatch for a product that needs a different `validate` shape
is to edit its own `validate` script (the harness never overwrites it), not to
fight the managed templates or hand-edit a synced config. Revisit if a product
appears that cannot use oxlint or prettier (for example a non-JS repo), at which
point make the toolchain templates and dependencies optional per `reins.json`.
