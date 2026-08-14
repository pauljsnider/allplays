# QA

## Risk Matrix

- High: private-team/private-event disclosure, scheduled/live games affecting standings, incorrect home/away score mapping, or ranking config loss.
- Medium: missing highlight, unbounded results, weak empty state, or mobile overflow.
- Low: regressions to existing loading, retry, navigation, and auth actions.

## Automated Tests To Add/Update

- Service: allow-listed profile metadata, safe league URL, full standings config, bounded projection request, final-game normalization, home/away mapping, non-record exclusion from standings, recent-result ordering/cap, and defensive exclusion of private/practice/live/incomplete fixtures.
- Component: responsive table, points/win-percentage context, accessible current-team highlight, recent opponent/date/score/result, empty state, league fallback, inline results retry, and existing profile recovery behavior.
- Smoke: extend the 390px browse-to-public-profile flow with standings, recent scores, highlight, and no page-level horizontal overflow.
- Existing contracts: native standings plus public-team API core and handler tests.

## Manual Test Plan

Open a controlled public team signed out at 390px, compare rows with the authenticated view, verify five newest finals, and confirm private/practice/live events are absent. Open a controlled private team and confirm not-found without stale prior data.

## Negative Tests

Reject scheduled, live, cancelled, private, practice, deleted, malformed-date, invalid-score, missing-score, unsafe-link, and non-public-team cases.

## Release Gates

- Focused component and service tests pass.
- Native standings and public API boundary tests pass.
- Focused public-team mobile smoke passes.
- TypeScript typecheck passes.

## Post-Deploy Checks

Verify one public and one private fixture while signed out, then inspect browser console and Functions error/rate-limit metrics for projection failures or retry loops.
