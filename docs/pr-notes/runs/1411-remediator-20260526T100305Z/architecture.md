## Current-State Read

PR #1411 adds media-type filter chips to legacy `js/team-media.js`. The review issue is valid: the item reorder click handler builds its reorder list from `getFilteredItems(getItemsForFolder(...))` when a filter is active.

`reorderTeamMediaItems(teamId, itemIds)` writes `order = index` for only the provided IDs. If the caller sends only photos/videos/files, hidden sibling items keep prior `order` values. That can create duplicate `order` values and unstable `sortByMediaOrder(...)` results after switching back to **All** or reloading.

## Proposed Design

Use filtering only for rendering.

Minimal decision:

- Keep `getFilteredItems(...)` for display counts, empty states, and card rendering.
- In the reorder handler, compute reorder against `getItemsForFolder(folderId)` without the media-type filter.
- Pass the full reordered folder item ID list to `reorderTeamMediaItems(...)`.

Recommended minimal handler shape:

```js
const items = getItemsForFolder(itemButton.dataset.folderId);
const reordered = moveInArray(items, itemButton.dataset.itemId, itemButton.dataset.itemMove);
persistAndReload(
    () => reorderTeamMediaItems(state.teamId, reordered.map((item) => item.id)),
    'Item order saved.'
);
```

This restores the original persistence contract: item ordering is album-scoped, not filter-scoped.

## Files And Modules Touched

Required:

- `js/team-media.js`
  - Change the reorder click handler to use the full folder list.
  - No Firestore schema, rules, or storage changes.

Recommended test coverage if updating tests:

- `tests/unit/team-media-page.test.js`
  - Add/adjust coverage proving filtered views do not send partial reorder IDs.

## Data/State Impacts

- No data model change.
- No migration required.
- Existing duplicate/unstable `order` values caused by prior filtered reorders may remain until a full album reorder writes all item orders again.
- Future reorders should preserve a single deterministic order sequence across all media types in the album.

## Security/Permissions Impacts

- No permission boundary change.
- Existing `state.canManage` guard remains the control for reorder actions.
- No Firebase rules changes required.
- No additional reads/writes beyond the existing reorder batch pattern.

## Failure Modes And Mitigations

- **Filtered reorder feels visually odd:** With a filter active, an item may move relative to hidden siblings, so the visible filtered order might not change as expected. Mitigation: acceptable for minimal fix, or optionally hide/disable reorder buttons unless filter is **All**.
- **Existing duplicate order data remains:** Prior bad writes may have already created duplicate orders. Mitigation: any full album reorder normalizes all provided IDs back to `0..n`.
- **Regression risk:** Low. This reverts reorder persistence to the pre-filter album-level behavior while preserving filter rendering.
- **Rollback:** Revert the `js/team-media.js` handler change. No schema or data rollback required.
