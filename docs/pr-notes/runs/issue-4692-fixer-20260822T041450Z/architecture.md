# Current-State Read

`getPublicTeamGamesProjection` is the existing anonymous, rate-limited, sanitized boundary. Dependency #4690 added strict completed-game normalization for standings inputs, but `PublicTeamDetail` still loads only identity data.

# Proposed Design

- Add a `PublicTeamRecentResult` view model and a five-item `getPublicTeamRecentResults` selector.
- Reuse the completed-public-game normalization path so privacy filters cannot drift.
- Recompute Win/Loss/Draw from validated current-team scores.
- Sort newest first, use a deterministic tie break, then slice.
- Load results as supplemental data after the profile succeeds. A results failure leaves the profile usable.
- Render stacked mobile-first rows in a separate card.

# Files And Modules Touched

- `apps/app/src/lib/publicTeamsService.ts`
- `apps/app/src/pages/PublicTeamDetail.tsx`
- `apps/app/src/pages/PublicTeamDetail.test.tsx`
- `tests/unit/app-public-teams-service.test.ts`
- `tests/smoke/app-teams.spec.js`

# Data/State Impacts

No schema, write path, endpoint, rule, cache, or native-shell changes. React stores at most five sanitized result rows. Route changes reset supplemental state and ignore late responses.

# Security/Permissions Impacts

Anonymous access remains behind the existing public callable. The client fails closed for non-completed, live-marked, non-game, private, deleted, mismatched, or malformed records and exposes no extra projection fields.

# Failure Modes And Mitigations

- Projection failure: show results unavailable, not an authoritative empty state.
- Empty projection: show a distinct no-results message.
- Long history: filter and sort before the fixed slice.
- Slow stale response: active-request guard and route reset.
- Long opponent text: wrap in bounded stacked rows.
- Rollback: revert the service helper, UI card, and focused tests. No data rollback is required.
