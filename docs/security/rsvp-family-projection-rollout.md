# RSVP and family-share privacy rollout

This change is intentionally deployable in phases. Do not deploy the Firestore
rule closure before the callable and both clients have passed preview parity.

## Safe rollout

1. Deploy only `getFamilyShareView` and the updated RSVP functions. Confirm the
   callable returns `projectionVersion: 2` and that serialized responses contain
   none of `ownerUserId`, `extraCalendarUrls`, `calendarUrls`, or planted sentinel
   URL query values.
2. Deploy Hosting and the React app. Exercise legacy `family.html` and
   `/app/#/family/:token` against active, revoked, expired, private-team,
   recurring-practice, external-calendar-failure, and multi-child fixtures.
   During this window clients try the projection first and retain the old read as
   a passive compatibility path.
3. Capture parity evidence (event counts/IDs/dates, child filters, calendar
   export, and failure states), then deploy `firestore.rules`. The closure denies
   anonymous token-source reads and parent RSVP/note collection lists. Token
   owners still manage their records, while staff retain roster RSVP lists.
4. Monitor permission-denied and callable error rates. Roll back the rules alone
   if projection availability regresses; do not roll back the PII-free writes.

The projection reuses the hardened calendar SSRF fetch path and its shared
cache/in-flight coalescing, making repeated bearer requests side-effect-free and
idempotent at the outbound-fetch boundary. Each response is bounded to 8 source
calendars, 50 children, 20 teams, 500 database events, and 500 projected
external events. Raw source URLs remain server-only, including private-team
calendar sources. Legacy calendar, team, and parent-dashboard views use exact
own/linked RSVP document reads for parents; staff paths retain collection lists.

## RSVP sanitation tool

The migration is dry-run by default, page-bounded, update-time preconditioned,
idempotent, and resumable. Use different state files for dry-run and apply so a
completed dry-run cursor cannot skip the apply pass.

```sh
npm run ops:sanitize-rsvp-pii -- \
  --project PROJECT_ID \
  --page-size 200 \
  --max-pages 25 \
  --state-file /secure/path/rsvp-pii-dry-run.json
```

Review totals and sampled documents. Applying requires an exact project
confirmation:

```sh
npm run ops:sanitize-rsvp-pii -- \
  --project PROJECT_ID \
  --confirm-project PROJECT_ID \
  --apply \
  --page-size 200 \
  --max-pages 25 \
  --state-file /secure/path/rsvp-pii-apply.json
```

The tool scans the `rsvps` and `rsvpNotes` collection groups, deletes direct
email fields, and deletes `displayName` only when it is an email address or
matches a stored email. It never rewrites statuses, player scope, timestamps, or
notes. Re-running after completion is a no-op.

## Rollback boundaries

- Functions/clients: revert to the prior release only while source-token reads
  remain closed or after restoring the projection callable; otherwise a bearer
  token could again receive raw owner/calendar data.
- Rules: the family-token and RSVP read closures are independently reversible.
- Backfill: field deletion is not automatically reversible. Export Firestore
  before apply. RSVP behavior does not depend on the deleted fields, and staff
  identity resolution uses roster/player links rather than RSVP email fields.
