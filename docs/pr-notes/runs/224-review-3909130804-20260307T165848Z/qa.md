# QA Role Summary

Thinking level: medium

## Test Focus
- Rule math with mixed rewards and penalties under a cap.
- Rendered incentives HTML escaping.
- Panel failure mode when aggregated stat reads reject.
- No regression in existing parent incentives pure-function coverage.

## Minimum Validation
- `npm test -- tests/unit/parent-incentives.test.js`
- Manual review of `firestore.rules` conditions for create, update, delete, and read on both incentive subcollections.

## Regression Risks
- Cap save/remove flow must still work after adding `teamId`.
- Any HTML escaping fix must not double-escape normal content.
- Error handling must not leave stale earnings chips implying success.
