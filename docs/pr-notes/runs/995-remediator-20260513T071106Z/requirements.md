# Requirements

Subagent spawn unavailable in this run, so this is inline role analysis following the orchestrator fallback.

## Acceptance Criteria
- Deleting a single media item updates the local `state.items` cache before re-rendering so the item disappears immediately after delete succeeds, independent of Firestore read timing.
- Selected IDs are cleaned when the deleted item is removed.
- Supported document uploads accept allowed file extensions when browsers provide a blank or generic MIME type.
- Explicit non-generic unsupported MIME types remain rejected.

## Risks
- Extension fallback should be limited to document extensions already implied by the MIME whitelist.
- UI change should only affect the single-item delete path tied to the review thread.
