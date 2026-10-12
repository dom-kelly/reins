# Changelog

Releases are git tags (`v<version>`), cut by the release workflow when main's
`package.json` version has no tag yet. Products pin a range on them
([decision 0007](./docs/contributing/decisions/0007-versioned-by-tag.md)).

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
