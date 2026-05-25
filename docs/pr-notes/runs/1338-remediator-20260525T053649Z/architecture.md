# Architecture

Decisions:
- Reuse existing local `validateImageFile` to preserve control equivalence with player photos.
- Import and call `deleteAthleteProfileMediaByPath` from `js/db.js` for rollback because `uploadAthleteProfileMedia` returns `storagePath`.
- Wrap only the `saveAthleteProfile` call after a successful profile-photo upload, so validation/upload failures are not treated as rollback cases.
- Cleanup failure is best-effort and should not mask the original profile save failure.
