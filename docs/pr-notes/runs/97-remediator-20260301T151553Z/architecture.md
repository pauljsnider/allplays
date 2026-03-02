# Architecture Role Notes

## Decision
Simplify mixed timestamp handling: pick the highest `order` candidate when both timestamped and untimestamped events exist.

## Rationale
- `order` reflects snapshot/list order from Firestore query and is the only reliable signal when `serverTimestamp()` is unresolved.
- Avoids stale restore from older timestamped event when a later untimestamped event exists.
- Keeps all-timestamped branch unchanged for deterministic server-time ordering.

## Blast Radius
- Limited to `js/live-tracker-resume.js` logic path for mixed datasets.
- No schema or API changes.
