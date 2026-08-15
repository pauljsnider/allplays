# Research and Product Decisions

Status: Proposed

Depends on: Current AllPlays navigation and publicly documented competitor behavior

## Objective

Choose a primary navigation model that reflects how AllPlays is actually used: sports operations, family coordination, team workspaces, and a real social/discovery layer.

## Observed AllPlays facts

At the planning base:

- Signed-in desktop navigation exposes Home, Schedule, Messages, My Teams, Profile, Family when applicable, and Discover.
- Signed-in mobile exposes Home, Schedule, Messages, and My Teams directly, with Profile, Family, and Discover inside More.
- Home contains its own Today, Feed, Players, Teams, and Friends section navigation.
- The header independently exposes Ask AllPlays, Notifications, Search, and a broad Add menu.
- Discover contains Opportunities and public Teams.
- The social model already contains feed filters for All, Friends, Teams, Players, Highlights, and Opportunities plus friendship management.
- Teams, Schedule, Messages, Player, Profile, and Family each contain meaningful nested navigation that must remain intact.

The problem is therefore not merely “seven icons are too many.” The product currently has three overlapping navigation systems: primary navigation, Home section navigation, and global header actions. Users must infer whether Teams or Players live under Home, whether Discover is separate from Feed, and whether creation starts globally or in a destination.

## Competitor evidence

The following are observations from official product or help documentation available on 2026-08-15. They support patterns; they do not prove that competitor structures should be copied literally.

### GameChanger

