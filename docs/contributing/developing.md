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
| `bin/reins.ts`       | CLI entry: new, adopt, sync, check, classify, policy, doctor, hook           |
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

The harness does not adopt itself through `reins sync`. Decision
[0004](./decisions/0004-harness-is-a-cli-package.md) keeps this repo's
`docs/contributing/` (about developing the harness) distinct from the
product-facing docs under `templates/`; a full self-adopt would overwrite one
with the other. The copied skills and workflow, each with an equality test, are
the deliberate compromise: the harness runs the files it ships without becoming
a product of itself.

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
rebuilt by `npm run build`. The e2e lanes (`npm run test:e2e`) are the only
checks that exercise the package as installed, because `npm link` resolves
outside `node_modules` and hides the restriction. Each scaffolds a product and
runs the product's own `validate`:

- the **tarball** lane packs the package and installs the `.tgz`, which proves
  the `files` list, the bin path and the Claude hook before and after install;
- the **git** lane installs `git+file://<this checkout>#<HEAD>`, which follows a
  product's install: npm fetches the commit into a temp dir with no `dist/` and
  no `node_modules`, installs the devDependencies there, runs
  `scripts/prepare.mjs` and packs the result. A missing devDependency or a
  prepare that expects an existing build only fails here. npm takes HEAD, so
  uncommitted changes are not exercised; commit before trusting it. Two things
  still differ from a product: the spec pins a sha, so `#semver:` tag resolution
  is not covered, and for GitHub npm downloads the commit's tarball (no `.git`,
  so the husky branch of prepare is skipped) rather than cloning.

## Releasing

A release is a tag; products pin a range on tags
([decision 0007](./decisions/0007-versioned-by-tag.md)).

1. In the PR that changes shipped code (`src/`, `bin/`, `templates/`,
   `scaffold/`, `scripts/`, `package.json`), bump `version` in `package.json`
   (`npm version patch|minor --no-git-tag-version`) and add a `## [<version>]`
   entry to `CHANGELOG.md`. The repo rules check in `npm run validate` fails
   without both; a change to `package-lock.json` alone needs neither.
2. On merge, `.github/workflows/release.yml` tags main `v<version>` when no such
   tag exists.
3. Products depend on `git+https://github.com/dom-kelly/reins.git#semver:^0.2.0`
   and take a release with `npm update @dom-kelly/reins && npx reins sync`. A
   new minor is taken by editing the spec; `reins adopt` writes the current
   major.minor and a test keeps `scaffold/app-node/package.json` on it.

## Trying it against a real product

```bash
npm link                      # once, here
cd ../some-product && npm link @dom-kelly/reins
npx reins doctor
```

Unlink with `npm unlink @dom-kelly/reins && npm install` when done. A linked
package runs from source, so it does not prove the packaged install; the e2e
lane does.
