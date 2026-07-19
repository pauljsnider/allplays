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
npm start           # listens on :8787, endpoint POST /mcp
```

No environment variables required — the public web API key and project id
default to the main project (`game-flow-c6311`). Override with
`FIREBASE_PROJECT_ID` / `FIREBASE_WEB_API_KEY` if needed.

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

Then in ChatGPT → Settings → Apps & Connectors → Advanced → Developer Mode →
add a connector with `https://<your-ngrok-host>/mcp` and the refresh token as
the bearer token. Ask: "What does my family have this weekend?" — ChatGPT
should call `list_schedule` and answer with permission-filtered events and
deep links into AllPlays.

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
