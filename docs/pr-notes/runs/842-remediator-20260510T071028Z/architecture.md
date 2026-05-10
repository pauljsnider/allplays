# Architecture

## Decision
Use live authorization sources for calendar feed access: `teams/{teamId}.ownerId`, `teams/{teamId}.adminEmails`, and `users/{uid}.parentTeamIds`.

## Rationale
Calendar token documents are bearer credentials and may persist role snapshots. They are suitable for token identity/metadata, not for authorizing continued team access after membership removal.

## Blast Radius
Limited to `teamCalendarFeed` guard behavior. Token validity, revocation, expiration, and ICS generation remain unchanged.
