# Code Plan

## Root Cause

The exact combined function evidence shape is hard-coded as exclusively `updated`. The shape gate rejects `unchanged` before its artifact and deployment identities can be validated.

## Minimal Patch

1. Generalize the combined field set and shape predicate from updated-only to authoritative result evidence.
2. Permit only `updated` and `unchanged` statuses on that combined shape.
3. Reuse the existing validation and matching of both `artifactSha` and `deploymentId`.
4. Continue requiring `current` for the two single-identity shapes.

## Tests

Add a complete unchanged fixture and acceptance assertion, plus explicit rejection of artifact-only and deployment-only unchanged evidence and identity mismatches. Run only the focused verifier unit file.
