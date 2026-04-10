Test strategy:
- Add a Vitest regression test that extracts the player edit payload helper from `player.html`.
- Cover three cases:
  1. private-profile read failed and user only changed the photo
  2. private-profile read succeeded and normal private fields are included
  3. private-profile read failed but the user explicitly changed private fields
- Add a `js/db.js` unit test confirming `updatePlayerProfile()` does not write the private profile doc when only `photoUrl` is present.

Why unit coverage over Playwright:
- The repo already has broad Vitest source-extraction coverage and no established Playwright setup for this flow.
- The bug is deterministic in payload construction and Firestore call shaping, so unit tests give fast, stable regression protection.

Validation plan:
- Run the new targeted tests first to prove failure against current code.
- After the fix, rerun the targeted tests.
- Run the full unit suite if time permits and there is no unrelated breakage.
