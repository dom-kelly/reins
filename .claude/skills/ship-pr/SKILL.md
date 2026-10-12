---
name: ship-pr
description: >
  Shepherd a change to done: assess risk, run validate, get independent reviews,
  address valid feedback, verify against the running app, write the PR
  description, then push/merge/deploy only as far as the shipping policy allows.
  Use when a branch or PR needs to be taken to done.
---

# Ship PR

Authority comes from
[shipping-policy.md](../../../docs/contributing/shipping-policy.md) and is
enforced by `npx reins policy`. Never work around it. When the policy parks a PR
for the owner, stop with everything ready, say which rule applied, and link the
PR.

## Loop

1. **Assess risk.** `npx reins classify` for the primitives touched, then judge
   `composes` · `extends` · `adds` from the diff. Invariants touched → at least
   medium.
2. **Validate.** `npm run validate`. Fix failures. Do not weaken a check to
   pass; if a check is wrong, fix the checker with a test.
3. **Draft first.** If pushing is allowed, open the PR as a draft while
   iterating so CI does not run on every commit. Mark it ready only when
   validate is green locally.
4. **Review (medium+).** Wait for the AI reviewers (see **AI reviewers** below)
   and address valid feedback. Also spawn one fresh sub-agent with only the
   intent, the diff, and the relevant docs; never review your own work.
5. **Verify (user-visible changes).** Use `verify-app` with realistic data and
   record the evidence.
6. **Describe.** Fill the PR template: Intent, Why, Summary, Testing (commands
   and results).
7. **Leftovers.** Remove transitional code now. If something must wait for a
   later gate, say so in the PR under a `Cleanup:` line with a falsifiable
   "ready when"; a `TODO` in code is not a tracker.
8. **Ship within policy.** Wait on CI for the current head SHA only; ignore
   results for superseded commits. Then
   `gh pr merge <n> --squash --delete-branch`: the guard runs
   `npx reins policy <n>` and either merges or prints what it is waiting for (a
   reviewer, an unanswered finding, or the owner). Act on that; never retry with
   other flags or the API. If the branch becomes conflicting after green, rebase
   once and re-run; if still conflicting, stop and report.
9. **After merge/deploy (if allowed):** confirm `/health` reports the merge sha
   on the deployed origin.

Repeat 2–8 until CI is green and valid review feedback is cleared.

## AI reviewers

Installed as GitHub Apps (listed in
[external-services.md](../../../docs/contributing/external-services.md)); they
need no files in the repo.

- **Cursor Bugbot** is the primary reviewer. Trigger it by commenting
  `bugbot run` on the PR, or enable automatic runs in the Cursor dashboard.
  Bugbot only reviews PRs whose author is the GitHub account linked to Cursor.
  If the author differs, no review will appear: do not wait, note it in the PR,
  and continue with CI and the other reviewers.
- **CodeRabbit** is optional. Wait for it only on **high** risk (or when the
  owner asks). It posts some findings only in the review summary ("outside the
  diff"), not inline; read the summary too. If it is rate-limited, paused,
  errored, or not installed, do not wait.
- Treat every review comment as a claim to verify. Fix valid findings and reply
  `Fixed in <sha>: <what changed>`. For wrong claims, nits, and already-fixed
  items, reply on the thread with the reason.
- **Promote repeats.** If a finding is the second of its kind (check
  [gotchas.md](../../../docs/contributing/gotchas.md) and earlier PR threads),
  encode it in this PR: a checker or test first, a gotcha line only if no cheap
  checker exists.

## Gates are not CI

A soak, calendar gate, or rollout window ends the run. Schedule a wake-up; do
not sleep-poll.

## Wrap-up

- Add any new trap to [gotchas.md](../../../docs/contributing/gotchas.md).
- Final summary to the owner:
  - a human headline of the change (not "ship repo#12");
  - risk, difficulty (Easy/Medium/Hard), status (Shipped / Ready / Blocked);
  - model used and cost, **only** when the platform reports them;
  - what was verified, and links to the PR and any deployed pages.

  Never invent URLs, costs, or model names.
