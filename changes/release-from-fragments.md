minor

- Releases come from change notes, not from a version bump in the PR
  ([decision 0011](./docs/contributing/decisions/0011-release-from-change-notes.md)).
  A PR that ships code adds one file under `changes/` (first line `patch` or
  `minor`, then the changelog text) instead of editing `package.json` and
  `CHANGELOG.md`; two such PRs share no file and merge in any order. The release
  workflow folds the notes into the changelog, writes the version into
  `package.json`, `package-lock.json` and the plugin manifest, commits to main
  as the bot and tags; `node scripts/release.ts --check` previews it. The repo
  rules check accepts either a change note or the old bump-with-heading, so a
  product that sets `checks.bumpVersionWhen` may adopt notes at its own pace.
