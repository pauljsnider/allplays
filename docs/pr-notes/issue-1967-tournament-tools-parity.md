# Issue #1967: Tournament Tools Parity

Draft PR anchor for #1967.

## Current Finding

Tournament tooling remains web-first. The issue is intentionally split into two
implementation phases: read-only app rendering of existing tournament groupings,
then native tournament creation.

## Implementation Scope

- Phase 1: render web-created tournament groupings in the app schedule,
  including grouping name, member games, round, and bracket position where the
  data exists.
- Phase 1: expose tournament standings read-only, either by consuming stored
  standings or porting the legacy client-side computation with fixtures.
- Phase 2: add native tournament grouping creation after read-only rendering has
  landed and been validated.
- Keep organization-level scheduling out of scope.

## Acceptance

- A tournament created on the web appears in the app schedule in the expected
  grouping and game order.
- Tournament games still behave as normal schedule games for RSVP, tracking, and
  reports.
- Parent users see tournament context read-only.
- Phase 2 creation writes docs compatible with the legacy tournament views.

## Validation

- Schedule rendering unit tests with a real web-created tournament fixture
- Standings fixture comparison if standings logic is ported
- `npm run app:build`
- Manual web-created bracket to app schedule smoke
