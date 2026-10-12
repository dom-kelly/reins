# Shipping policy

Merging to `main` is the moment a change reaches everyone (and, in a deployed
product, production). The owner sets this policy in `reins.json` → `policy`;
`npx reins policy <pr>` applies it and the guard hook runs it on every
`gh pr merge`, so an agent cannot merge past it. Agents never widen it on their
own.

## Risk

Risk is the highest of three things:

1. **What the PR declares** in its **Change:** line — `composes` (wires existing
   primitives) = low, `extends` (changes a primitive's behaviour or shape) =
   medium, `adds` (a new primitive) = high.
2. **The floor** of every primitive the diff touches
   ([primitives.yaml](./architecture/primitives.yaml); `npx reins classify`
   lists them). A renamed file counts under both its paths. An unmapped file is
   high.
3. **The Door** — `one-way` is always high.

A diff that touches a primitive's `invariants` says how each one still holds.

## Tiers (kody's)

| Risk       | Before merging                                                          | Who merges (default)   |
| ---------- | ----------------------------------------------------------------------- | ---------------------- |
| **Low**    | The gate check is green                                                 | agent                  |
| **Medium** | + every `reviewers.gate` check passed and its findings addressed        | agent                  |
| **High**   | + every `reviewers.required` login has reviewed the current head commit | owner (agent parks it) |

`policy.authority` changes who merges per tier. A repo whose merges deploy
nothing can let agents merge high risk; a repo whose merges deploy to production
should keep the owner there.

When an agent is the one merging medium or high, the PR also needs the
independent review that `ship-pr` posts: an issue comment whose first line is
`## Independent review` and which has a line `head: <sha>` naming the current
head or an earlier commit of the branch (so fixes pushed after the review keep
it valid; a sha that is not on the branch is refused). `owner` tiers are
unaffected. `policy.independentReview: false` switches it off.

Always: a PR of this repo (a PR URL from another repo is refused: run the policy
and the merge from that repo), not a draft, targets `main`, a body with exactly
one `**Door:**` and one `**Change:**` line as the PR template has them (the
`Cleanup:` line is for the reader), no test file deleted, no other check red or
pending (except `reviewers.ignoreChecks`). `gh pr merge --admin|--auto` and
merging through the API are refused outright.

## Waiting for the verdict

`npx reins policy <pr> --wait` polls every 20 seconds while the verdict waits on
something that may still arrive: a check still running or not yet reported on
the current head, a gate or required reviewer that has not spoken, the
independent review comment. It reads the head afresh each poll, so a push during
the wait is followed, and a `gh` call that fails mid-wait is retried a few times
before it counts. A failed check, or a review comment that names a wrong commit,
is refused at once. It then prints the verdict as usual: exit 0 may merge, 2
refused, 1 gave up after `--timeout <seconds>` (default 20 minutes), saying what
it was still waiting for. Prefer it to polling `gh pr checks`, which can report
the previous run right after a push.

## Status on the PR

Every evaluation (`npx reins policy`, `--wait`, and the guard on `gh pr merge`)
writes the verdict to the PR, so the owner reads GitHub rather than the agent's
terminal:

- **Labels.** Exactly one of `needs-owner` (the owner merges: the tier's
  authority is `owner`, whether the PR is green yet or still waiting on CI or a
  reviewer) or `agent-merges` (the agent finishes it: allowed, waiting, or
  refused with something the agent must fix), plus `risk:low|medium|high` once
  the risk is known. A label the repo lacks is created when first needed; one it
  already has is used as it is, and other labels are never touched. Filter the
  PR list on `needs-owner` to see what is yours.
- **Assignee.** A parked PR is assigned to `policy.owner`, or to the repo owner
  when the repo belongs to a user. An organisation repo needs `policy.owner`
  set, else nobody is assigned.
- **One comment**, first line `<!-- reins:policy -->`, heading
  `## Shipping policy`, saying who acts and why, with the merge command when
  parked. It is updated in place, never duplicated, and only when the text
  changes.

The policy is the only writer. Agents and owners do not set these by hand; a
write that fails is reported as `policy: could not write PR status (…)` and
never changes the verdict (the other writes still run, and under `--wait` the
line is repeated with the final verdict, whichever poll it happened on).
`policy.publish: false` switches the writes off; `--no-publish` does so for one
run. The agent's final summary uses the same vocabulary: `Shipped`,
`Needs you: <action>`, or `Blocked: <what>`.

## After merge

The head branch does not outlive the PR: the guard requires `--delete-branch` on
`gh pr merge`, and the merged-branch workflow
(`.github/workflows/merged-branch.yml`) deletes the branch of any merged PR,
however it was merged.

## Where the policy reads from

`reins.json` and `primitives.yaml` are read from `origin/main`, never from the
PR's own checkout, so a PR cannot lower its floors or change who may merge it;
such a change takes effect only after it is merged under the current rules.

## Review findings

A thread opened by a login in `reviewers.findingsFrom` counts as addressed when
it is resolved, or when a reply says `Fixed in <sha>: <what changed>` (at least
seven hex characters) or `wontfix: <reason>`. This is an honour system: the
policy checks the words, not the diff. Reviewers not listed are read and handled
on merit but do not block.

The owner's own review threads count too: `policy.owner`, or the repo owner when
the repo belongs to a user, is added to the default `findingsFrom`
(`policy.ownerFindings: false` turns this off; an explicit `findingsFrom` list
replaces the default). So a comment the owner leaves on a PR is answered before
an agent merges medium or high, not merely read. When nothing names the owner
and the lookup fails, the policy refuses rather than quietly dropping those
findings, and `--wait` retries it.

The independent review comment (`## Independent review`, `head: <sha>`) works
the same way: the policy checks that a review of a commit on the branch was
posted, not its quality. Findings it raises are fixed and get a
`Fixed in <sha>: <what>` line appended to that comment.

A finding that has come up before gets encoded, not just fixed: see the
enforcement ladder in [harness-engineering.md](./harness-engineering.md).

## Configuration

```json
"policy": {
	"gate": "validate",
	"ciCheck": "validate",
	"authority": { "low": "agent", "medium": "agent", "high": "owner" },
	"enforceOnMerge": true,
	"independentReview": true,
	"publish": true,
	"owner": "your-login",
	"reviewers": {
		"gate": [{ "check": "Cursor Bugbot", "login": "cursor" }],
		"required": ["coderabbitai", "devin-ai-integration"],
		"findingsFrom": [
			"cursor",
			"coderabbitai",
			"devin-ai-integration",
			"your-login"
		],
		"ignoreChecks": ["CodeRabbit"]
	}
},
"hooks": {
	"stopGate": "validate",
	"typecheck": "typecheck",
	"typecheckIgnore": ["app/generated/"]
}
```

`enforceOnMerge: false` stops the guard running the policy on `gh pr merge` (the
command `npx reins policy` still does). `hooks.stopGate` is what the Claude Code
Stop hook runs; it defaults to `policy.gate` and should finish in about a
minute. `hooks.typecheck` is what the typecheck hook runs after a TypeScript
edit (default `typecheck`), and `hooks.typecheckIgnore` lists path prefixes it
leaves alone ([harness-engineering.md](./harness-engineering.md), agent
guardrails).

With no `reviewers`, medium and high need only the gate plus, when an agent
merges, the independent review comment; add reviewers as the GitHub Apps are
installed ([external-services.md](./external-services.md)).

Every reviewer named in `reviewers` must actually be installed on the repo: the
list is declared, never discovered. `npx reins doctor` reports any gate check,
required or `findingsFrom` login that has never run on the repo (it reads the
check runs, reviews and comments of the last 20 PRs), and the policy refuses
rather than waits for a gate check or required reviewer that has never run, so
`--wait` returns at once instead of sitting out its timeout on an app that is
not there. With fewer than three PRs there is too little history to judge and
the policy waits as usual. The first PR after an app is installed is refused the
same way until the app's check or review appears on it; run the policy again
then.

## Asking

When the policy parks a PR, the agent stops with everything ready, says
`Needs you: <action>` with the rule that applied, and links the PR. On GitHub
the PR is labelled `needs-owner`, assigned to the owner and carries the
`## Shipping policy` comment with the merge command. The owner reviews and
merges, or comments what to change: that comment is a finding the agent must
answer.
