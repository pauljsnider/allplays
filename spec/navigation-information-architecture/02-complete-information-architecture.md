# Complete Information Architecture

Status: Proposed

Depends on: [Research and product decisions](./01-research-and-product-decisions.md)

## Objective

Define the complete signed-in hierarchy from the global shell through every existing subnavigation and sub-subnavigation surface affected by the change. Items marked conditional appear only when the user, team, event, or data supports them.

## Target hierarchy: top to bottom

```text
SIGNED-IN APP
├─ Top app bar
│  ├─ Left: AllPlays brand on roots; Back + destination/team/player title on detail routes
│  └─ Right
│     ├─ Contextual action
│     │  ├─ Home: Ask AllPlays
│     │  ├─ Schedule: Add event / schedule actions (role-aware)
│     │  ├─ Feed: Create post
│     │  ├─ Messages: New message
│     │  ├─ Teams: Create, join, or find team
│     │  └─ Detail routes: the safest primary action for that object, or none
│     ├─ Search
│     ├─ Notifications
│     └─ You (avatar)
│        ├─ View public profile
│        │  ├─ Overview
│        │  ├─ Posts
│        │  ├─ Teams
│        │  └─ Players
│        ├─ Account settings
│        │  ├─ Profile
│        │  ├─ Notifications
│        │  ├─ Invites
│        │  └─ Sign-in & security
│        ├─ Family (conditional)
│        │  ├─ Access
│        │  ├─ Household
│        │  ├─ Fees
│        │  ├─ Calendar
│        │  ├─ Share
│        │  ├─ Register
│        │  └─ Awards
│        ├─ Help
│        │  └─ Help article
│        └─ Sign out
│
├─ Primary destination: Home
│  ├─ Greeting / role context
│  ├─ Urgent action queue
│  │  ├─ RSVP
│  │  ├─ Practice packet
│  │  ├─ Assignment
│  │  ├─ Rideshare
│  │  ├─ Fee
│  │  └─ Message
│  ├─ Next event / upcoming schedule preview
│  ├─ Players launcher
│  │  ├─ Player card → Player workspace
│  │  └─ View all players (when needed)
│  ├─ Teams launcher
│  │  ├─ Team card → Team workspace
│  │  └─ View all teams → Teams
│  ├─ Feed preview → Feed / Following
│  ├─ Family preview → You / Family (conditional)
│  ├─ Ask AllPlays
│  └─ Officials → Officials workspace (role-aware)
│
├─ Primary destination: Schedule
│  ├─ Role switch (when both are available)
│  │  ├─ Family schedule
│  │  │  ├─ Agenda
│  │  │  ├─ RSVP needed
│  │  │  ├─ Calendar
│  │  │  └─ Practice packets
│  │  └─ Team management
│  │     ├─ Team schedule
│  │     ├─ Add event
│  │     ├─ Attendance
│  │     └─ Manage with AI
│  ├─ View
│  │  ├─ List
│  │  ├─ Compact
│  │  ├─ Calendar
│  │  └─ Packets
│  ├─ Primary filter
│  │  ├─ All Upcoming
│  │  ├─ Upcoming Games
│  │  ├─ Upcoming Practices
│  │  ├─ Availability
│  │  ├─ Recent Results
│  │  └─ Past Events
│  ├─ Range
│  │  ├─ Week
│  │  ├─ Month
│  │  ├─ Quarter
│  │  └─ All
│  ├─ Scope filters
│  │  ├─ Team
│  │  └─ Player (family context)
│  ├─ Staff tools (conditional)
│  │  ├─ Create game
│  │  ├─ Create practice
│  │  ├─ Create tournament
│  │  ├─ Calendar source/import
│  │  └─ AI schedule management
│  └─ Event detail
│     ├─ Availability
│     ├─ Rideshare (conditional)
│     ├─ Assignments / Tasks (conditional)
│     └─ Game, or More for a practice
│        ├─ Foul tracker
│        ├─ Live chat
│        ├─ Live reactions
│        ├─ Post-game wrap-up
│        ├─ Statsheet import
│        ├─ Lineup builder
│        ├─ Live substitutions
│        └─ Report sections
│           ├─ Summary
│           ├─ Players
│           ├─ Plays
│           ├─ Opponent (conditional)
│           ├─ Insights (conditional)
│           └─ Media (conditional)
│
├─ Primary destination: Feed
│  ├─ Following
│  │  ├─ All
│  │  ├─ Friends
│  │  ├─ Teams
│  │  ├─ Players
│  │  └─ Highlights
│  ├─ Discover
│  │  ├─ Opportunities
│  │  │  ├─ Opportunity detail
│  │  │  ├─ Post opportunity
│  │  │  ├─ Edit opportunity
│  │  │  ├─ Manage listings & inquiries
│  │  │  │  ├─ My listings
│  │  │  │  ├─ Inquiries
│  │  │  │  └─ Reports (platform moderator conditional)
│  │  │  └─ Private inquiry → Messages
│  │  ├─ Teams
│  │  │  ├─ Search/filter public teams
│  │  │  └─ Public team detail
│  │  ├─ People
│  │  │  ├─ Search
│  │  │  ├─ Suggestions
│  │  │  └─ Public/friend profile
│  │  └─ Public posts/highlights (future, blocked pending separate safety spec)
│  ├─ Friends
│  │  ├─ Current friends
│  │  ├─ Incoming requests
│  │  ├─ Outgoing requests
│  │  ├─ Suggestions/search
│  │  └─ Friend profile / direct message
│  └─ Create post
│     ├─ Photo or moment
│     ├─ Game recap
│     ├─ Player stat
│     └─ Update
│
├─ Primary destination: Messages
│  ├─ Search conversations
│  ├─ Opportunity conversations
│  │  └─ Inquiry detail
│  ├─ Team inbox
│  │  └─ Team conversation workspace
│  │     ├─ Team
│  │     ├─ Staff (conditional)
│  │     ├─ Custom group (conditional)
│  │     └─ Direct conversation (conditional)
│  └─ New message
│     ├─ Team / group
│     └─ Authorized direct recipient
│
└─ Primary destination: Teams
   ├─ My Teams
   │  └─ Team card → Team workspace
   ├─ Find a Team
   ├─ Join with Code
   ├─ Create Team (role/capability-aware)
   └─ Team workspace
      ├─ Overview
      ├─ Schedule
      ├─ Roster
      │  └─ Player → Player workspace
      ├─ Insights
      └─ More
         ├─ Use now
         │  ├─ Team page
         │  ├─ Schedule (when available)
         │  ├─ Messages
         │  └─ Practice packets (when available)
         ├─ Team resources
         │  ├─ Website team page
         │  ├─ Player profile(s) (when linked)
         │  ├─ Media
         │  ├─ My fees
         │  ├─ Registrations
         │  └─ Awards
         └─ Coach/admin tools (conditional)
            ├─ Team settings
            ├─ Manage roster
            ├─ Manage schedule
            ├─ Fees
            ├─ Team drills
            ├─ Game plan
            ├─ Game day
            ├─ Tracking
            ├─ Stats config
            └─ Certificates
```

