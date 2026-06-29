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

1. **AI quota UI.** Existing AI usage does not appear to have a shared quota component. If quota controls are added, certificate generation should consume the same quota/accounting mechanism as game-summary AI.

2. **User lookup for signers.** `signers.js` needs owner/admin display names. Reuse or extract an existing lookup helper rather than scanning all users from the certificate module.

3. **CORS and export rendering.** `html-to-image` can fail if an image URL taints the canvas. A spike should verify Firebase image URLs from the images project export cleanly and document any retry/blob-object-URL path.

4. **Batch AI concurrency.** Start with a small fixed queue size, then validate latency and quota behavior with 12-20 player rosters.

## Validation Checklist

- [ ] Requirements reviewed by product owner
- [ ] Design reviewed by an engineer familiar with existing image uploads
- [ ] AI prompt reviewed for privacy and youth-sports tone
- [ ] Firestore rules and indexes reviewed
- [ ] CORS/export spike completed
- [ ] Batch AI concurrency validated

## Implementation Validation - 2026-05-09

Validated on local branch `awards` using `certificates.html?demo=1#teamId=demo-junior-current` against the supplied Junior Current PDF reference.

- Added the team-run certificates studio, review grid, print flow, PNG export, ZIP export, saved draft/publish actions, parent links, Firestore helpers, rules, and indexes.
- Render/export path uses the same certificate DOM and exports the Junior Current demo certificate at 2050 x 1153 px, matching the rendered 960 x 540 PDF aspect ratio.
- Playwright smoke validation covered: open studio, generate roster certificates, edit recipient name, verify live preview update, print selected certificates, and download PNG.
- Unit validation covered: page/navigation/rules wiring, roster-safe AI prompt construction, 5/10 completed-game selection, fallback copy, color/image resolution, contrast warning, and signer normalization.
- Follow-up permission validation changed the workflow to local-first: startup tolerates denied saved-data reads, and Generate team certificates no longer writes batches/certificates before the coach can edit, print, or export.

Commands run:

```bash
node --check js/certificates/studio.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://127.0.0.1:8001 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

Notes:

- Playwright required installing its matching Chromium runtime with `npx playwright install chromium`.
- Vitest reports existing missing source-map warnings for vendored Firebase files; the certificate tests passed.

## Issue Fix Validation - 2026-05-09

Validated fixes for the reported certificate workflow issues:

- Award descriptions are capped at 300 characters in generation, fallback copy, regeneration, review-grid inputs, and preview fallback data.
- Banner and header templates render up to 4 signer blocks; Playwright verified the fourth coach appears in the live preview and print output.
- Team color editing is now wired through `edit-team.html` and saves normalized `team.colors.primary` / `team.colors.secondary` values.
- Image upload slots now show thumbnails, upload state, uploaded filenames, and local-preview fallback when Firebase image auth blocks local uploads.
- Print no longer clones and scales the certificate DOM. The print action renders the selected drafts to the same PNG blobs used by export, prints those images, and keeps the print DOM in place until the browser `afterprint` event or a long fallback timeout.
- Print-mode Playwright check verified 3 print sheets and 3 print images, with the first print image rendered from a 2050 x 1153 natural-size PNG and scaled proportionally to 1008 x 567 px in the landscape print viewport.

Commands run:

```bash
node --check js/certificates/studio.js && node --check js/certificates/templates.js && node --check js/certificates/exporter.js && node --check js/certificates/aiDescriptions.js && node --check js/certificates/renderer.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://127.0.0.1:8001 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

Artifacts:

- Print-mode screenshot: `/tmp/allplays-certificates-print-mode.png`

## Local Upload and Opacity Validation - 2026-05-09

Validated follow-up fixes for background opacity and image upload setup:

- Added a saved `backgroundOpacity` shared setting, rendered by banner and header templates and covered by the Playwright smoke workflow.
- Updated image picker controls to show a thumbnail, choose/replace action, selected/uploading badge, and concise upload status text.
- Upload fallback errors now translate Firebase referrer blocks into actionable local URL guidance instead of showing the raw Firebase error.
- Firebase CLI `serve` was blocked by expired local credentials. Hosting emulator could run with a demo project on `localhost:5002`, but the image Firebase API key blocks that referrer.
- Added `npm run serve:firebase` plus Firebase Hosting emulator config for `localhost:8000`, the local origin allowlisted by the image Firebase API key.
- Image Firebase anonymous auth succeeds at `http://localhost:8000` and fails at `http://127.0.0.1:8000` and `http://localhost:5002`. Local image upload testing must use `http://localhost:8000`, not `127.0.0.1`.

Commands run:

