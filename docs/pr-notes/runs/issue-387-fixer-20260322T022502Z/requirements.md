Objective: prevent stale roster-image state from surviving Bulk AI cancel in Edit Roster and cover that behavior with browser automation.

Current state:
- Coaches can cancel after reviewing proposed AI changes.
- Cancel clears proposed operations and text only.
- The previously uploaded image remains selected and previewed.
- A later AI run can silently reuse that stale image.

Proposed state:
- Cancel behaves like a workflow reset for Bulk AI input state.
- Proposed changes, text input, image file selection, and image preview are all cleared.
- A subsequent AI run with no new text or image is blocked with the existing empty-input alert.

Risk surface and blast radius:
- Workflow scope is limited to `edit-roster.html` Bulk AI update.
- User-facing risk is stale roster data being reprocessed and applied after a coach believes they reset.
- No backend contract changes are required.

Assumptions:
- Existing UX intent is that Cancel abandons the current AI draft, not only the proposed operations list.
- Reusing the existing remove-image semantics is preferable to duplicating divergent reset behavior.

Recommendation:
- Add a browser test that reproduces stale-image reuse and asserts full reset semantics.
- Implement a single helper that clears image and text state, and call it from Cancel and post-apply reset paths.

Success measure:
- Automated browser coverage fails on old behavior and passes once cancel clears file and preview state.
