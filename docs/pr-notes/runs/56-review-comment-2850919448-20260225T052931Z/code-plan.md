# Code Role

## Objective
Patch rules minimally to satisfy review finding with explicit evidence.

## Plan
1. Add `isRideshareOfferOpen(teamId, gameId, offerId)` helper in `firestore.rules`.
2. Replace inline offer status check in `requests` create rule with helper call.
3. Run lightweight validation command for rules syntax/deployability.
4. Commit and push to `feat/issue-53-rideshare`.

## Why This Patch
- Smallest safe change.
- Keeps lifecycle authority in rules (not UI-only).
- Improves readability and future reuse.
