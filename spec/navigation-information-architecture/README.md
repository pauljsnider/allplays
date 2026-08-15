# Navigation Information Architecture Specifications

Status: Proposed

Planning base: `origin/master` at `2b384d00e22ed3b92a2cbd017f30c30b4351f9e8` (2026-08-15)

This folder defines the product requirements, information architecture, route migration, implementation boundaries, and verification plan for simplifying the signed-in AllPlays navigation without losing existing destinations. It is a successor proposal to `spec/nav-ux`: that earlier work reduced mobile navigation to four direct destinations plus More, while this proposal gives the product's social experience and team workspace explicit first-class homes.

The recommended signed-in mobile model is:

- Bottom navigation: **Home · Schedule · Feed · Messages · Teams**.
- Top app bar: contextual action, Search, Notifications, and **You** (avatar).
- Home: a dashboard and fast launcher for urgent work, players, teams, the next event, and Ask AllPlays; it is not another five-tab navigation surface.
- Feed: **Following** and **Discover**, with friends management inside the social workspace.
- You: public profile, account settings, Family, Help, and sign out.

The proposal preserves deep links and existing authorization. It primarily changes frontend composition, routing, active-state logic, and tests. It does not require a Firestore migration, new security rules, or new write services for the initial rollout.

## Product principles

- Keep the five most important signed-in destinations visible and stable.
- Treat Teams as a core object and workspace, not an item hidden under Home or More.
- Treat Feed and Discover as two modes of one social/discovery workspace, not competing primary destinations.
- Make Home the fastest path to a user's players and teams, while avoiding duplicated nested navigation.
- Move low-frequency identity and family administration under You without making it hard to find.
- Put creation where its result belongs: event creation in Schedule, post creation in Feed, team creation in Teams, and messaging creation in Messages.
- Preserve every existing route during migration and make old bookmarks converge on the new canonical location.
- Keep authorization, privacy, data-loading completeness, and mutation behavior unchanged unless a later specification explicitly changes them.
- Use the same information model on React web, iOS, and Android; adapt only the shell presentation by viewport.

## Specification index

| # | Specification | Primary outcome | Depends on |
|---|---|---|---|
| 1 | [Research and product decisions](./01-research-and-product-decisions.md) | Evidence, alternatives, and the selected five-destination model | Current product and competitor evidence |
| 2 | [Complete information architecture](./02-complete-information-architecture.md) | Top-to-bottom destination, subnavigation, and sub-subnavigation hierarchy | 1 |
| 3 | [Shell, routes, and action migration](./03-shell-routes-and-actions.md) | Responsive shell contract, route aliases, active state, and complete action mapping | 1–2 |
| 4 | [Destination workspace requirements](./04-destination-workspaces.md) | Behavioral requirements for Home, Feed, Teams, Schedule, Messages, players, and You | 2–3 |
| 5 | [Accessibility, analytics, and responsive behavior](./05-accessibility-analytics-responsive.md) | Interaction semantics, measurement, and viewport adaptation | 2–4 |
| 6 | [Implementation, tests, rollout, and rollback](./06-implementation-tests-rollout.md) | Phased work, test impact, service impact, estimates, and release gates | 1–5 |

## Decision summary

### Selected option

Use five persistent signed-in destinations: Home, Schedule, Feed, Messages, and Teams. Put identity, Family, settings, and Help behind the top-right avatar. Keep Search and Notifications globally available in the top bar. Replace the global Add menu with a contextual action whose destination-specific menu still exposes every current workflow.

### Why this option

- Schedule, Messages, and Teams are proven high-frequency sports-management objects.
- AllPlays already has a real social feed, friendships, public opportunities, and team discovery. Combining Following and Discover creates one understandable social destination without demoting Teams.
- Home can answer “what needs my attention?” and launch a player or team without also behaving like a tab container.
- Profile and Family remain accessible but do not consume two persistent navigation slots.
- Five stable destinations fit common mobile guidance and avoid the current seven-item density or a generic More destination.

### Deferred decision

The first release does **not** add a global public social-post feed. Discover initially reuses Opportunities, public Teams, and people/friend discovery. A globally browsable post/highlight feed requires a separate privacy, youth-safety, moderation, ranking, and Firestore access design before it can appear.

## Delivery chunks

### Chunk 1: Navigation-only shell

Introduce a centralized navigation model, the five-item bottom bar, responsive desktop equivalent, avatar/You menu, contextual action contract, route-family active matching, analytics events, and compatibility routes. Feed may temporarily render the existing Home feed/friends experience through an adapter while all current deep links remain valid.

### Chunk 2: Feed extraction

Create the signed-in `/feed` workspace, move existing social feed, composer, friends, opportunities, team discovery, and people discovery into Following and Discover, then leave redirects for `/home?section=feed`, `/home?section=friends`, and signed-in `/discover`.

### Chunk 3: Home and You consolidation

Remove Home's Today/Feed/Players/Teams/Friends section bar. Keep player and team launchers directly on Home. Add a You hub that routes to public profile, settings, Family, and Help without rewriting those feature panels.

### Chunk 4: Contextual creation and responsive refinement

Replace the generic Add surface with destination actions, verify every legacy workflow mapping, refine tablet/desktop rail behavior, and remove temporary adapters only after route and analytics evidence is stable.

## Expected impact

The full proposal is a large frontend information-architecture change but a low-backend-impact change. At the planning base, the main shell and directly affected pages total more than 6,800 lines, including `AppShell.tsx`, `Home.tsx`, `Profile.tsx`, `ParentTools.tsx`, `Discover.tsx`, and `App.tsx`. The five primary component suites alone contain approximately 190 tests. A broad route-string inventory touches hundreds of tests, though most should continue passing because compatibility routes are retained.

Expected effort for one engineer:

- Navigation-only shell: roughly 1–2 weeks including focused tests and responsive refinement.
- Complete hierarchy, Feed extraction, You consolidation, migration coverage, and staged rollout: roughly 4–6 weeks.
- A public social-post Discover feed, if later approved, is separate scope and requires additional backend, privacy, moderation, and rules work.

## Non-goals

- No change to who may see or mutate teams, players, schedules, messages, family data, profiles, opportunities, or social posts.
- No Firestore schema or data migration for the initial navigation release.
- No replacement of existing Schedule, event detail, game hub, Team, Player, Profile, or Family business logic.
- No deletion of public/signed-out Discover or public team routes.
- No redesign of live scoring, chat delivery, RSVP, fees, registration, awards, media, or Private AI services.
- No automatic exposure of youth profiles or private social posts in Discover.

## Cross-specification definition of done

An implementation is complete only when:

- Signed-in mobile has exactly five stable primary destinations in the specified order.
- Every current primary destination, Home section, header action, Add workflow, role-specific Schedule item, Team subpage, Player subpage, and Family/Profile panel has a documented destination.
- Home reaches any visible player or team in one tap from its launcher and reaches all players or teams in no more than two taps from initial render.
- Old route URLs remain functional through compatibility rendering or tested redirects that preserve safe query context.
- Active navigation state works for nested and query-driven routes.
- Navigation is keyboard and screen-reader operable, survives native back and interrupted navigation, and honors safe-area insets.
- Role changes and partial access loads do not expose unauthorized items or turn incomplete access into authoritative absence.
- Existing feature services and security rules remain unchanged unless an independently reviewed follow-up requires them.
- Focused component, route, service-contract, smoke, accessibility, responsive, and analytics tests pass at the exact handoff SHA.
- Rollout metrics show no material regression in player/team access, event access, messages access, route errors, or task completion before compatibility adapters are removed.
