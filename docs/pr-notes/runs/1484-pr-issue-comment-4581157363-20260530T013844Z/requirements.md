# Requirements

## Problem
Organization draft schedule publishing must not create games for teams unless the publisher has admin access to every home and away team included in the draft. This protects teams from unauthorized schedule changes while preserving fast publishing for legitimate organization schedulers.

## Acceptance Criteria
1. Authenticated organization admins can publish valid draft slots only when they also pass team admin access for every participating home and away team.
2. If access is missing for any participating team, the callable returns `permission-denied` before any schedule game writes are prepared.
3. The UI must not report success when authorization fails.
4. Existing no-draft blocking remains: “Generate at least one draft slot before publishing.”
5. Successful publishes preserve opponent, venue, date, home/away status, notes, shared schedule linkage, and audit fields for coaches and parents.
6. Global admins remain authorized through the existing `hasTeamAdminAccess` behavior.

## Non-Goals
- Redesign role models or delegated league scheduler permissions.
- Add a pre-publish permission audit screen.
- Change draft generation, venues, blackout logic, CSV import, or notification behavior.

## Edge Cases
- A large draft with one unauthorized team fails fully, with no partial publish state.
- Team admin for home teams but not away teams fails.
- Deleted or inaccessible referenced teams fail cleanly.
- Duplicate team IDs are checked once via the unique team ID set.
