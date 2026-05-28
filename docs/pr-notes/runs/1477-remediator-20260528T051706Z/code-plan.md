# Code role notes

## Implementation plan
- In `TeamMedia.tsx`, replace delete-time `setLoading(true/false)` with `deletingItemId` state.
- Pass `currentUserId` and per-card `deleting` to `TeamMediaItemCard`.
- In `TeamMediaItemCard`, render delete when `canManage` is true or when the current user owns a photo/file item.
- Disable only the matching delete button and show an inline spinner/text while that item is deleting.
- In `tests/smoke/app-parent-tools.spec.js`, add `uploadedBy` to the mocked photo, capture delete calls, and assert owner delete plus non-blocking UI.
