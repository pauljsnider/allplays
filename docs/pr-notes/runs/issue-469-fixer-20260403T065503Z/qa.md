Validation target:
- A page-level test should fail against current code because the open day modal does not refresh after RSVP submission.
- After the fix, the same test should prove:
  - `submitRsvp` receives both child IDs.
  - The modal remains open.
  - The selected RSVP button class updates.
  - The rendered RSVP summary updates.

Regression guardrails:
- Keep existing controller tests green to protect list-row and single-child behavior.
- Run the new focused test file plus the existing RSVP controller/unit suite.
