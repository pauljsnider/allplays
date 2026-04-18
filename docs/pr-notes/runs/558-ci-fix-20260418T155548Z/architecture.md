# Acceptance Criteria
- The parent dashboard calendar day modal test remains valid regardless of the current date.
- The shared-game modal still renders merged child RSVP controls and refreshed summary state for the selected game day.
- No production behavior changes.

# Architecture Decisions
- Treat this as a brittle unit-test fixture issue, not an application regression.
- Freeze test time before the hard-coded event date so the dashboard's existing upcoming-event cutoff logic continues to include the fixture.
- Keep the fix scoped to the failing test file only.

# Risks And Rollback
- Risk is low because the change only affects test runtime clock state within one test.
- Rollback is a single-file revert of the timer setup if a better fixture strategy is chosen later.
