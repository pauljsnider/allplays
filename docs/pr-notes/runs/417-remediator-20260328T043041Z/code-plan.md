Implementation plan:
1. Add small local helpers in `js/homepage.js` for HTML escaping, query param encoding, and safe card field normalization.
2. Update both live-game and replay markup generation to use escaped text/attribute values and encoded `href` query params.
3. Extend `tests/unit/homepage-index.test.js` with a malicious-input case that proves the XSS vectors are neutralized.

Note:
- The requested orchestrator/subagent skills and `sessions_spawn` tool are not available in this session, so these notes capture the fallback inline role analysis.
