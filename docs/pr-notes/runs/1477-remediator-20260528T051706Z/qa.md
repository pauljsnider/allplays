# QA role notes

## QA plan
- Extend the existing Playwright parent tools media flow because it already mounts the React route with mocked parent permissions.
- Mock an uploaded photo with `uploadedBy: 'user-1'` and `canManage: false` to prove a contributor owner sees the delete control.
- Click the owner delete control, accept confirmation, assert the delete service receives the team/item pair.
- While the mocked delete promise is in flight, assert the album button remains enabled to catch regressions where global page `loading` disables/replaces the full UI.

## Validation commands
- `npm --prefix apps/app run build`
- `npx playwright test tests/smoke/app-parent-tools.spec.js --config=playwright.smoke.config.js --reporter=line`
