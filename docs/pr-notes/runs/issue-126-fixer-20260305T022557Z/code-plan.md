# Code Role Plan (fallback local synthesis)

## Minimal patch
1. Create `js/track-ai-summary.js` with:
   - `isAISummaryEnabled(flag)`
   - `applyAISummaryAvailability({ button, loadingDiv, enabled })`
2. Update `track.html`:
   - import helper functions
   - evaluate `const aiSummaryEnabled = isAISummaryEnabled();`
   - apply UI gating to button/loading area
   - attach click listener only when enabled
3. Add unit test `tests/unit/track-ai-summary-gating.test.js` that validates wiring in source.

## Conflict resolution
- Requirements/QA prefer hide-or-disable; architecture prefers explicit capability control.
- Chosen synthesis: explicit opt-in + hide button by default to eliminate deterministic runtime failure in unsupported environments.
