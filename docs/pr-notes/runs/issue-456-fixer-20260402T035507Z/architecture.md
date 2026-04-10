# Architecture Role (allplays-architecture-expert)

## Root Cause
`getUpcomingLiveGames()` excludes practices and completed games but does not exclude `status: 'cancelled'`, so homepage consumers receive cancelled records and render them as normal upcoming cards.

## Minimal Safe Fix
- Filter cancelled games out of `getUpcomingLiveGames()` at the source.
- Add a homepage-level guard so cancelled upcoming entries do not render even if upstream data is stale or partially filtered.

## Blast Radius
- Data source change is limited to `js/db.js` upcoming-game discovery.
- UI guard is limited to `js/homepage.js` card composition for the index page.

## Controls
- Add a unit regression test for homepage rendering with mixed upcoming game statuses.
- Keep the patch local to cancellation filtering; no routing or schema changes.
