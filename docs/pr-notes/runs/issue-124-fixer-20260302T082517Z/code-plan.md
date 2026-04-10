# Code Role Plan Synthesis

1. Add failing unit test in `tests/unit/signup-flow.test.js` covering `admin_invite` email/password signup persistence call.
2. Patch `js/signup-flow.js` to add explicit `admin_invite` branch that invokes injected `redeemAdminInviteAcceptance`.
3. Wire dependencies in `js/auth.js` `signup()` call (import helper + include required db functions).
4. Run targeted Vitest suites and confirm pass.
5. Stage and commit with issue reference.

Assumption: role skills/subagent spawning are unavailable in-session; plan produced via manual synthesis fallback.
