# Architecture Role Notes

## Current State
`hasFullTeamAccess(user, team)` currently treats `coachOf` membership as full management access in the client helper, but Firestore rules only permit writes for owner/admin-email/global-admin.

## Risk
Client/server authorization drift: users can access management UI and fail writes.

## Proposed State
`hasFullTeamAccess` should only return true for owner, team-admin-email, or platform-admin. If coach membership logic remains in file context, it must validate `team.id` before inclusion checks.

## Blast Radius
Low. Single helper function used for team-gating behavior. Change reduces false-positive access grants.
