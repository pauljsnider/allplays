# Architecture Role (manual fallback)

## Current state
`signup()` creates auth user, attempts `redeemParentInvite`, catches parent-link failures, logs, and returns success object. Caller unconditionally redirects to `verify-pending.html` on resolved promise.

## Proposed state
Maintain existing flow but change parent-invite catch in `signup()` to fail closed by rethrowing, preserving existing error UI path in `login.html`.

## Controls / equivalence
- Stronger control: success signal now means parent invite finalization succeeded.
- Reduced blast radius: no redirect into broken verification flow when invite linkage fails.

## Tradeoffs
- Parent sees immediate signup error instead of silent partial account creation flow.
- Potentially exposes backend failure text; acceptable for now because existing UI already displays error.message.