## Object workspaces reached from the hierarchy

```text
PLAYER WORKSPACE
├─ Overview
├─ Schedule (access/data conditional)
├─ Reports (parent or staff conditional)
│  ├─ Overview
│  ├─ Game Stats
│  ├─ Season Averages
│  ├─ Game Events
│  └─ Video Clips
└─ Profile
   ├─ Edit Profile / Roster / Info (role-aware label)
   ├─ Athlete Profile (linked parent)
   ├─ Family
   └─ Incentives (linked parent)
      ├─ Overview
      ├─ Rules
      └─ Payouts

TEAM CHILD ROUTES
├─ Public team detail
├─ Team settings
├─ Certificates
├─ Team drills
│  ├─ Community
│  └─ Favorites
├─ Fees
│  └─ Fee batch
├─ Media
│  ├─ All
│  ├─ Photos
│  ├─ Videos
│  └─ Files
├─ Registration forms
└─ Registration review

OTHER DEEP-LINKED WORKSPACES
├─ Ask AllPlays
├─ Officials
├─ Game compatibility route → canonical Schedule event detail
├─ Live tracker
├─ Registration detail
├─ Accept invite
├─ Capability page
├─ Public Family share
└─ Help article
```

## Current-to-target ownership

| Current surface | Target owner | Treatment |
|---|---|---|
| Home / Today | Home | Becomes the only Home canvas; remove Home section tabs |
| Home / Feed | Feed / Following | Move existing components and preserve alias |
| Home / Friends | Feed / Friends | Move existing components and preserve alias |
| Home / Players | Home launcher + Player workspace | Keep launcher on Home; no Home tab |
| Home / Teams | Home launcher + Teams | Keep launcher on Home; full list lives in Teams |
| Discover / Opportunities | Feed / Discover / Opportunities | Move for signed-in users; preserve public route |
| Discover / Teams | Feed / Discover / Teams | Move for signed-in users; share public team search |
| Friend search/suggestions | Feed / Discover / People and Feed / Friends | Reuse one people-discovery model |
| Profile | You / View public profile | No business-logic rewrite |
| Profile settings | You / Account settings | Preserve four settings sections |
| Family | You / Family | Preserve seven Family tools |
| Global Ask AllPlays | Home contextual action and Home module | Preserve `/ai` deep link |
| Global Add | Destination contextual actions | Map every workflow in the route/action specification |
| Search | Top app bar | Preserve global scope and shortcut |
| Notifications | Top app bar | Preserve unread badge and inbox |

## Hierarchy rules

1. Primary destinations are stable; role and access affect content beneath them, not their order.
2. A detail route keeps its owning primary destination active: Player and Team children activate Teams; event detail activates Schedule; opportunity and friend profiles activate Feed; Profile, Family, and Help activate You.
3. Query-driven subnavigation remains linkable and refresh-safe.
4. Conditional entries must not appear from stale or partial authorization alone. A known accessible partial result may be shown with partial status, but an empty partial result must not remove a previously known destination.
5. Cross-links are allowed, but each capability has one canonical owner. For example, Home previews a feed item but Feed owns browsing and creation.
6. Back returns to the prior filtered context when available; deep-linked details return to their canonical owner when no history exists.

## Tasks

- [ ] Validate every item in this hierarchy against the implementation inventory immediately before coding.
- [ ] Add any new route introduced after the planning base before implementation begins.
- [ ] Produce mobile, tablet, and desktop wireflows from this hierarchy.
- [ ] Validate role combinations: parent only, coach only, parent + coach, platform admin, player, and signed-in user with no team.
