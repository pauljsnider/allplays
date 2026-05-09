# Awards & Certificates - Validation Log

This file records implementation facts verified against the current codebase while shaping the spec. It should be updated as spikes and implementation PRs land.

## Verified Against Codebase

Verified on 2026-05-09 while working on the `awards` branch at latest `origin/master`.

- **Static page pattern.** Team admin pages use root HTML files plus ES modules under `js/`, cache-busted imports, shared auth/header utilities, and Tailwind CDN config. `certificates.html` should follow the same pattern as `team-chat.html` and `team-media.html`.

- **Team admin navigation.** `js/team-admin-banner.js` supports an `active` key and route map. The Certificates card should use `active='certificates'`, route to `certificates.html#teamId={teamId}`, and appear only in full-access layouts. Parent/slim access should keep its existing layout.

- **Image upload pattern.** `js/firebase-images.js` owns the named image Firebase app, exports `imageStorage`, and provides `ensureImageAuth()` plus `requireImageAuth()`. Existing uploads in `js/db.js` use `ref`, `uploadBytes`, and `getDownloadURL` against `imageStorage`, with sanitized filenames for user-uploaded media. Certificate assets and signature images should use the same approach.

- **Image upload paths.** Existing paths include `team-photos/`, `player-photos/`, `user-photos/`, chat/team media paths, and drill diagrams. The certificate feature adds analogous paths under `certificate-assets/{teamId}/`, `certificate-exports/{teamId}/`, and `certificate-signatures/{userId}/`.

- **Firebase AI usage.** Existing AI calls import from `js/vendor/firebase-ai.js`, import `getApp` from `js/vendor/firebase-app.js`, instantiate `getAI(getApp(), { backend: new GoogleAIBackend() })`, and use `gemini-2.5-flash`. References verified in `js/live-tracker.js`, `js/track-basketball.js`, and `js/live-game.js`. Certificate AI descriptions should reuse this pattern exactly.

- **Recent stats data.** `js/db.js` already exports `getGames(teamId)` and `getAggregatedStatsForGames(teamId, gameIds)`. These are the right building blocks for the last 5-10 completed games workflow; certificate modules should not duplicate raw Firestore traversal where these helpers already exist.

- **Completed game status.** Existing code treats completed games as `status === 'completed'`, `status === 'final'`, or `liveStatus === 'completed'`. The AI context helper should use the same convention and exclude practices/cancelled games.

- **Player privacy.** Public roster docs are guarded against restricted fields, and private data lives separately. Certificate prompts and saved certificates should only use public roster fields plus game-derived stats/summaries.

- **Parent access model.** Existing rules/helpers use denormalized `parentPlayerKeys` shaped like `${teamId}::${playerId}`. Parent certificate reads should use this same pattern and only expose published certificates for linked players.

- **Spec structure.** Existing feature specs use `requirements.md`, `design.md`, `tasks.md`, and sometimes `validation-log.md`. This folder follows that shape.

## Decisions Captured

- The default workflow is a **team certificate run**, not a one-player editor.
- The coach configures common certificate values once, then the app fills player-specific fields.
- All active roster players are selected by default.
- AI descriptions are generated in bulk using the selected recent game window.
- Default stats window is the last 10 completed games; coach may use last 5.
- Per-player edits happen in the review grid after draft creation.
- Image uploads are shared run-level configuration by default, not per-player setup.
- The preview DOM and export DOM must be the same render path.

## Open Questions

1. **Team colors.** The spec references `team.colors.primary` and `team.colors.secondary`, but the current team edit flow may not collect colors consistently. Decide whether adding team color fields belongs in this feature or a separate prerequisite.

2. **AI quota UI.** Existing AI usage does not appear to have a shared quota component. If quota controls are added, certificate generation should consume the same quota/accounting mechanism as game-summary AI.

3. **User lookup for signers.** `signers.js` needs owner/admin display names. Reuse or extract an existing lookup helper rather than scanning all users from the certificate module.

4. **CORS and export rendering.** `html-to-image` can fail if an image URL taints the canvas. A spike should verify Firebase image URLs from the images project export cleanly and document any retry/blob-object-URL path.

5. **Batch AI concurrency.** Start with a small fixed queue size, then validate latency and quota behavior with 12-20 player rosters.

## Validation Checklist

- [ ] Requirements reviewed by product owner
- [ ] Design reviewed by an engineer familiar with existing image uploads
- [ ] AI prompt reviewed for privacy and youth-sports tone
- [ ] Firestore rules and indexes reviewed
- [ ] CORS/export spike completed
- [ ] Batch AI concurrency validated
