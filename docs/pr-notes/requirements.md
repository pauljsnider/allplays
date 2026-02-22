# Requirements Role Notes (Issue #28)

## Objective
Resolve drill workflow feedback so coaches can publish/share drills reliably, attach external drill resources, capture non-drill planning notes, and access drill details during Practice Mode.

## Current State
- Drill detail only embeds YouTube links and renders instructions as plain text.
- Diagram upload can fail hard when image-bucket auth/storage permissions reject writes.
- Community tab queries only `source == community`, so published custom drills are excluded.
- My Drills tab is team-scoped (`getTeamDrills(state.teamId)`), so drills are hidden when switching teams.
- Practice Mode lacks a direct way to open the current drill’s detail view.
- Planning supports drill and structure blocks, but no first-class free-text planning block.

## Proposed State
- Accept any resource URL in drill form; embed YouTube and show non-YouTube links as clickable external resources.
- Linkify URLs inside instructions text.
- Add storage fallback for drill diagrams when image storage auth/permission blocks uploads.
- Include published custom drills in Community tab results.
- Aggregate My Drills across all teams the user can access.
- Add a dedicated Free Text timeline block.
- Add Practice Mode “View Drill Details” button for current linked drill.

## Risk Surface / Blast Radius
- Primary blast radius is `drills.html` drill library + practice mode rendering and `js/db.js` drill queries/uploads.
- Query/path changes are read-heavy and do not alter existing stored schema requirements.
- New `note` block type expands timeline state shape; must remain backward compatible with existing drill/structure blocks.

## Assumptions
- Issue #28 should be addressed in this PR as an operational fix set, not split across multiple PRs.
- Cross-team My Drills should include all teams where the user has owner/admin/coach access.
- Community should include both seeded community drills and custom drills marked `publishedToCommunity`.

## Recommendation
Ship one incremental PR with UI + query + fallback + timeline-type changes together, because these items are tightly coupled in the drill workflow and easiest to validate end-to-end in one pass.
