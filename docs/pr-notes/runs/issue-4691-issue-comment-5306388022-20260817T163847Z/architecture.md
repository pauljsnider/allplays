# Architecture

## Current-State Read

- The branch loads the allow-listed public profile first, then requests sanitized team-scoped standings inputs only when standings are enabled.
- `computeNativeStandings` is exposed through the typed legacy adapter and receives the normalized config unchanged.
- Profile and standings states are independent, but broad auth/notification Playwright route mocks added during CI remediation expanded the failure blast radius from one public-team smoke to 24 unrelated failures.

## Proposed Design

- Keep the read-only public profile to public projection to native computation flow required by #4691.
- Preserve separate loading, ready, empty, disabled, and unavailable states.
- Keep the fixed full-width four-column table, wrapping team names, normalized current-team matching, and sanitized external league link.
- Remove broad auth/notification smoke mocks. Retain only public-team service and adapter mocks required by the changed import surface.
- Add a signed-out 320px browser regression with populated rows.

## Files And Modules Touched

- `apps/app/src/lib/adapters/legacyPublicTeamsDb.ts`
- `apps/app/src/pages/PublicTeamDetail.tsx`
- `apps/app/src/pages/PublicTeamDetail.test.tsx`
- `tests/smoke/app-teams.spec.js`
- Branch-only broad mocks removed from `tests/smoke/app-auth-profile.spec.js`, `tests/smoke/app-messages.spec.js`, and `tests/smoke/app-schedule.spec.js`.

## Data/State Impacts

- Read-only. No persistence, schema, index, or migration changes.
- Disabled standings perform no public-games request.
- Incomplete pagination fails closed and renders unavailable, never partial-as-complete.

## Security/Permissions Impacts

- Anonymous reads remain behind the public profile and public games callables.
- No direct client Firestore reads, authenticated fallbacks, or access-control changes are introduced.
- `leagueUrl` remains normalized to HTTP(S) and opens with `rel="noreferrer"`.

## Failure Modes And Mitigations

- Projection or computation failure preserves identity content and shows a standings-local unavailable state.
- Route cleanup blocks stale async state.
- Long names wrap inside a fixed-width table.
- A missing current-team match produces no fabricated highlight.
- Team-scoped input completeness is a known product limitation; authoritative league-wide ranking requires a future stable group projection, not client fan-out.
