---
name: ship-pr
description: >
  Shepherd a change to done: assess risk, run validate, get independent reviews,
  address valid feedback, verify against the running app, write the PR
  description, then push/merge/deploy only as far as the shipping policy allows.
  Use when a branch or PR needs to be taken to done.
---

# Ship PR

Authority comes from `docs/contributing/shipping-policy.md` and is enforced by
`npx reins policy`. Never work around it. When the policy parks a PR for the
owner, stop with everything ready, say which rule applied, and link the PR.

## Loop

1. **Assess risk.** `npx reins classify` for the primitives touched, then judge
   `composes` · `extends` · `adds` from the diff. Invariants touched → at least
   medium.
2. **Validate.** `npm run validate`. Fix failures. Do not weaken a check to
   pass; if a check is wrong, fix the checker with a test.
3. **Push, open the PR, and start the review while CI runs.** If pushing is
   allowed, push and `gh pr create` (as a draft while still iterating, so CI
   does not run on every commit; ready once validate is green locally). Then,
   without waiting for CI, spawn one fresh sub-agent with only the intent, the
   diff and the relevant docs; a fast model is fine; never review your own work.
   When it returns, post its findings on the PR with
   `gh pr comment <n> --body-file <file>`. The comment's first line is
   `## Independent review`, the next is `head: <full sha reviewed>`, then the
   findings (or `No defects found`). The policy needs this comment before an
   agent merges medium or high; its `head:` must be the current head or an
   earlier commit of the branch.
4. **Address findings (medium+).** Treat the independent review and the AI
   reviewers (see **AI reviewers** below) alike: verify each claim, fix the
   valid ones. For an independent-review finding, append a line
   `Fixed in <sha>: <what>` to that same comment rather than posting a new one,
   so the review and its outcome read as one: fetch the body with
   `gh api repos/{owner}/{repo}/issues/comments/<id> --jq .body` (ids from
   `gh api repos/{owner}/{repo}/issues/<n>/comments --jq '.[].id'`), add the
   line, and write it back with
   `gh api -X PATCH repos/{owner}/{repo}/issues/comments/<id> -F body=@<file>`.
5. **Verify (user-visible changes).** Use `/reins:verify-app` with realistic
   data and record the evidence.
6. **Describe.** Fill the PR template: Intent, Why, Summary, Testing (commands
   and results).
7. **Leftovers.** Remove transitional code now. If something must wait for a
   later gate, say so in the PR under a `Cleanup:` line with a falsifiable
   "ready when"; a `TODO` in code is not a tracker.
8. **Ship within policy.** `npx reins policy <n> --wait` polls until every check
   on the current head has finished and the reviews the tier needs are in, then
   prints the verdict: exit 0 may merge, 2 refused (it says why), 1 gave up
   after 20 minutes (`--timeout <seconds>` changes that) and says what it was
   still waiting for. It reads the head afresh each poll, so a push during the
   wait is followed. Do not poll `gh pr checks` by hand: right after a push it
   can report the previous run. On 0,
   `gh pr merge <n> --squash --delete-branch`: the guard runs the policy again
   and either merges or prints what it is waiting for (a reviewer, an unanswered
   finding, or the owner). Act on that; never retry with other flags or the API.
   If the branch becomes conflicting after green, merge main once and re-run; if
   still conflicting, stop and report. When the merge exits 1 with "Reference
   does not exist", GitHub's auto-delete removed the branch first and the merge
   still happened: confirm with `gh pr view <n> --json state`. Every policy run
   also writes the PR's status: the labels `needs-owner` or `agent-merges` plus
   `risk:<tier>`, the owner assigned when parked, and one `## Shipping policy`
   comment kept current. Never set those by hand.
9. **After merge/deploy (if allowed):** confirm `/health` reports the merge sha
   on the deployed origin.

Repeat 2–8 until CI is green and valid review feedback is cleared.

## AI reviewers

Installed as GitHub Apps (listed in `docs/contributing/external-services.md`);
they need no files in the repo.

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
  `docs/contributing/gotchas.md` and earlier PR threads), encode it in this PR:
  a checker or test first, a gotcha line only if no cheap checker exists.

## Gates are not CI

A soak, calendar gate, or rollout window ends the run. Schedule a wake-up; do
not sleep-poll.

## Wrap-up

- Add any new trap to `docs/contributing/gotchas.md`.
- Final summary to the owner:
  - a human headline of the change (not "ship repo#12");
  - risk, difficulty (Easy/Medium/Hard), and exactly one status:
    - `Shipped` — merged (and deployed where that applies), with the link;
    - `Needs you: <the one action>` — the policy parked it; quote its
      `Merge needs the user (…)` line and give the command, for example
      `gh pr merge <n> --squash --delete-branch`;
    - `Blocked: <what is waited on>` — something outside this run (a reviewer
      app, a failing external service, a decision you need from the owner);
  - model used and cost, **only** when the platform reports them;
  - what was verified, and links to the PR and any deployed pages.

  The PR carries the same status (labels, assignee, the `## Shipping policy`
  comment), so the owner can trust either surface. Never invent URLs, costs, or
  model names.
