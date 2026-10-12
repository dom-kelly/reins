# Developing the harness

Requires Node 22.18 or later (`nvm use` reads `.nvmrc`).

```bash
npm install
npm run validate          # the one gate: format, lint, types, tests, the CLI's own checks
node bin/reins.ts --help
```

## Layout

| Path                 | What                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `bin/reins.ts`       | CLI entry: new, adopt, sync, check, classify, doctor, hook                   |
| `src/checks/`        | Checkers behind `reins check` and the git hooks                              |
| `src/hooks/`         | The Bash guard, the typecheck and gate-on-stop hooks, the git hook runner    |
| `src/policy/`        | `reins policy`: risk tiers, reviewers, authority; tested against a stub `gh` |
| `src/lib/`           | Repo discovery, `reins.json`, template apply and three-way sync              |
| `src/cli/`           | new, adopt, doctor                                                           |
| `templates/`         | Files written into products; `manifest.json` says which are managed vs owned |
| `scaffold/app-node/` | The placeholder app `reins new` starts from                                  |
| `docs/contributing/` | These docs, about the harness itself                                         |

The root `.claude/skills` holds copies of `templates/.claude/skills`: the
harness uses the same skills it ships. A test fails if the copies drift, so edit
the template and copy it over (a symlink breaks git stash and npm pack). Their
links point at product docs, so `reins.json` lists them under
`checks.ignoreLinksIn`.

## Changing a template

1. Edit the file under `templates/`. Product-facing docs describe a product, not
   this repo; keep them stack-agnostic.
2. If you add or remove a file, update `templates/manifest.json`. Managed files
   are synced into products (three-way merge); owned files are written once and
   never touched again.
3. `npm run validate`. The CLI tests (`src/cli/cli.test.ts`) create a product in
   a temp dir and run every check against it, so a template that breaks a
   product fails here.
4. In a product, `npx reins sync` (or `--check` in CI to see what is behind).

## Build output

Node refuses to strip TypeScript types for files under `node_modules`, so the
package ships compiled JavaScript: `npm install` here (and a product's install
from git) runs `scripts/prepare.mjs`, which builds `dist/`. Run the CLI from
source while developing (`node bin/reins.ts …`); `dist/` is gitignored and
rebuilt by `npm run build`. The e2e lane (`npm run test:e2e`) packs the package,
scaffolds a product, installs the tarball into it and runs the product's own
`validate`; it is the only check that exercises the package as installed,
because `npm link` resolves outside `node_modules` and hides the restriction.

## Trying it against a real product

```bash
npm link                      # once, here
cd ../some-product && npm link @dom-kelly/reins
npx reins doctor
```

Unlink with `npm unlink @dom-kelly/reins && npm install` when done. A linked
package runs from source, so it does not prove the packaged install; the e2e
lane does.
