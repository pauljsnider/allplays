# QA Plan

## Automated

- Update `tests/unit/app-capability-page.test.jsx` to mock `openPublicUrl`.
- Verify stub capability `/capabilities/game-plan` calls `openPublicUrl('https://allplays.ai/game-plan.html')` and does not render a raw relative anchor.
- Verify legacy-link capability `/capabilities/admin` calls `openPublicUrl('https://allplays.ai/admin.html')` and does not render a raw relative anchor.
- Verify native-shell and future capability behavior remains unchanged.

## Commands

- `npx vitest run tests/unit/app-capability-page.test.jsx --reporter=verbose`
- `npm run app:build`
