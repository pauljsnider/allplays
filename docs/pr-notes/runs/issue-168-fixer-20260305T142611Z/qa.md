# QA Role Synthesis (Fallback)

Primary regression to cover:
- `edit-team.html` must include a missing-team guard in `init()` for `teamId` routes.

Test approach:
- Add unit wiring test that inspects `edit-team.html` source and asserts:
  - `if (!team)` guard exists.
  - guard contains user-facing alert for missing team.
  - guard redirects to `dashboard.html`.

Why this format:
- Existing repo tests include static HTML wiring checks for page behavior contracts.
- No existing browser integration harness; source-assertion test is aligned with current conventions.

Manual validation:
1. Open `edit-team.html?teamId=<invalid>` while signed in.
2. Confirm alert appears.
3. Confirm immediate redirect to dashboard.
4. Open valid team edit link; confirm normal prefilled edit flow.

Residual risk:
- Runtime browser behavior is still manually validated (no DOM e2e automation in repo).
