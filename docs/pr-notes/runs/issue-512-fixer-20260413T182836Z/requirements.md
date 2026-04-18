# Issue #512 Requirements

## Acceptance Criteria
1. Clicking a team's location link on `teams.html` opens Google Maps in a new tab or window only.
2. Clicking the location link does not navigate the current tab away from `teams.html`.
3. Clicking anywhere else on the same team card still navigates to `team.html#teamId=...`.
4. Keyboard activation of the focused location link behaves the same as mouse activation.
5. Team cards without a location link keep their existing navigation behavior unchanged.

## UX Notes
- The Teams browse flow is location-first, so users must be able to inspect a map and keep their place in the list.
- The location text should keep behaving like a normal external link.
- Scope stays limited to the location interaction bug.

## Edge Cases
- Ctrl/Cmd-click or middle-click on the location link should follow normal browser behavior.
- Double-clicking the location link should not redirect the current tab.
- Clicking the location row outside the anchor should still trigger team-card navigation.
- Cards without a rendered location link should remain unchanged.

## Risks
- A mouse-only fix could still fail for keyboard activation.
- Overly broad suppression could block intended team-card navigation.

## Recommendation
Treat the location link as an independent interactive target and ensure the team-card navigation does not run when that link is activated.