# QA Plan

## Automated checks
- Add/verify unit coverage in `tests/unit/live-game-video.test.js` for metadata-only recap clips with explicit clip URL.
- Add coverage for metadata-only recap clips using replay fallback URL.
- Preserve existing timed clip expectations.

## Manual checks
- Completed game recap with metadata-only clip should show title/context/players but no synthetic time range.
- Timed clip should still show authored range and use replay fallback URL when no clip URL exists.
- Browser console should remain clean on completed game recap rendering.

## Regression risks
- Accidentally changing `createHighlightClipDraft` behavior for saved timed highlights.
- Sorting mixed timed/untimed clips incorrectly. Existing order-first sorting is preserved.
