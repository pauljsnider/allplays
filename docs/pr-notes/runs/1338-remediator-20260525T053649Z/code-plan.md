# Code Plan

Implementation:
1. Add `deleteAthleteProfileMediaByPath` to `playerService.ts` db imports.
2. Validate `profilePhotoFile` before upload in `saveParentAthleteProfileDraft`.
3. Track the uploaded profile photo metadata and delete by `storagePath` in a catch block if `saveAthleteProfile` throws.
4. Extend `tests/unit/app-player-service.test.js` mocks and add focused tests for validation and rollback.

Risks and rollback:
- Risk is limited to parent athlete profile saves with newly uploaded headshots.
- Rollback is reverting this commit; no data migration involved.
