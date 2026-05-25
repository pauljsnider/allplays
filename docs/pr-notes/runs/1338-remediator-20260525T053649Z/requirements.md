# Requirements

Acceptance criteria:
- Profile headshot uploads through `saveParentAthleteProfileDraft` must enforce the same image-only, non-empty, and <=10 MB validation used by parent player photo uploads.
- If a new profile headshot uploads successfully but `saveAthleteProfile` fails, the uploaded media object must be deleted by storage path before the original save error is rethrown.
- Existing reset/no-photo behavior must remain unchanged.
- Scope is limited to PR review feedback in `apps/app/src/lib/playerService.ts` and direct unit coverage.
