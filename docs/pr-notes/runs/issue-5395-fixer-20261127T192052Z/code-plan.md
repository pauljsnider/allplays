# Code plan

## Root cause

`verifyFunctionDeployments` permits an empty current evidence array only when `previousEvidence` exists. On a first attempt, the indexer throws a generic non-empty-array error before the intended-target walk can identify all missing targets.

## Minimal patch

1. Add a focused aggregate regression for `verifyFunctions([], expectedDeployments)`.
2. Always allow the current aggregate evidence array to be empty during indexing.
3. Leave expected-target, previous-evidence, individual-function, Hosting, and workflow behavior unchanged.
4. Run the focused verifier unit test file.
