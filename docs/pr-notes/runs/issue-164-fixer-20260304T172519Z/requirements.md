# Requirements Role Synthesis

## Objective
Guarantee single-use access/invite code redemption under concurrency so exactly one claimant succeeds and all others fail before side effects.

## User-visible behavior
- Concurrent redeems of the same code must not both show success.
- Losing claimant should receive a clear already-used/invalid failure.
- No duplicate parent linking from the same invite.

## Constraints
- Keep changes minimal and local to redemption paths.
- Preserve existing invite type semantics (`standard`, `parent_invite`, `admin_invite`).
- Avoid introducing new UX flows in this fix.

## Acceptance criteria
- A regression test fails on current flow where standard signup swallows mark-used failure.
- Code paths enforce atomic claim/check for single-use codes.
- Parent invite path no longer queries with `used == false` then marks later without atomic precondition.
