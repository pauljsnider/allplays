# Architecture Role Analysis

Thinking level: medium (state transition bug with realtime snapshots)

Root cause:
- Current algorithm combines cumulative unread count with a static seen watermark (`lastChatSeenAt`) while collapsed, causing repeated recount from the same watermark.

Minimal safe design:
- Introduce a second watermark for counting progression between snapshots: `lastChatSnapshotAt`.
- On first initialization and on chat expand: set both watermarks to `Date.now()` and reset unread.
- On collapsed snapshots: count only messages newer than `lastChatSnapshotAt`; then advance `lastChatSnapshotAt` to latest message timestamp (or now if missing timestamp messages were seen).

Why this design:
- Fixes deterministic overcount with minimal blast radius to chat UI state only.
- Does not change persistence or Firestore schema.
- Keeps existing read/expanded behavior unchanged.

Risk surface and controls:
- Risk: message timestamp gaps/out-of-order snapshots.
- Control: compute latest timestamp each pass and fallback to `Date.now()` when untimestamped messages are counted.
