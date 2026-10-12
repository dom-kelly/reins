## Intent

<!-- The goal of this change: what it is for, not how it works. -->

**Door:** `two-way` | `one-way`
<!-- Keep exactly one. one-way = expensive to undo (stored shapes, public contracts, deleted data, auth). -->

**Change:** `composes` | `extends` | `adds`
<!-- Keep exactly one (docs/contributing/architecture/primitives.yaml): composes = wires existing
     primitives; extends = changes a primitive's behaviour or shape; adds = a new primitive, added to the map in this PR. -->

**Cleanup:** `none` | `needed` | `done`
<!-- needed = something to remove later; say what and when it is ready. -->

## Why

<!-- Why it is needed now. -->

## Summary

<!-- What changed. Short bullets. -->

## Primitives

<!-- Paste `npx reins classify` and say how each listed invariant still holds. -->

## Testing

<!-- Commands run and results (validate, targeted tests, verify-app evidence). -->
