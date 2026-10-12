# Architecture

How the system is shaped. Keep this page short and link to one doc per primitive
as the product grows.

## Primitives taxonomy

[primitives.yaml](./primitives.yaml) is the stable vocabulary for the system's
building blocks. It is **not** a feature changelog.

- Every source file under `src/` must be owned by exactly one primitive's `code`
  root (longest prefix wins). `npx reins check` enforces it.
- Classify a diff against it with `npx reins classify`; `ship-pr` uses this to
  assess risk.
- Update the map only when a change **adds, removes, or reshapes** a primitive.
  Behavior detail goes in the linked `docs`, not in `summary`.
- `invariants` list properties every change must preserve. A diff touching a
  primitive with invariants calls them out in the PR description.

## Request lifecycle (placeholder app)

```mermaid
sequenceDiagram
  participant C as Client
  participant S as src/server.ts
  participant R as src/routes.ts
  C->>S: HTTP request
  S->>R: handle(req, res)
  R-->>C: route handler response, or 404 JSON
```
