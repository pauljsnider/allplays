# Architecture Role

## Decision
Apply a test-only smoke harness fix. `edit-team.html` imports `escapeHtml` from `./js/utils.js?v=8`; the smoke `EDIT_TEAM_UTILS_STUB` did not export it, preventing the page module from evaluating and leaving event handlers unbound.

## Architecture Decisions
- Add a deterministic `escapeHtml` export to the edit-team utils stub.
- Do not change production Firebase, Firestore rules, invite semantics, or roster rollover logic.
- Keep blast radius limited to `tests/smoke/admin-invite-redemption.spec.js`.

## Risks And Rollback
- Risk: future import/stub drift can produce misleading smoke failures.
- Mitigation: this stub now matches the current edit-team imports.
- Rollback: revert the smoke stub change. No production rollback required.
