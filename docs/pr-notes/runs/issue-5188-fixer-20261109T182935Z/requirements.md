# Requirements analysis

> Main-lane synthesis: the requested allplays-requirements-expert skill was unavailable and the required subagent runtime failed before producing output.

- A parent whose selected player is Going must retain the enabled, one-tap **Sign up** action.
- Claiming must call the existing claim service without an extra dialog or navigation.
- Release is independent of RSVP and must remain available for the current user's claim.
- Team-admin edit/remove controls and non-Going claim behavior must not change in this slice.

## Root cause

Assignment rendering only derives actionability from claim ownership/open state and a generic disabled flag. It has no explicit RSVP-derived claim-readiness state, and the existing interaction regression uses the default not_responded fixture, so the Going path is implicit.
