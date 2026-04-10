Objective: protect the live viewer contract for persisted opponent stats.

Current state:
- Tracker persistence stores opponent identity fields plus numeric stats, with fouls written separately.
- Viewer rendering trusts configured stat columns and has no contract test tying saved opponent snapshots to rendered output.

Proposed state:
- Add a unit-level contract test around the viewer-facing opponent panel output.
- Require persisted opponent identity and fouls to render even when configured columns omit fouls.

Risk surface:
- Live viewer only.
- Blast radius is limited to opponent stats rendering on `live-game.html`.

Assumptions:
- Opponent snapshots keep `name`, `number`, `photoUrl`, and `fouls` in Firestore.
- Viewer should show fouls as `FLS` when the config omits a fouls column.

Recommendation:
- Extract the opponent-panel rendering contract into a pure helper and test alias handling there.

Success measure:
- A persisted opponent snapshot with non-zero fouls renders identity plus the foul value on the viewer path.
