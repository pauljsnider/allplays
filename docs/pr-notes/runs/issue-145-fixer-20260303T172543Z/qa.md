# QA Role Synthesis

## Test strategy
- Add/extend unit test in invite processor suite to validate one-time semantics in admin path.
- Ensure failing path asserts exact user-visible error (`Code already used`).

## Regression scope
- Admin invite via accept-invite processor (covers URL and manual input callsites).
- Existing invite tests should remain green to guard parent invite behavior.

## Exit criteria
1. New/updated unit test fails without fix and passes with fix.
2. Invite-related test suite passes locally.
