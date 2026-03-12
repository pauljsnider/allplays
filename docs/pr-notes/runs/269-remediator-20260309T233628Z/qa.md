Validation plan:
- Run the focused parent membership unit tests with Vitest.
- Manually reason through Firestore membership request transitions after the rules change:
  - pending -> approved by owner/admin remains allowed
  - pending -> denied by owner/admin remains allowed
  - denied -> pending by requester is no longer allowed

Expected outcomes:
- Approval throws when requester already has a matching parentOf link.
- Existing helper tests still pass and the new duplicate-link guard test passes.
