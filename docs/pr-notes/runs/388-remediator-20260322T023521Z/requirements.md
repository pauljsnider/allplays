Objective: address PR #388 review thread `PRRT_kwDOQe-T58517zDQ`.

Thinking level: low. The feedback is narrow and localized to the bulk apply success path.

Current state:
- `edit-roster.html` always calls `resetBulkAiDraftState()` after the apply loop.
- Partial failures increment `errorCount` and still clear the uploaded image and pasted text.

Required state:
- Only a fully successful apply clears the bulk-AI draft inputs.
- Partial failures must preserve the source draft so the coach can retry without re-uploading or re-pasting.

Assumptions:
- Preserving the draft is sufficient even if proposed operations are cleared.
- No other review feedback in this PR requires broader workflow changes.
