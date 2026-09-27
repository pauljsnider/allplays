# Facilities and Eligibility Rules

Status: Proposed

Depends on: [League foundation](./01-league-foundation.md), [sports, seasons, and divisions](./02-sports-seasons-divisions.md)

## Objective

Create an authoritative inventory of venues, playable spaces, availability, and compatibility rules that every scheduling workflow can validate consistently.

## Requirements

1. Administrators can model venues and nested fields, courts, rinks, or other playable spaces with timezone, location, accessibility, surface, dimensions, lighting, and operational status.
2. Spaces support recurring availability, one-time openings, maintenance blocks, closures, setup buffers, and organization-owned or shared-use labels.
3. Compatibility rules can reference sport, division, age or grade band, participation category, surface, dimensions, lighting, and configured equipment.
4. The rule engine returns compatible, incompatible, or needs-review plus stable reason codes and human-readable explanations.
5. Availability and eligibility are evaluated against versioned facts captured at the time a slot is reserved or an event is published.
6. Concurrent holds and bookings must be serialized so two accepted operations cannot claim the same exclusive slot.
7. Administrators may grant scoped exceptions with reason, actor, expiration, and audit history.
8. Closure changes identify affected draft and published events before confirmation.
9. Address and operational contact details follow least-privilege read rules; public location data is separated from private access instructions.
10. All date calculations use the facility timezone and cover daylight-saving transitions explicitly.

## Design

### Facility model

Use venue records for shared location details and child space records for schedulable inventory. Store availability templates separately from dated exceptions. Material configuration changes create a new facility ruleset version rather than rewriting historical event context.

### Rule and reservation services

Implement a deterministic evaluator that consumes a space snapshot, activity facts, and a time range. A reservation service uses transactions to create short-lived holds, confirm bookings, release expired holds, and detect conflicts. Every denial returns reason codes suitable for UI display and audit.

### Operations experience

Provide calendar and list views, bulk availability editing, closure impact preview, and a conflict explanation panel. Maps are optional presentation; stored coordinates and addresses remain provider-neutral.

## Tasks

- [ ] Define venue, space, availability, closure, ruleset, exception, hold, and booking schemas.
- [ ] Implement deterministic eligibility and overlap evaluation.
- [ ] Implement transactional hold, confirm, release, and expiration operations.
- [ ] Build facility inventory, availability calendar, and closure-impact screens.
- [ ] Connect facility rules to schedule generation and event editing contracts.
- [ ] Add authorization and public/private location data rules.
- [ ] Add concurrency, daylight-saving, recurring availability, exception, and partial-load tests.
- [ ] Add audit events, utilization metrics, and operator-visible conflict diagnostics.
