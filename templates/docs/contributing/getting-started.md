<!-- reins: managed. Edit freely: `npx reins sync` merges harness updates in and
     keeps your edits. What reins touches: docs/contributing/getting-started.md -->

# Getting started

Requires Node 22, 22.18 or later (`.nvmrc` pins the major; the git hooks refuse
another, and `reins doctor` reports it). TypeScript runs natively, no build
step.

```bash
npm install          # also installs git hooks via husky
npm run dev          # the placeholder app, with /health
npm run validate     # the single gate; read-only
npm run validate:fix # apply formatter and lint autofixes
```

## Updating the harness

The harness is the `@dom-kelly/reins` devDependency, pinned to a semver range on
its release tags. `npm update @dom-kelly/reins && npx reins sync` takes a
release within that range and merges the template changes into this repo's
managed files; `npx reins doctor` says when a sync is due. A new minor is taken
by editing the range in `package.json`.

## What reins manages

Every file reins writes opens with a line saying which of these it is, except
the JSON configs and `.nvmrc` (no comment syntax) and the decision template
(copied into records that are the product's), so this list is the full one.

**Managed**: `npx reins sync` merges harness updates into them and keeps your
edits (a three-way merge against `.reins/base/`; a conflict gets markers to
resolve). Edit them when the product needs it; the bigger the edit, the more
each sync has to merge. `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`,
`.github/pull_request_template.md`, `.github/workflows/validate.yml`,
`.github/workflows/merged-branch.yml`, `.husky/pre-commit`, `.husky/pre-push`,
`.nvmrc`, `.oxlintrc.json`, `.prettierrc.json`, `.prettierignore`,
`docs/contributing/index.md`, `docs/contributing/harness-engineering.md`,
`docs/contributing/growth.md`, `docs/contributing/shipping-policy.md`,
`docs/contributing/testing-principles.md`, `docs/contributing/documentation.md`,
`docs/contributing/code-style.md`, `docs/contributing/getting-started.md`,
`docs/contributing/decisions/0000-template.md`.

**Owned**: written once as a starting point. Sync never changes them again
(deleted, one is written afresh). `SECURITY.md`,
`docs/contributing/project-intent.md`, `docs/contributing/security.md`,
`docs/contributing/external-services.md`, `docs/contributing/gotchas.md`,
`docs/contributing/architecture/index.md`,
`docs/contributing/architecture/primitives.yaml`,
`docs/contributing/decisions/index.md`,
`docs/contributing/decisions/0001-one-local-gate.md`,
`docs/contributing/decisions/0002-no-default-orchestration.md`.

**Not yours to edit**:

- `.reins/base/`: the templates as sync last applied them, the base of the merge
  above. Commit it; never edit it.
- `node_modules/@dom-kelly/reins/`: the CLI and the `/reins:*` skills. A change
  comes with `npm update @dom-kelly/reins`.

A file reins used to ship and has since retired is deleted by sync while it
still matches `.reins/base/`; an edited copy is reported and kept.

Sync writes nothing else. `reins check` reads the repo (links in every markdown
file, `AGENTS.md`, `package.json` and the changelog), and `reins.json` is the
product's configuration: you edit it, reins reads it, and sync records the
harness version there.

## Agents

An agent setting up the repo does everything it can itself (install, dev,
validate) and only then tells the owner what remains, with the exact command,
for anything that needs a human (secrets, logins, app installs).

## Starting a new product from this boilerplate

1. Run `/reins:new-product` with your product idea. It fills
   [project-intent.md](./project-intent.md), reshapes
   [primitives.yaml](./architecture/primitives.yaml), records the first
   decisions, and proposes the first vertical slices.
2. Pick the real stack. Replace `src/` and update the `dev` script and the
   `code` roots in `primitives.yaml`. Keep `validate` as the one gate and keep
   `/health` returning the deployed sha.
3. Add stack-specific checkers only when they encode a rule that was broken (see
   [growth.md](./growth.md)).
