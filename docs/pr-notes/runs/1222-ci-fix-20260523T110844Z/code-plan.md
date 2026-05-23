# Code plan

1. Remove static Firebase App and Firebase AI imports from `edit-roster.html`.
2. Add a cached `loadBulkAiModules()` helper that lazy-loads those modules and preloads them when the Bulk AI tab opens.
3. Use the cached modules inside the Bulk AI process handler.
4. Validate the failing smoke specs from a static server rooted at the current worktree.
