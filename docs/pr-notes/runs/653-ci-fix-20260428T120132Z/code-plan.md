# Code Plan

## Implementation
1. Update `tests/smoke/admin-invite-redemption.spec.js` `TEAM_ACCESS_STUB`.
2. Add `normalizeStreamVolunteerEmailList(streamVolunteerEmails)` export.
3. Delegate to `normalizeAdminEmailList` to keep normalization behavior aligned for the test fixture.

## Files
- `tests/smoke/admin-invite-redemption.spec.js`

## Validation
Run the targeted admin invite smoke spec. If the local preview server cannot be started, run the smallest available static/unit validation and report the blocker.
