# Architecture Role (allplays-architecture-expert)

## Root Cause
`edit-config.html` delegates delete directly to `deleteConfig`, and `js/db.js` deletes the config document without checking for dependent `games/{gameId}.statTrackerConfigId` references.

## Minimal Safe Fix
- Enforce the guard in `js/db.js` before `deleteDoc` by querying the current team's games for `statTrackerConfigId == configId` with `limit(1)`.
- Throw a user-safe error when a reference exists.
- Catch that error in `edit-config.html` and surface it via `alert(...)`.

## Blast Radius
- Data-layer change is limited to stat config deletion.
- UI change is limited to the delete button flow on `edit-config.html`.

## Controls
- Team-scoped query preserves tenant isolation.
- Guard at the shared DB helper prevents future callers from bypassing the protection accidentally.
