# Requirements analysis

## Required behavior

- Treat the intended Firebase Functions target list as an all-target contract.
- Succeed only when every intended target has explicit complete evidence.
- Fail closed when any intended target is absent or incomplete.
- Identify every incomplete target in the failure metadata.
- Preserve production orchestration, retry handling, and Hosting validation.

## Root cause

The aggregate verifier rejects an empty first-attempt evidence array before it compares evidence with the authoritative intended-target set. The generic array-shape error is nonzero, but it does not identify the incomplete intended targets.

## Regression requirements

- Retain coverage proving complete evidence for all targets succeeds.
- Add coverage proving an empty evidence set fails with every intended target identified in expected order.
