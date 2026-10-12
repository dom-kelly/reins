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
  (managed = synced, owned = written once)

## Skills

`.claude/skills/` is the same set products get (copies of `templates/`, kept
identical by a test): use `review-and-recommend` before a design choice,
`ship-pr` to take a change to done, `verify-app` here means `npm run validate`
plus trying the CLI against a temp product
(`node bin/reins.ts new .tmp/demo --no-install`).
