# 0009: Skills ship as a Claude Code plugin; products do not copy or edit them

- **Status:** accepted
- **Date:** 2026-10-12

## Context

Until 0.2.8 the four skills (`new-product`, `review-and-recommend`, `ship-pr`,
`verify-app`) were managed template files under `templates/.claude/skills`,
copied into every product by `reins new` and `reins adopt` and kept in step by
the three-way merge in `reins sync`. That model exists so a product can edit a
managed file and still take template updates. For a skill it is the wrong model:
a skill steers what an agent does in the repo, nothing reported when a product's
copy drifted from the template, and sync merged around the edit silently. The
owner's rule is that products are not allowed to change a skill; the harness is
the single source of truth, the way it already is for the checks, the hooks and
the policy ([0004](./0004-harness-is-a-cli-package.md)).

## Decision

The skills are a Claude Code plugin inside the package: `plugin/skills/<name>/`
with `plugin/.claude-plugin/plugin.json`, listed by a marketplace at the package
root (`.claude-plugin/marketplace.json`, source `./plugin`). A product's
`.claude/settings.json` (still managed) registers that marketplace as a
`directory` source at `./node_modules/@dom-kelly/reins` and enables
`reins@reins`, so Claude Code loads the skills in place and the npm lockfile
pins their version exactly as it pins the hook engine. `templates/manifest.json`
gains a `retired` list; sync and adopt delete a product's copy of a retired file
when it matches its `.reins/base/` record and report, without deleting, a copy
the product edited. The skills check refuses a product skill that takes a reins
skill's name, because a bare `/<name>` would run the product's copy. This repo
loads the same plugin from `.`, so nothing is copied anywhere.

## Consequences

Skills are invoked as `/reins:<name>`. A product takes a skill change with
`npm update @dom-kelly/reins` and `/reload-plugins`; `reins sync` is not
involved. Project-declared marketplaces load after the workspace trust dialog
and not at all in cloud or headless (`-p`) sessions, where the hooks still run
but no `/reins:*` skill is available. A product that needs a workflow the
harness lacks writes its own skill under a different name; one that needs a
harness skill to change opens a PR here. The skills are read from outside the
product tree, so they name product docs by repo-root path in prose rather than
by relative link. The manual `claude plugin validate --strict .` is the only
check of the manifests themselves, because CI has no `claude`. `reins doctor`
reports whether the plugin is declared and the marketplace is on disk.

Revisit if Claude Code can pin a plugin from an npm package without a repo-level
marketplace declaration, or if the hooks move into the plugin (which would make
`.claude/settings.json` unmanaged).
