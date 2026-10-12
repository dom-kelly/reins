# 0007: Releases are semver tags; products pin a range

- **Status:** accepted
- **Date:** 2026-10-12

## Context

The package version stayed at 0.1.0 from the first commit and there were no
tags. Products installed `git+https://github.com/dom-kelly/reins.git`, so every
install was whatever main held at that moment, `npm update` moved a product to a
new snapshot without anyone choosing to, and the `harness` field in a product's
`reins.json` (which `reins doctor` compares with the CLI) carried no
information. This repo lets agents merge every tier (decision 0005); an
unversioned engine that products track directly turns every merge into an
unreviewed release.

## Decision

A release is a git tag `v<version>` on main, created by the release workflow
when `package.json`'s version has no tag yet. The repo rules check
(`checks.bumpVersionWhen`) refuses a change to shipped code (`src/`, `bin/`,
`templates/`, `scaffold/`, `plugin/`, `.claude-plugin/`, `scripts/`,
`package.json`) unless the version is bumped and `CHANGELOG.md` has a
`## [<version>]` entry, so the bump and the note arrive in the PR that needs
them and every merge is either a release or leaves the version alone.

Products depend on
`git+https://github.com/dom-kelly/reins.git#semver:^<major.minor>.0`: npm
resolves the range against the tags, so `npm update @dom-kelly/reins` moves
within the major.minor and a new minor is taken on purpose by editing the spec.
`reins adopt` writes the current major.minor; `reins sync` rewrites a bare URL
to it and records the version it synced from in `reins.json`, which
`reins doctor` compares with the CLI.

## Consequences

A release is a deliberate act in the PR, and a bad one costs a product nothing:
it does not update, or pins the previous tag. A bug fix is a patch bump; new
behaviour, a changed template or anything a product must act on after
`npx reins sync` is a minor bump; before 1.0 nothing is a major. A change to
`package-lock.json` alone needs no bump: products resolve the runtime
dependencies themselves. `^0.x.0` keeps a product within its minor only below
1.0; at 1.0 the spec becomes `~major.minor.0` to keep that meaning. Prerelease
tags are not matched by the range, so a prerelease CLI cannot adopt a product.
Tags are only ever added, never moved. Between the merge and the workflow's tag
(a minute) a fresh install of the new range fails; retry. Revisit if products
routinely need an unreleased main (a prerelease tag scheme), or if two releases
a day make the per-PR bump a nuisance (batch the changelog and tag by hand).
