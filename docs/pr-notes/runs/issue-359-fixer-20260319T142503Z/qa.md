# QA synthesis

## Risk surface
- Share controls may appear but fail silently on unsupported browsers.
- Download behavior can vary for remote URLs.
- Copy-link can fail in restricted clipboard contexts.
- Gallery regression risk: cards may lose existing open/browse behavior.

## Test strategy
- Unit tests for `js/team-chat-media.js`:
  - action availability by capability combination
  - share payload text/title generation
  - download filename sanitization
- Wiring test for `team-chat.html`:
  - gallery renders `Share`, `Save`, and `Copy link`
  - page includes delegated handlers for media actions

## Manual validation
1. Open team chat and confirm `Photos & Videos` still opens.
2. Open a gallery with at least one image and one video.
3. Confirm each card exposes `Share`, `Save`, and `Copy link`.
4. Verify `Copy link` shows success feedback.
5. Verify `Save` downloads the selected asset.
6. On a browser with Web Share support, verify `Share` opens the native share sheet.
7. On a browser without Web Share support, verify `Share` falls back without breaking the UI.

## Exit criteria
- New unit tests pass.
- Existing team chat media tests still pass.
- No regression in gallery open/close or attachment browsing.
