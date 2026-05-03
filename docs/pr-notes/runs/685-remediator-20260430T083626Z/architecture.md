# Architecture

## Current State
PR #685 adds a read-only Local Attractions presentation slice to `team.html` backed by a new `teams/{teamId}/sponsors` Firestore subcollection.

## Architecture Decisions
- Keep sponsor rendering client-side and isolated to the public team page.
- Load sponsors through `getLocalAttractionSponsors(teamId)` in `js/db.js`.
- Normalize sponsor data and sanitize outbound URLs in `js/local-attractions.js`.
- Hide the section when no published local-attraction sponsors are available.
- Treat Firestore read failures as non-blocking so the rest of the team page still renders.

## Controls And Blast Radius
- Write access remains restricted to team owner/admin roles.
- Public read access is limited to sponsor documents marked published by supported publication fields.
- Client filtering limits rendered cards to local-attraction placements.
- URL rendering rejects non-HTTP protocols and escapes displayed values.
- Blast radius is limited to sponsor documents under a team. No player private profile, auth, game event, chat, or tracker permissions are changed.

## Rollback
Revert the PR commit that introduced the isolated rules block, helper module, DB function, team page section, and unit test. No data migration is required.