- GameChanger makes Home the entry point for team selection and places team creation behind the Home tab's top-right plus action. [Creating Your Team](https://help.gc.com/hc/en-us/articles/115005448866-Creating-Your-Team)
- Team search also begins from a search control in the Home tab. [Searching and Adding Teams to Your Account](https://help.gc.com/hc/en-us/articles/360019957491-Searching-and-Adding-Teams-to-Your-Account)
- Roster administration is contextual: Home → team → Team tab → player/staff actions. [Adding Players](https://help.gc.com/hc/en-us/articles/115005444183-Adding-Players), [Adding/Removing Staff Members](https://help.gc.com/hc/en-us/articles/115005457466-Adding-Removing-Staff-Members)

Inference: GameChanger demonstrates that team selection and contextual actions can reduce global navigation. It does not provide evidence that AllPlays should hide Teams, because AllPlays also has multi-team family coordination and a cross-team social layer.

### TeamSnap

- TeamSnap emphasizes Schedule, Roster, Messages, assignments, and team live updates as core workflows. [Parent/Player Dashboard](https://www.teamsnap.com/teams/member-toolkit)
- TeamSnap's Discover surface is training and instructional content, not a public people/team/social feed. [How to Maximize the TeamSnap App](https://www.teamsnap.com/blog/how-to/how-to-maximize-the-teamsnap-app)
- TeamSnap supports an all-team schedule and uses team selection within Schedule. [Viewing your all-team schedule](https://helpme-teams.teamsnap.com/article/2785-viewing-your-all-team-schedule)

Inference: TeamSnap supports keeping Schedule, Messages, and team/roster context prominent. Its Discover label should not be copied without explanation because the AllPlays meaning is materially different.

### Strava

- Strava gives Clubs a dedicated place under Groups, supports club search from Home or Groups, and gives a club its own events, posts, membership, and admin actions. [Clubs on the Mobile App](https://support.strava.com/en-us/articles/15401837-clubs-on-the-mobile-app)
- Club and direct messages are also aggregated into a global message hub. [Club Messages](https://support.strava.com/en-us/articles/15401541-club-messages)

Inference: Strava is the closest structural analogue for a product that combines a personal/cross-network feed with first-class group workspaces. This supports keeping Feed and Teams separate at the primary level while allowing discovery and creation inside each context.

### Spond

- Spond posts are group-scoped and reached through the selected group's Posts area. [Posts](https://help.spond.com/app/en/articles/118471-posts)

Inference: Group-scoped feeds work for operations-first products, but AllPlays already has cross-team following, friends, opportunities, and profiles. Collapsing all social activity into each Team would remove an existing cross-network use case.

## User needs

1. A parent must see urgent family actions and reach a child or team immediately.
2. A coach must reach a team workspace, schedule tools, roster, and messages without hunting through Home.
3. A player or fan must browse followed updates and discover relevant people, teams, and opportunities without confusing private operational content with public discovery.
4. A multi-team user needs a combined Schedule and Messages view before drilling into a team.
5. Every user needs predictable access to Search, Notifications, profile/settings, Help, and sign out.
6. Creation must be contextual enough to reduce choice overload but complete enough that no current workflow disappears.

## Options considered

### Option A — Five destinations with Feed and Teams (selected)

Bottom: Home · Schedule · Feed · Messages · Teams. Identity and Family move to You in the header.

Strengths:

- Gives the social network and team workspace distinct, understandable homes.
- Preserves high-frequency Schedule and Messages.
- Removes generic More and the duplicated Home section bar.
- Supports multi-team and multi-role users.

Risks:

- Feed extraction and compatibility routing are real implementation work.
- Users accustomed to Profile/Family in bottom navigation need clear avatar affordance and onboarding.
- Home must remain a fast player/team launcher or the change adds friction.

### Option B — Four destinations plus a central Create action

Bottom: Home · Schedule · Create · Messages · Teams. Feed is embedded in Home.

Strengths: creation is prominent and the bar is operationally focused.

Rejected because Feed would remain entangled with Home, Discover would still lack a clear parent, and a permanent Create slot represents an action rather than a stable destination.

### Option C — Home · Schedule · Messages · Teams · More

This is close to the current implemented model.

Strengths: smallest change and lowest migration cost.

Rejected as the long-term model because More continues to group unrelated Profile, Family, and Discover items while Home remains overloaded with five internal sections.

### Option D — Role-adaptive primary navigation

Parents see Players/Family while coaches see Teams/Manage.

Strengths: each role sees apparently relevant items.

Rejected as the default because many users hold multiple roles, destinations would move when permissions change, support instructions become inconsistent, and muscle memory is weakened. Role-aware content belongs inside stable destinations.

## Product decisions

1. Use Option A as the target architecture.
2. Keep the primary destinations stable across signed-in roles; filter nested tools by authorization.
3. Treat Feed as the parent of Following, Discover, and Friends.
4. Keep Teams first-class. Do not replace Teams with a Home shortcut.
5. Make Home a dashboard with direct player and team launchers, not a tabbed destination directory.
6. Move Profile, account settings, Family, Help, and sign out into You.
7. Keep Search and Notifications globally available in the header.
8. Replace the generic Add button with a destination-aware action; provide an overflow path when more than one relevant creation workflow exists.
9. Preserve signed-out Discover as a public route. Signed-in Discover appears inside Feed.
10. Do not add global public social-post discovery in this project. Require a separate youth-safety and moderation specification.

## Success criteria

- At least 95% of successful signed-in sessions render the five-item model without fallback or route mismatch.
- Median taps from Home to a visible player or team remain one; all accessible players and teams remain within two taps.
- Navigation-related not-found, redirect-loop, and permission-error rates do not increase.
- Schedule, message, and team task starts do not materially decline after rollout.
- Feed/Discover naming tests show that users understand Following as known-network content and Discover as finding new public entities/opportunities.
- Profile and Family findability meet the usability threshold defined before rollout.

## Tasks

- [ ] Validate the five-destination labels with at least five parents, five coaches/admins, and mixed-role users.
- [ ] Run first-click tests for player, team, RSVP, new post, find team, Family fees, and account settings tasks.
- [ ] Confirm whether the product label should be `Teams` or `My Teams`; use one label consistently after validation.
- [ ] Confirm whether `You` appears as an avatar only or avatar plus text on tablet/desktop.
- [ ] Record baseline task starts, taps, and navigation errors before implementation.
