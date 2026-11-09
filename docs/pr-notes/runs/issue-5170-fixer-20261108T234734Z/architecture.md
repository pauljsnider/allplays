# Architecture assessment

## Root cause
Dependency #5169 already completed the data path: the legacy adapter exports `removeFamilyMember`, and `parentHouseholdService.revokeParentHouseholdMemberAccess` delegates to it. The remaining gap was isolated to `HouseholdInviteTool`, which rendered no active membership cards and had no organizer eligibility, confirmation, mutation, error, or refresh flow.

## Minimal design
- Preserve the existing flow: React component → parent household service → legacy adapter → callable.
- Render normalized active and pending memberships separately from read-only contacts.
- Use normalized `organizerUserId` plus status for control visibility.
- Reuse the existing Parent Tools modal and async-operation patterns.
- Never optimistically remove a member; refresh after successful mutation.
- Keep creation entitlement checks away from revocation controls.
