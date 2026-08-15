# Communications, Weather, and Alerts

Status: Proposed

Depends on: [League foundation](./01-league-foundation.md), [schedule generation and publication](./05-schedule-generation-publication.md), [compliance and safety](./09-compliance-safety.md)

## Objective

Deliver direct, targeted, reliable organization communications to affected coaches and families for announcements, schedule changes, closures, and urgent conditions.

## Requirements

1. Authorized senders can target the organization, season, sport, division, team, facility, event, role, or an explicit authorized recipient set.
2. Audience resolution occurs server-side from authoritative memberships and event relationships and records whether the result is complete, partial, or failed.
3. A partial empty audience cannot be treated as nobody affected; the send must retry or surface a recoverable error while preserving the last complete preview.
4. Messages support in-app, push, and email channels with per-user preferences and channel availability.
5. Urgent safety and schedule notifications may use a narrowly defined preference override, visibly labeled and audited.
6. Facility closures can identify affected events and families, require administrator confirmation, and trigger schedule status updates without coach relay.
7. Weather inputs are advisory until an authorized person or configured policy creates an organization decision.
8. Every send uses a durable message ID, immutable content version, audience snapshot, per-recipient delivery state, and idempotency key.
9. Retries must not duplicate notifications, and channel failure must not erase successful delivery evidence.
10. Schedule-linked messages include the authoritative event revision and deep-link users to current state rather than stale message data.
11. Senders can preview audience count and content, schedule delivery, cancel pending sends, and view delivery exceptions according to role.
12. Recipient contact details, device tokens, and channel-provider payloads remain private.
13. Messages support accessible formatting, localization-ready templates, quiet hours for non-urgent content, and abuse reporting.

## Design

### Audience and message model

Separate a message definition from its immutable content version, resolved audience snapshot, and per-channel deliveries. Audience jobs return completeness and truncation metadata. A durable outbox fans out recipients only after the message and audience are committed.

### Closures and urgent decisions

A closure workflow evaluates affected facility bookings, previews the complete impact, and commits a closure decision plus event status revisions. Notification workers consume that decision. Weather adapters provide normalized observations and warnings but cannot mutate schedules without policy evaluation and an auditable decision.

### Delivery and preferences

Use provider adapters behind one delivery contract. Resolve user preferences at send time, record the reason a channel was selected or suppressed, and maintain a fallback policy. Deep links resolve through authenticated, authorized routes and never contain sensitive bearer state.

## Tasks

- [ ] Define message, content version, audience, closure decision, outbox, delivery, preference, and template schemas.
- [ ] Implement complete audience resolution with partial-result protection and previews.
- [ ] Implement send authorization, scheduling, cancellation, fan-out, retry, and deduplication.
- [ ] Integrate facility closures and schedule revisions with direct family notification.
- [ ] Add provider-neutral weather input and auditable decision policies.
- [ ] Build administrator compose, audience preview, confirmation, and delivery-status screens.
- [ ] Build family and coach inbox, preferences, deep links, and urgent-state experiences.
- [ ] Add privacy rules for contact details, device tokens, and provider payloads.
- [ ] Add partial access, channel failure, duplicate callback, quiet-hour, closure-race, and stale-event tests.
- [ ] Add delivery metrics, audit history, abuse controls, and operator retry tools.
