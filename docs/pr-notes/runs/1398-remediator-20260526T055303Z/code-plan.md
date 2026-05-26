# Code Plan

- Add small invite-expiration and pending-invite predicate helpers in `apps/app/src/lib/teamDetailService.ts`.
- Replace the loose `type === admin_invite && used !== true` filter with the stricter predicate.
- Extend the existing pending-admin-invites unit test to verify stale/non-active invites are filtered out.
