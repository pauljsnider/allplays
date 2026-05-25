# Requirements notes

Subagent role spawning was unavailable in this environment, so this note captures inline requirements analysis.

## Acceptance criteria
- A parent who deep-links to `/parent-tools/registrations/:teamId/:formId` for an online-checkout registration must not be able to submit through `submitOfflineRegistration`.
- The page must show a clear unavailable/error state for online-checkout registration detail routes.
- Existing offline registration detail submission behavior remains unchanged.

## Non-goals
- Do not redesign the online checkout flow.
- Do not change list-card visibility or payment-provider behavior beyond closing the route-level bypass.
