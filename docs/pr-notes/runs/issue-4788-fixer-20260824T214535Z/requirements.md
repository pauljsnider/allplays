# Problem Statement

The public native team page renders only the profile's optional inline standings even though computed standings are exposed through an independent public service. Enabled standings therefore appear unavailable to unauthenticated visitors. Standings hydration and failure must not block the public-safe profile or recent results.

# User Segments Impacted

- Parents and spectators need trustworthy rank, record, and league metrics without signing in.
- Coaches need the public page to match the computed standings service.
- Team and program administrators need reliable public standings without exposing private data.

# Acceptance Criteria

1. The public profile renders as soon as its request succeeds, without waiting for standings.
2. The standings card has an independent loading state.
3. Successful standings show rank, team, record, and points or win percentage exactly as returned by the public service.
4. The service-provided current row is visibly and accessibly highlighted.
5. Disabled standings and no eligible games preserve the existing unavailable state.
6. A standings failure preserves the profile and recent results and shows a standings-only failure state.
7. Route changes cannot display stale standings from the prior team.

# Non-Goals

- Standings computation or eligibility changes.
- Signed-in or legacy standings changes.
- Private roster or schedule exposure.
- End-to-end infrastructure changes.

# Edge Cases

- Disabled or missing standings configuration.
- Enabled standings with no eligible games.
- A service response with zero rows or no current row.
- Zero points or zero win percentage.
- Standings failure while recent results succeed, and the inverse.
- A route change while standings are pending.

# Open Questions

- A standings-only retry may be added later; it is not required for this slice.
- A stable row identifier could replace the current service-authoritative row key in a future contract.