```bash
node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8')); JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('json ok')"
node --check js/firebase.js && node --check js/firebase-images.js && node --check js/firebase-runtime-config.js && node --check js/certificates/studio.js && node --check js/certificates/templates.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

## PR Review Comment Fix Validation - 2026-05-10

Addressed the four unresolved review threads on PR #884:

- Sanitized and length-limited user-controlled team, player, tone, stat, and game-summary values before adding them to AI prompts.
- Added an explicit prompt instruction that source data is untrusted context, not instructions.
- Made the concurrent draft worker index handoff explicit before reading each draft.
- Validated certificate image upload `teamId` and signature upload `userId` before auth/upload/storage-path construction.

Commands run:

```bash
node --check js/certificates/aiDescriptions.js && node --check js/certificates/assets.js
npx vitest run tests/unit/certificates-logic.test.js tests/unit/certificates-workflow.test.js tests/unit/certificates-assets.test.js
npm run test:unit
SMOKE_BASE_URL=http://localhost:8010 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
git diff --check
```

## Saved Sidebar and Deep Link Validation - 2026-05-09

Validated the saved-area click behavior with Playwright:

- Saved run and saved certificate entries now render as buttons with click handlers.
- Demo/local saves populate the saved sidebar immediately instead of leaving it empty until Firestore is available.
- Opening an individual saved certificate rebuilds the editable review grid with one row and the matching preview.
- Opening a saved run rebuilds the editable review grid with all certificates in the original generated order.
- `certificateId` and `batchId` deep links now open saved items for full-access users.
- Parent-facing saved certificate links now open a certificate detail view with PNG and Print actions instead of returning to the list.
- Playwright caught and verified the fix for a saved-run ordering regression where reopened runs displayed the last saved row first.

Commands run:

```bash
node --check js/certificates/studio.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

## Setup Saved Work Validation - 2026-05-09

Validated the saved-work entry point on the initial setup page with Playwright:

- Added a `Saved work` panel between shared setup and the player checklist.
- Empty setup state shows `No saved certificates yet.`
- After saving drafts, clicking `Start new run` shows recent saved runs and certificates on the setup page.
- Opening a saved certificate from the setup page opens the review grid with one editable row.
- Opening a saved run from the setup page opens the review grid with all saved certificates.
- The review-sidebar saved controls still use the same open handlers and continue to work.

Commands run:

```bash
node --check js/certificates/studio.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

## Compact Saved Work Button Validation - 2026-05-10

Validated the saved-work entry point after replacing the large setup-page panel:

- Removed the full `Saved work` panel from the setup page so the player checklist stays high on the page.
- Added a compact `View saved work` button beside `Start new run` and `Create one-off certificate`.
- The button opens the saved-work review view with the Saved sidebar visible.
- Empty saved state shows a lightweight `No saved work yet.` message.
- After saving drafts, the button opens the saved view with recent runs and certificates available from the sidebar.
- Opening saved certificates and saved runs from that view still lands in the editable review/export/print workflow.

Commands run:

```bash
node --check js/certificates/studio.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

## AI Description Progress and Cache-Bust Validation - 2026-05-10

Validated the longer-team AI description UX and `View saved work` cache issue:

- Added a review-grid progress banner showing description generation progress as `completed/total`.
- Rows now show `Writing` with a spinner while AI descriptions are pending.
- Completed rows fill in as each AI call finishes instead of waiting for the full team batch.
- Regenerate selected uses the same progress UI.
- Updated the AI prompt to use stats as private narrative context and explicitly avoid exact stat numbers, scores, dates, opponent names, and opposing team names.
- Removed opponent names from the game-context labels passed into the AI prompt.
- Bumped certificate asset URLs to avoid stale browser modules: `certificates.css?v=2`, `studio.js?v=2`, and `aiDescriptions.js?v=2`.
- Playwright verified the `View saved work` button switches to the saved-work view, empty saved state renders, and saved runs/certificates still open.

Commands run:

```bash
node --check js/certificates/studio.js
node --check js/certificates/aiDescriptions.js
npx vitest run tests/unit/certificates-logic.test.js tests/unit/certificates-workflow.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

## Description Length, Saved Dates, and Sharing Validation - 2026-05-10

Validated certificate copy and saved-work metadata changes:

- Description hard cap increased from 300 to 350 characters while the AI prompt still targets 230-300.
- Truncation no longer appends trailing `...`; over-limit text is clipped to a word boundary and closed with punctuation where possible.
- Long descriptions over 300 characters receive a smaller certificate text style to reduce visual crowding.
- Saved runs and saved certificates now show relative date labels such as `Today`, `Yesterday`, or `3 days ago`, plus the absolute date.
- Saved runs and certificates include share actions that copy a direct `batchId` or `certificateId` link for coaches/admins with team access.
- Playwright verified saved date rendering, share-link copying for certificates and runs, and the 350-character editor cap.

Commands run:

```bash
node --check js/certificates/templates.js
node --check js/certificates/studio.js
node --check js/certificates/aiDescriptions.js
npx vitest run tests/unit/certificates-logic.test.js tests/unit/certificates-workflow.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

