# Code Plan

## Implementation Plan
- Update `firestore.rules` only.
- Keep scorekeeping update fields scoped to the existing list.
- Factor destructive lifecycle rejection into an explicit helper used by `isScorekeepingGameUpdate` so the post-update state cannot be `status == cancelled` or `liveStatus == deleted`.

## Notes
- Subagent history was not readable from this remediator session due session visibility restrictions, so these role notes capture the inline fallback analysis required before implementation.
