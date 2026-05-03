# QA Role

## Risk Matrix
- High: `preview-smoke` red blocks merge even though unit tests pass.
- Medium: Existing-user admin invite fallback is on the same page as roster rollover and must remain stable.
- Low: Production roster rollover logic is unchanged by this patch.

## Validation Plan
- Run full unit suite: `npm run test:unit:ci`.
- Run targeted admin invite smoke: `SMOKE_BASE_URL=http://127.0.0.1:4173 SMOKE_SUITE=preview npx playwright test --config=playwright.smoke.config.js tests/smoke/admin-invite-redemption.spec.js --reporter=line`.
- CI should run full `preview-smoke` with browser dependencies installed.

## Impacted Workflows
- Existing-user admin invite fallback from `edit-team.html`.
- Admin invite redemption from `accept-invite.html`.
- Roster rollover smoke dependency isolation only, no production behavior change.
