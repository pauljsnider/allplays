## Acceptance Criteria
1. The team card click behavior must navigate to `team.html#teamId={id}` only when the click originates from a non-interactive area of the card.
2. Clicking the nested location link must not trigger card-level navigation in the current tab, so coaches, parents, and admins can open the map destination without losing their place in the teams list.
3. The unit test for the nested location link scenario must only treat the exact interactive selector string `a, button, input, select, textarea, summary, [role="button"], [role="link"]` as interactive, so the test matches the shipped UI behavior instead of passing on partial selector matches.
4. If any other selector string is passed to the mocked `closest`, the test must return `null` and must not create a false positive for blocked navigation.

## UX Notes
- The card should feel tappable for quick browsing, especially on mobile.
- Nested controls, especially the location link, must preserve their own expected behavior and must not hijack the user into the team detail page.
- This matters most in fast parent and coach browsing flows where losing the current list context is frustrating.

## Edge Cases
- Clicks on text or icons inside the location link should still count as interactive and avoid card navigation.
- Future nested buttons or link-like controls should remain protected by the same interactive selector contract.
- A test that passes because a mock matches any selector containing `a` is invalid, because it can hide regressions in the interactive guard.

## Risks
- A loose mock can approve broken click-guard logic and let regressions reach production.
- If the selector contract drifts between implementation and test, users may see unexpected navigation when trying to use nested controls.

## Recommendation
Tighten the mock to recognize only the exact selector string used by the production click guard. This keeps the test aligned with real behavior and gives high confidence that nested interactive elements, especially the location link, do not trigger accidental card navigation.