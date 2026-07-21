# Architecture Review: Issue #4117

## Current state

- `PublicTeamSearch` renders a generic `View public team` button and calls `useNavigate`.
- The action is only 40px high and its accessible name does not distinguish teams.
- `PublicTeamDetail` renders an unlabeled spinner and a terminal error `Status` with no retry path.
- Successful profiles point discovery to `/discover?tab=teams` and omit account-entry paths.

## Root cause

The public flow was implemented as a success-path display and navigation surface. Semantic navigation, complete async state handling, canonical recovery routes, and visitor exit paths were not encoded as component contracts or regression tests.

## Minimal design

- Replace imperative result navigation with a React Router `Link` to the encoded public route, named for the team and styled with `!min-h-11`.
- Model detail retry with a local attempt counter while retaining the effect cleanup guard against stale responses.
- Render loading as a polite status with visible text and a decorative spinner.
- Render failure with the existing error message, `Retry`, and a `/teams/browse` link.
- Add `/teams/browse`, `/accept-invite`, and `/auth` links to the successful public profile.

## Safety, blast radius, and rollback

- No data service, Firebase query, rule, index, or route definition changes are required.
- The view continues to consume only `PublicTeamProfile` allow-listed fields.
- Blast radius is limited to two public React components and focused tests.
- Rollback is a source/test revert with no data or configuration migration.
