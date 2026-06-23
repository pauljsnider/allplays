# Issue #1995: Registration Form Editor Parity

Draft PR anchor for #1995.

## Current Finding

The app has registration detail consumers and service-level form editor plumbing,
but the staff-facing native editor still needs full parity with the web form
configuration workflow.

## Implementation Scope

- Add staff app UI for creating and editing registration forms.
- Preserve the document shape consumed by `RegistrationDetail.tsx`,
  `loadPublicRegistrationDetail`, `loadParentRegistrationDetail`, and
  `registration.html`.
- Support options, pricing, quantity discounts, waiver text, fees,
  payment-plan availability, publish/open state, and waitlist toggle.
- Match legacy validation rules from `js/admin-registration-forms.js`.
- Keep review queue and waitlist action workflows out of scope.

## Acceptance

- A form created in the app is submittable through both the app and
  `registration.html`.
- A web-created form opens in the app editor without field loss.
- Validation blocks invalid option/pricing/waiver combinations consistently with
  the web editor.
- Existing submissions are protected according to the legacy edit rules.

## Validation

- Registration form serializer and validation unit tests
- Parent registration detail regression tests
- `npm run app:build`
- Manual web/app submission smoke for an app-created form
