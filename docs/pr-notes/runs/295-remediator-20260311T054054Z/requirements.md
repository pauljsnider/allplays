Objective: close PR #295 review thread PRRT_kwDOQe-T585zfft0 without widening the RSVP scope or regressing calendar coach flows.

Current state: calendar RSVP submission now routes through a dedicated resolver that preserves explicit child scoping when present and falls back when no event child metadata exists.

Required behavior:
- Parent flows with event child metadata must stay scoped to the event childIds.
- Calendar submissions with no child scope metadata must not throw the "Select a child in this game..." error.
- Coach and no-scope users must be able to submit the same way they could before the scope hardening change.

Acceptance evidence:
- `resolveCalendarRsvpPlayerIdsForSubmission` returns fallback team player ids when the event has no child metadata.
- The helper returns an empty list instead of throwing when both the event scope and fallback scope are empty.
- Existing scoped calendar tests still pass.

Assumption: the fetched branch head already contains the source fix for this review item, so this run only needs to record analysis and validate it.
