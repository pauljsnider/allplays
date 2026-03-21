# Issue 362 QA

## Coverage Plan
- Behavioral unit regression: load Edit Team with malformed existing admin emails, remove or add admins, save, and assert the persisted `adminEmails` payload.
- Behavioral unit regression: reload as the affected user and verify access changes on the next load.
- Unit regression: confirm full team access ignores admin email casing and whitespace.

## Validation
- Run targeted Vitest for `team-access`.
- Run targeted Vitest for the new Edit Team persistence spec.

## Residual Risk
- This does not cover Firestore rules directly; it covers the client-side payload and access behavior that previously lacked behavioral protection.
