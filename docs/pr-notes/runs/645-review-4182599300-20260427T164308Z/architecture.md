# Architecture Role

## Decision
Fix the smoke harness, not production code. `edit-team.html` now imports `./js/db.js?v=76` and expects roster rollover exports. The smoke test still intercepted only `?v=15` and did not provide the new exports, so the page loaded the real DB module path in preview smoke.

## Architecture Notes
- Use a wildcard route for `**/js/db.js*` to make the smoke test resilient to intentional cache-bust changes.
- Add no-op rollover exports to the edit-team DB stub so existing-team admin tests can boot without invoking rollover behavior.
- Keep Firebase/data-path behavior unchanged. This is a static-site test isolation fix.

## Risk / Rollback
- Blast radius is limited to `tests/smoke/admin-invite-redemption.spec.js`.
- Rollback is reverting the smoke test update if CI shows unexpected behavior.
