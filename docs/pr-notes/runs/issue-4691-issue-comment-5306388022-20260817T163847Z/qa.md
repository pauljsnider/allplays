# QA

## Risk Matrix (high/medium/low)

| Level | Risk | Guardrail |
| --- | --- | --- |
| High | Public route drops or mutates standings inputs/config | Component assertion on exact projection and native-engine arguments |
| High | Standings failure hides the public profile | Rejection regression proving identity remains visible |
| High | Broad smoke mocks mask unrelated app behavior | Remove branch-only auth/notification mocks and rerun impacted smoke suites |
| Medium | Current team is not highlighted | Visual class plus `aria-current` component and browser assertions |
| Medium | Narrow layout clips long names | Populated 320px Playwright geometry assertion |
| Medium | Route race renders stale rows | Active-effect cancellation; retain as a residual coverage target |
| Low | Native ranking behavior changes | Native engine remains unchanged; run its focused unit suite |

## Automated Tests To Add/Update

- Retain `PublicTeamDetail.test.tsx` coverage for anonymous rendering, exact config handoff, current-team highlight, PTS/PCT modes, empty, disabled, and unavailable states.
- Update `app-teams.spec.js` to prove signed-out populated standings, league link, highlight, no unexpected page error, and no 320px page overflow.
- Remove broad auth and notification loader stubs that increased preview failures from 1 to 24.

## Manual Test Plan

- Signed out, verify one enabled public profile and one disabled/empty profile.
- Compare a known result against configured ranking values.
- Check long names at 320, 375, 768, and desktop widths.
- Confirm roster, private schedule, contacts, and member data are absent from network activity.

## Negative Tests

- Disabled standings skip projection and computation.
- Projection/computation failure does not become a page-level failure.
- No matching row receives `aria-current`.
- Invalid league URLs remain absent after normalization.
- Scheduled, live, private, practice, malformed, deleted, and wrong-team games are excluded by the public service.

## Release Gates

- `npm run test:app -- src/pages/PublicTeamDetail.test.tsx`
- `npx vitest run tests/unit/native-standings.test.js`
- Focused Playwright public standings smoke at 320px, then impacted smoke suites.
- `npm --prefix apps/app run lint`
- `npm run app:build`
- Exact-head `unit-tests`, `app-quality`, `mobile-build`, and `preview-smoke` must pass.

## Post-Deploy Checks

- Verify the exact merge SHA completes production deployment and post-deploy smoke.
- Recheck signed-out enabled and unavailable public profiles, league link, current-team highlight, console health, and 320px overflow.
