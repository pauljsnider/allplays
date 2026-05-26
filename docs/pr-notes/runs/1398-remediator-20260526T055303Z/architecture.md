# Architecture

- Keep filtering local to `loadPendingAdminInvites` so the Staff & Permissions view model receives only displayable pending invite records.
- Support Firestore timestamp shapes already used by access-code validation: `toMillis()`, `Date`, and numeric milliseconds.
- No schema or query/index changes; blast radius is limited to the React team detail service pending-invite read path.
