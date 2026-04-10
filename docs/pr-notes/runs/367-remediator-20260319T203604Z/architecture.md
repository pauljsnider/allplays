Decision: use the existing query-string cache busting pattern rather than altering module structure or adding runtime fallbacks.

Why this path:
- The failure mode is browser cache incoherence between importing modules and the helper module URL.
- Bumping the helper URL forces a fresh fetch of the updated exported surface with minimal code change.

Controls:
- No data model, auth, or Firestore behavior changes.
- Equivalent or better operational control because cached clients converge immediately to the updated helper.

Rollback: revert the import token change if needed.
