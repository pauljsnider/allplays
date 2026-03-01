# QA Role - Issue #104

## Test Strategy
Primary: unit test for RSVP player scope resolver.
Secondary: targeted regression run of related parent dashboard tests.

## Failure Reproduction in Test
Given schedule events for same team and same game with sibling child IDs plus unrelated event rows, resolver should:
- return only clicked row child ID when `childId` provided
- never include child IDs from unrelated game rows

## Regression Guards
- Aggregate rows with `childIds` preserve explicit subset behavior.
- Fallback path (no explicit child IDs) scopes to `(teamId, gameId)` only.

## Manual Spot Check
- Parent with 2 children on same team.
- RSVP from one child row -> Firestore RSVP `playerIds` contains single child.
- Sibling row remains unchanged.