## Saved List Full Run Validation - 2026-05-10

Validated the reported saved-list cap:

- Removed the 8-item display cap from saved runs and saved certificates.
- Increased default Firestore saved-history reads to 100 runs and 250 certificates.
- Expanded the demo roster to 12 players so Playwright catches full-team saved-list regressions.
- Playwright verified a 12-certificate run saves and shows all 12 saved certificate entries in the Saved panel and View saved work flow.
- Bumped cache versions to load the uncapped saved-list code: `studio.js?v=4` and `db.js?v=76`.

Commands run:

```bash
node --check js/certificates/studio.js
node --check js/db.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

Artifacts:

- Upload UI screenshot: `/tmp/allplays-certificates-upload-ui.png`

## Image Slot None Validation - 2026-05-09

Validated with Playwright that selecting `None` clears each image slot independently:

- Foreground crest `None` removes the crest image and does not replace it with a placeholder.
- Background image `None` removes the background image.
- Watermark image `None` removes the watermark image.
- Re-selecting `Use team logo` restores each slot as expected.

Commands run:

```bash
node --check js/certificates/renderer.js && node --check js/certificates/templates.js && node --check js/certificates/studio.js
npx vitest run tests/unit/certificates-logic.test.js tests/unit/certificates-workflow.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

## PNG and Landscape Print Validation - 2026-05-09

Validated the updated review export behavior with Playwright:

- The main `PNG selected` button downloads one PNG per selected certificate.
- Each generated certificate row has its own `PNG` action for an individual certificate download.
- The review preview has a `PNG` action for the currently selected certificate.
- Print CSS now uses an explicit `11in 8.5in` page size with 10.5in x 7.5in printable sheets.
- Playwright confirmed row-level PNG, preview PNG, selected PNG downloads for all 3 demo certificates, ZIP export, and 3 landscape print sheets/images.

Commands run:

```bash
node --check js/certificates/studio.js && node --check js/certificates/exporter.js && node --check js/certificates/renderer.js && node --check js/certificates/templates.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

## Setup UX and Font Validation - 2026-05-09

Validated setup-page workflow and certificate font controls with Playwright:

- The primary create action now lives below the player checklist, not inside shared setup.
- Header actions were renamed to `Start new run` and `Create one-off certificate`.
- Setup actions were renamed to `Save setup for future runs` and `Reset setup`.
- Review actions were renamed to `Save progress` and `Publish certificates`.
- Added font selectors for team/title, recipient name, and description/footer text.
- Previous uploaded images appear in the image selectors under `Previous uploads`.
- Direct DOM validation confirmed the create button is below the player list and there is no generate button in the setup panel.

Commands run:

```bash
node --check js/certificates/studio.js && node --check js/certificates/renderer.js && node --check js/certificates/templates.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

Artifacts:

- Setup UX screenshot: `/tmp/allplays-certificates-setup-ux.png`

## Image Control Follow-up - 2026-05-09

Validated fixes for the stacked image controls and upload behavior:

- Foreground, background, and watermark controls now stack as full-width image cards.
- Background opacity and watermark opacity sliders live inside their related image card borders.
- Foreground image selection no longer creates an implicit watermark. Watermark rendering is opt-in from the watermark slot only.
- `Use team logo` now resolves the team image from `photoUrl`, `logoUrl`, `teamLogoUrl`, or `imageUrl`.
- Certificate image uploads now use the existing image-project storage folders: `team-photos/` for certificate assets and `user-photos/` for signature images. The deployed image bucket rejected the new `certificate-assets/...` path, while the existing folders are accepted.
- Browser validation at `http://localhost:8000` uploaded a certificate image to Firebase Storage, rendered the Firebase Storage URL in the thumbnail and preview, kept watermark count at 0 after foreground upload, and showed `Uploaded for this run.`

Commands run:

