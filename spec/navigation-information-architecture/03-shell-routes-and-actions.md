# Shell, Routes, and Action Migration

Status: Proposed

Depends on: [Complete information architecture](./02-complete-information-architecture.md)

## Objective

Define one centralized navigation contract, preserve existing deep links, and map every current global action to a clear destination owner.

## Shell requirements

1. Define primary destinations and their route families in one typed navigation model consumed by mobile bottom navigation, tablet rail, desktop sidebar, active-state logic, page titles, preload behavior, analytics, and tests.
2. Signed-in mobile shows exactly five primary destinations in this order: Home, Schedule, Feed, Messages, Teams.
3. The top app bar contains a contextual action, Search, Notifications, and You. On narrow screens, controls may become icon-only but retain accessible names and 44-by-44-pixel targets.
4. The contextual action is derived from the canonical destination and current authorization, never merely from a user-controlled URL.
5. You is visually active for Profile, settings, Family, and Help descendants without occupying the bottom bar.
6. Nested routes keep the correct primary destination active, including query-driven Team, Player, Schedule, Feed, and Messages states.
7. Public/signed-out navigation remains separate. Public Discover and public team routes are not forced into the signed-in shell.
8. Native back dismisses an open Search, Notifications, action menu, or You menu before navigating away.
9. Safe-area padding, keyboard visibility, compact chat detail, and AI detail behavior continue to work in Capacitor shells.
10. Shell rendering must not trigger new authorization or domain-data reads solely to decide navigation. It may consume already authoritative access summaries.

## Canonical route model

Recommended new signed-in routes:

| Canonical route | Owner | Notes |
|---|---|---|
| `/home` | Home | Dashboard; no section tab |
| `/schedule` | Schedule | Existing query model retained |
| `/feed` | Feed / Following | New page shell reusing existing social components |
| `/feed?tab=discover` | Feed / Discover | Signed-in discovery |
| `/feed?view=friends` | Feed / Friends | Friends management |
| `/messages` | Messages | Existing inbox |
| `/teams` | Teams | Existing team list/workflow entry |
| `/profile` | You / public profile | Existing route |
| `/profile/settings` | You / settings | Existing route |
| `/parent-tools` | You / Family | Existing route family |
| `/help` | You / Help | Existing route family |

The exact Feed query names may change during implementation, but they must be typed, documented, and tested. Path ownership and compatibility behavior are normative.

## Compatibility and redirect matrix

| Existing URL | Signed-in target | Signed-out behavior | Context to preserve |
|---|---|---|---|
| `/home?section=today` | `/home` | Existing public Home behavior | Other safe Home query values |
| `/home?section=feed` | `/feed` | Existing public behavior | `social`, `type`, safe composer fields |
| `/home?section=friends` | `/feed?view=friends` | Sign-in flow as today | Request/profile context |
| `/home?section=players` | `/home#players` or typed launcher state | Existing public behavior | Selected player if valid |
| `/home?section=teams` | `/teams` | Existing public behavior | Team/workflow query if valid |
| `/discover` | `/feed?tab=discover` | Keep public Discover | `tab`, filters, cursor only when safe |
| `/discover/new` | Feed Discover create flow or existing form | Existing auth handoff | Validated `next` and draft state |
| `/discover/manage` | Feed Discover management | Existing auth handoff | Listing/inquiry context |
| `/people/:userId` | Feed-owned detail, same URL initially | Sign in as today | User ID |
| `/profile` | Same URL under You | Sign in as today | None |
| `/profile/settings?...` | Same URL under You | Sign in as today | `section`, validated `teamId` |
| `/parent-tools/:toolId` | Same URL under You | Sign in as today | Valid tool ID |

Compatibility may be implemented as route adapters before hard redirects. Do not redirect until the new destination can restore the same selected subview and creation state. Invalid or unsafe parameters fall back to the destination root.

## Route-family active ownership

| Route family | Active primary destination |
|---|---|
| `/home`, `/ai`, `/officials` | Home |
| `/schedule/**`, `/games/:gameId` | Schedule |
| `/feed`, signed-in `/discover/**`, `/people/**` | Feed |
| `/messages/**` | Messages |
| `/teams/**`, `/players/**` | Teams |
| `/profile/**`, `/parent-tools/**`, `/help/**` | You |
| `/accept-invite` | Teams when opened inside signed-in shell; otherwise standalone |
| `/registration`, `/family/:token`, public team routes | Standalone/public owner |

