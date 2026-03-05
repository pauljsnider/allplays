# Code Role (allplays-code-expert equivalent fallback)

Requested skills (`allplays-orchestrator-playbook`, `allplays-code-expert`) and `sessions_spawn` are unavailable in this runtime. This file captures equivalent implementation plan.

## Plan
1. Add failing tests for notification preference helpers and profile wiring.
2. Add `js/notification-preferences.js` helper module.
3. Add DB API methods in `js/db.js` for notification prefs/devices.
4. Add `js/push-notifications.js` client registration helper and `firebase-messaging-sw.js`.
5. Extend `profile.html` with per-team notification settings UI and save flow.
6. Extend `functions/index.js` with push dispatch helpers + chat/game triggers.
7. Update `functions/package.json` dependency and `firestore.rules` for new paths.
8. Run targeted Vitest tests and adjust until green.
