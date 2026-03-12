Objective: ensure accepted admin invites result in immediate, real team-admin access on the dashboard and protected team actions.

Current state:
- The codebase already routes `accept-invite.html` through the atomic admin invite redemption flow.
- The invite page still references older cache-busted module URLs, so a browser with cached pre-fix assets can keep running the stale acceptance logic.

Proposed state:
- `accept-invite.html` must pin fresh versions of the invite-flow modules that persist `teams/{teamId}.adminEmails` during admin invite redemption.

Risk surface and blast radius:
- Invite acceptance only.
- High user impact because the UI can claim success while the invited admin still lacks dashboard visibility and write access.

Assumptions:
- The atomic redemption path in `js/db.js` is the intended source of truth for admin invite acceptance.
- The remaining production exposure for issue #276 is stale cached client code on `accept-invite.html`.

Recommendation:
- Ship a cache-busting bump on the invite acceptance page and lock it in with a unit test that reads the HTML import pins directly.

Success measure:
- A regression test fails on the stale import versions and passes once the page references the fresh invite modules.
