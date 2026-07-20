# ChatGPT App Integration — Tasks

## Phase 1 — Read-only foundation (spike)

- [x] 1. Scaffold `services/chatgpt-mcp/` Node package (MCP SDK, express, zod — no privileged credentials). _Req 1.1_
- [x] 2. Implement `src/identity.js`: bearer (Firebase refresh token or ID token) → `{uid, email, idToken}` via securetoken exchange with caching. _Req 2.1, 2.4_
- [x] 3. Implement `src/firestoreRest.js`: user-credentialed Firestore REST adapter — every read authorized by `firestore.rules` as the user, same as the parent UI. _Req 2.2_
- [x] 4. Implement `src/core.js` `resolveUserContext`: owner/admin/parent role resolution (defense-in-depth over rules), global-admin flag. _Req 2.2_
- [x] 5. Implement `get_profile` (teams + roles + linked players, name/number only; name aligned with the in-app private AI registry). _Req 1.2, 5.1_
- [x] 6. Implement `list_schedule` (date-range query per authorized team, whitelisted event fields, caller's own RSVP, deep links). _Req 3.1–3.3_
- [x] 7. Implement `get_game_summary` (membership check, whitelisted game fields, aggregated stats, deep link). _Req 4.1–4.2_
- [x] 8. Wire `src/server.js`: express, auth middleware, stateless Streamable HTTP transport, tool registration, error mapping. _Req 1.1, 1.3_
- [x] 9. Unit tests in `tests/unit/chatgpt-mcp-core.test.js`: roles, cross-team denial, rules-denial degradation, range filter, whitelists, token exchange, REST adapter. _Req 2.3, 5.1–5.2_
- [x] 10. Service README + `scripts/get-token.mjs`: local run, refresh-token bearer, ngrok + Developer Mode connection steps. _Req 1.1_

## Phase 1 — remaining (before dev deploy)

- [ ] 11. Connect locally via ngrok + ChatGPT Developer Mode; validate tool discovery and the first-milestone prompt. _Req 1.1_
- [ ] 12. Deploy to a dev Cloud Run endpoint. _Req 1.1_
- [ ] 13. Structured security tests for parent, coach, unauthorized, and cross-team scenarios against the live service. _Req 2.3_

## Phase 2+ (per plan §10, not started)

- [ ] 14. Extract the in-app private AI registry's `summarize*`/`loadParent*` layer (`apps/app/src/lib/privateAiService.ts`, `parentToolsService.ts`) into a shared package so MCP tools and the app assistant run one implementation (covers practice sessions, assignments, rideshare, RSVP fallback resolution the spike omits).
- [x] 15. OAuth broker: dynamic client registration, authorization code + PKCE (S256), refresh grant, AllPlays sign-in page; broker tokens map to the user's Firebase refresh token. _Req 2.4_
- [ ] 15b. Harden the broker for production: Firestore-backed token/code storage (in-memory today), Google sign-in on the authorize page, token revocation/disconnect endpoint, rate limiting.
- [ ] 16. `get_event_details`, `get_coach_attention_items`, `get_practice_context` read tools (mirror app registry names where they exist).
- [x] 17a. Family Schedule Card on `list_schedule` (day-grouped events, RSVP badges, follow-up RSVP prompts, deep links; upgrade Respond buttons to `callTool` when `update_rsvp` ships).
- [ ] 17b. Game Summary Card on `get_game_summary`.
- [ ] 18. Write tools with confirmation, idempotency, audit — reuse the app registry's pending-confirmation staging (`update_rsvp`, practice-plan save). _Req 6.1_
