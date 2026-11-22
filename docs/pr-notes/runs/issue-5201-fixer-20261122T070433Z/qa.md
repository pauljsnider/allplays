# QA analysis

The required `allplays-qa-expert` role session was attempted twice but the OpenClaw subagent runtime failed with `published reply runtime missing for main`. This artifact records the main-run synthesis.

## Regression matrix

For parent, household, and co-parent redemption:

- unverified plus mismatched authoritative token email: mismatch error, no transaction, zero writes;
- unverified plus matching authoritative token email: `email-verification-required`, no transaction, zero writes;
- verified plus mismatched authoritative email: existing mismatch rejection;
- verified plus matching authoritative email: existing success path.

Identity-core tests must prove that unverified authoritative email remains available for comparison while verification remains false.

## Focused validation

- `node --test functions/test/parent-invite-redemption-callable.test.cjs functions/test/failed-invite-signup-cleanup.test.cjs`
- `npx vitest run tests/unit/family-invite-auth-identity.test.js --reporter=verbose`
