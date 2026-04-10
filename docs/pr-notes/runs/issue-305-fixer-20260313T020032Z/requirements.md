Objective: ensure signup from `login.html?code=...&type=admin` grants the invited user team-admin access, not just account creation.

Current state:
- Direct invite acceptance already has a dedicated admin invite redemption path.
- Email/password signup validates the same invite, but its helper path is inconsistent with the direct acceptance flow.

Proposed state:
- Route email/password admin invite redemption through the same authoritative persistence model used for invite acceptance.

Risk surface and blast radius:
- Affects only `admin_invite` signup redemption.
- Parent invites and generic activation codes must remain unchanged.
- High user impact if wrong: invite is consumed without access.

Assumptions:
- `validation.data.teamId` and `validation.codeId` are present for `admin_invite`.
- Atomic persistence in `js/db.js` is the intended source of truth for admin grants.

Recommendation:
- Keep the fix narrow: update the signup-side admin invite helper to delegate to atomic persistence and add regression tests around that delegation and cache-bust wiring.
