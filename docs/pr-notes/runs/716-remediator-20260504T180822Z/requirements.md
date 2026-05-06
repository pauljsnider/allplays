# Requirements

## Acceptance Criteria
- Delegated scorekeepers may continue to write scoring fields for active, visible games.
- Delegated scorekeepers must not be able to set `status` to `cancelled`.
- Delegated scorekeepers must not be able to set `liveStatus` to `deleted`.
- Team owners, team admins, and global admins retain existing schedule-level permissions.

## Scope
- Minimal Firestore rules change only.
- No client behavior or data model changes.
