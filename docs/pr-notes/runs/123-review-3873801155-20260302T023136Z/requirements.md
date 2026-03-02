# Requirements Role Summary

## Objective
Address PR #123 review finding: delegated coach access must only evaluate `coachOf` membership when `team.id` is valid.

## Current vs Proposed
- Current: Full team access recognizes owner/team-admin/platform-admin, while tests expect delegated coach full access.
- Proposed: Full team access additionally recognizes delegated coach assignment via `user.coachOf.includes(team.id)` with a strict non-empty `team.id` guard.

## Risk Surface and Blast Radius
- Surface: Team management authorization gate used by team admin pages.
- Blast radius: Low. Change is isolated to a single helper (`hasFullTeamAccess`) and unit tests.
- Control impact: Stronger correctness guard by requiring valid `team.id` before delegated access lookup.

## Assumptions
- `coachOf` is an array of team id strings.
- Missing/blank `team.id` should never authorize delegated coach access.

## Recommendation
Ship minimal helper patch + targeted regression test to enforce guard behavior and preserve expected delegated-coach UX.
