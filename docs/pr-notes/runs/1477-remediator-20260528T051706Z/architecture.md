# Architecture role notes

## Architecture decisions
- Keep the change local to `TeamMedia.tsx`; no service contract change is required because `TeamMediaItem` already preserves `uploadedBy` via object spread.
- Add a page-level `deletingItemId` state instead of reusing global `loading` so delete refreshes can be non-blocking.
- Compute per-item delete visibility in the card from `canManage`, `currentUserId`, item `type`, and `uploadedBy`, mirroring the legacy `canDeleteTeamMediaItem` owner rule for photos/files.

## Risks and rollback
- Risk: duplicating the permission predicate can drift from `team-media-utils.js`. This is acceptable for a scoped PR remediation, but future cleanup should expose a shared app-safe helper if more React media permissions are added.
- Rollback: revert this commit; the prior page-wide delete behavior and manager-only delete visibility return.