## Contextual action mapping

### Home

- Primary: Ask AllPlays → `/ai`.
- Secondary Home modules link to the relevant Schedule, Feed, Player, Team, Family, Messages, or Officials destination.

### Schedule

- Staff: Add event menu → game, practice, tournament, and calendar source/import.
- Family-only: Calendar/export or no creation action; do not show unauthorized Add.
- Detail routes: event-safe actions such as RSVP or game tools remain inside event content rather than replacing global navigation.

### Feed

- Primary: Create post.
- Discover context: Post opportunity may be a secondary action.
- Friends context: Find people or manage requests may be a secondary action.

### Messages

- Primary: New message.
- Composer allows team/group and authorized direct recipients only.

### Teams

- Primary action menu: Create team, Join with code, Find team.
- Inside a Team: role-aware team action or overflow; existing Team More remains the complete operational directory.

## Complete legacy Add-workflow mapping

| Current section / action | New canonical location | Existing target retained initially |
|---|---|---|
| Team / Create team | Teams action | `/teams/new` |
| Team / Join with code | Teams action | `/accept-invite` |
| Team / Find team | Teams action and Feed / Discover / Teams | `/teams/browse` |
| Player / Add player | Team / Roster action | `/teams?workflow=roster` until a team is selected |
| Player / Share with family | You / Family / Share and Player / Family | `/parent-tools/share` |
| Player / Player profile | Home player launcher or Team roster → Player / Profile | Replace the ambiguous `/home` fallback only after player selection exists |
| Schedule / Game or practice | Schedule action | Existing staff-tools query |
| Schedule / Practice packet | Schedule / Packets or Team / Drills | Existing website link until migrated |
| Schedule / Calendar sync | Schedule export and You / Family / Calendar | `/parent-tools/calendar` |
| Social / Post moment | Feed action | New `/feed` composer; legacy Home alias accepted |
| Social / Public opportunity | Feed / Discover / Opportunities | `/discover/new` compatibility |
| Social / Find friends | Feed / Friends or Discover / People | Legacy Home friends alias accepted |
| Social / Share game recap | Event report → Feed composer | Preserve event/game context |
| Team Ops / Photos/video | Selected Team / More / Media | `/teams` chooser until team selected |
| Team Ops / Registration | Selected Team / More / Registrations | `/parent-tools/registrations` for family registrations |
| Team Ops / Fees | Selected Team / More / Fees or You / Family / Fees | `/teams?workflow=fees` for staff |
| Team Ops / Awards | Selected Team / More / Certificates or You / Family / Awards | `/teams` chooser for staff |

No legacy workflow may disappear merely because its global Add card is removed. Each migration requires an automated route/action assertion.

## Search and notifications

- Search remains global and keeps the existing keyboard shortcut.
- Results may include teams, players, people, events, opportunities, and help content as currently authorized.
- A result opens the canonical route owner and sets the matching primary active state.
- Notifications retain unread badge, mark-read behavior, and deep links. Notification destinations pass through the compatibility resolver so old payload URLs remain valid.

## New frontend contracts

Expected net-new frontend abstractions:

- `NavigationDestination` model with label, icon, canonical path, route matcher, public/signed-in visibility, preload hint, analytics key, and responsive placement.
- `ContextualAction` model with authorization predicate, primary action, overflow actions, and accessible label.
- Compatibility route resolver for Home sections and signed-in Discover.
- You menu/hub composition.
- Feed route/page composition.
- Navigation analytics event helper.

These should be frontend-only. Existing domain services remain the source of team, schedule, social, opportunity, message, profile, and family data.

## Tasks

- [ ] Define and unit-test the centralized destination and contextual-action models.
- [ ] Define query schemas for new Feed states and reject invalid values.
- [ ] Implement compatibility adapters before redirects.
- [ ] Preserve notification, search, auth `next`, and native deep-link destinations.
- [ ] Add route ownership tests for every family in the active-state table.
- [ ] Add one mapping test for every legacy Add workflow.
- [ ] Remove old Home-section and More-nav code only after compatibility telemetry passes.
