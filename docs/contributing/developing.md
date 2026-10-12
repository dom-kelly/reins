# Developing the harness

Requires Node 22, 22.18 or later: `.nvmrc` pins the major and the git hooks
refuse another (`nvm use` reads it).

```bash
npm install
npm run validate          # the one gate: format, lint, types, tests, reins check, the e2e lanes, audit
node bin/reins.ts --help
```

## Layout

| Path                 | What                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `bin/reins.ts`       | CLI entry: new, adopt, sync, check, classify, policy, doctor, hook                    |
| `src/checks/`        | Checkers behind `reins check` and the git hooks                                       |
| `src/hooks/`         | The Bash guard, the typecheck and gate-on-stop hooks, the git hook runner             |
| `src/policy/`        | `reins policy`: risk tiers, reviewers, authority; tested against a stub `gh`          |
| `src/lib/`           | Repo discovery, `reins.json`, template apply and three-way sync                       |
| `src/cli/`           | new, adopt, doctor                                                                    |
| `templates/`         | Files written into products; `manifest.json` says which are managed, owned or retired |
| `scaffold/app-node/` | The placeholder app `reins new` starts from                                           |
| `plugin/`            | The Claude Code plugin: the skills, which products load in place from node_modules    |
| `.claude-plugin/`    | The marketplace that lists the plugin; the package root is the marketplace root       |
| `docs/contributing/` | These docs, about the harness itself                                                  |

The harness does not adopt itself through `reins sync`. Decision
[0004](./decisions/0004-harness-is-a-cli-package.md) keeps this repo's
`docs/contributing/` (about developing the harness) distinct from the
product-facing docs under `templates/`; a full self-adopt would overwrite one
with the other. The copied merged-branch workflow (with an equality test) and
the plugin block in `.claude/settings.json` (pointing at `.`, where a product
points at `./node_modules/@dom-kelly/reins`) are the deliberate compromise: the
harness runs what it ships without becoming a product of itself.

## Changing a skill

Edit `plugin/skills/<name>/SKILL.md`. Nothing is copied anywhere: this repo
loads it from `.` and a product from its installed package, so a product takes
the change with `npm update @dom-kelly/reins` and `/reload-plugins` (no `sync`
needed). Skills are read from outside the product tree, so they name product
docs by repo-root path in prose (`docs/contributing/gotchas.md`), never by
relative link; a test enforces it. `claude plugin validate --strict .` checks
the marketplace and plugin manifests (CI has no `claude`, so run it by hand when
you touch them). A product may not keep a `.claude/skills/<name>` under a reins
skill's name (`reins check` refuses it,
[decision 0009](./decisions/0009-skills-ship-as-a-plugin.md)).

## Changing a template

1. Edit the file under `templates/`. Product-facing docs describe a product, not
   this repo; keep them stack-agnostic.
2. If you add or remove a file, update `templates/manifest.json`. Managed files
   are synced into products (three-way merge); owned files are written once and
   never touched again; a file the harness stops shipping moves to `retired`,
   and sync deletes a product's copy when it still matches its `.reins/base/`
   record (an edited copy is reported, never deleted).
3. `npm run validate`. The CLI tests (`src/cli/cli.test.ts`) create a product in
   a temp dir and run every check against it, so a template that breaks a
   product fails here.
4. In a product, `npx reins sync` (or `--check` in CI to see what is behind).

## Public surface

The CLI is the only contract
([decision 0004](./decisions/0004-harness-is-a-cli-package.md)): products call
`npx reins …` and never import this package. `exports` in `package.json`
enforces it by exposing only `package.json`, so a deep import of `dist/` fails
at resolution (`ERR_PACKAGE_PATH_NOT_EXPORTED`); the tarball e2e lane checks
that. To offer something to products, add a command or a hook, not an export.

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
   `scaffold/`, `plugin/`, `.claude-plugin/`, `scripts/`, `package.json`), bump
   `version` in `package.json` (`npm version patch|minor --no-git-tag-version`)
   and in `plugin/.claude-plugin/plugin.json` (a test keeps them equal), and add
   a `## [<version>]` entry to `CHANGELOG.md`. The repo rules check in
   `npm run validate` fails without both; a change to `package-lock.json` alone
   needs neither.
2. On merge, `.github/workflows/release.yml` tags main `v<version>` when no such
   tag exists.
3. Products depend on `git+https://github.com/dom-kelly/reins.git#semver:^0.4.0`
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
