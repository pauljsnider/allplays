# QA Role Summary

## Focus Areas
- Regression guardrail: request decision writes must fail without synchronized offer seat update.
- Data-integrity guardrail: request deletes must maintain seat-count correctness.
- Authorization guardrail: parent edits restricted to pending metadata updates.

## Test Strategy
1. Rules parse/deploy check (`firebase deploy --only firestore:rules --project game-flow-c6311`).
2. Targeted rideshare unit test regression (`npx vitest run tests/unit/rideshare-helpers.test.js`).

## Manual Emulator Scenarios (follow-up)
- Attempt direct request `pending -> confirmed` update without offer update: expect deny.
- Attempt delete confirmed request without decrementing offer seats: expect deny.
- Execute app transaction path for status update/delete: expect allow.

## Residual Risks
- No dedicated Firestore emulator rules test harness currently in repo; coverage relies on deploy validation + app/unit behavior.
