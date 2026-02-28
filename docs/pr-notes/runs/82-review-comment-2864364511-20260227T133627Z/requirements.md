# Requirements Role Summary

## Objective
Prevent duplicate `admin_invite` redemption so one code cannot grant coach/admin privileges to multiple users under concurrent requests.

## Current State
- Invite flow validates code (`validateAccessCode`) and later consumes code (`markAccessCodeAsUsed`) in a separate operation.
- Admin role/team updates can be applied before code consumption, allowing race-condition duplicate grants.

## Proposed State
- Redemption must be atomic for `admin_invite`: the same atomic unit checks `used/expiry/type`, grants access, and marks used.
- Losing concurrent request must fail before any privilege grant.

## Blast Radius
- Limited to admin-invite acceptance path (`accept-invite.html` -> `js/accept-invite-flow.js` -> `js/db.js`).
- No parent invite behavior changes.

## Acceptance Criteria
1. Two near-simultaneous submissions of the same admin code result in exactly one success.
2. Only one user receives coach access for that team via invite redemption.
3. Access code document ends with single `usedBy` and `usedAt` values.
