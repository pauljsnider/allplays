# Home UX Improvements — Requirements

## Context

The React/Capacitor Home route currently renders the personalized dashboard for
signed-out visitors, including account-like zero metrics and controls whose
handlers require an authenticated user. The signed-in dashboard also needs a
clearer mobile navigation pattern, more actionable empty states, role-aware
copy, and stronger assistive-technology feedback.

This work implements GitHub issue #4056 for the shared web, iOS, and Android
React experience.

## User stories

1. As a signed-out visitor, I want a clear welcome and authentication choice so
   I do not mistake an empty preview for my account.
2. As a signed-in user, I want Home to identify the next important action and
   upcoming event without repeating the same task.
3. As a phone user, I want every Home section and Feed filter to remain
   discoverable and easy to tap.
4. As a new parent or team member, I want empty states to tell me what to do
   next and take me there.
5. As a coach, parent, official, or administrator, I want Home copy to reflect
   my context without assuming I only manage players.
6. As an assistive-technology user, I want navigation and asynchronous feedback
   announced with the correct semantics.

## Functional requirements

### Signed-out state

- `/home` and signed-out root routing shall render a dedicated welcome state.
- The welcome state shall include working Sign in and Create account actions.
- Authentication actions shall preserve `/home` as the safe next route.
- Personalized metrics, Refresh, Home section navigation, Feed composer, and
  friend search shall not render while signed out.
- The public state shall explain the benefits of linking players and teams
  without fabricating personalized data.

### Signed-in Home

- Home shall continue to default to the Today section.
- Today, Players, Teams, Feed, and Friends shall remain directly addressable by
  their existing query-string routes.
- The hero shall use a role-neutral title, identify the signed-in user, and show
  an explicit open-action or caught-up state.
- Supporting hero copy shall prefer administrator, coach, official, or parent
  context when available.
- Today shall exclude its priority action from the remaining-action list.
- Existing loading, progressive hydration, retry, pull-to-refresh, and social
  behavior shall remain intact.

### Responsive interaction

- Home shall avoid document-level horizontal overflow at 320px and wider.
- The active Home section shall expose `aria-current="page"` and be scrolled
  into view when necessary.
- Overflowing Home navigation and Feed filters shall provide a visible edge cue
  and scroll snapping.
- Frequent mobile Home controls shall be at least 44px high.
- Desktop Home shall use a compact horizontal section navigation instead of a
  second 236px sidebar.

### Empty states

- Players shall offer Accept invite and Request player access actions.
- Teams shall offer Request player access and Find teams actions.
- An empty Feed shall provide one primary action based on whether a team is
  already linked.
- Friend search shall have a persistent accessible label.

### Accessibility

- Home section navigation shall have an accessible navigation label.
- Errors shall use alert semantics.
- Success and non-critical status feedback shall use polite status semantics.
- Existing modal focus trapping, Escape handling, meaningful control names,
  and hidden decorative icons shall be preserved.

## Acceptance criteria

- Signed-out Home contains no personalized zero metrics or no-op controls.
- Signed-out Sign in and Create account links target the existing auth route and
  preserve `/home` as `next`.
- All five Home destinations and all Feed filters remain reachable at 320px and
  390px.
- The Home and Feed scrollers do not increase document width.
- The hero never displays the ambiguous status label `Clear`.
- Parent, coach, official, and admin contexts produce appropriate supporting
  copy.
- Players, Teams, and empty Feed states contain working next-step actions.
- Async error and success feedback is detectable by role.
- Focused Home tests, app build, and relevant smoke/browser validation pass.
