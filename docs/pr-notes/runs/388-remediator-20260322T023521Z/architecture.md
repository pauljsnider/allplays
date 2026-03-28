Current state vs proposed state

Current:
- Bulk apply performs N operations, reports counts, then unconditionally clears the bulk-AI draft.

Proposed:
- Keep the existing operation loop and reload behavior.
- Gate draft clearing on `errorCount === 0`.

Risk surface:
- Blast radius is limited to the roster bulk-apply success path in one page.
- No data model, Firebase API, or routing changes.

Recommendation:
- Use the smallest targeted conditional around `resetBulkAiDraftState()`.
