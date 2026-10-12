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

Always: not a draft, targets `main`, no test file deleted, no other check red or
pending (except `reviewers.ignoreChecks`). `gh pr merge --admin|--auto` and
merging through the API are refused outright.

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

A finding that has come up before gets encoded, not just fixed: see the
enforcement ladder in [harness-engineering.md](./harness-engineering.md).

## Configuration

```json
"policy": {
	"gate": "validate",
	"ciCheck": "validate",
	"authority": { "low": "agent", "medium": "agent", "high": "owner" },
	"reviewers": {
		"gate": [{ "check": "Cursor Bugbot", "login": "cursor" }],
		"required": ["coderabbitai", "devin-ai-integration"],
		"ignoreChecks": ["CodeRabbit"]
	}
}
```

With no `reviewers`, medium and high need only the gate; add reviewers as the
GitHub Apps are installed ([external-services.md](./external-services.md)).

## Asking

When the policy parks a PR, the agent stops with everything ready, says which
rule applied, and links the PR. The owner reviews and merges.
