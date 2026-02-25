# Architecture Role Notes

## Current State
`parseMarkdown()` escapes full input, then `applyInlineMd()` injects capture groups into HTML wrappers and linkifies URL candidates.

## Proposed State
- Add defensive inline-capture sanitizer before wrapping `strong`/`em`/`code`.
- Replace boolean URL validation with URL normalization gate (`normalizeSafeHttpUrl`).
- Escape normalized URL before placing into `href` attribute.
- Escape link label before insertion.

## Blast Radius
- Affected module: `js/drills-issue28-helpers.js`.
- Affected flows: any page rendering drill markdown through shared helper.
- No Firestore schema/auth/rules impact.

## Rollback
Revert commit on branch `fix/game-day-loader-and-chat` if rendering regressions appear.
