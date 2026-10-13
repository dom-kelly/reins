<!-- reins: managed. Edit freely: `npx reins sync` merges harness updates in and
     keeps your edits. What reins touches: docs/contributing/getting-started.md -->

# Code style

Formatting and lint are mechanical (`npm run validate:fix`). This page covers
only what the tools do not enforce. When a convention here starts getting broken
repeatedly, turn it into a lint rule or checker and delete the line.

- Match the surrounding code: naming, idiom, comment density.
- No decorative comment banners. If a file needs sections, split it.
- One responsibility per file. Split rather than grow.
- One clear contract per capability. Do not add aliases, fallbacks, or compat
  shims for callers; fix the contract.
- Prefer plain functions and data over classes and inheritance.
- Types describe reality. A type that lies is a bug.
