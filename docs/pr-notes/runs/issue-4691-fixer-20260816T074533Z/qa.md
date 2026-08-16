# QA

## Risk Matrix

| Risk | Level | Guardrail |
| --- | --- | --- |
| Public profile never requests standings inputs | High | Component regression for enabled anonymous profile |
| Configuration is altered before computation | High | Assert exact native-engine call arguments |
| Standings failure hides valid profile | High | Reject projection and assert identity remains |
| Private boundary expands | High | Mock and assert only public service methods |
| Wrong team highlighted | Medium | Assert exact matching row has `aria-current` |
| Disabled or empty standings are a dead end | Medium | Assert specific fallback and optional league link |
| Narrow layout overflows | Medium | Assert fixed full-width table and wrapping team column |
| Route races render stale rows | Medium | Shared effect cancellation pattern |
| Native ranking regresses | Low | Do not modify engine; retain existing native tests |

## Automated Tests To Add/Update

Update `apps/app/src/pages/PublicTeamDetail.test.tsx` to verify:

1. Anonymous enabled standings render from the public inputs.
2. Exact normalized config and inputs reach the native engine.
3. Current-team highlight is visible and accessible.
4. Win-percentage mode uses the correct header and formatting.
5. Projection failure preserves the profile and renders the league link.
6. Disabled standings skip projection and still show a useful state.
7. The table uses fixed, full-width responsive structure with a wrapping team column.

## Manual Test Plan

- At 320, 375, and 768 CSS pixels, confirm there is no page-level horizontal scroll and long team names wrap.
- Compare a known public team table with its configured ranking rules.
- Verify disabled, empty, and failed states with and without a league URL.
- Verify signed-out and signed-in visitors see the same public-safe content.

## Negative Tests

- Disabled standings do not request game inputs or run computation.
- Projection rejection does not become a page-level failure.
- No row is highlighted when no team name matches.
- Unsafe league URLs never reach the page because the service normalizer returns `null`.
- No recent-results content is introduced.

## Release Gates

- `npm run test:app -- src/pages/PublicTeamDetail.test.tsx`
- `npm run app:build` for TypeScript/import validation after the focused test.
- No native builds or broad smoke suites locally.

## Post-Deploy Checks

- Verify one enabled and one unavailable public profile signed out.
- Confirm configured values, current-team highlight, league link, console health, and 320px layout.
- Confirm the deployed exact SHA passes production and post-deploy gates.
