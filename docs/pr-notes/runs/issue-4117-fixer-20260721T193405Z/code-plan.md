# Code Plan: Issue #4117

## Test first

1. Update `PublicTeamSearch.test.tsx` to require team-named links, encoded public-profile destinations, and `!min-h-11`; convert button navigation assertions to semantic links.
2. Update `PublicTeamDetail.test.tsx` to cover announced loading, error recovery, retry success, canonical search navigation, join-code entry, and sign-in.
3. Extend the focused 390×844 smoke path to measure the result target and verify profile visitor links without horizontal overflow.

## Implementation

1. Remove `useNavigate`, the open-team callback, and button plumbing from `PublicTeamSearch`.
2. Render each card action as a descriptive React Router `Link` to the encoded public route with a 44px minimum height.
3. Add a local retry trigger to `PublicTeamDetail`, preserving the existing effect cleanup guard.
4. Add a polite loading status, recoverable failure actions, and successful-profile search/account-entry links.
5. Leave `publicTeamsService`, Firebase access, routes, invite redemption, and authentication logic untouched.

## Prevention / learning

Treat discovery results as navigation contracts: test semantic role, entity-specific accessible name, destination, and touch-target size. For async public pages, test loading, failure recovery, and success paths separately rather than relying on success-only coverage.
