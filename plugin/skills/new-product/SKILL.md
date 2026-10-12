---
name: new-product
description: >
  Bootstrap a new product on the reins harness: interview the owner, fill
  project-intent, reshape the primitives map, record the first decisions, choose
  the stack, and plan the first vertical slices. Use when the user says "new
  product", "start an app", "I want to build X", or the project-intent doc is
  still the template.
---

# New product

Turn an idea into a steerable repo before any product code exists. The output is
docs and a plan; implementation starts only after the owner approves.

## 1. Interview (one round, batched)

Ask only what you cannot infer. Batch into a single question set:

- Who is the user and what job do they hire this for?
- What does "working" look like in 4 weeks? (falsifiable outcomes)
- Fixed constraints: hosting, budget, auth, data sensitivity, deadlines.
- Explicit non-goals.
- Stack preference, or "recommend one".

## 2. Write intent

Fill `docs/contributing/project-intent.md`. Keep it to one page. Put the
one-line product summary at the top of `CLAUDE.md`.

## 3. Choose the stack

If the owner has no preference, use `/reins:review-and-recommend`: 2–3 stacks
with effort and one-way/two-way door labels, one recommendation. Stop for a
choice. Record the chosen stack's one-way-door aspects as a decision record.

## 4. Shape primitives

Rewrite `docs/contributing/architecture/primitives.yaml` with 4–8 primitives
(entry points, auth, core domain objects, storage, jobs). Give each a `code`
root (create empty directories with a stub module if needed), a `docs` link, and
`invariants` for anything that must never break (for example per-user data
isolation).

## 5. Record the noes

For each non-goal an agent would plausibly re-propose, add a decision record
(see `docs/contributing/decisions/index.md`).

## 6. Adapt the harness to the stack

- Replace `src/` with the real app skeleton; keep `/health` returning the sha.
- Update the `dev` script and the `code` roots in `primitives.yaml`; keep every
  check in `validate`.
- Add stack-specific checkers only when they encode a rule that was broken
  (`docs/contributing/growth.md`).

## 7. Plan slices

Propose 3–6 thin **vertical** slices (each user-visible, independently
shippable, with a falsifiable done check). Mark which can run in parallel by
file ownership. Stop and wait for approval.

## Done

`npm run validate` is green, intent and primitives are filled, at least one
decision record exists beyond the defaults, and the slice plan is approved.
