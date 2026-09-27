# Problem Statement

The eligible legacy Team Pass CTA lacks a complete attempt-state contract. It needs a clear state machine: idle to loading to validated redirect, or idle to loading to visible error to retryable idle.

# User Segments Impacted

- Coaches, administrators, and owners need duplicate-submit protection and fast failure recovery.
- Eligible parents need clear progress, safe navigation, and retry without refreshing.
- Program managers need every attempt scoped to the same team and season and every destination validated.
- Ineligible users must remain unaffected with no checkout CTA.

# Acceptance Criteria

1. Activating **Buy Team Pass** synchronously disables the CTA and visibly communicates that checkout is starting.
2. Additional clicks while checkout is pending do not create another request.
3. Each attempt uses the current team ID and resolved season ID.
4. Starting a retry clears prior error feedback.
5. Failure displays a user-visible error, restores the original CTA label, and re-enables the button.
6. Retrying invokes checkout creation again without a page refresh.
7. Every attempt, including retries, accepts only canonical HTTPS `checkout.stripe.com` destinations without credentials, custom ports, or an empty path.
8. An invalid destination causes no navigation and recovers as a retryable error.
9. A valid redirect keeps the CTA disabled during navigation.
10. Focused unit tests cover pending/loading state, duplicate-click prevention, error recovery, retry invocation, and invalid-destination recovery.

# Non-Goals

- Backend checkout, Stripe, entitlement, or idempotency changes.
- Eligibility, team/season resolution, or pass-status changes.
- React/Capacitor TeamDetail changes.
- Playwright coverage or broader UI redesign.
- Other premium purchase CTAs.

# Edge Cases

- Rapid double-clicks must create one pending attempt.
- Retry must clear stale error text immediately.
- Missing error messages must use stable fallback copy.
- HTTP, lookalike, credentialed, custom-port, root-only, or malformed destinations must never navigate.
- Destination validation must run independently on every retry.
- Missing CTA markup must remain a safe no-op.
- Successful checkout remains disabled because navigation is expected.

# Open Questions

- Loading copy: use **Starting checkout...**.
- Accessibility: update the button copy, set `aria-busy`, and retain the existing live region for errors.
- Preserve specific backend error text where available and explicitly tell the user to retry.
