Current state:
- The page-level ES module import relies on query-string cache busting.
- Auth redirect coordination buffers a user while redirect processing is active, then consumes that buffer afterward.

Proposed state:
- Increment the `login-page.js` query version to force browsers to fetch the module containing the new export surface.
- Treat a falsy auth callback as authoritative and clear any buffered user before returning.

Tradeoff:
- Minimal fix with no API shape changes and no redirect flow refactor.
- This preserves existing behavior except for the stale-user edge case.
