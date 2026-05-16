# QA Notes

## Acceptance criteria
- Team media smoke tests execute the page module successfully.
- Permission-denied media reads show the non-staff empty state.
- Staff management read denial hides management UI and shows the Firestore rules message.
- Staff with folders sees visible save actions and album options.

## Validation
Run `npm run test:smoke:team-fallback -- --grep "team media"`.
