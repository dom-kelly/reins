# Agent index

This repo is **the harness**: the CLI products call, the templates it writes
into them, and the scaffold `reins new` starts from. It follows the same
principles it ships; read them in
[templates/docs/contributing/harness-engineering.md](./templates/docs/contributing/harness-engineering.md).

`npm run validate` is the single authoritative local gate. CI runs the same
checks, so green locally means green in CI.

- Layout, commands, how to change a template safely:
  [docs/contributing/developing.md](./docs/contributing/developing.md)
- Decision records (veto list — open before proposing a new command, template or
  check):
  [docs/contributing/decisions/index.md](./docs/contributing/decisions/index.md)
- Known traps: [docs/contributing/gotchas.md](./docs/contributing/gotchas.md)
- What products receive: [templates/manifest.json](./templates/manifest.json)
  (managed = synced, owned = written once, retired = deleted by sync) and the
  plugin in [plugin/](./plugin/skills/) (the skills, loaded from node_modules)

## Skills

The skills live in `plugin/skills/` and this repo loads them from itself (the
repo root is the marketplace; see `.claude/settings.json`), so they are the same
`/reins:<name>` products get: use `/reins:review-and-recommend` before a design
choice, `/reins:ship-pr` to take a change to done; `/reins:verify-app` here
means `npm run validate` plus trying the CLI against a temp product
(`node bin/reins.ts new .tmp/demo --no-install`). After editing a skill, run
`/reload-plugins` to pick it up in the current session.
