# QA Plan

Regression tests:
- Invalid headshot file rejects before upload and does not call `uploadAthleteProfileMedia`.
- Save failure after successful headshot upload calls `deleteAthleteProfileMediaByPath` with the uploaded storage path and rethrows the save failure.
- Existing headshot upload/reset test continues to prove current happy paths.

Validation command:
- `npx vitest run tests/unit/app-player-service.test.js --reporter=verbose`
