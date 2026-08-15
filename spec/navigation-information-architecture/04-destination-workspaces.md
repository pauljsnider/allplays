# Destination Workspace Requirements

Status: Proposed

Depends on: [Complete information architecture](./02-complete-information-architecture.md), [shell, routes, and action migration](./03-shell-routes-and-actions.md)

## Objective

Define what changes—and what must remain stable—inside each destination after the navigation hierarchy is reorganized.

## Home

### Requirements

1. Home is a dashboard, not a tab container. Remove Today, Feed, Players, Teams, and Friends section navigation after their target destinations are available.
2. The first useful viewport prioritizes urgent actions and the next event, then direct player and team launchers.
3. Every visible player card opens that Player workspace in one tap.
4. Every visible team card opens that Team workspace in one tap. If only one team is available, do not remove the explicit card or make Teams navigation unpredictable.
5. Users with more players or teams than fit the preview reach the complete collection in no more than one additional tap.
6. Keep a compact Feed preview that opens Feed / Following; do not duplicate filtering, composer, or friends management on Home.
7. Keep Ask AllPlays available as the Home contextual action and a discoverable Home module.
8. Preserve urgent action types, fee visibility, role-aware Officials access, partial-data handling, caching, and retry behavior.
9. A partial empty player/team load must not make Home claim the user has no players or teams or remove their last complete launcher state.

### Acceptance criteria

- Home has no horizontal destination subnav.
- A first-click test finds Player, Team, RSVP, and Ask AllPlays without opening an overflow menu.
- Player/team launcher tap counts meet the README definition of done.
- Home unit and smoke tests cover zero, one, many, partial, mixed-role, and offline states.

## Feed

### Requirements

1. Feed has two primary modes: Following and Discover.
2. Following reuses the existing authorized social feed and supports All, Friends, Teams, Players, and Highlights filters.
3. Opportunities is removed from Following filters and owned by Discover.
4. Discover initially contains Opportunities, Teams, and People using existing opportunity, public-team, and friendship/people discovery capabilities.
5. Friends management is part of Feed and retains current friends, incoming, outgoing, suggestions, search, profile, block/remove, and direct-message behavior according to existing permissions.
6. Public/friend profiles retain Overview, Posts, Teams, and Players sections, with the same audience filtering and self-profile behavior.
7. Opportunity management retains My listings, Inquiries, and moderator-only Reports views.
8. Post composition retains moment/photo, game recap, player stat, and update types plus existing visibility rules.
9. Following must not broaden a post's audience. Discover must not expose a private post, youth profile, roster detail, or team-only content.
10. A global public post/highlight Discover mode remains disabled until a separate safety specification covers eligibility, moderation, reporting, ranking, youth privacy, retention, and rules.
11. Signed-out `/discover` continues to render the public Opportunities/Teams experience.
12. Empty, error, partial, loading-more, composer, and moderation states retain accessible next actions.

### Acceptance criteria

- Following and Discover have tab semantics and URL-restorable state.
- Existing feed/friend/opportunity/team discovery behaviors pass through shared components or adapters.
- Private content never enters Discover fixtures.
- Old Home feed/friends and signed-in Discover links resolve to the matching Feed state.

## Teams

### Requirements

1. Teams stays in primary navigation for all signed-in users, including users with zero, one, or many teams.
2. The Teams root includes My Teams plus Find a Team, Join with Code, and Create Team when permitted.
3. Preserve the Team workspace tabs Overview, Schedule, Roster, Insights, and More.
4. Preserve every More section and item in the complete hierarchy; role filtering continues to use authoritative access.
5. Preserve Team Drills Community and Favorites tabs and Team Media All, Photos, Videos, and Files filters.
6. Player selection from Roster opens the Player workspace while Teams remains the active primary owner.
7. Team context may flow to Schedule and Messages, but those destinations continue to support all-team views and their own canonical roots.
8. Do not change team discovery, detail, roster, settings, media, fees, registration, awards, drills, insights, or public-team services as part of navigation-only work.

### Acceptance criteria

- Zero-team users see clear Find, Join, and Create next actions.
- Single-team users can still reach the Teams root; context shortcuts may deep-link but must not erase the root.
- Parent, coach/admin, and mixed-role More sections match current authorization behavior.

