# AllPlays ChatGPT MCP Service (read-only, rules-enforced)

Remote MCP server exposing permission-aware AllPlays tools to ChatGPT:
`get_profile`, `list_schedule`, `get_game_summary` — names aligned with the
in-app private AI registry (`apps/app/src/lib/privateAiService.ts`).

Spec: `/spec/chatgpt-app-integration/` · Plan: `AllPlays_ChatGPT_App_Integration_Plan.docx`

## How authorization works

The service holds **no privileged credentials** (no service account, no Admin
SDK). The connector's bearer token is the user's Firebase **refresh token**
(or a short-lived ID token). Per request the service exchanges it for an ID
token and calls the **Firestore REST API as that user**, so every read is
authorized by the same `firestore.rules` that protect the AllPlays web and
mobile clients. Cross-team access fails at the database, not just in service
code (which also checks, as defense-in-depth).

## Run locally

```bash
cd services/chatgpt-mcp
npm install
FIREBASE_PROJECT_ID=your-project-id \
FIREBASE_WEB_API_KEY=your-web-api-key \
npm start           # listens on :8787, endpoint POST /mcp
```

`FIREBASE_PROJECT_ID` and `FIREBASE_WEB_API_KEY` are required; the service
exits at startup when either is missing.

Get a bearer token (prints your refresh token):

```bash
ALLPLAYS_EMAIL=you@example.com ALLPLAYS_PASSWORD=... node scripts/get-token.mjs
```

Smoke check:

```bash
curl -s http://localhost:8787/mcp \
  -H "Authorization: Bearer <refresh-token>" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Connect from ChatGPT Developer Mode (ngrok)

```bash
ngrok config add-authtoken <your-token>   # once
ngrok http 8787
```

Then in ChatGPT → Settings → Apps → Advanced settings → Developer mode → New
App:

- Server URL: `https://<your-ngrok-host>/mcp`
- Authentication: **OAuth** — ChatGPT discovers the broker automatically
  (`/.well-known/oauth-authorization-server`), registers itself, and sends the
  user to the AllPlays sign-in page; tokens are per-user, PKCE-protected.

Ask: "What does my family have this weekend?" — ChatGPT should call
`list_schedule` and answer with permission-filtered events and deep links.

### OAuth broker

`src/oauth.js` implements the slice of OAuth 2.1 the MCP spec requires:
dynamic client registration, authorization code + PKCE (S256 only), refresh
grant, and opaque access tokens that map to the signed-in user's Firebase
refresh token. Codes are single-use with a 10-minute TTL; access tokens last
1 hour. Storage is in-memory — restart logs everyone out; Firestore-backed
storage is a prerequisite for multi-instance Cloud Run.

Sign-in accepts AllPlays email/password (proxied to Firebase Identity Toolkit
with the site referer; the password is never stored). Google sign-in is a
follow-up.

For manual curl testing you can still bypass OAuth: a Firebase refresh token
or ID token works directly as the MCP bearer.

## Deploy (dev Cloud Run)

```bash
gcloud run deploy allplays-chatgpt-mcp \
  --source services/chatgpt-mcp \
  --project game-flow-c6311 \
  --region us-central1
```

No secrets to provision — the service is stateless and credential-free. The
production path replaces raw refresh tokens with an OAuth broker
(authorization code + PKCE) that yields the same user-scoped credential.

## Security model

- Identity comes only from the bearer token; tool arguments are never trusted.
- All Firestore access is user-credentialed — `firestore.rules` is the
  enforcement point, identical to the parent UI.
- Responses are additionally field-whitelisted in `src/core.js`;
  `players/*/private/*` and `privatePlayerStats` are never requested.
- A forged JWT yields no data: every Firestore call presents that same token
  and is rejected by the backend.

Unit tests: `npx vitest run tests/unit/chatgpt-mcp-core.test.js` from the repo root.
