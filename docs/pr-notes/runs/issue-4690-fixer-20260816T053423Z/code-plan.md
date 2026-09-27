# Orchestrator Synthesis

## Acceptance Criteria

- Preserve only allow-listed league/config fields.
- Expose completed public non-practice projections as native-compatible standings inputs with dates and public tournament metadata.
- Fail closed for private/non-public teams, excluded statuses/types, malformed games, and incomplete pagination.
- Leave UI and native standings unchanged.

## Architecture Decisions

- Use the existing public callable directly through the typed adapter.
- Separate profile and standings-input service methods so the identity route does not acquire hidden schedule work.
- Validate public identity and rebuild all outputs explicitly.
- Follow callable cursors with repeated/missing-cursor guards.
- Leave `js/db.js` and Functions unchanged.

## QA Plan

- Add focused service tests first for profile allow-listing, home/away orientation, tournament metadata, exclusion classes, public-team identity, and pagination.
- Run the focused public-team service and unchanged native-standings tests.
- Run app typecheck only if needed for compile/import validation.

## Implementation Plan

1. Add typed adapter projection models and pagination.
2. Add profile/config/url normalizers and strict public validation.
3. Add exported standings-input types and `getPublicTeamStandingsInputs`.
4. Normalize only valid completed public games.
5. Validate, review the diff, and commit once.

## Risks And Rollback

- Primary risks are authorization-boundary drift, reversed away scores, and partial pagination.
- Explicit reconstruction, identity checks, table-driven tests, and cursor guards contain those risks.
- Rollback is a single commit reverting the adapter/service/test additions; no data migration exists.

# Code Role Artifact

## 1. Patch Plan

- Add typed, fail-closed pagination for the existing public games callable.
- Extend `PublicTeamProfile` with bounded league and standings fields.
- Add `getPublicTeamStandingsInputs(teamId)` with native-compatible game normalization.
- Cover configuration, boundaries, orientation, exclusions, pagination, and callable failure.

## 2. Code Changes Applied

None by the analysis-only role. The main lane owns all edits.

## 3. Validation Run

No validation was run by the analysis-only role. The main lane will run the focused Vitest command.

## 4. Residual Risks

- The callable's bounded default date window remains authoritative.
- Pagination must fail closed.
- Numeric strings stay invalid.
- Team identity must match the request.
- Native behavior remains isolated because the new output only conforms to its existing input contract.

## 5. Commit Message Draft

`Expose public team standings inputs (#4690)`
