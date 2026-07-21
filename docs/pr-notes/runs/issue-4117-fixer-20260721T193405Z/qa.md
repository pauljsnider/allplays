# QA Strategy: Issue #4117

## Focused regression coverage

| Criterion | Guardrail |
| --- | --- |
| Descriptive result links | Query links by team-specific accessible name and assert the encoded `/teams/:id/public` destination. |
| 44px touch targets | Assert `!min-h-11` in the component test and computed height `>= 44` at 390×844. |
| Announced loading | Hold the request pending and assert a `role="status"` containing `Loading public team`; spinner is `aria-hidden`. |
| Recoverable failure | Reject once, assert error, Retry, and exact `/teams/browse` destination; retry the same ID and recover in place. |
| Visitor account paths | Assert `/accept-invite` and `/auth` links on the successful profile. |
| Public boundary | Keep the existing allow-listed profile test; do not change the public service/query contract. |
| Route race safety | Preserve the route-transition test that clears stale profile content before a later failure. |

## Validation

```bash
cd apps/app
npx vitest run src/components/PublicTeamSearch.test.tsx src/pages/PublicTeamDetail.test.tsx --reporter=verbose
cd ../..
npm run app:build
```

At the existing 390×844 Playwright viewport, verify no horizontal overflow, descriptive result link semantics, a computed 44px target, and the canonical visitor actions.

## Recurrence risk

Medium until browser validation passes because jsdom verifies semantics and classes but not computed target size or mobile overflow. Async refactors can also regress live announcements, retry behavior, or canonical recovery destinations.
