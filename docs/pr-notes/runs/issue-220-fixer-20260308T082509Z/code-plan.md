# Code Role (fallback synthesis)

## Plan
1. Create `tests/unit/shared-games.test.js` with failing coverage for projection and merge behavior.
2. Implement `js/shared-games.js` with synthetic ID encoding, projection, and merge helpers.
3. Wire `js/db.js` game helpers to include shared games in `getGames` and resolve synthetic shared IDs for reads and writes.
4. Run focused tests, then the relevant unit suite slice, and commit with issue reference.

## Non-Goals
- No bulk import UI in this patch.
- No tournament hub page in this patch.
- No Firestore rules migration in this patch.
