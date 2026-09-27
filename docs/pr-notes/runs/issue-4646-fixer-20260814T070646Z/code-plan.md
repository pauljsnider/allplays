# Patch Plan

1. Add the typed native page cursor.
2. Preserve page metadata in a chat-specific native REST page reader.
3. Emit native cursor state from polling and include it in deduplication.
4. Route typed native cursors through REST and web snapshots through the SDK.
5. Return replacement cursors with older-page results.
6. Track pagination cursor separately in the hook and merge through existing ID-deduplicating chronological logic.
7. Add focused service and hook regressions, then typecheck.

# Code Changes Applied

None during role analysis. Only the main run edits.

# Validation Run

Role performed read-only source and test inspection.

# Residual Risks

Latest-page polling must not overwrite an older-page cursor; page tokens require URL encoding; exact-50 terminal pages cannot use count-based completion; cursor context must reject cross-conversation reuse.

# Commit Message Draft

Paginate native chat history (#4646)
