Test strategy:
1. Add unit coverage for pure membership-request helpers:
   - stable request ID generation
   - deduplicated parent-link merging
   - approval/denial transition guardrails
2. Add wiring coverage for:
   - parent dashboard request UI and DB helper imports
   - roster approval UI and approval/denial handlers
   - Firestore rules for `membershipRequests`
3. Run focused tests for the new files plus touched related wiring suites.

Primary regression risks:
- Parent dashboard still needs redeem-code flow to work unchanged.
- Roster page must keep existing invite-parent actions intact.
- Firestore rules must not accidentally broaden team write access.

Validation commands:
- `node ./node_modules/vitest/vitest.mjs run tests/unit/parent-membership-utils.test.js tests/unit/parent-membership-request-wiring.test.js tests/unit/team-management-access-wiring.test.js`
