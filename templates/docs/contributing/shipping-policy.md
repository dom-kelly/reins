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
it valid; a sha that is not on the branch does not count). `owner` tiers are
unaffected. `policy.independentReview: false` switches it off.

Always: not a draft, targets `main`, no test file deleted, no other check red or
pending (except `reviewers.ignoreChecks`). `gh pr merge --admin|--auto` and
merging through the API are refused outright.

## Waiting for the verdict

`npx reins policy <pr> --wait` polls every 20 seconds while the verdict waits on
something that may still arrive: a check still running or not yet reported on
the current head, a gate or required reviewer that has not spoken, the
independent review comment. It reads the head afresh each poll, so a push during
the wait is followed. It then prints the verdict as usual: exit 0 may merge, 2
refused, 1 gave up after `--timeout <seconds>` (default 20 minutes), saying what
it was still waiting for. Prefer it to polling `gh pr checks`, which can report
the previous run right after a push.

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
	"independentReview": true,
	"reviewers": {
		"gate": [{ "check": "Cursor Bugbot", "login": "cursor" }],
		"required": ["coderabbitai", "devin-ai-integration"],
		"ignoreChecks": ["CodeRabbit"]
	}
},
"hooks": {
	"stopGate": "validate",
	"typecheck": "typecheck",
	"typecheckIgnore": ["app/generated/"]
}
```

`hooks.stopGate` is what the Claude Code Stop hook runs; it defaults to
`policy.gate` and should finish in about a minute. `hooks.typecheck` is what the
typecheck hook runs after a TypeScript edit (default `typecheck`), and
`hooks.typecheckIgnore` lists path prefixes it leaves alone
([harness-engineering.md](./harness-engineering.md), agent guardrails).

With no `reviewers`, medium and high need only the gate; add reviewers as the
GitHub Apps are installed ([external-services.md](./external-services.md)).

## Asking

When the policy parks a PR, the agent stops with everything ready, says which
rule applied, and links the PR. The owner reviews and merges.
