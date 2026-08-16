# Accessibility, Analytics, and Responsive Behavior

Status: Proposed

Depends on: Specifications [2](./02-complete-information-architecture.md), [3](./03-shell-routes-and-actions.md), and [4](./04-destination-workspaces.md)

## Objective

Make the new hierarchy operable and measurable across phones, packaged native apps, tablets, desktop web, keyboard navigation, and assistive technology.

## Accessibility requirements

1. Primary navigation is a labeled `nav`; the current destination exposes `aria-current="page"`.
2. Following/Discover and true same-page view switchers use `tablist`, `tab`, and `tabpanel` semantics with arrow-key behavior. Route-to-route controls remain links, not faux tabs.
3. Every bottom-bar, header, menu, and high-frequency subnav target is at least 44 by 44 CSS pixels.
4. Icon-only actions have unique accessible names and visible tooltips where pointer hover is available.
5. The You menu and any contextual action sheet use accessible dialog/menu semantics appropriate to their interaction model, dismiss on Escape/backdrop/native back, and restore focus.
6. A route change places focus at the destination heading or preserves focus when only a same-page filter changes.
7. Unread badges do not replace accessible names; screen readers receive meaningful counts and loading/error status.
8. Bottom navigation and sticky subnavigation do not obscure focused controls, toasts, save bars, chat composer, or validation messages.
9. Reduced-motion preferences disable nonessential navigation and sheet animations.
10. Text remains usable at 200% zoom and large dynamic type without truncating destination identity.
11. Active state is not conveyed by color alone.
12. Loading, partial, empty, error, retry, offline, and stale states retain existing live-region and alert behavior.

## Responsive model

### Compact phone: below 768px

- Five-item bottom navigation, respecting bottom safe area.
- Compact top bar with icon-only contextual action, Search, Notifications, and avatar when space requires.
- Bottom bar may be hidden only for immersive flows already designed for it, such as active compact chat/tracker states; a clear back path is mandatory.
- Subnavigation uses scrollable tabs, compact selects, or sheets according to the existing destination pattern.

### Tablet and narrow desktop: 768–1199px

- Use a five-destination navigation rail or wider bottom bar based on available height and input mode.
- Labels remain visible in the rail.
- You anchors to the rail bottom or top-bar avatar consistently.
- Two-pane Messages and Schedule layouts may activate when content width permits.

### Desktop: 1200px and above

- Use a sidebar/rail based on the same five destination model; do not restore the old seven-item information architecture only because space exists.
- Show destination labels and allow contextual Schedule role subnavigation beneath Schedule when useful.
- Keep Profile, Family, Help, and sign out grouped under You/account rather than mixing identity administration with destination navigation.
- Preserve the existing wide Messages and Schedule layouts.

## Native behavior

- Respect iOS and Android safe-area insets and keyboard resizing.
- Native back dismisses the topmost transient surface first, then navigates history, then follows existing exit rules.
- Push notification routes pass through compatibility resolution before render.
- The app icon unread badge and notification inbox behavior remain unchanged.
- Route changes must not cause duplicate haptics, focus jumps, or WebView scroll restoration failures.

## Analytics requirements

Add privacy-safe navigation events without names, message text, team names, player names, emails, or raw query values.

### Events

| Event | Required properties |
|---|---|
| `nav_destination_impression` | destination, layout, role bucket, experiment version |
| `nav_destination_selected` | from destination, to destination, layout, source control |
| `nav_contextual_action_opened` | destination, action family, layout |
| `nav_contextual_action_selected` | destination, action ID, role bucket |
| `nav_you_opened` | layout, role bucket |
| `nav_you_item_selected` | item ID, layout |
| `nav_compatibility_route_used` | legacy route family, canonical destination, outcome |
| `nav_route_resolution_failed` | sanitized route family, failure class |
| `nav_task_started` | task family, destination, source |
| `nav_task_completed` | task family, destination, source, success/failure class |

### Task families

- Open player
- Open team
- Open next event
- Submit RSVP
- Open/read message
- Create post
- Find/join/create team
- Open Family fee/registration/award
- Open account settings
- Ask AllPlays

### Baselines and guardrails

Record at least two weeks of baseline data if traffic permits. Compare:

- taps and time to player/team/event/message;
- task start and completion rates;
- Feed and Discover engagement separately;
- Profile and Family findability;
- backtracking and repeated destination taps;
- route resolution failures, blank states, permission errors, and crash/error boundaries;
- navigation layout by viewport and native/web client.

Rollout pauses if route failures, inaccessible destinations, or core task completion materially regress beyond pre-agreed thresholds. Exact thresholds must be written into the release checklist before activation rather than chosen after data is visible.

## Research validation

Before full rollout, run moderated or instrumented first-click tasks:

1. Find your child's profile.
2. Open your team roster.
3. Respond to an upcoming event.
4. Read a team message.
5. Share a game recap.
6. Find a new team.
7. Find an opportunity.
8. Pay or inspect a Family fee.
9. Change notification settings.
10. Ask AllPlays a schedule question.

Segment findings by parent, coach/admin, mixed role, number of teams, and platform. Do not approve the hierarchy solely from aggregate success if one role cannot complete a core task.

## Tasks

- [ ] Add automated axe or equivalent checks for the shell, Feed tabs, You menu, and contextual action sheet.
- [ ] Add geometry assertions for 44-pixel targets and safe-area clearance at supported mobile viewports.
- [ ] Add keyboard, focus restoration, Escape, backdrop, and native-back tests.
- [ ] Define analytics schemas and sanitized allow-lists before emitting events.
- [ ] Capture baseline metrics and write rollout thresholds.
- [ ] Run the ten first-click tasks and resolve blocking findings before full rollout.
