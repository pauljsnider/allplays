# Code Role Synthesis

## Minimal Patch Plan
1. Add failing assertions in `tests/unit/parent-dashboard-rideshare-wiring.test.js`:
   - `renderEventRideshare` gate accepts practice events.
   - `hydrateRideshareOffersForSchedule` filter accepts practice events.
2. Update `parent-dashboard.html`:
   - Introduce `canShowRideshareForEvent(event)` helper predicate.
   - Use helper in `renderEventRideshare` and hydration filter.
3. Run targeted unit tests and confirm pass.
4. Commit with issue reference.

## Conflict Resolution Across Roles
- Requirements requested practice support.
- Architecture preferred a narrow frontend-only fix.
- QA required test evidence for both render and hydration paths.
- Code approach aligns with all three while avoiding backend/rules changes.
