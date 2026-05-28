# QA role notes

## Test plan
- Unit test `loadAppSearchTeams` with `getTeams()` returning only public/default teams while supplemental Firestore queries return private selected-stream teams.
- Assert uid and email stream-volunteer teams are included, hidden teams are excluded, and Firestore query constraints include member uid and normalized email.
- Run targeted Vitest file first, then the repository unit suite if feasible.
- Run app build for TypeScript/Vite validation. Android/iOS native builds are not required for this search-service-only change; iOS is skipped on Linux.
