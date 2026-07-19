# RSVP and family-share privacy rollout

This delivery is intentionally split because the production workflow evaluates
Firestore configuration before application deployment:

- **Phase A** contains the additive projection callable, legacy and React
  projection-first clients, PII-free RSVP writes, and dry-run sanitizer tooling.
  Its `firestore.rules` and `firestore.indexes.json` must remain byte-identical to
  the current production base. The legacy source-token fallback remains passive
  and available during this phase.
- **Phase B** contains only the restrictive Firestore rule closure and its
  rule-specific validator and actor-matrix coverage. Keep Phase B held until
  Phase A is live, parity is verified, and compatible native releases have
  propagated to the supported iOS and Android population.

Do not combine or reorder these phases. A web deployment alone is not sufficient
evidence for Phase B because installed native builds package the React family
viewer and RSVP hydration paths, and do not receive Hosting updates. Older
native builds directly read family-token source documents and list RSVP/note
collections, both of which Phase B closes.

## Safe rollout

1. Deploy Phase A. Confirm `getFamilyShareView` returns `projectionVersion: 2`
   and that serialized responses contain none of `ownerUserId`,
   `extraCalendarUrls`, `calendarUrls`, or planted sentinel URL query values.
   Because Phase A has no Firestore configuration delta, the production
   workflow's configuration-first step is a no-op.
2. Exercise legacy `family.html` and
   `/app/#/family/:token` against active, revoked, expired, private-team,
   recurring-practice, external-calendar-failure, and multi-child fixtures.
   During this window clients try the projection first and retain the old read as
   a passive compatibility path.
3. Release signed, compatible iOS and Android builds and verify the supported
   installed population uses the projection-first viewer and exact-document RSVP
   hydration.
   Treat app-store submission,
   approval, or web parity alone as insufficient; require release propagation
   evidence or a separately reviewed backward-compatible bridge before closure.
4. Capture parity evidence (event counts/IDs/dates, child filters, calendar
   export, failure states, native versions, and callable/fallback telemetry).
   Rebase Phase B onto the then-current master and verify its diff is limited to
   the intended rules closure, validator, actor-matrix tests, and this gate.
5. Only then deploy Phase B. The closure denies anonymous token-source reads and
   parent RSVP/note collection lists. Token owners still manage their records,
   while staff retain roster RSVP lists.
6. Monitor permission-denied and callable error rates. Roll back the rules alone
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

- Functions/clients: before Phase B, Phase A may be rolled back because legacy
  source-token reads remain open, explicitly accepting the return to the prior
  raw-data exposure. After Phase B closes those reads, do not remove the
  projection callable or projection-first clients while the closure remains.
  Roll back the Phase B rules first before a functionality rollback, explicitly
  accepting that raw source-token exposure is restored.
- Rules: the family-token and RSVP read closures are independently reversible.
- Backfill: field deletion is not automatically reversible. Export Firestore
  before apply. RSVP behavior does not depend on the deleted fields, and staff
  identity resolution uses roster/player links rather than RSVP email fields.
