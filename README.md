# reins

The agent harness, as a CLI. One package every product depends on: it scaffolds
a new product, applies the harness to an existing repo, keeps the shared files
in sync, and runs the checks and hooks that keep agent-written code steerable.

The approach is adapted from the agent workflow in
[kentcdodds/kody](https://github.com/kentcdodds/kody) and OpenAI's
[harness engineering](https://openai.com/index/harness-engineering/) write-up,
deliberately slimmed: it ships kody's **loop**, not kody's inventory
([decision 0003](./docs/contributing/decisions/0003-slim-template-grow-when-earned.md)).

## Use it

```bash
npx github:dom-kelly/reins new my-product   # a new product: app, docs, skills, hooks, gate
cd my-product && npm run validate

# or, in an existing repo
npm i -D "git+https://github.com/dom-kelly/reins.git#semver:^0.4.0"
npx reins adopt            # writes what's missing, keeps what's yours
npm update @dom-kelly/reins && npx reins sync   # later: take a release, merge template updates
npx reins check            # decisions, links, skills, primitives map, repo rules
npx reins classify         # which primitives a branch touches, and the risk floor
npx reins policy 42      # may an agent merge PR 42? the guard runs this on every gh pr merge
npx reins policy 42 --wait   # the same, after CI and the reviews on the current head are in
npx reins doctor           # what a fresh session needs to know; --offline skips GitHub
```

Products call `npx reins hook …` from `.husky/` and `.claude/settings.json`, so
the guard and the git hooks come from this package too; the same settings file
loads the skills as a Claude Code plugin straight from `node_modules`, so a
product never holds a copy of them
([decision 0009](./docs/contributing/decisions/0009-skills-ship-as-a-plugin.md)).

### Or hand it to an agent

Create the repository on GitHub, clone it, open your coding agent in the clone
and paste this. The agent scaffolds, installs, proves the gate and the app,
commits, and then hands you the few steps only you can do.

```text
Set this repository up on the reins harness (https://github.com/dom-kelly/reins)
and get it running. Do everything you can yourself; stop only for what needs me,
and give me the exact command for each of those.

1. Node. This needs Node 22 (22.18 or later; the hooks refuse any other major).
   Check `node -v`; if it is something else, run
   `nvm install 22 && nvm use 22` (or tell me to).
2. Scaffold. `reins new` refuses a non-empty directory and this one has `.git`
   (and maybe README.md, LICENSE, .gitignore from GitHub), so scaffold next to it
   and move the result in:
     npx github:dom-kelly/reins new ../reins-scaffold --name <this directory's name, lowercase> --no-git --no-install
   Move everything from ../reins-scaffold into this repo, dotfiles included, then
   delete ../reins-scaffold. Where a file already exists here, keep mine; for
   .gitignore, append the scaffold's entries to mine.
3. Install and prove it. `npm install` (it also installs the git hooks and builds
   the harness). `npm run validate` must be green; fix the cause of anything red,
   never skip a check. Start `npm run dev`, confirm `curl localhost:3000/health`
   returns ok:true with the git sha, then stop it.
4. `npx reins doctor`. Fix whatever it flags that you can.
5. Commit everything on main as one commit, "Scaffold with reins". Never pass
   --no-verify; a failing hook means something to fix.
6. Do not push: the harness refuses an agent pushing to main. Finish by telling
   me to run `git push -u origin main`, then to open Claude Code here, accept the
   plugin trust dialog so /reins:* appears, and run /reins:new-product with my
   product idea. Add anything else that needs me (for example `gh auth login`,
   `gh repo edit --delete-branch-on-merge`).
```

## What a product gets

| Layer        | Where in the product                                   | Purpose                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map          | `CLAUDE.md`, `AGENTS.md`                               | Short index; detail lives in focused docs                                                                                                                                                                   |
| Docs         | `docs/contributing/`                                   | Intent, harness loop, shipping policy, security, testing, gotchas                                                                                                                                           |
| Veto list    | `docs/contributing/decisions/`                         | Recorded "no" decisions so agents stop re-proposing them                                                                                                                                                    |
| Taxonomy     | `docs/contributing/architecture/primitives.yaml`       | Building blocks, invariants, risk floors; every source file has an owner                                                                                                                                    |
| Skills       | `/reins:*` (plugin in `node_modules/@dom-kelly/reins`) | new-product, review-and-recommend, ship-pr, verify-app; harness-owned, never copied ([decision 0009](./docs/contributing/decisions/0009-skills-ship-as-a-plugin.md))                                        |
| Toolchain    | `.oxlintrc.json`, `.prettierrc.json`, lint-staged      | Shared format and lint; the product keeps its test runner, typechecker and build ([decision 0008](./docs/contributing/decisions/0008-harness-owns-format-and-lint.md))                                      |
| Gate         | `npm run validate`                                     | One local gate, identical in CI; `npx reins check` is one lane                                                                                                                                              |
| Hooks        | `.husky/`, `.claude/settings.json`                     | Git hooks: Node version, lint-staged, `reins check`, typecheck, tests on push. Claude hooks: doctor at session start, typecheck after edits, gate before stopping; destructive git and push-to-main blocked |
| Housekeeping | `.github/workflows/merged-branch.yml`                  | A merged PR's head branch is deleted, however it was merged; the guard requires `--delete-branch` too                                                                                                       |
| Policy       | `reins.json` → `policy`                                | kody's risk tiers: who may merge, which reviewers must have spoken; the verdict is written to the PR as `needs-owner` / `agent-merges` labels, an assignee and a comment                                    |
| Growth path  | `docs/contributing/growth.md`                          | What to add, and when it has earned its place                                                                                                                                                               |

`templates/manifest.json` says which of these are **managed** (kept in sync),
which are **owned** by the product after the first write, and which are
**retired** (once managed, now deleted by sync)
([decision 0004](./docs/contributing/decisions/0004-harness-is-a-cli-package.md)).

## Develop it

See [docs/contributing/developing.md](./docs/contributing/developing.md).
