# Requirements Review

## Problem Statement

Cancelling an in-progress game can leave `status: cancelled` and `liveStatus: live`, causing families to see and interact with a game that is no longer active. Cancellation must be authoritative across legacy and app workflows, stale records, shared schedules, and already-open viewers.

## User Segments Impacted

- Coaches need one cancellation action to stop the public live experience.
- Parents and spectators need trustworthy discovery and viewer state.
- Team and program admins need consistent behavior across web, app, and shared schedules.

## Acceptance Criteria

1. Legacy and app cancellation writes set both `status` and `liveStatus` to `cancelled` without changing authorization.
2. Direct and shared cancelled games are excluded from live discovery even when persisted `liveStatus` is stale.
3. An initially cancelled stale-live game does not enter live mode or start live-event, chat, reaction, or presence subscriptions.
4. An already-open live viewer exits live mode on cancellation and tears down live and engagement subscriptions.
5. Same-day chat eligibility does not override cancellation.
6. Shared fixtures receive terminal cancellation state but do not mirror active live state without the source event stream.
7. Regression tests cover both write paths, discovery, initial viewer state, live-to-cancelled transition, engagement gating, shared schedule behavior, and cache delivery.

## Non-Goals

- Redesign cancellation UX or notifications.
- Change cancellation permissions.
- Migrate historical Firestore records.
- Delete existing events, scores, chat, reactions, or recordings.
- Add a restore-without-reload workflow.

## Edge Cases

- Treat both `cancelled` and `canceled` as terminal.
- Cancellation can occur before or during live tracking and may arrive through duplicate snapshots.
- Old viewer URLs and temporarily inconsistent shared records must remain safe.
- Explicit replay remains unchanged.

## Open Questions

- Cancellation-specific viewer copy is a follow-up UX improvement, not required for this state-consistency fix.
- Server-side chat/reaction denial for modified or stale clients is a separate security-hardening decision.
