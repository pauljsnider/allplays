# QA Plan

## Regression Coverage

Add a unit-level source assertion in `tests/unit/team-media-page.test.js` that the item move handler uses `getItemsForFolder(itemButton.dataset.folderId)` directly and does not use `getFilteredItems(getItemsForFolder(...))` for persistence.

## Manual Scenario

1. Open a mixed-media album as a manager.
2. Select Videos.
3. Move a video up or down.
4. Switch back to All.
5. Confirm photos, videos, and files remain in one deterministic order without dropped IDs or duplicate order collisions.

## Test Commands

```bash
npx vitest run tests/unit/team-media-page.test.js --reporter=verbose
npx vitest run tests/unit/team-media-page.test.js tests/unit/app-parent-tools-integration.test.jsx --reporter=verbose
```
