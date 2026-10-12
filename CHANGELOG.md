# Changelog

Releases are git tags (`v<version>`). The release workflow writes each entry
here from the change notes under `changes/` and tags main
([decision 0011](./docs/contributing/decisions/0011-release-from-change-notes.md));
products pin a range on the tags
([decision 0007](./docs/contributing/decisions/0007-versioned-by-tag.md)).

## [0.4.2] - 2026-10-12

- The Claude hooks (`typecheck`, `validate-on-stop`) run the product's scripts
  on the Node in `.nvmrc` again when the session's Node is not nvm's. npm
  exports its config to what it runs, so `npx reins hook …` arrived with
  `npm_config_prefix` set to that Node's prefix, nvm refused `nvm use` because
  the prefix was outside `NVM_DIR`, and the hook silently ran the gate on the
  wrong Node (rollup: "Cannot find module `@rollup/rollup-darwin-x64`" under a
  Homebrew x64 Node 23 on an arm64 Mac). The hook now uses its own Node when
  that already matches `.nvmrc` (CI, where nvm is present but Node comes from
  setup-node), otherwise drops the npm prefix variables and lets nvm select the
  right one, and when neither gives that Node it exits 2 saying which Node is
  required, that the hooks run on the Node Claude Code was started with, and why
  nvm could not supply it, instead of running the script on the wrong Node. An
  `.nvmrc` that is not a version (`lts/*`) claims nothing, so the hook's Node is
  used as is. The npm prefix variables are dropped for the nvm call only; a
  product script still sees them. A unit test drives the switch with a `node`
  shim and a prefix outside nvm; the tarball e2e lane runs the typecheck hook
  command as Claude Code does with such a prefix.
- The product harness-engineering doc routes a papercut owned by the harness to
  a `friction` issue on dom-kelly/reins instead of a workaround in the product.

## [0.4.1] - 2026-10-12

- Docs brought back in line with the code. Product docs: the shipping policy
  names the `**Door:**` and `**Change:**` lines it reads and says the
  independent review is needed with or without reviewers; `enforceOnMerge` and
  `findingsFrom` join the configuration example; the `checks` keys are
  documented (`lockfile`, `agentsMaxLines`, `appendOnly`, `bumpVersionWhen` for
  the repo rules; `ignoreLinksIn` for the link check); an invariant touched
  declares `extends` rather than "counts as medium" (the policy takes the
  highest of the declared Change, the floor and the Door, and cannot see the
  invariant itself); the required Node is 22 (22.18+), not "22.18 or later"; the
  CI check to require is `validate`, lowercase; git hooks format staged files
  only when a lint-staged config exists. Skills: `ship-pr` fills the Door /
  Change / Cleanup and Primitives sections of the PR template; `new-product` no
  longer says "boilerplate". Harness docs: the README is titled reins and its
  hooks row says what the git hooks run; decision 0007 lists `plugin/` and
  `.claude-plugin/` among the shipped paths.

## [0.4.0] - 2026-10-12

- The policy writes the PR's status
  ([decision 0010](./docs/contributing/decisions/0010-policy-writes-pr-status.md)).
  Every `reins policy` run, each change of reason during `--wait`, and the guard
  on `gh pr merge` now set exactly one of the labels `needs-owner` /
  `agent-merges` plus `risk:<tier>`, assign the owner when the PR is parked
  (`policy.owner`, or the repo owner of a user-owned repo), and keep one
  `## Shipping policy` comment (first line `<!-- reins:policy -->`) current with
  the reason and the merge command. Labels are created on first use; other
  labels are untouched; a failed write prints
  `policy: could not write PR status (…)` and never changes the verdict.
  `policy.publish: false` or `--no-publish` switches it off. The repo owner's
  review threads now count as findings by default (`policy.ownerFindings`).
  `ship-pr`'s final summary uses `Shipped` / `Needs you: <action>` /
  `Blocked: <what>`; "Ready" is retired. The settings template allow-lists
  `gh pr merge *`, since the guard already runs the policy on every merge, and
  gives the guard hook an explicit 120 second timeout for the extra `gh` calls.
