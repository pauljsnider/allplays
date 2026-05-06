# Code role notes

## Implementation Plan
- In `js/premium-entitlements.js`, remove the blanket `revokedAt === undefined` rejection and only reject malformed `revokedAt` when the field is present.
- In team scope validation, compare normalized `data.seasonId` to `currentSeasonId` and reject missing/wrong season.
- Pass `currentSeasonId` through `readTeamPremiumEntitlement`, defaulting in the validator.
- In `firestore.rules`, restrict raw team entitlement reads to owner/admin/global admin only.
- Update `tests/unit/premium-entitlements.test.js` for the corrected logic.
