# Media Infrastructure

Status: Proposed

Depends on: [League foundation](./01-league-foundation.md), [facilities and eligibility rules](./04-facility-eligibility-rules.md), [schedule generation and publication](./05-schedule-generation-publication.md)

## Objective

Manage organization-owned cameras, scoreboards, streams, recordings, and viewer access as reliable facility resources with explicit privacy and retention controls.

## Requirements

1. Administrators can inventory cameras, scoreboards, encoders, and supported sensors and bind them to a specific facility space.
2. Device records expose safe identity, capability, assignment, health, firmware, and last-contact status while keeping credentials and provider controls private.
3. Provisioning, credential rotation, reassignment, and retirement are server-authoritative and auditable.
4. A published event can reserve compatible media devices and define capture windows, setup buffers, stream visibility, recording policy, and retention.
5. Streams and recordings inherit authorization from the current event, team, family, and organization relationships; a shared link grants only its explicitly scoped viewing capability.
6. Viewer access for invited extended family is revocable, time-bounded when configured, and does not expose broader team data.
7. Provider sessions, ingest keys, signed URLs, tokens, device secrets, and exact private requests never appear in member-readable event or media records.
8. Clients resolve current viewing access through the server and validate canonical HTTPS playback destinations.
9. Ingest handles disconnects, duplicate callbacks, clock drift, late media, and partial recordings without marking them complete.
10. Scoreboard signals retain source, timestamp, sequence, and synchronization quality for downstream use.
11. Recording retention, download, sharing, and deletion respect organization policy, participant consent, legal hold, and active derived-media references.
12. Deletion uses persistent retirement records and a final authoritative reference check; unproven ownership or reference state retains the object.
13. The viewer experience provides accessible playback, captions when available, quality fallback, and clear live, delayed, interrupted, processing, and archived states.

## Design

### Device and provider abstraction

Create organization device records and private provisioning records behind adapter interfaces. A device capability model allows facility scheduling to match required capture, scoring, or connectivity features without embedding a vendor-specific schema in events.

### Media session lifecycle

A server workflow reserves devices for an event, creates a durable private attempt, provisions the external session idempotently, validates provider responses, and publishes only an opaque public session reference. Webhooks update an append-only session timeline and are reconciled against provider state after ambiguity.

### Storage and access

Store public metadata separately from canonical bucket, object path, generation, credentials, and signed access state. Playback calls authorize the current principal and return short-lived access. Retirement records prevent stale writers from reintroducing deleted media and require a final check across events, highlights, and saved outputs.

## Tasks

- [ ] Define device, capability, assignment, health, reservation, session, recording, viewer grant, and retirement schemas.
- [ ] Define provider adapter contracts for provisioning, streaming, recording, health, and scoreboard events.
- [ ] Implement secure device enrollment, credential rotation, reassignment, and retirement.
- [ ] Integrate device reservations with facilities and published events.
- [ ] Implement idempotent session creation, webhook handling, reconciliation, and private-state storage.
- [ ] Build administrator inventory, health, assignment, session, and exception screens.
- [ ] Build family and extended-viewer live and archived playback experiences.
- [ ] Implement consent, retention, legal-hold, reference-safe deletion, and revocation workflows.
- [ ] Add authorization, disconnect, clock-drift, duplicate-event, ambiguous-write, and retention-race tests.
- [ ] Add device health alerts, stream quality metrics, audit history, and operator recovery tools.
