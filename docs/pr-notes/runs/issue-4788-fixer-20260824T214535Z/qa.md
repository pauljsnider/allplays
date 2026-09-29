# Risk Matrix

- High: standings state blocks profile content; wrong data source preserves the defect; stale route responses render the wrong team.
- Medium: points/PCT labeling or empty/failure state regressions; current-row mismatch.
- Low: responsive overflow and optional-value fallbacks.

# Automated Tests To Add/Update

1. Profile remains usable while standings are pending.
2. Points rows render exact rank, record, totals, and current-row highlight.
3. Win-percentage rows render `PCT` with the returned value.
4. `null` or empty standings preserve the unavailable state.
5. Standings rejection preserves profile and recent results.
6. Recent-results rejection does not suppress successful standings.

# Manual Test Plan

- Open enabled, disabled, no-game, and forced-failure public teams while unauthenticated.
- Confirm mobile horizontal scrolling and current-team emphasis.
- Confirm no roster, contact, or private schedule data is requested or rendered.

# Negative Tests

- Rejected standings with successful profile/results.
- `null` standings and zero-row standings.
- Win-percentage rows without points.
- Missing current row.
- Stale completion after route navigation.

# Release Gates

- `npm run test:app -- src/pages/PublicTeamDetail.test.tsx`
- App build only if the focused test exposes a compiler/import issue.
- GitHub `app-quality` remains the full CI gate.

# Post-Deploy Checks

- Compare known points and win-percentage teams to the public service output.
- Verify disabled/no-game and failure isolation states.
- Check for unhandled promise rejections or repeated hydration loops.
