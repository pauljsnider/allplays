# Code Role (fallback synthesis)

- Requested `allplays-orchestrator-playbook`, `allplays-code-expert`, and `sessions_spawn` tooling is unavailable in this runtime; equivalent role outputs are recorded in this run directory.
- Findings:
  - PR head already includes the substantive feedback fix in commit `61a19fc580`.
  - `tests/unit/parent-dashboard-rideshare-access-sync.test.js` still expected the pre-fix `submitRideOfferFromForm(teamId, gameId, eventKey)` signature and had no assertion for legacy fallback ids.
- Smallest safe patch:
  - update that test to match `submitRideOfferFromForm(teamId, gameId, legacyGameId, eventKey)`
  - assert `createRideOffer(..., { fallbackGameIds })` is used
  - assert `getLegacyRideEventId()` and `refreshRideshareForEvent(..., legacyGameId)` preserve legacy recurring-practice rideshare keys
- Validation target:
  - `node .../vitest.mjs run tests/unit/ics-tracking-ids.test.js tests/unit/rideshare-helpers.test.js tests/unit/parent-dashboard-rideshare-wiring.test.js tests/unit/parent-dashboard-rideshare-access-sync.test.js`
