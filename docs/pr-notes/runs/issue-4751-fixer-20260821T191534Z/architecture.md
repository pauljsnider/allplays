# Current-State Read

`buildTeamPassMarkup()` renders an eligible CTA and an `aria-live="polite"` feedback element. `bindTeamPassCheckoutButton()` disables the button and re-enables it on rejection, while `redirectToTeamPassCheckout()` enforces canonical Stripe destination validation. The initial CTA slice tested only successful wiring, leaving stale error state, explicit loading feedback, and reentrant duplicate-attempt protection undefined.

# Proposed Design

- Keep ephemeral attempt state local to `bindTeamPassCheckoutButton()`.
- Add an explicit `inFlight` guard in addition to the disabled property.
- At attempt start, clear prior feedback, disable the button, set `aria-busy`, and show loading copy.
- On failure, clear the guard and busy state, restore the original label, re-enable the button, and display retryable feedback.
- On success, keep the CTA disabled because validated navigation is underway.
- Keep every attempt routed through `redirectToTeamPassCheckout()` so canonical validation remains centralized and fail-closed.

# Files And Modules Touched

- `js/team-pass.js`
- `tests/unit/team-pass.test.js`
- The four required run artifacts under `docs/pr-notes/runs/issue-4751-fixer-20260821T191534Z/`

# Data/State Impacts

No persisted data, Firebase schema, entitlement, checkout payload, or eligibility changes. New state is ephemeral and scoped to one rendered CTA binding.

# Security/Permissions Impacts

No access-control changes. Existing eligibility controls whether the CTA renders, and canonical HTTPS Stripe validation remains unchanged for initial attempts and retries.

# Failure Modes And Mitigations

- Slow creation: synchronous disabled and in-flight states block duplicates.
- Network or backend rejection: visible feedback and restored retryability.
- Invalid destination: existing validator rejects before navigation and UI recovers.
- Retry: stale feedback clears and the full validated flow runs again.
- Success: disabled state remains during navigation.
