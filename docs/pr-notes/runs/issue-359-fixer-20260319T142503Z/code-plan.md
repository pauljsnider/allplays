# Code plan synthesis

## Smallest viable path
1. Extend `js/team-chat-media.js` with pure helpers for media action state, share payloads, and filenames.
2. Add failing unit coverage for those helpers.
3. Add a wiring test asserting the gallery exposes the new controls in `team-chat.html`.
4. Update `team-chat.html` to render action buttons and handle share/save/copy with browser fallbacks.
5. Run targeted tests, then the full unit suite if the targeted run is clean enough.

## Why this path
- It keeps tests deterministic in a static app.
- It avoids introducing a new framework or large refactor.
- It limits the patch to the issue scope while preserving future reuse for other media surfaces.
