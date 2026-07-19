# Account Entry and Public Team UX Design

## Account-entry model

Sign in and Sign up remain one route and one card, but the mode switch becomes a real two-tab interface. The visible form is the associated tab panel. Arrow keys move between adjacent modes; Home and End select the first and last mode.

Password inputs use compact trailing visibility buttons inside a shared field container. Each button has a mode-specific accessible name, a 44px target, and does not submit the form. The field value and focus remain stable when visibility changes.

Password recovery stays inline to avoid a new route or modal. Its trigger exposes disclosure state, the panel is labelled by the trigger, and the reset email initializes from the email already typed. Errors interrupt with an alert; confirmations are polite status updates.

Sign-up copy explains the invite-only model before users complete the form. Join-code entry remains part of account creation, while the separate Enter join code link remains available only from Sign in.

## Public-team model

Team cards use native links rather than navigation buttons. The visible call to action includes the team name, so repeated results remain distinguishable to screen-reader and voice-control users and support standard link behavior.

Public team detail uses three explicit states:

1. Loading: announced status with visible progress copy.
2. Failure/not found: alert copy, Retry, and Back to team search.
3. Success: existing public-safe profile plus direct Enter a join code and Sign in actions.

The back link returns to `/teams/browse` to preserve the visitor's information architecture. The profile still exposes only allow-listed public data.

## Responsive behavior

- Mobile targets are at least 44px and full-width where recovery or conversion benefits from emphasis.
- Auth password controls remain inside the input boundary without reducing usable text width below a practical mobile size.
- Public profile actions stack on small screens and may sit inline at larger breakpoints.

## Non-goals

- No open self-service registration without a join code.
- No authentication provider, Firebase rule, data schema, or invite-contract changes.
- No public roster, schedule, contact, or private team data exposure.
- No redesign of signed-in team detail, roster, staff tools, or scheduling workflows.
