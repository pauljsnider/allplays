# Requirements: Issue #4117

## Objective

Make public team discovery and profile visits understandable, accessible, recoverable, and usable at 390×844 without changing public data access or authentication behavior.

## Observable requirements

- Each result exposes a semantic link to `/teams/{encodedTeamId}/public` whose accessible name identifies the team.
- Result links use the existing `min-h-11` convention for a 44px minimum touch target.
- Public detail loading exposes meaningful status text through a live status region; the spinner is decorative.
- Detail failures retain the error and provide `Retry` plus `Back to team search` linking exactly to `/teams/browse`.
- Successful profiles provide `Enter a join code` to `/accept-invite` and `Sign in` to `/auth`.
- Existing public routes and the allow-listed `PublicTeamProfile` data boundary remain unchanged.

## Visitor journeys

1. A visitor browses or searches, finds a descriptive team link, and opens the public-safe profile with touch, keyboard, or assistive technology.
2. While the profile loads, assistive technology announces `Loading public team`.
3. If loading fails, the visitor can retry the same team request or return to canonical team search.
4. From a successful profile, a visitor can enter an existing join code or sign in without changing invite redemption or authentication behavior.

## Accessibility and mobile constraints

- Use links for navigation rather than buttons plus programmatic navigation.
- Derive each link's accessible name from `team.teamName`.
- Keep decorative icons and spinners `aria-hidden`.
- Stack recovery and account-entry actions on narrow screens and avoid horizontal overflow.
- Preserve intentional truncation for long card content without shortening the accessible link name.

## Boundaries and assumptions

- Continue using `getPublicTeamsPage` and `getPublicTeamDetail` only.
- Do not load rosters, private schedules, contacts, member records, or authenticated team details.
- Do not change Firebase queries, rules, indexes, route definitions, invite redemption, signup, or auth behavior.
- A full-width descriptive link inside the card satisfies the result-card link requirement without creating nested interactive content.
