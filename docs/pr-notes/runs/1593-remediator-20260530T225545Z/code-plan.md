# Code Plan

- Edit `apps/app/src/lib/parentToolsService.ts` to remove `getTeam` from `loadPublicRegistrationDetail`.
- Derive public `teamName` from registration form fields such as `teamName`, `team`, or `organizationName`, falling back to `Team`.
- Update `tests/unit/app-parent-tools-service.test.js` with a regression where `getTeam` rejects but the public form loads.
- Run focused Vitest tests and app build if available.
