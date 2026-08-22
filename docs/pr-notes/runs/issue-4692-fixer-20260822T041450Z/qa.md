# Risk Matrix

- High: private or non-public data appears.
- High: result is calculated from the wrong team perspective.
- Medium: history is unbounded or sliced before sorting.
- Medium: supplemental failure hides the public profile or stale results cross routes.
- Medium: mobile rows overflow.
- Medium: the browser smoke service stub misses the new named export.
- Low: empty results are confused with loading or failure.

# Automated Tests To Add/Update

- Service: newest-first order, five-item bound, win/loss/draw, empty results, and exclusion of scheduled, live, private, practice, deleted, mismatched, and malformed projections.
- Component: populated results, score/date/result labels, empty state, non-fatal unavailable state, and stale route clearing.
- Mobile smoke: update the service stub, render a long opponent, assert essential fields and no horizontal overflow.

# Manual Test Plan

Verify populated and empty profiles anonymously at 320px and 390px. Confirm current-team score perspective and that results failure leaves identity visible.

# Negative Tests

Reject scheduled scores, live markers, completed practices, every private marker, deleted/wrong-team rows, invalid dates, blank opponents, and invalid scores. Never render raw extra fields.

# Release Gates

Focused service, component, mobile smoke, and app typecheck/build checks pass. No new endpoint, private loader, standings computation, or score workflow is introduced. GitHub CI remains the full gate.

# Post-Deploy Checks

Confirm the exact deployed SHA, populated and empty anonymous profiles, absent non-public games, narrow-screen layout, and clean browser console/network behavior.
