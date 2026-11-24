# Architecture Analysis

Treat `unchanged` as a distinct authoritative result, not an alias for `current`.

## Evidence Contract

- `current`: retain the existing exact artifact-only or deployment-only shapes.
- `updated`: retain the exact combined artifact-and-deployment shape.
- `unchanged`: require that same combined identity shape with the explicit `unchanged` status.

The combined shape proves both the intended commit and the authoritative deployed function identity. Exact-key checks continue to reject missing, mixed, or extra metadata.

## Root Cause

The verifier currently derives status solely from shape: the combined shape means `updated`, while either single identity means `current`. That mapping leaves no explicit path for authoritative unchanged evidence.

## Compatibility

No application/Hosting evidence, quota, retry, aggregate validation, or workflow behavior changes.
