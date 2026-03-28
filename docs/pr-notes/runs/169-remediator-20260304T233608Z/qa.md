# QA role notes
- Validate stale-doc remediation:
  1. Seed `rsvps/{uid}` for a game.
  2. Submit single-child RSVP via `submitRsvpForPlayer`.
  3. Confirm `rsvps/{uid}` no longer exists and only `rsvps/{uid__child}` remains.
  4. Confirm summary counts reflect one child response, not duplicated totals.
- Validate legacy hydration:
  1. Seed legacy RSVP doc for current user with response but no player fields.
  2. Load parent dashboard where game has scoped children.
  3. Confirm `resolveMyRsvpByChildForGame` maps response to all scoped children, not `not_responded`.
- Regression check: explicit per-player docs still override by latest `respondedAt` for same child.
