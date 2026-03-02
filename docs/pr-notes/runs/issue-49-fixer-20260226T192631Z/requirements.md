# Requirements Role Notes (Fallback)

Objective: Enforce one-time redemption for admin invite codes in `accept-invite` so a second redemption fails with `Code already used`.

Current state:
- Accept flow validates admin invite code with `validateAccessCode(code)`.
- Admin branch updates user profile but does not mutate access code state.
- Same code can be redeemed by multiple accounts.

Proposed state:
- On successful admin invite redemption, mark the exact code record as used and store `usedBy` and `usedAt`.
- Keep existing success UX and redirect behavior unchanged.

Risk surface and blast radius:
- Scope limited to admin invite redemption path in `accept-invite.html`.
- No schema changes.
- Parent invite behavior should remain unchanged.

Assumptions:
- Invite lifecycle is single-use for both parent and admin invite types.
- Existing Firestore rules permit invited user to call the same path used by parent invite redemption helper.

Recommendation:
- Minimal fix: call `markAccessCodeAsUsed(validation.codeId, userId)` after successful admin profile/team updates.
- Add a unit test covering sequencing and ensuring the usage mark happens once per successful admin flow.

Success criteria:
- A second `validateAccessCode` call for the same admin code returns invalid due to `used: true`.
- New test fails before the patch and passes after.
