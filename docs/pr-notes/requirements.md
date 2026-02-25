# Requirements Role Notes (Parent Take-Home Packet Visibility)

## Objective
Ensure parents can reliably open a generated take-home packet from the parent dashboard schedule experience.

## Current State
- `Open Packet` in schedule list/calendar only appears when `practiceHomePacket` is attached directly to the rendered event.
- Event->session linkage can miss in some recurring/calendar cases even when a valid practice session packet exists.
- Result: packet exists in session data, but no `Open Packet` CTA appears in schedule.

## Proposed State
- Keep existing direct linkage path.
- Add a safe fallback lookup so schedule views can resolve packet context from known practice sessions when direct event linkage is missing.
- Preserve tenant/team boundaries and avoid cross-team packet exposure.

## User-Facing Acceptance Criteria
1. Parent sees `Open Packet` on practice schedule cards when a packet exists for the matched session.
2. Parent sees `Open Packet` in calendar day modal under the same conditions.
3. If no packet exists, no CTA is shown (existing behavior).
4. Fallback never maps to another team’s session.

## Assumptions
- Practice session docs remain the source of truth for packet content.
- Team/date proximity is a valid fallback key when event IDs are absent or mismatched.
