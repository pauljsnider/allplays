# Rainout Polling by ZIP - Design

## Current state
- No dedicated rainout event pipeline.
- Saved ZIP exists in user profile data.
- Chat and app surfaces exist for presenting status information.

## Proposed state
Add a polling worker that:
1. Computes unique polling targets from active subscriptions.
2. Polls rainout source once per unique ZIP every 30 minutes.
3. Emits internal events only when status changed.
4. Fans out to chat + status feed for matching subscribers.

## Data model
- `rainoutSubscriptions`
  - `id`
  - `tenantId`
  - `userId`
  - `zip`
  - `facilityId` (optional)
  - `channels` (chat/push/email)
  - `enabled`
- `rainoutState`
  - `tenantId`
  - `zip`
  - `facilityId`
  - `status`
  - `updatedAt`
  - `sourceEventId`
- `rainoutEvents`
  - `idempotencyKey`
  - `tenantId`
  - `zip`
  - `status`
  - `updatedAt`
  - `matchedSubscriberCount`
  - `deliveryResults[]`

## Polling workflow
1. Scheduler starts every 30 minutes (`00` and `30`).
2. Query active subscriptions.
3. Build unique target list by `tenantId + zip`.
4. For each target, request source data and normalize.
5. Compare normalized status with previous state.
6. On change, persist event and fan out notifications.
7. Record metrics and audit rows.

## UX workflow
1. User enables rainout alerts in settings (ZIP prefilled from saved profile).
2. User chooses channels (default: chat + in-app).
3. On status change, user sees:
   - Chat message with status + facility + timestamp.
   - Updated dashboard status widget.
   - Alerts history entry.

## Blast radius analysis
- Current blast radius: manual checking only, low system risk but poor responsiveness.
- New blast radius: bad parser or bad matching could produce noisy/incorrect alerts.
- Mitigation:
  - tenant-scoped keying (`tenantId + zip`)
  - idempotency key per change event
  - dead-letter queue for parse failures
  - audit log and per-tenant throttles

## Rollback plan
- Feature flag the poller and fanout.
- If issues occur, disable flag to stop new events.
- Existing status views continue showing last known state.

## Instrumentation
- `poll_targets_total`
- `poll_success_total`
- `poll_failure_total`
- `rainout_change_events_total`
- `rainout_delivery_attempt_total`
- `rainout_delivery_failure_total`
- `rainout_cross_tenant_block_total`
