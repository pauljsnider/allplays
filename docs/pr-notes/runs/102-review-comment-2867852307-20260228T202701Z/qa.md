# QA Role Output

## Risk Matrix
- High: incorrect boundary comparison allows redemption at exact expiration timestamp
- Medium: regression in code validity window interpretation
- Low: unrelated auth or tracker flows

## Automated Tests To Add/Update
- Existing boundary helper tests already cover equality-expired behavior (`tests/unit/access-code-utils.test.js`).
- No new test added in this patch because change is single-line in `db.js`; validate via targeted unit test and code inspection.

## Manual Test Plan
- Validate a code just before expiration: valid
- Validate exactly at expiration timestamp: expired
- Validate after expiration: expired

## Negative Tests
- Invalid code remains invalid
- Used code remains blocked
- Missing `expiresAt` behavior unchanged

## Release Gates
- Targeted unit tests pass
- Diff limited to boundary condition in access-code validation

## Post-Deploy Checks
- Monitor support feedback for invite redemption near expiration boundaries
- Spot-check one production-like code at boundary timestamp in staging/manual environment