## Schedule

### Requirements

1. Preserve Family and Team-management role sections and all current role submenu items.
2. Preserve List, Compact, Calendar, and Packets views; all six primary filters; all four ranges; Team and Player scope; and URL restoration.
3. Preserve event detail Availability, conditional Rideshare, conditional Assignments, and Game/More sections.
4. Preserve all game hub and report subpanels named in the complete hierarchy.
5. Schedule's contextual action reflects current authoritative staff access. Family-only users must not receive staff creation actions.
6. Event and tracker deep links remain canonical and keep Schedule active.
7. Existing schedule services, completeness rules, caches, RSVP, rideshare, assignments, imports, AI management, tracker, and game-report logic are unchanged.

### Acceptance criteria

- Existing Schedule and event-detail query links survive reload, back, and notification launch.
- Role switching and active subnav work at mobile and desktop widths.
- No existing Schedule test is weakened merely to accommodate the new shell.

## Messages

### Requirements

1. Preserve the global inbox, search, opportunity conversations, team inboxes, team/staff/custom/direct conversation switching, unread counts, mute state, attachments, moderation, and pagination.
2. Messages contextual action opens a new-message flow using only currently authorized teams, groups, and recipients.
3. Opportunity inquiries remain visible in Messages even though listings are owned by Feed / Discover.
4. Compact mobile chat detail may hide the bottom bar while the conversation is open if the current behavior requires it, but back must return to the Messages inbox.
5. Existing partial team discovery and preview behavior remains fail-safe; incomplete empty discovery cannot become an authoritative empty inbox.

### Acceptance criteria

- Message deep links and notification links preserve team/conversation/inquiry selection.
- Existing chat service and component tests remain unchanged except where shell expectations move.

## Player workspace

### Requirements

1. Preserve Overview, Schedule, Reports, and Profile sections with current access-dependent visibility.
2. Preserve all Reports, Profile, and Incentive subpanels listed in the complete hierarchy.
3. Keep Teams as the primary owner because a player is reached from a team/roster relationship; Home may also launch directly.
4. Preserve both `/players/:teamId/:playerId` and compatibility `/players/:playerId` routes until all callers use canonical identity.
5. No change to athlete-profile privacy, uploads, family contacts, incentives, stats, clips, or sharing is authorized by this specification.

## You, Profile, and Family

### Requirements

1. You is available from the avatar in the top bar and exposes public profile, account settings, Family when applicable, Help, and sign out.
2. The menu identifies the signed-in user and current role context without exposing private identifiers.
3. Preserve public profile sections: Overview, Posts, Teams, and Players.
4. Preserve Profile settings sections: Profile, Notifications, Invites, and Sign-in & security.
5. Preserve Family tools: Access, Household, Fees, Calendar, Share, Register, and Awards.
6. Family visibility remains role/access-driven. An access load that is partial and empty must not prematurely remove a previously authoritative Family entry.
7. Sign out remains a deliberate action and preserves existing cleanup/navigation behavior.
8. The You surface may be a menu plus hub page, but frequently deep-linked Profile/Family routes remain addressable and refresh-safe.

### Acceptance criteria

- Users find public profile, notification settings, fees, and awards in first-click testing.
- You is keyboard accessible, traps focus when modal, closes on Escape/backdrop/native back, and returns focus to the avatar.
- Profile and Family business-logic suites require no service mocks solely for the new shell.

## Cross-destination requirements

- Loading and error states must not cause primary destinations to reorder or disappear.
- A destination preview never becomes a second editable copy of the canonical workspace.
- Creation returns to the destination that owns the result.
- Back and deep-link fallback are deterministic.
- Scroll position is preserved independently per primary destination where practical.
- Notification and search results always open the canonical owner.
- No route move broadens read or write authority.

## Tasks

- [ ] Extract reusable Feed and Friends sections from Home without duplicating service calls.
- [ ] Replace Home section navigation with launchers and previews.
- [ ] Add You composition around existing Profile and ParentTools routes.
- [ ] Wire contextual actions to existing flows.
- [ ] Verify every conditional subnav against parent-only, staff-only, mixed-role, and no-team fixtures.
