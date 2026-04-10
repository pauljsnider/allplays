Thinking level: medium
Reason: small patch, but it crosses async auth timing and invite-routing behavior.

Plan:
1. Add unit coverage for deferred auto-redirect behavior while auth processing is locked.
2. Run the focused unit test and confirm it fails on current code.
3. Implement a minimal state helper in `js/login-page.js` and wire it into `login.html`.
4. Run targeted unit validation, then full unit suite if the local runtime allows it.
5. Commit all reviewable changes with issue reference.
