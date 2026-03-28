# Code role plan (fallback)

## Minimal patch steps
1. Add a unit test file that reads `parent-dashboard.html` and fails when:
   - duplicate `window.submitGameRsvp = async function(` assignments exist
   - accidental nesting pattern (`submitGameRsvp` opener immediately wrapping rideshare helper declarations) exists
2. Remove the stray early `window.submitGameRsvp = async function(...) {` line from `parent-dashboard.html`.
3. Run targeted Vitest suite to confirm failure->pass and no local regressions.
4. Commit test + fix together with issue reference.
