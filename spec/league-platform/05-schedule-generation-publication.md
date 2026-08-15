# Schedule Generation and Publication

Status: Proposed

Depends on: [Sports, seasons, and divisions](./02-sports-seasons-divisions.md), [facilities and eligibility rules](./04-facility-eligibility-rules.md)

## Objective

Generate, review, publish, and revise organization schedules from authoritative teams, rules, facilities, and constraints without manual re-entry in downstream team experiences.

## Requirements

1. Administrators can create a schedule workspace for selected seasons, divisions, teams, date ranges, and facilities.
2. Inputs support hard constraints, preferences, blackout periods, rest intervals, home/away balance, game counts, travel considerations, and shared-resource limits.
3. Generation must be bounded, cancellable, reproducible from a stored input version, and explicit when no fully valid solution exists.
4. Each draft event includes its source constraints and any warnings; unresolved hard conflicts block publication.
5. Staff can move, swap, add, or remove draft events and receive immediate eligibility and availability validation.
6. Publication creates a prepared schedule revision and idempotently updates every required team and family projection. A separate transaction activates the revision only after authoritative completion evidence proves that every required projection matches it.
7. Users must never see a draft or partial publication as the official schedule.
8. Revisions preserve history, reason, actor, affected events, and notification status; rollback creates a new revision rather than rewriting history.
9. Event times retain timezone context and render correctly across user locales and daylight-saving transitions.
10. Published events appear automatically in existing team calendars and supported calendar feeds without duplicate creation.
11. Officials or other assignable resources are supported through an optional constraint interface, without being required for initial release.
12. Incomplete schedule reads expose completion and truncation evidence and cannot prove that no event exists.

## Design

### Draft workspace

Store normalized generator inputs, a ruleset and facility version, a random seed when applicable, progress, diagnostics, and generated draft events under a private workspace. Generation runs as an asynchronous job with an explicit time and search bound. Results distinguish valid schedules, best-effort drafts, and failed runs.

### Publication model

Published events reference an immutable schedule revision with explicit `prepared`, `projecting`, `active`, or `failed` status. A server publication operation validates the complete draft again, reserves all facility slots, commits a prepared revision, and writes a durable projection outbox. Workers materialize hidden versioned team and family projections idempotently and record per-target completion. An activation transaction verifies the complete expected target set before moving the organization-wide active-revision pointer. Every client resolves official state through that pointer, so the prior revision remains visible until the new one is consistently available everywhere.

### Review experience

Provide calendar, list, conflict, and workload views. Explain why a placement is invalid and offer compatible alternatives. The interface preserves unsaved review state locally but never represents it as published.

## Tasks

- [ ] Define workspace, input, generation run, draft event, revision, and projection-outbox schemas.
- [ ] Build deterministic constraint normalization and validation.
- [ ] Implement bounded schedule generation with cancellation, progress, and diagnostics.
- [ ] Implement transactional preparation, facility reservation, projection-completeness verification, activation, revision, and rollback operations.
- [ ] Build schedule setup, review, conflict, and publication screens.
- [ ] Connect official revisions to existing team calendars and calendar feeds.
- [ ] Add idempotent notification and projection workers with retry visibility.
- [ ] Add reproducibility, unsatisfiable-input, concurrent-publication, interrupted-projection, activation-gate, timezone, partial-read, and rollback tests.
- [ ] Add generation performance metrics, audit records, and operational recovery tools.
