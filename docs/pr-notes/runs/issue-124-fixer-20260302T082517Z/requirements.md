# Requirements Role Synthesis

- Objective: Ensure admin invite signup links (`login.html?code=<CODE>&type=admin`) grant invited team admin access when account creation succeeds.
- Current state: Email/password signup via `login.html` validates code and consumes it, but `admin_invite` is treated as generic code in `signup-flow` and does not persist admin/team linkage.
- Proposed state: `admin_invite` email/password signup path uses the same persistence contract as accept-invite flow: add team coach/admin access and then consume code.

## User outcomes
- Invited admin who signs up from copied link lands in a usable admin state for the invited team.
- Invite code is consumed only when admin persistence succeeds.
- Existing parent invite and generic activation code behavior remains unchanged.

## Constraints and assumptions
- `allplays-orchestrator-playbook` and `sessions_spawn` role tooling are unavailable in this runtime; this file is a manual role synthesis fallback.
- `validateAccessCode` for admin invites returns `type=admin_invite`, `data.teamId`, and `codeId`.
- Existing `redeemAdminInviteAcceptance` helper is the canonical persistence path for non-atomic signup flow.

## Success criteria
- New regression test fails on baseline and passes after fix.
- Signup path for admin invite calls admin persistence helper with `userId`, normalized `userEmail`, `teamId`, and `codeId`.
- No regression in parent invite signup tests.
