# Code plan

The requested `allplays-code-expert` skill was unavailable, and the required
role subagent failed before execution with no runtime. This fallback analysis
applies the requested minimal-patch implementation role.

1. Add aggregate retry tests before source changes: stable complete results,
   stable partial-quota failure, and authoritative gap filling.
2. Extend the public verifier input with optional `previousEvidence` and reject
   its use outside aggregate function verification.
3. Extract the existing per-attempt target indexing logic so current and prior
   arrays receive identical duplicate, unexpected-target, and identity checks.
4. Resolve each expected target from prior terminal evidence first, then current
   terminal evidence; retain the existing incomplete error otherwise.
5. Delegate selected entries to the existing exact-shape/identity verifier.
6. Run only the adjacent Vitest file, inspect the diff and status, and commit
   source, tests, and role artifacts together for issue #5292.

The roles agree on fail-closed gap handling. The only ordering decision is to
prefer prior terminal evidence, because using the latest observation would
rewrite a previously valid `updated` result as `unchanged` on retry.
