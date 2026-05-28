# Code role notes

## Implementation plan
1. Import `collection` from the Firebase adapter in `searchService.ts`.
2. Add `loadStreamVolunteerSearchTeams(user)` that queries `teams` by `teamPermissions.streaming.memberIds array-contains user.uid` and `streamVolunteerEmails array-contains normalized email`.
3. Merge normalized supplemental teams through the same `canUserDiscoverTeamInAppSearch` gate.
4. Replace the redundant ternary branch with direct `team.teamPermissions.streaming.memberIds` after the `Array.isArray` guard.
5. Extend `app-search-service.test.js` mocks and add a regression test proving private stream-volunteer teams are loaded even when `getTeams()` omits them.
