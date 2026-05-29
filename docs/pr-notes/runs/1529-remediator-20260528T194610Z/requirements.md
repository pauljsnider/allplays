# Requirements

- Feedback thread PRRT_kwDOQe-T586FfZeD is actionable.
- Parent fee checkout affordance must match backend eligibility: online Stripe collection, not paid, not canceled, valid identifiers, and positive remaining balance.
- A zero amount recipient must not show Pay Team Fee.
- A recipient with total amount fully covered by paidAmountCents must not show Pay Team Fee when no explicit positive balance remains.
