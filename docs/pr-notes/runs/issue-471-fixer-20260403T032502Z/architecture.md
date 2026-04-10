Objective: fix the destructive update path without changing Firestore write semantics outside the player edit UI.

Current state:
- `player.html` constructs the update payload inline in the submit handler.
- `js/db.js:updatePlayerProfile()` only writes private profile fields when those keys are present.

Proposed state:
- Keep `updatePlayerProfile()` unchanged.
- Move payload construction in `player.html` behind a small helper that decides whether to include private fields based on modal read status and per-field dirty flags.

Why this path:
- The bug originates in UI payload shaping, not in the Firestore helper.
- Fixing in the UI keeps the blast radius narrow and preserves existing behavior for other callers of `updatePlayerProfile()`.

Controls:
- No schema changes.
- No security-rule changes.
- No behavioral change for successful private-profile reads.
- Reduced destructive write risk when the private-profile read fails.

Rollback:
- Revert the `player.html` helper and event wiring if needed.
- Unit tests added in this change should fail again on rollback, providing a quick signal.
