# Code Plan And Synthesis

## Acceptance Criteria

Provide a staff-only, read-only parent preview from unsaved editor state for every form status while preserving the public published-only boundary.

## Architecture Decisions

- Create a pure preview component instead of reusing mutation-coupled `RegistrationDetail`.
- Build its model with `buildAppRegistrationFormAdminPayload`.
- Use the existing `Modal` and mobile-width static presentation.
- Leave public loader, routes, Firestore, submission, and checkout code unchanged.

## QA Plan

- Component regression for unsaved values, state matrix, inactive filtering, close behavior, and no save/submit/checkout.
- Existing direct public-loader test strengthened for draft and closed states.
- Focused mobile Playwright overflow smoke.
- Focused app build after tests.

## Implementation Plan

1. Add `RegistrationFormPreview.tsx`.
2. Wire preview state and action into `TeamRegistrationForms.tsx`.
3. Write component tests before implementation and confirm failure.
4. Add focused smoke and boundary assertions.
5. Run the smallest focused commands, then build for compiler coverage.

## Risks And Rollback

- Conditional discounts can be misleading, so show active rule details separately from the default fee snapshot.
- Incomplete drafts must render defensively without forcing validation or save.
- Rollback is removal of the preview component and editor wiring; no persisted data or schema requires reversal.

## Conflict Resolution

- QA suggested a new `parentRegistrationsService` test file, but `tests/unit/app-parent-tools-service.test.js` already directly exercises `loadPublicRegistrationDetail` for draft and closed forms. Strengthening that focused test avoids duplicate mocks while preserving direct boundary evidence.
- Requirements allowed disabled inputs or static field cards. Static cards were selected because they provide the clearest non-submittable control boundary.

## Commit Message Draft

`Add parent preview to registration setup (#4675)`
