# Change notes

One file per pull request that ships code (decision 0011): any name, `.md`,
first line `patch` or `minor`, then the changelog text as it should appear under
the next version's heading in `CHANGELOG.md`, links written from the repo root
as they will be there. Two pull requests never touch the same file here, so they
merge in any order. The release workflow folds these into the changelog, writes
the version and deletes them on every push to main;
`node scripts/release.ts --check` shows what that release would be.

```md
patch

- The guard refuses `git push --mirror` too.
```
