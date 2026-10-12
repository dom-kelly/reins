# Project intent

Fill this in with `/reins:new-product` before writing product code. Agents read
this to decide whether a proposal is in scope. Keep it under one page.

## Product

One paragraph: what it is and the problem it removes.

## Users

Who uses it, and the one job each user type hires it for.

## Outcomes

Three to five falsifiable outcomes that mean the product is working. Prefer "a
new user can X within Y minutes" over "users love it".

## Scope

What is in. Name the core primitives (see
[architecture/primitives.yaml](./architecture/primitives.yaml)).

## Non-goals

What is deliberately out, so agents stop proposing it. Durable "no" decisions
also get a [decision record](./decisions/index.md).

## What not to assume

Things an agent might reasonably infer that are wrong for this product (for
example "examples in the docs are the full feature set", "every user is an
admin", "we will add a chat UI").

## Agent guidance

How agents should behave when intent is unclear: which doc or decision wins,
when to stop and ask, and which proposals to never make without the owner.

## Constraints

Hosting, budget, compliance, data residency, stack choices that are fixed.