```bash
node --check js/certificates/studio.js && node --check js/certificates/templates.js && node --check js/certificates/renderer.js && node --check js/certificates/assets.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

Artifacts:

- Stacked image controls screenshot: `/tmp/allplays-certificates-stacked-images.png`

## Saved Data, Review Buttons, and Production Firebase Validation - 2026-05-09

Validated the reported saved-data warning and review-button failures with Playwright:

- `http://localhost:8080` and `http://127.0.0.1:8080` both fail Firebase Auth with `auth/requests-from-referer-...-are-blocked`. The allowlisted local origin is `http://localhost:8000`.
- Firebase CLI app/project inspection was blocked by expired Firebase CLI credentials, but Google auth could read and update the Firebase Rules API with the `game-flow-c6311` quota project header.
- Released Firestore ruleset `projects/game-flow-c6311/rulesets/c0f9e898-db6c-41b9-b312-cb611059b7ec` to `projects/game-flow-c6311/releases/cloud.firestore`.
- Applied GET/HEAD-only CORS to `gs://game-flow-img.firebasestorage.app` so existing Firebase Storage image URLs can be rasterized by PNG, ZIP, and print export.
- The startup `Saved certificate data could not be loaded...` warning no longer appears. Optional saved-history reads still log permission details if rules are unavailable, but do not block create/edit/export/print.
- Save and publish now degrade to browser-session state when certificate persistence is unavailable, and use real Firestore persistence once the rules are released.
- Review buttons validated in demo mode: regenerate selected, row regenerate, save drafts, publish all, print selected, PNG, and ZIP.
- Review buttons validated against production Firebase on the AI Score Reader team with one generated certificate: regenerate selected, immediate save after regeneration, row regenerate, immediate publish after regeneration, PNG download, ZIP download, and print.
- Production print validation used the PNG-backed path after bucket CORS was applied: 1 print sheet, 1 print image, and 0 DOM fallback frames.

Commands run:

```bash
firebase emulators:start --only hosting --project demo-allplays
firebase projects:list --json
firebase apps:list WEB --project game-flow-c6311 --json
firebase apps:list WEB --project game-flow-img --json
gcloud projects describe game-flow-c6311 --format=json
gcloud storage buckets update gs://game-flow-img.firebasestorage.app --cors-file=/tmp/allplays-image-bucket-cors.json --format=json
gcloud storage buckets describe gs://game-flow-img.firebasestorage.app '--format=json(cors_config)'
node --check js/certificates/studio.js
node --check js/certificates/exporter.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

## Saved Work Collapse Validation - 2026-05-10

Validated the saved work collapse/show-more behavior with unit checks and Playwright:

- Saved certificates default to a compact list of 6 items with a `Showing 6 of 12` count.
- The saved certificate list exposes `Show all 12`, expands to every saved player certificate, and keeps a `Show fewer` control after expansion.
- The same show-more behavior is available in the main `View saved work` page without expanding the entire saved area by default.
- The 12-player demo run still opens saved certificates individually, opens the full saved run, shares saved links, and completes PNG/print validation after the saved-list change.

Commands run:

```bash
node --check js/certificates/studio.js && node --check js/db.js && node --check js/certificates/templates.js && node --check js/certificates/aiDescriptions.js
npx vitest run tests/unit/certificates-workflow.test.js tests/unit/certificates-logic.test.js
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```

## PR Hardening Validation - 2026-05-10

Completed a pre-PR security, bug, and test hardening pass:

- Replaced inline CSS `background-image:url(...)` certificate rendering with safe image elements to avoid style URL injection from saved image refs.
- Added image URL protocol filtering for certificate templates; allowed `http`, `https`, `blob`, safe relative paths, and raster `data:image` URLs only.
- Added template escaping coverage for untrusted names/descriptions and blocked unsafe image URLs in unit tests.
- Re-clamped saved/published certificate descriptions to the certificate description limit before persistence and when reopening saved certificates.
- Redacted explicit opponent names from AI game-summary context before building the prompt.
- Parent certificate loading now derives linked players from `parentPlayerKeys` in addition to legacy `parentOf`.
- Repaired full-suite test blockers around edit-team color inputs, local date-only player clip formatting, and timezone-stable organization schedule expectations.

Commands run:

```bash
node --check js/certificates/studio.js && node --check js/certificates/templates.js && node --check js/certificates/renderer.js && node --check js/certificates/aiDescriptions.js && node --check js/certificates/assets.js && node --check js/certificates/exporter.js && node --check js/certificates/signers.js && node --check js/player-profile-stats.js && node --check js/organization-schedule.js
npm run test:unit
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
git diff --check
```

## PR Merge Readiness Validation - 2026-05-10

Merged current `origin/master` into `awards` after draft PR creation showed a merge conflict. The only manual conflict was in `js/team-media.js`; kept the newer master media-management implementation because the awards branch only had older import/cache-bust changes in that file.

Commands run:

```bash
node --check js/certificates/studio.js && node --check js/certificates/templates.js && node --check js/certificates/renderer.js && node --check js/certificates/aiDescriptions.js && node --check js/certificates/assets.js && node --check js/certificates/exporter.js && node --check js/certificates/signers.js && node --check js/player-profile-stats.js && node --check js/organization-schedule.js && node --check js/team-media.js
git diff --cached --check
npm run test:unit
SMOKE_BASE_URL=http://localhost:8000 npm run test:smoke -- tests/smoke/certificates-workflow.spec.js
```
