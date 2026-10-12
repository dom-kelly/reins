# Changelog

Releases are git tags (`v<version>`), cut by the release workflow when main's
`package.json` version has no tag yet. Products pin a range on them
([decision 0007](./docs/contributing/decisions/0007-versioned-by-tag.md)).

## [0.2.5] - 2026-10-12

- The product-facing docs say what the guard does now: the "Agent guardrails"
  bullets in `harness-engineering.md` list what it refuses (force-push, push to
  main, `--no-verify`, destructive resets, `--admin`/`--auto` and API merges, a
  merge without `--delete-branch`) and that it runs the shipping policy on
  `gh pr merge`, instead of claiming pushes and merges always ask the owner.
  `growth.md` states kody's licence (FSL-1.1-ALv2) and points at the harness
  repo for the earlier implementations; the decisions index names
  `npx reins check`. A test keeps retired wording (`npx harness`,
  `harness.json`, "always ask the owner", …) out of every markdown file under
  `templates/` and `docs/`, the README and `CLAUDE.md`.

## [0.2.4] - 2026-10-12

- The CLI is the only public surface: an `exports` map in `package.json` exposes
  only `package.json`, so a deep import of `dist/` from a product fails at
  resolution instead of becoming de facto API (decision 0004).
- The typecheck hook can run a fast script: `hooks.typecheck` in `reins.json`
  names the npm script it runs after a TypeScript edit (default `typecheck`),
  and it now skips files outside the repo root, under `node_modules/`, `dist/`,
  `build/`, `.react-router/`, or any prefix in `hooks.typecheckIgnore`. A
  missing script shows the user a notice naming it instead of silently passing.

## [0.2.3] - 2026-10-12

- The Stop hook has its own gate: `hooks.stopGate` in `reins.json` names the npm
  script it runs (default: `policy.gate`), so a product whose merge gate is slow
  can keep a fast stop gate instead of timing out and failing open. A missing
  script now shows the user a notice naming it instead of silently passing, and
  `reins doctor` suggests a stop gate when the merge gate is not `validate`.

## [0.2.2] - 2026-10-12

- A merged PR's head branch no longer outlives it: a managed workflow
  (`.github/workflows/merged-branch.yml`) deletes the branch of any merged PR,
  the guard refuses `gh pr merge` without `--delete-branch`, and `reins doctor`
  says whether GitHub's own auto-delete is on. A test now fails when a file
  under `templates/` is missing from the manifest.

## [0.2.1] - 2026-10-12

- A git-install e2e lane: a product now also installs the package the way
  products do, from a git URL, so npm's clone, the devDependency install and
  `scripts/prepare.mjs` in that clone are exercised, not only the tarball.

## [0.2.0] - 2026-10-12

- Versioning: a change to shipped code must bump the version and add an entry
  here (`checks.bumpVersionWhen`), merging main tags `v<version>`, products pin
  `#semver:^major.minor` instead of tracking main, `reins sync` records the
  version it synced from and `reins doctor` asks for a sync when it differs.
- Renamed to reins: package `@dom-kelly/reins`, bin `reins`, `reins.json` and
  `.reins/base`; adopt and sync migrate a product from the old names (#9).
- Claude hooks fail closed when the package is not installed instead of letting
  `npx` fetch a stranger's package from the registry (#8).

## [0.1.0] - 2026-10-09

- Initial release: new, adopt, sync, check, classify, doctor, policy, hooks.
