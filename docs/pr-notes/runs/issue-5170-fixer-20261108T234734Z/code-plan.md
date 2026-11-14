# Minimal implementation plan

1. Import `Modal` and `revokeParentHouseholdMemberAccess` into `HouseholdInviteTool`.
2. Add selected/failed membership state and a dedicated revoke async operation.
3. Derive active and pending lists; omit removed records.
4. Add a mobile-sized membership card with organizer-only revoke control.
5. Confirm with caregiver and player names.
6. On success, refresh and only then show success; on failure, retain cards and expose retry.
7. Keep revocation outside the premium invitation gate.
8. Extend focused Parent Tools tests; retain existing service-boundary regression tests.
