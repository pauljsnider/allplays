# Architecture

- Keep the fix local to `track-statsheet.html` page state.
- Track the last uploaded `File` object and URL in memory.
- Initialize the cached URL from `currentGame.statSheetPhotoUrl` after game load.
- On Apply, upload only when the selected `statSheetFile` differs from the last uploaded file; otherwise reuse the cached/current game URL.
- After upload succeeds, cache the URL before Firestore commit so retry after commit failure does not duplicate upload.
- No Firestore schema, security rule, or Storage path changes.
