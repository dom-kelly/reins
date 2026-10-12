# harness

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
npm i -D "git+https://github.com/dom-kelly/reins.git#semver:^0.3.0"
npx reins adopt            # writes what's missing, keeps what's yours
npm update @dom-kelly/reins && npx reins sync   # later: take a release, merge template updates
npx reins check            # decisions, links, skills, primitives map, repo rules
npx reins classify         # which primitives a branch touches, and the risk floor
npx reins policy 42      # may an agent merge PR 42? the guard runs this on every gh pr merge
npx reins policy 42 --wait   # the same, after CI and the reviews on the current head are in
npx reins doctor
```

Products call `npx reins hook …` from `.husky/` and `.claude/settings.json`, so
the guard and the git hooks come from this package too; the same settings file
loads the skills as a Claude Code plugin straight from `node_modules`, so a
product never holds a copy of them
([decision 0009](./docs/contributing/decisions/0009-skills-ship-as-a-plugin.md)).

## What a product gets

| Layer        | Where in the product                                   | Purpose                                                                                                                                                                |
| ------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map          | `CLAUDE.md`, `AGENTS.md`                               | Short index; detail lives in focused docs                                                                                                                              |
| Docs         | `docs/contributing/`                                   | Intent, harness loop, shipping policy, security, testing, gotchas                                                                                                      |
| Veto list    | `docs/contributing/decisions/`                         | Recorded "no" decisions so agents stop re-proposing them                                                                                                               |
| Taxonomy     | `docs/contributing/architecture/primitives.yaml`       | Building blocks, invariants, risk floors; every source file has an owner                                                                                               |
| Skills       | `/reins:*` (plugin in `node_modules/@dom-kelly/reins`) | new-product, review-and-recommend, ship-pr, verify-app; harness-owned, never copied ([decision 0009](./docs/contributing/decisions/0009-skills-ship-as-a-plugin.md))   |
| Toolchain    | `.oxlintrc.json`, `.prettierrc.json`, lint-staged      | Shared format and lint; the product keeps its test runner, typechecker and build ([decision 0008](./docs/contributing/decisions/0008-harness-owns-format-and-lint.md)) |
| Gate         | `npm run validate`                                     | One local gate, identical in CI; `npx reins check` is one lane                                                                                                         |
| Hooks        | `.husky/`, `.claude/settings.json`                     | Node version, doc checks, typecheck after edits, gate before stopping; destructive git and push-to-main blocked                                                        |
| Housekeeping | `.github/workflows/merged-branch.yml`                  | A merged PR's head branch is deleted, however it was merged; the guard requires `--delete-branch` too                                                                  |
| Policy       | `reins.json` → `policy`                                | kody's risk tiers: who may merge, which reviewers must have spoken                                                                                                     |
| Growth path  | `docs/contributing/growth.md`                          | What to add, and when it has earned its place                                                                                                                          |

`templates/manifest.json` says which of these are **managed** (kept in sync),
which are **owned** by the product after the first write, and which are
**retired** (once managed, now deleted by sync)
([decision 0004](./docs/contributing/decisions/0004-harness-is-a-cli-package.md)).

## Develop it

See [docs/contributing/developing.md](./docs/contributing/developing.md).
