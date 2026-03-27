# Architecture synthesis

## Decision
Implement the feature with a pure helper layer in `js/team-chat-media.js` and thin UI wiring in `team-chat.html`.

## Current state
- `collectThreadMedia()` normalizes gallery entries.
- Gallery rendering is inline in `team-chat.html`.
- No reusable model exists for media action labels, filenames, or share payloads.

## Proposed state
- Add pure helpers for:
  - deriving a safe media filename
  - building share metadata for a gallery entry
  - reporting action availability from browser capabilities
- Keep runtime browser APIs inside `team-chat.html`:
  - `navigator.share`
  - `navigator.canShare`
  - `navigator.clipboard.writeText`
  - `fetch` + object URL download fallback

## Blast radius
- Limited to team chat media UI and a shared helper module already owned by this feature.
- No Firestore schema, storage path, or security rule changes.

## Controls
- Authorization remains unchanged because actions operate only on media already visible in the gallery.
- URLs still pass through existing safe URL validation.
- Download/share actions use the same asset URL already rendered today.

## Tradeoffs
- File-based share may fail on some browsers or for some remote assets, so URL share and copy-link fallback remain necessary.
- Keeping browser API calls in the page avoids over-abstracting a static HTML page but leaves DOM wiring inline.