- The policy refuses a PR URL from another repo before reading anything, so a
  `gh pr merge <url>` cannot be judged against this repo's PR of the same number
  or write its status there. `policy.owner` joins the default `findingsFrom` (so
  an organisation repo's named owner is answered too), and when nothing names
  the owner and the lookup fails the policy refuses instead of dropping those
  findings. A status write that fails during `--wait` is repeated with the final
  verdict.

## [0.3.0] - 2026-10-12

- The skills ship as a Claude Code plugin instead of managed copies
  ([decision 0009](./docs/contributing/decisions/0009-skills-ship-as-a-plugin.md)).
  `plugin/skills/` and `.claude-plugin/marketplace.json` travel with the
  package; a product's `.claude/settings.json` now registers that marketplace as
  a `directory` source at `./node_modules/@dom-kelly/reins` and enables
  `reins@reins`, so the skills load in place as `/reins:<name>` and the lockfile
  pins them. `templates/manifest.json` has a `retired` list: sync and adopt
  delete a product's unedited copy of a retired file (and its `.reins/base/`
  record) and report an edited one, or one with no base record, under "RETIRED
  BUT NOT DELETED" (sync exits 1) rather than deleting it. `reins check` refuses
  a product `.claude/skills/<name>` or `.agents/skills/<name>` that reuses a
  reins skill's name. `reins doctor` reports whether the plugin is declared and
  the marketplace is on disk. Skills name product docs by repo-root path in
  prose instead of relative links, and cross-reference each other as
  `/reins:<name>`. **Taking it:** set the spec to
  `git+https://github.com/dom-kelly/reins.git#semver:^0.3.0`, `npm install`,
  `npx reins sync` (the four skill copies go, `.claude/settings.json` gains the
  plugin block), then open Claude Code in the repo and accept the trust dialog;
  skills are now `/reins:new-product`, `/reins:review-and-recommend`,
  `/reins:ship-pr`, `/reins:verify-app`. Repo-declared plugins do not load in
  cloud or headless sessions.

## [0.2.8] - 2026-10-12

- A reviewer named in `policy.reviewers` must exist on the repo. Before
  `reins policy` waits for a gate check to pass or a required login to review
  the head, it looks up which check runs and which review/comment logins have
  appeared on the repo's last 20 PRs (one GraphQL call per run, cached; the
  current PR's own checks and reviews count; a `[bot]` suffix is ignored). One
  that has never appeared is refused at once with "`<name>` is configured in
  reins.json as a gate check | required reviewer but has never run on this repo:
  install the app or remove it from `policy.reviewers`", so `--wait` returns
  exit 2 instead of sitting out its timeout on an app that was copied from
  another repo's tiers. With fewer than three PRs, or when the lookup fails, it
  waits as before. `reins doctor` reports the same per configured reviewer (gate
  checks, required and `findingsFrom` logins): ❌ when one has never run, ℹ️
  when there are too few PRs or `gh` cannot read the repo. Not part of
  `reins check`, which stays offline.

## [0.2.7] - 2026-10-12

- The husky hooks fail closed: `.husky/pre-commit` and `pre-push` now run
  `npx --no-install reins hook …`, so a product whose `node_modules` lacks the
  harness gets "reins is not installed: run npm install" instead of npx fetching
  whatever the public registry has under `reins` (the hazard of decision 0006,
  which the Claude hooks already closed). A test keeps every `npx reins hook` a
  template ships on `--no-install`.
- The merged-branch workflow URL-encodes the head branch before the
  `DELETE /git/refs/heads/…` call, so a name with `#` or `%` hits the right ref
  (slashes stay literal); the skip and already-deleted cases are unchanged.

## [0.2.6] - 2026-10-12

- The independent review is on the PR and the policy checks for it: when an
  agent merges medium or high, `reins policy` needs an issue comment whose first
  line is `## Independent review` with a `head: <sha>` naming the current head
  or an earlier commit of the branch (`policy.independentReview: false` turns it
  off). `ship-pr` now spawns the fresh-context reviewer right after
  `gh pr create`, while CI runs, posts its findings as that comment and appends
  `Fixed in <sha>` lines to it.
- `reins policy <pr> --wait [--timeout <seconds>]` polls every 20 seconds while
  the verdict waits on something that may still arrive (a check running or not
  yet reported, a reviewer, the review comment), reading the head afresh each
  time, then prints the verdict; exit 1 on timeout (default 20 minutes) saying
  what it was still waiting for. A check still running is now reported as
  "waiting for" rather than "not green".

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
