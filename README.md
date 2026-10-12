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
npm i -D git+https://github.com/dom-kelly/reins.git
npx reins adopt            # writes what's missing, keeps what's yours
npx reins sync             # later: pull template updates, keeping local edits
npx reins check            # decisions, links, skills, primitives map, repo rules
npx reins classify         # which primitives a branch touches, and the risk floor
npx reins policy 42      # may an agent merge PR 42? the guard runs this on every gh pr merge
npx reins doctor
```

Products call `npx reins hook …` from `.husky/` and `.claude/settings.json`, so
the guard and the git hooks come from this package too.

## What a product gets

| Layer       | Where in the product                             | Purpose                                                                                                         |
| ----------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Map         | `CLAUDE.md`, `AGENTS.md`                         | Short index; detail lives in focused docs                                                                       |
| Docs        | `docs/contributing/`                             | Intent, harness loop, shipping policy, security, testing, gotchas                                               |
| Veto list   | `docs/contributing/decisions/`                   | Recorded "no" decisions so agents stop re-proposing them                                                        |
| Taxonomy    | `docs/contributing/architecture/primitives.yaml` | Building blocks, invariants, risk floors; every source file has an owner                                        |
| Skills      | `.claude/skills/`                                | new-product, review-and-recommend, ship-pr, verify-app                                                          |
| Gate        | `npm run validate`                               | One local gate, identical in CI; `npx reins check` is one lane                                                  |
| Hooks       | `.husky/`, `.claude/settings.json`               | Node version, doc checks, typecheck after edits, gate before stopping; destructive git and push-to-main blocked |
| Policy      | `reins.json` → `policy`                          | kody's risk tiers: who may merge, which reviewers must have spoken                                              |
| Growth path | `docs/contributing/growth.md`                    | What to add, and when it has earned its place                                                                   |

`templates/manifest.json` says which of these are **managed** (kept in sync) and
which are **owned** by the product after the first write
([decision 0004](./docs/contributing/decisions/0004-harness-is-a-cli-package.md)).

## Develop it

See [docs/contributing/developing.md](./docs/contributing/developing.md).
