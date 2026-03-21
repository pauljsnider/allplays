Validation focus:
- Confirm all imports of `live-tracker-integrity.js` now reference the bumped cache token.
- Confirm only the expected files changed for runtime behavior.

Manual checks:
- Search for `live-tracker-integrity.js?v=` in `js/`.
- Inspect `js/live-tracker.js` and `js/track-basketball.js` import lines.

Residual risk:
- Browsers may still hold the old parent modules until those URLs are refreshed, but once the updated pages load they will request the new helper URL consistently.
