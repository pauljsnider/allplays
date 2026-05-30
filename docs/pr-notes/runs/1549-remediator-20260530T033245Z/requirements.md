# Requirements

- Prevent unauthenticated cancellation of normal pending/waitlisted public registrations by registration ID alone.
- Allow checkout preparation failures and Stripe cancel returns to release capacity only when the caller presents the same checkout attempt token stored on the registration.
- Preserve existing open-checkout cancellation/webhook behavior and paid-registration safety guard.
