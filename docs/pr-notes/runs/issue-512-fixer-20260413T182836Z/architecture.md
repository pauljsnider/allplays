# Issue #512 Architecture

## Architecture Decisions
- Keep the fix local to `teams.html`.
- Preserve the existing card navigation to `team.html#teamId=...`.
- Guard the card click handler so nested interactive elements, especially the Google Maps anchor, do not trigger card navigation.
- Do not cancel the anchor default, so Maps still opens in a new tab.

## Minimal Change Scope
- Touch only `teams.html` for the production fix.
- Do not change Firebase logic, routing structure, styling, or data models.

## Tradeoffs Considered
1. Add `stopPropagation()` on the Maps link only. Smallest literal fix, but less robust for future nested controls.
2. Guard navigation in the card click handler. Slightly more logic, still minimal, and protects future nested interactive targets.
3. Refactor the card UX so only a dedicated button navigates. Cleaner model, but too large for this bug.

## Risks And Rollback
- Risk: a selector that is too narrow may miss future controls; too broad may suppress normal card clicks.
- Rollback: revert the single listener change in `teams.html`.

## Recommendation
Use the card-level guard as the smallest coherent fix with the lowest blast radius.