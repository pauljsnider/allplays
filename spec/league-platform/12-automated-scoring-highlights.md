# Automated Scoring and Highlights

Status: Proposed

Depends on: [Schedule generation and publication](./05-schedule-generation-publication.md), [media infrastructure](./11-media-infrastructure.md)

## Objective

Derive reviewable game events, scores, statistics, and highlight clips from synchronized media and scoreboard evidence without allowing low-confidence automation to overwrite authoritative results.

## Requirements

1. The system ingests timestamped video, scoreboard signals, and permitted manual observations into an append-only evidence timeline.
2. Sport-specific adapters translate evidence into candidate events using versioned models and rule definitions.
3. Every candidate includes source references, model or rules version, confidence, affected entities, and an explanation suitable for review.
4. Confidence policy determines whether a candidate is auto-accepted, queued for review, or withheld; consequential or ambiguous events require human confirmation.
5. Only accepted events update the canonical game state, score, box score, or player statistics.
6. Authorized scorers can correct, reject, merge, or replace events without destroying original evidence or automation history.
7. Reprocessing with a new model creates a new candidate run and does not silently rewrite published results.
8. Player attribution requires a valid event roster and must support unknown or needs-review rather than guessing identity.
9. Statistics are reproducible from the accepted event log and expose completeness and correction status.
10. Highlight generation uses accepted events or explicitly labeled unverified moments, applies capture bounds, and retains source provenance.
11. Clip visibility and sharing inherit participant consent, event access, retention, revocation, and organization policy.
12. Families can follow selected participants for notifications without granting the model or viewers access to unrelated profile data.
13. Automation quality is measured by sport, event type, environment, and review outcome, with drift and systematic error alerts.
14. If evidence is missing, partial, delayed, or unsynchronized, the system must report uncertainty and avoid authoritative absence claims.

## Design

### Evidence and event pipeline

Normalize inputs into a sequenced evidence timeline keyed to the event and media session. Processing runs reference immutable input ranges, adapter versions, and model versions. Candidate events are separate from accepted events; promotion occurs through a policy engine or reviewer action with expected-version checks.

### Canonical game state

Build scores and statistics as projections of the accepted event log. Corrections append superseding events and trigger idempotent projection rebuilds. Published results identify the projection version and whether review is complete, in progress, or unavailable.

### Highlights and delivery

A highlight job references accepted event IDs and exact recording ranges, creates a private generation attempt, validates the output, and publishes an authorized clip record. Notifications contain authenticated deep links rather than transferable storage URLs. Removing source consent or access reevaluates derived clips before playback or sharing.

### Responsible automation

Set thresholds independently by sport and event type. Store reviewer outcomes as quality evidence, not as unrestricted training data. Operators can disable an adapter or automatic promotion without disabling manual scoring.

## Tasks

- [ ] Define evidence, processing run, candidate event, accepted event, correction, projection, clip, and quality schemas.
- [ ] Define sport adapter and confidence-policy interfaces with versioning.
- [ ] Implement synchronized evidence ingestion, deduplication, ordering, and partial-input reporting.
- [ ] Implement candidate processing, review queues, acceptance, correction, and projection rebuilds.
- [ ] Build game-day scorer and reviewer experiences for web and mobile.
- [ ] Implement highlight generation, access inheritance, authenticated delivery, and consent reevaluation.
- [ ] Build family score, statistics, clip, and participant-following experiences.
- [ ] Add authorization and privacy controls for evidence, identity, results, and derived media.
- [ ] Add low-confidence, clock-drift, duplicate-input, correction, reprocessing, partial-evidence, and revocation tests.
- [ ] Add accuracy, review-rate, drift, processing-latency, and failure metrics with operator controls.
