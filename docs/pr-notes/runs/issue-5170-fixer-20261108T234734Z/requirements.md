# Requirements review

## User outcome
Authenticated household organizers can revoke active caregiver access or pending invitations from the mobile Parent Tools household panel with an explicit, named confirmation.

## Guardrails
- Show **Revoke access** only for active or pending memberships whose `organizerUserId` matches the signed-in user.
- Keep read-only linked contacts and removed memberships non-actionable.
- Name both caregiver and player in confirmation; cancellation performs no mutation.
- Refresh the authoritative household model after success.
- Preserve the membership and offer retry after failure.
- Keep revocation independent from the premium gate for creating invitations.
- Keep the change within the React household panel and adjacent tests; backend and legacy UI remain out of scope.
