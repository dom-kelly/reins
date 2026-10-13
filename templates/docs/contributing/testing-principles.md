<!-- reins: managed. Edit freely: `npx reins sync` merges harness updates in and
     keeps your edits. What reins touches: docs/contributing/getting-started.md -->

# Testing principles

Tests exist to catch regressions in behavior users or callers depend on. Pick
the lightest kind of test that can catch the bug.

## What to test

- Test behavior through the public surface (an HTTP route, an exported
  function), not implementation details.
- A bug fix starts with a failing test that reproduces it.
- A checker you add to `validate` has a unit test for its pure logic; the
  harness's own checkers are tested in the harness.
- User-visible changes also get `verify-app` evidence against the running app.

## How tests are written

- **Flat and self-contained.** Each test sets up what it needs and cleans up in
  `try`/`finally` (or `await using` where the runtime supports it). No shared
  `beforeEach`/`beforeAll` state between tests; the global setup in
  `vitest.setup.ts` is the only exception.
- **Fewer, longer tests.** One test may walk a whole journey with several
  assertions. Do not split a flow into many tiny tests that each rebuild the
  world.
- **Inject, do not mutate globals.** Pass `env`, clocks, and clients as
  parameters instead of editing `process.env` in a test.
- **Offline.** Tests never call real third-party services; use a mock server.

## Assertions to avoid

- **Tautologies** that re-state the implementation (asserting a constant equals
  itself, or a mock returns what it was told to).
- **Vanished-copy absence checks** such as "the footer no longer contains X".
  They help while building and say nothing afterwards; delete them once the
  change ships.
- Snapshot tests of large output nobody reads.

## Guardrails (enforced)

- Unexpected `console.error` or `console.warn` fails the test. Fix the cause, or
  call `allowConsole()` from `vitest.setup.ts` and assert on the output.
- Mocks reset between tests (`clearMocks`, `mockReset`).
- One timeout (20s) locally and in CI, so a pass locally means a pass in CI.
- Never skip hooks with `--no-verify` and never retry a flaky test into green;
  fix it, or record it in [gotchas.md](./gotchas.md). The Claude Code guard hook
  blocks `--no-verify`.
