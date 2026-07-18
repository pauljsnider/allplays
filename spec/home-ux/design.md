# Home UX Improvements — Design

## Design principles

- **State before features:** public visitors see an honest welcome; personalized
  tools appear only after authentication.
- **One next action:** the priority card owns the most important task while
  signals summarize categories and the remaining list excludes the priority.
- **Mobile-first reachability:** navigation may scroll, but never silently clips
  without an edge cue and active-item positioning.
- **Use the existing system:** reuse app cards, buttons, route patterns, colors,
  typography, and Lucide icons.

## Public welcome

Signed-out Home becomes a single-column welcome experience:

1. Brand/value card with the neutral headline `Your sports day, organized`.
2. Primary Create account and secondary Sign in actions.
3. Two compact benefit cards covering schedules/actions and team connection.
4. Public Discover and Find teams links for users who are not ready to create an
   account.

The welcome state deliberately excludes the personalized date hero, status
metrics, social composer, Refresh, and Home section navigation.

## Signed-in hero

- Date tile remains as the visual anchor.
- Heading becomes `Your day`, which remains meaningful on narrow screens.
- The badge uses `N open`, `Loading`, or `Caught up`.
- Supporting copy combines display name with the strongest available context:
  administrator, coach, official, parent, or general member.
- Refresh becomes a 44px target.
- Desktop metrics remain concise and no longer repeat the top priority action or
  a second caught-up chip.

## Home section navigation

The existing section query routes remain canonical. The UI becomes a labeled
`nav` containing links with `aria-current="page"`.

- Mobile: horizontal scroller, 44px links, scroll snapping, hidden scrollbar,
  right-edge fade, and active-link `scrollIntoView`.
- Desktop: the same control renders as a five-column horizontal segmented row
  across the content width.

This removes the nested desktop sidebar while retaining direct links and browser
history behavior.

## Feed navigation and empty state

Feed filters use the same reachability treatment: 44px chips, snapping, and an
edge fade. The empty Feed card receives one contextual primary action:

- linked team: `Create a post`
- no linked team: `Link a player`

Quick Shares remains available as a collapsed disclosure so it does not compete
with the empty state on mobile.

## Empty-state component

`EmptyCard` accepts an optional action region. Players and Teams use this region
for two compact CTAs while existing call sites continue to render unchanged.

## Accessibility feedback

The existing `Status` visual treatment remains. Error variants receive
`role="alert"`; success variants receive `role="status"`, `aria-live="polite"`,
and atomic announcements. Friend search receives a persistent label associated
with its input.

## Compatibility and risk

- No service or Firestore contracts change.
- No native-specific code changes.
- Existing URLs remain valid.
- The largest regression risk is Home component behavior because it combines
  progressive loading and social state. Focused component tests cover public,
  authenticated, error, and section-navigation paths.
- CSS changes are scoped to Home class names so player-detail desktop navigation
  remains unchanged.
