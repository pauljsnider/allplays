# Architecture Notes

## Decisions
- Keep the remediation local to `edit-team.html` and static wiring tests.
- Import and read `getUserProfile` during auth initialization, before the rollover picker can load eligible teams.
- Use `currentUser.email || currentUserProfile?.email || ''` as the access email for `getUserTeamsWithAccess` to preserve existing profile-email fallback behavior.
- Track roster preview requests with a monotonically increasing `rosterRolloverPreviewRequestId`.
- A preview fetch may update UI only when its captured request id is still current and the select value still equals the fetched source team id.

## Risk and rollback
- Profile lookup failure falls back to auth email and logs a warning, preserving existing behavior for standard accounts.
- Stale fetches are not canceled, but their UI side effects are discarded.
- No Firestore rules, data model, or persistent write behavior changes.
- Rollback is a single-file revert plus related test-note revert if needed.
