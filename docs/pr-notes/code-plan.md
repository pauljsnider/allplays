# Code Role Plan Notes (Issue #28)

## Objective
Deliver a scoped implementation for issue #28 in `drills.html` and `js/db.js`.

## Plan
1. Data/query changes (`js/db.js`)
- Add `getPublishedDrills(options)` for published custom drill retrieval.
- Harden `uploadDrillDiagram` with image-storage fallback to main storage.

2. Library behavior (`drills.html`)
- Import new query + team access helpers.
- Community tab: merge `getDrills` + `getPublishedDrills` and dedupe.
- My Drills tab: aggregate drills across all accessible teams.

3. Drill detail UX (`drills.html`)
- Linkify instruction URLs.
- For `drillYoutubeUrl`: embed YouTube, otherwise render clickable external resource link.
- Update form label/help text to indicate non-YouTube links are supported.

4. Planning/Practice workflow (`drills.html`)
- Add Free Text block action in structure picker.
- Implement `blockType: 'note'` render/edit/save behavior.
- Guard structure nesting to drills only.
- Add Practice Mode “View Drill Details” button + handler for current playback block.

5. Validation + PR
- Run relevant test command(s).
- Commit with issue-linked message and open PR including `Closes #28` and Role Summaries references.
