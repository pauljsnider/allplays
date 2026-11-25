# QA analysis

## Prevention-oriented matrix

| Scenario | Expected result |
| --- | --- |
| Exact expected project/site, site release complete, and final deploy complete | Accept normalized Hosting evidence |
| Upload/finalize/releasing progress without final summary | Reject |
| Site release complete without final deploy summary | Reject |
| Final deploy summary without site release complete | Reject |
| Generic, wrong-typed, padded, or partial summaries | Reject |
| Wrong project/site or mixed Function fields | Reject |
| Existing individual and aggregate Function evidence | Continue to pass unchanged |

## Regression strategy

The positive dedicated Hosting test fails before the fix because there is no supported Hosting contract. The missing-final-summary test captures the current false-positive class by proving progress or release output cannot substitute for terminal deployment completion. Assertions should compare the exact normalized accepted object and use exact summary matching rather than substring checks.

## Focused validation

`npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose`

## Recurrence risk

Medium before the guard because Firebase CLI output is multi-stage and several progress lines contain success-like language. Exact dual-terminal evidence reduces the code-level risk to low.
