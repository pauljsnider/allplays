# Rainout Polling by ZIP - Requirements

## Objective
Deliver rainout notifications by polling every 30 minutes using unique ZIP targets, then surface results in chat and in-app status views.

## Problem
We need reliable rainout updates without waiting on webhook support. Users already have saved ZIP codes, so polling should deduplicate by unique ZIP and avoid redundant external calls.

## Functional requirements
- Build polling targets from unique `tenantId + zip` combinations.
- Poll source data on a 30-minute cadence.
- Detect changes using status transitions and source update timestamps.
- Match changed events to subscribers by `tenantId + zip` with optional facility filter.
- Post update to tenant chat stream when a change is detected.
- Update in-app status feed/card with latest status and `lastUpdated` time.
- Expose alert settings where users can enable/disable rainout notifications.

## Non-functional requirements
- Cross-tenant isolation is mandatory.
- Event delivery must be idempotent.
- Full audit trail for poll, change detection, fanout decisions, and delivery result.
- Degraded mode: if source parse fails, log and retry without blocking other ZIPs.

## UX requirements
- User sees latest rainout status in dashboard widget.
- User sees change notifications in chat thread/channel.
- User can open an alerts history screen showing what changed and when.
- User can manage subscription preferences in profile/alerts settings.

## Success metrics
- P95 source-to-user latency <= 35 minutes.
- Duplicate notification rate < 1%.
- Poll cycle success rate >= 99%.
- Cross-tenant misroute incidents = 0.
