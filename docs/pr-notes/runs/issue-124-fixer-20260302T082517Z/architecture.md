# Architecture Role Synthesis

- Objective: Close parity gap between invite acceptance flows while minimizing blast radius.

## Current vs proposed
- Current: `login.html` signup calls `signup()` -> `executeEmailPasswordSignup()`. In `signup-flow.js`, only `parent_invite` has dedicated logic; all other code types call `updateUserProfile` + `markAccessCodeAsUsed`.
- Proposed: Introduce explicit `admin_invite` branch in `executeEmailPasswordSignup()` that delegates to `redeemAdminInviteAcceptance` (`js/admin-invite.js`) before email verification.

## Design choice
- Reuse existing helper instead of duplicating admin persistence logic.
- Inject helper and dependencies through `signup()` dependency bag for testability and minimal coupling.

## Risk surface and blast radius
- Scope limited to email/password signup flow.
- Existing Google admin-invite path already uses admin helper and is unaffected.
- Parent invite cleanup/rollback behavior remains untouched.

## Controls
- Keep sequence: admin persistence (including team/admin linkage) before verification completion.
- Preserve thrown errors to prevent false-success signup when admin linking fails.
