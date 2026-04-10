# Architecture Role (Fallback Manual Synthesis)

- Decision: Keep state client-side and extend existing cursor with `lastChatSnapshotIds` for deterministic tie-breaks.
- Control equivalence: No backend/API/security changes; existing access controls and tenant boundaries unchanged.
- Data flow update:
  1. `subscribeLiveChat` emits message docs with `id` + `createdAt`.
  2. `advanceLiveChatUnreadState` compares each message against `{lastChatSnapshotAt, lastChatSnapshotIds}`.
  3. State advances to max timestamp and the complete ID set observed at that timestamp.

## Tradeoffs
- Pros: Minimal patch, no sort assumptions, handles equal-ms collisions.
- Cons: Additional in-memory array in `liveState`; negligible overhead at `limit:100`.

## Rollback
- Revert commit touching unread helper and state plumb.
