# Architecture

## Decision
Scope the change to `normalizeGameRecapHighlightClips` in `js/live-game-video.js`.

## Data flow
`collectRawHighlightClips` gathers recap sources, then `normalizeGameRecapHighlightClips` maps them for completed-game recap rendering. The bug came from passing metadata-only clips into `createHighlightClipDraft`, whose default behavior is correct for drafting timed clips but wrong for untimed recap metadata.

## Implementation shape
- Read raw timing with `toFiniteNumber` before calling `createHighlightClipDraft`.
- Only call `createHighlightClipDraft` when a finite source `startMs` exists.
- Preserve absent timing as `null` while keeping metadata and URLs unchanged.

## Blast radius
Limited to completed-game recap normalization and its unit tests. No schema, auth, Firestore rules, or replay playback architecture changes.
