## QA Role

- Regression target: admin-invite signup via email/password and Google popup/redirect.
- Test strategy:
  - assert the signup helper still routes admin invites through `redeemAdminInviteAcceptance(...)`
  - assert the passed object omits `markAccessCodeAsUsed`, `addTeamAdminEmail`, and `updateUserProfile`
  - rerun focused auth/signup unit tests covering admin cleanup behavior
- Residual risk: no browser-level manual run in this lane; confidence comes from existing unit coverage around the exact invocation points.
