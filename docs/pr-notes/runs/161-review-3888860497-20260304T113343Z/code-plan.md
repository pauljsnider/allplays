# Code Role (allplays-code-expert)

## Patch Plan
- Add `forceRefresh` option to roster cache helper.
- Add `freshRoster` option to `computeRsvpSummary`.
- Use fresh-roster compute only in `submitRsvpForPlayer`.
- Keep all other call sites unchanged for minimal blast radius.

## Code Changes Applied
- `js/db.js`: implemented opt-in roster refresh path and wired coach override flow to it.

## Validation Run
- Run focused RSVP unit tests:
  - `npx vitest tests/unit/rsvp-summary.test.js tests/unit/rsvp-hydration.test.js tests/unit/rsvp-doc-ids.test.js`

## Residual Risks
- `submitRsvp` still uses cached roster and may not reflect immediate roster edits in rare same-session timing windows.
- `sessions_spawn` tool unavailable in this runtime; role outputs were produced as equivalent structured artifacts in this run directory.

## Commit Message Draft
Fix stale roster summary on coach RSVP overrides

## Final Synthesis
### Acceptance Criteria
- Coach override summary recompute uses latest roster, preserving current error handling and behavior outside override path.

### Architecture Decisions
- Opt-in refresh flag chosen over global cache invalidation to control blast radius and maintain performance.

### QA Plan
- Focused RSVP unit regression tests plus explicit manual scenario for same-session roster change.

### Implementation Plan
- Minimal targeted changes in `js/db.js`; no schema/UI/rules updates.

### Risks And Rollback
- Risk: slight extra Firestore read on coach override path.
- Rollback: revert this commit to restore prior cached-only behavior.
