Current state:
- Resume logic is split between `js/live-tracker.js` as the caller and `js/live-tracker-resume.js` as the pure helper.

Proposed state:
- Keep the helper unchanged.
- Expand the persisted clock payload at the call site so the helper can exercise its existing legacy fallback path.

Why this path:
- Smallest viable change.
- Preserves existing controls and behavior for modern fields.
- Avoids duplicating normalization logic in the helper or changing unrelated resume flows.
