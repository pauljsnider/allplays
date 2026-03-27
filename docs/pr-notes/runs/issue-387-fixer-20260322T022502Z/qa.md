Coverage target:
- Browser-level workflow for Edit Roster Bulk AI Update cancel/reset.

Planned assertions:
- Uploading an image shows the preview.
- Processing mocked AI output renders the proposed changes section.
- Cancel hides proposed changes and clears text input, file input, and preview state.
- Re-processing without new text or image shows the empty-input alert and does not invoke AI again.
- A fresh text-only run after cancel sends text only, proving stale image state is gone.

Validation commands:
- `python3 -m http.server 4173`
- `./node_modules/.bin/playwright test tests/smoke/edit-roster-bulk-ai-reset.spec.js --config=playwright.smoke.config.js --reporter=line`

Residual risk:
- This test covers cancel/reset semantics, not the full apply mutation matrix for add/update/delete operations.
