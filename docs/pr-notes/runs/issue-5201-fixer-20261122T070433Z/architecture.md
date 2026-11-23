# Architecture analysis

The required `allplays-architecture-expert` role session was attempted twice but the OpenClaw subagent runtime failed with `published reply runtime missing for main`. This artifact records the main-run synthesis.

## Root cause

`resolveAuthenticatedFamilyInviteEmail` returns an empty string for both an unverified authoritative email and a missing authoritative email. The redemption guards therefore cannot distinguish those states and execute the verification-required branch before the mismatch branch.

## Patch boundary

- Preserve `resolveAuthenticatedFamilyInviteEmail` for compatibility.
- Add an identity resolver returning normalized authoritative email and verification state from one trusted lookup.
- Use that identity in parent, household, and co-parent handlers.
- Validate mismatch first, verification second, before and inside the transaction.

This keeps request/profile email untrusted and retains verified email as the access gate.
