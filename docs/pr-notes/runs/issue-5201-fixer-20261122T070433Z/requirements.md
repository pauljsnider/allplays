# Requirements analysis

The required `allplays-requirements-expert` role session was attempted twice but the OpenClaw subagent runtime failed with `published reply runtime missing for main`. This artifact records the main-run synthesis from repository guidance and issue evidence.

## User outcome

- A caller whose authoritative Firebase Auth email differs from the invited address must immediately receive the existing mismatch error, even when that email is unverified.
- A caller whose authoritative email matches the invite but is unverified must continue to receive `email-verification-required`.
- No parent, household, or co-parent access may be granted until the matching email is verified.
- Caller-supplied email fields must remain untrusted.

## Acceptance criteria

1. Parent, household, and co-parent redemptions compare the normalized authoritative Auth email with the normalized invited email before reporting the verification requirement.
2. Mismatched unverified identities fail before a transaction and produce zero writes.
3. Matching unverified identities still fail before a transaction with the established verification reason.
4. Verified matching identities retain current success behavior.
