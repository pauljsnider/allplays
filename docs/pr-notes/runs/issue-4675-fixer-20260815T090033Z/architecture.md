# Architecture

## Current State

`TeamRegistrationForms` owns the complete draft in React state. `buildAppRegistrationFormAdminPayload` already derives the normalized form, fee snapshot, and payment plans. Parent presentation is coupled to route loading and mutation logic in `RegistrationDetail`; the public loader correctly blocks unavailable statuses.

## Proposed Design

- Add a pure `RegistrationFormPreview` component receiving normalized presentation data and `onClose` only.
- Derive preview data synchronously from the current draft when the modal is open.
- Reuse the existing `Modal` for focus trapping, Escape/native-back dismissal, body-scroll locking, and focus restoration.
- Render static field cards, active options and discounts, fee lines, plan choices, and waiver text in a mobile-width, vertically scrolling sheet.
- Import no save, submission, checkout, Firestore, or loader services into the preview component.

## Security And State

- Existing editor authorization remains the only entry boundary.
- Preview state is ephemeral and does not change form status.
- Public routing and `loadPublicRegistrationDetail` remain unchanged.
- Structural separation, not disabled mutation buttons, prevents registration and checkout actions.

## Failure Mitigations

- Use the existing normalization helper to avoid fee and plan logic drift.
- Do not block preview on save validation errors.
- Filter inactive options and discounts.
- Apply `min-w-0`, wrapping, viewport width constraints, and internal scrolling.
