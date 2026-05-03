# QA Notes

## Validation scope
- Existing-user admin invite fallback should still show the `already has an account` status.
- Invite code should still render as `EXIST111`.
- Admin email persistence should still update the admin list.

## Targeted gates
- `SMOKE_BASE_URL=http://127.0.0.1:4173 SMOKE_SUITE=preview npx playwright test --config=playwright.smoke.config.js tests/smoke/admin-invite-redemption.spec.js --reporter=line`
- Unit tests when available for team access and edit-team admin access persistence.

## Negative coverage to preserve
- Existing admin duplicate handling should not be changed.
- Streaming volunteer email normalization should not broaden team admin access.
