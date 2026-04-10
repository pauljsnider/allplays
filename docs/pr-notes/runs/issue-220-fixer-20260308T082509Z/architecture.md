# Architecture Role (fallback synthesis)

## Root Cause
The app hard-codes team ownership for game reads, updates, and live subcollections, which prevents a single organization-level matchup from serving both teams.

## Minimal Safe Fix
- Add a pure shared-game projection module that converts a central shared game doc into a team-facing game shape.
- Use a synthetic game ID for projected shared games so team page URLs remain stable without colliding with local game IDs.
- Update `js/db.js` helpers to detect synthetic shared IDs and route reads and writes to the shared game document path.

## Blast Radius
- Primary: `js/db.js`
- New pure helper: `js/shared-games.js`
- No page-specific UI flow changes in this patch.

## Controls
- Unit tests for projection, placeholder naming, and merge behavior.
- Team-owned game paths remain the default path and unchanged for existing callers.
