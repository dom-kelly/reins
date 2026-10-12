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
