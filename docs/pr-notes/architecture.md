# Architecture Role Notes (Parent Take-Home Packet Visibility)

## Decision
Add a packet-context resolver that returns both `sessionId` and `homePacket` for a schedule event.

## Design
- Module: `js/parent-dashboard-packets.js`
- Existing path (unchanged): resolve by explicit IDs (`practiceSessionId`, direct `eventId`, recurring `masterId__date`).
- New fallback path:
  - constrain candidates to same `teamId`
  - constrain candidates to same calendar day as event date
  - choose nearest-time candidate (title tie-breaker)
- Output: `{ sessionId, homePacket }`

## Integration Points
- `parent-dashboard.html` schedule list rendering
- `parent-dashboard.html` calendar day modal rendering
- Both now use packet-context fallback when `event.practiceHomePacket` is absent.

## Blast Radius
- UI/read-only composition changes only.
- No write-path changes.
- No schema migration.
- No auth/rules changes required.

## Controls
- Team-scoped fallback prevents cross-team packet lookup.
- Existing session-ID mapping remains primary source to minimize false matches.
