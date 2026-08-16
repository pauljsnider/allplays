# Implementation, Tests, Rollout, and Rollback

Status: Proposed

Depends on: Specifications [1](./01-research-and-product-decisions.md) through [5](./05-accessibility-analytics-responsive.md)

## Objective

Deliver the navigation change in independently verifiable phases, preserve all existing capabilities, and make the true frontend, test, service, and operational impact explicit.

## Planning evidence

Planning base: `2b384d00e22ed3b92a2cbd017f30c30b4351f9e8`.

Observed at that base:

- `apps/app/src/components/AppShell.tsx`: 1,072 lines; 38 component tests.
- `apps/app/src/pages/Home.tsx`: 2,811 lines; 62 component tests.
- `apps/app/src/pages/Profile.tsx`: 2,207 lines; 30 component tests.
- `apps/app/src/pages/ParentTools.tsx`: 299 lines; 56 component tests.
- `apps/app/src/pages/Discover.tsx`: 125 lines; 6 component tests.
- `apps/app/src/App.tsx`: 374 lines plus route tests.
- A broad search for affected route strings reaches hundreds of test files. This is an impact inventory, not an assertion that every matching test needs modification.

Before implementation, refresh these facts against the exact intended base and inspect the merge-base diff. Do not implement against this recorded SHA if the active base has materially changed.

## Net-new implementation

Expected new frontend work:

1. Central typed destination/route-family model.
2. Five-destination responsive navigation renderer.
3. Contextual action model and menu/sheet.
4. You menu or hub composition.
5. Feed route/page composition.
6. Compatibility route resolver and telemetry.
7. Query-aware active-state matching.
8. Navigation analytics and experiment/rollout flag.
9. Focus, scroll, and native-back coordination for new transient surfaces.

Expected reuse:

- Existing Home loaders and urgent-action components.
- Existing social feed, composer, friendship, opportunity, and public-team services.
- Existing Teams, Team detail, Schedule, event detail, game hub, Messages, Player, Profile, ParentTools, Help, Search, Notification, and Private AI components and services.
- Existing routes during compatibility period.

## Service, data, and security impact

### Initial navigation and Feed extraction

- Firestore schema: no expected change.
- Firestore/Storage rules: no expected change.
- Data migration: none.
- Cloud Functions: no expected change.
- Existing service methods: reuse; component ownership/import paths may change.
- Caching: cache keys should remain domain-based, not page-component-based. Verify extraction does not create duplicate subscriptions or parallel loads.
- Notifications/search: route targets need compatibility resolution, not payload/schema migration.
- Analytics: new sanitized frontend events and dashboard queries are expected.

### Condition that expands backend scope

A global public social-post/highlight feed is not part of this plan. Adding it would require a separate specification covering:

- public eligibility and youth/guardian consent;
- denormalized public indexes or bounded queries;
- Firestore and Storage rules;
- reporting, blocking, takedown, moderation, and appeals;
- ranking, pagination, abuse prevention, retention, and deletion propagation;
- privacy-safe analytics and operational monitoring.

## Phased implementation plan

### Phase 0 — Validation and baselines

- Refresh route, component, service, and test inventories at the exact base SHA.
- Run label/first-click research and record task baselines.
- Define analytics schemas, rollout thresholds, and the rollback flag.
- Produce approved mobile/tablet/desktop wireflows.

Exit: product decisions are resolved; no implementation ambiguity remains around labels, You presentation, or Feed query schema.

### Phase 1 — Navigation-only shell

- Add the centralized destination model.
- Render Home, Schedule, Feed, Messages, Teams across responsive shells.
- Initially allow Feed to adapt the existing Home feed/friends components.
- Add You and contextual action surfaces.
- Preserve old routes and global workflows.
- Add active-state, accessibility, native-back, and analytics coverage.

Exit: every old destination and action remains reachable; no service/schema/rules change; shell can be disabled with one flag.

Estimated effort: 1–2 weeks for one engineer including tests and responsive refinement.

### Phase 2 — Feed extraction

- Extract social feed, composer, and Friends from Home into `/feed`.
- Compose signed-in Discover from existing Opportunities, Teams, and People capabilities.
- Add compatibility adapters and then tested redirects.
- Prevent duplicate subscriptions, loads, and cache entries.

Exit: Home no longer owns Feed/Friends; old URLs restore equivalent state; signed-out Discover is unchanged.

### Phase 3 — Home and You consolidation

- Remove the Home section bar.
- Keep direct player/team launchers and the operational dashboard.
- Consolidate Profile, settings, Family, and Help under You.
- Verify role/access changes and partial-data retention.

Exit: Home reaches players/teams within the required tap counts; Profile and Family meet findability thresholds.

### Phase 4 — Contextual action completion and cleanup

- Replace the generic Add menu entry point after every workflow mapping is proven.
- Refine tablet rail/desktop sidebar.
- Remove temporary component adapters only after observation thresholds pass.
- Retain lightweight route aliases for external links and old notification payloads as long as needed.

Exit: no unmapped workflow, no material task regression, and no unresolved compatibility errors.

Estimated full effort: 4–6 weeks for one engineer, or multiple smaller pull requests with independent verification.

## Test impact and verification matrix

