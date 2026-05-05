# QA role notes

## QA Plan
- Unit-test missing `revokedAt` accepts otherwise valid active entitlements.
- Unit-test malformed explicit `revokedAt` rejects.
- Unit-test current-season team entitlements unlock and old-season team entitlements lock.
- Static-check `firestore.rules` to confirm parent team access was removed from `teams/{teamId}/entitlements` raw read rule.
- Run targeted premium entitlement tests, then the unit suite if feasible.
