# QA analysis

## Regression strategy

Update the nearest source-contract test, `tests/unit/parent-dashboard-redeem-code-wiring.test.js`, so the pre-fix implementation fails because it calls `redeemParentInvite` and the fixed implementation passes only when it routes the encoded code to the canonical app accept-invite route.

Existing `tests/unit/accept-invite-flow.test.js` cases already prove that the shared processor dispatches household codes to `redeemHouseholdInvite` and co-parent codes to `redeemCoParentInvite`, so duplicating those processor unit cases is unnecessary. Together, the wiring test and existing dispatch tests cover the full defect chain.

## Focused validation

Run `npx vitest run tests/unit/parent-dashboard-redeem-code-wiring.test.js tests/unit/accept-invite-flow.test.js --reporter=verbose`.

The requested QA subagent could not start because the subagent runtime reported `published reply runtime missing for main`; this artifact records the main-run synthesis needed to continue.
