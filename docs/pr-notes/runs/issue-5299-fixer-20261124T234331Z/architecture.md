# Architecture Analysis — Issue #5299

The requested `allplays-architecture-expert` skill was unavailable, so this artifact records the equivalent Firebase architecture review.

## Root cause

The verifier validates only one evidence/expected-target pair and cannot prove complete coverage of an intended Firebase function target set.

## Recommended design

- Extend the existing verifier to accept paired arrays while preserving object behavior.
- Treat expected deployments as the authoritative inventory.
- Match evidence by `(projectId, functionTarget)`, not array order.
- Reject empty inventories, mixed collection/scalar inputs, duplicate identities, missing evidence, and unexpected evidence.
- Delegate each matched pair to the existing single-target verifier.
- Return a frozen result array in expected-target order.

This reuses exact-shape validation for `current`, `updated`, and `unchanged` without broadening Hosting, retry, quota, or workflow behavior.

## Risk

Index-based matching would accidentally make order authoritative. Identity-based exact-set validation is the minimal fail-closed approach.