| Layer | Primary coverage | Required evidence |
|---|---|---|
| Navigation model | New focused unit suite | destination order, route ownership, role visibility, labels, analytics keys |
| App routing | `apps/app/src/App.test.tsx` and route helpers | canonical routes, aliases, query preservation, invalid query fallback, auth `next`, notification/deep-link handoff |
| Shell | `AppShell.test.tsx` | five items, active descendants, top actions, You, contextual action, native back, safe signed-out behavior |
| Home | `Home.test.tsx` | no section bar, player/team one-tap launchers, previews, partial/offline state, Ask AllPlays |
| Feed | Extracted component tests plus `Discover.test.tsx`, `FriendProfile.test.tsx`, Opportunity suites, and social logic/service suites | Following filters, Discover modes, Friends, profile sections, opportunity-management views, composer, visibility, public/signed-in separation, pagination/error states |
| Teams and Player | `Teams.test.tsx`, `TeamDetail.test.tsx`, `PlayerDetail.test.tsx`, Team Drills and Media suites | ownership active state, all tabs/subtabs/filters, chooser workflows, role filtering |
| Schedule | `Schedule.test.tsx`, `ScheduleEventDetail.test.tsx`, game report tests | role subnav, filters/views/ranges, event/game/report panels, contextual authorization |
| Messages | Messages, ChatWindow, chat service suites | inbox/detail routing, opportunity threads, team/staff/group/direct selection, compact back behavior |
| You | Profile and ParentTools suites plus new menu/hub tests | settings/Family hierarchy, active state, focus, partial access, sign out |
| Search/notifications | Existing dialog/inbox/push routing suites | canonical destinations, legacy payloads, unread behavior |
| Accessibility/responsive | Component assertions and Playwright | landmarks, tabs, current page, focus, 44px targets, zoom, safe area, mobile/tablet/desktop |
| Smoke | Existing app Home, Schedule, Messages, Teams, Profile/Family, Discover, Search, Private AI smoke suites | top task paths and zero fatal/page errors |
| Analytics | New schema/helper suite | allow-listed properties, no private values, start/completion pairing, compatibility outcomes |

### Required scenario matrix

- Signed out.
- Signed in with no team.
- Parent only with one player/team.
- Parent only with multiple players/teams.
- Coach/admin only.
- Mixed parent and coach/admin.
- Platform admin where applicable.
- Complete empty, complete nonempty, partial empty, partial nonempty, offline with cache, retry success, and authorization change.
- Fresh launch, browser refresh, native deep link, notification link, search result, auth continuation, back/forward, and native back.
- 320px compact phone, repository standard mobile viewport, large phone/dynamic type, tablet portrait/landscape, and desktop.

## Test-change policy

- Preserve existing business-behavior assertions. Update only shell ownership, labels, or canonical route expectations that intentionally changed.
- Do not weaken a test because a destination moved.
- Prefer shared component extraction so the existing service tests remain authoritative.
- Add deterministic regressions for every compatibility route and legacy Add workflow.
- Capture `pageerror` before DOM assertions in affected smoke tests.
- Run app tests from `apps/app` using the repository's app configuration.
- Use focused suites first, then the full React app suite, production build, relevant smoke suites, and `git diff --check`.

## Rollout

1. Ship behind a server-controlled or remotely configurable navigation flag with old and new shell variants supported by the same routes.
2. Enable for internal accounts and test fixtures.
3. Enable a small percentage of signed-in web sessions, then packaged mobile cohorts only when supported client versions contain the new shell.
4. Expand by role cohort while monitoring navigation resolution, task completion, permission errors, and support feedback.
5. Hold at each stage for the predeclared observation window.
6. Remove the old shell only after the exact release head meets all test, accessibility, analytics, and research gates.
7. Keep route compatibility longer than the visual old shell because bookmarks, emails, notifications, and installed clients outlive a frontend deployment.

## Rollback

- Disable the new shell flag and render the existing navigation without changing stored data.
- Keep canonical/new routes readable by the old shell where possible; otherwise route them through compatibility adapters.
- Do not delete analytics or compatibility mappings during rollback.
- Preserve the user's current route and last complete cached domain state.
- A rollback must not broaden authorization, discard a draft, or convert partial data into emptiness.
- If Feed extraction has already shipped, rollback the shell without moving data or reintroducing duplicate subscriptions; the old Home alias may render the shared Feed component.

## Production-safety applicability

- Authorization and privacy apply because navigation visibility and deep links must not expose unauthorized objects.
- Partial-data handling applies because role/team/family discovery may be incomplete.
- Interrupted navigation and compatibility apply across browser, native back, auth continuation, search, and notifications.
- Persistent mutation atomicity, provider idempotency, destructive deletion, Storage cleanup, and payment compensation are not directly applicable because this proposal does not change those mutations.
- Any future public-post Discover implementation or mutation rewrite requires a separate production-safety review.

## Handoff evidence

Each implementation pull request must record:

- intended base, merge base, exact tested head, and final pushed head;
- changed destination/route/action mappings;
- focused and broad commands with results;
- screenshots at phone, tablet, and desktop widths;
- accessibility findings;
- analytics/flag state and rollout cohort;
- observed facts versus remaining inferences;
- compatibility routes retained and explicit removal criteria.

## Tasks

- [ ] Refresh the evidence inventory against the implementation base.
- [ ] Split work into the four phases with independently testable pull requests.
- [ ] Add focused regression coverage before removing any old entry point.
- [ ] Run semantic review for authorization, privacy, partial results, stale state, and interrupted navigation.
- [ ] Complete exact-head preflight and record rollout/rollback evidence for each phase.
