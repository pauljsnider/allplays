# Architecture assessment

## Evidence contract

The expected Functions list is the authoritative completeness set. Current deployment evidence is an observation set and may be empty, so cardinality validation must not short-circuit intended-target reconciliation.

## Minimal design

- Allow an empty current aggregate evidence array.
- Preserve strict entry validation, duplicate rejection, unexpected-target rejection, and the non-empty expected-target contract.
- Keep evidence keyed by `[projectId, functionTarget]`.
- Use the existing expected-order walk to report every unmatched target through `firebase-functions-incomplete-targets`.

No workflow, retry-artifact, previous-evidence, or Hosting behavior changes are needed.
