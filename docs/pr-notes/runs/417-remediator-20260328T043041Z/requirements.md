Objective: Resolve PR #417 homepage review feedback about XSS in live-game and replay card rendering.

Current state:
- `js/homepage.js` builds card markup with `innerHTML` and interpolates Firestore-derived values directly into text nodes and HTML attributes.
- Untrusted team names, opponent names, IDs, and image URLs can break markup or inject script-bearing HTML.

Required behavior:
- All user-controlled values rendered in homepage live/replay cards must be escaped before HTML insertion.
- Link query parameter values must be encoded so untrusted IDs cannot break the `href`.

Assumptions:
- The requested scope is limited to the homepage card rendering paths called out in the two review threads.
- Existing card layout and empty/error states should remain unchanged.
