# Code Plan

## Files
- `js/live-game-video.js`
- `tests/unit/live-game-video.test.js`

## Patch
- In `normalizeGameRecapHighlightClips`, calculate `rawStartMs` and `rawEndMs` before normalization.
- Only use `createHighlightClipDraft` when `rawStartMs` is finite.
- Return `null` timing values when timing is absent instead of synthesized defaults.
- Extend tests to assert untimed recap clips preserve null timing.

## Validation
Run `npm run test:unit -- tests/unit/live-game-video.test.js`.
