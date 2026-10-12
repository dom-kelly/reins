# 0006: The package and CLI are called reins; the harness stays the concept

- **Status:** accepted
- **Date:** 2026-10-10

## Context

The package was `@dom-kelly/harness` with a bin called `harness`. An unrelated,
unscoped `harness` package already exists on the public npm registry, and
`npx <bin>` falls back to the registry when the bin is not in `node_modules`:
with the harness missing, `npx harness` fetched a stranger's package instead of
failing. The hooks now fail closed (`--no-install`), but a bin name that another
package can claim is a standing hazard, and the scoped package name did not help
because `npx` resolves the bin, not the package.

## Decision

The package is `@dom-kelly/reins` and its bin is `reins`; products call
`npx reins …`. The config file is `reins.json` and the base copies live under
`.reins/`. The GitHub repo moves to `dom-kelly/reins` (GitHub redirects the old
name).

"The harness" remains the name of the concept: the loop, the docs, the
guardrails products get. Prose says "the harness"; commands, file names and the
package say `reins`.

`reins adopt` and `reins sync` migrate a product: `harness.json` becomes
`reins.json` and `.harness/base` becomes `.reins/base` when only the old names
exist. `sync --check` renames nothing and reads the old locations.

## Consequences

Products run `npm i -D git+https://github.com/dom-kelly/reins.git`, then
`npx reins sync` and `npm install` again: the sync rewrites the hooks, husky
lines and skills that still say `npx harness`, renames the config and base
directory and drops the old dependency. Until a product has migrated the CLI
reads the old names (the merge policy too, from `origin/main`), so an unmigrated
product keeps working. Revisit if a product's `validate` or hooks must be edited
by hand after a sync, which would mean the migration missed a file.
