# AllPlays ChatGPT MCP Service (read-only, rules-enforced)

Remote MCP server exposing permission-aware AllPlays tools to ChatGPT:
`get_profile`, `list_schedule`, `get_game_summary` — names aligned with the
in-app private AI registry (`apps/app/src/lib/privateAiService.ts`).

Spec: `/spec/chatgpt-app-integration/` · Plan: `AllPlays_ChatGPT_App_Integration_Plan.docx`

## Deployed endpoint

Cloud Run (project `game-flow-c6311`, region `us-central1`):

```
https://allplays-chatgpt-mcp-982493478258.us-central1.run.app/mcp
```

Connect in ChatGPT → Settings → Apps → Developer mode → New App: paste that URL
and choose **OAuth**. ChatGPT discovers the broker, registers itself, and sends
you to the AllPlays sign-in page. No tunnel, no laptop required.

## How authorization works

For **user data**, the service holds no privileged credentials: the connector's
OAuth token maps to the user's Firebase refresh token, which the service
exchanges for an ID token and uses to call the **Firestore REST API as that
user** — every read is authorized by the same `firestore.rules` that protect
the AllPlays web and mobile clients. Cross-team access fails at the database,
not just in service code (which also checks, as defense-in-depth).

The one exception is the **OAuth broker's own bookkeeping** (registered clients
and broker-token → refresh-token grants). That is service state with no owning
user, so it is persisted with the Cloud Run runtime service account (Firestore
REST via the metadata-server token) into `oauthBrokerState/state`, a collection
denied to all client access by the default-deny rule in `firestore.rules`.

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

### Local ChatGPT testing over a tunnel (optional)

The deployed Cloud Run URL above is the normal way to connect. To test local
code changes against ChatGPT before deploying, expose the local server with a
tunnel and point a second Developer-mode app at it:

```bash
ngrok config add-authtoken <your-token>   # once
ngrok http 8787
```

Use `https://<your-ngrok-host>/mcp` with Authentication **OAuth**. ChatGPT
discovers the broker (`/.well-known/oauth-authorization-server`), registers
itself, and sends the user to the AllPlays sign-in page; tokens are per-user,
PKCE-protected. Ask "What does my family have this weekend?".

## Deploy to Cloud Run

```bash
gcloud run deploy allplays-chatgpt-mcp \
  --source services/chatgpt-mcp \
  --project game-flow-c6311 --region us-central1 \
  --allow-unauthenticated --set-env-vars OAUTH_STORE_FIRESTORE=1 \
  --min-instances 0 --max-instances 2 --memory 512Mi
```

`--allow-unauthenticated` exposes the endpoint publicly; the app does its own
OAuth. `OAUTH_STORE_FIRESTORE=1` selects Firestore-backed broker storage. The
Cloud Run runtime service account needs Firestore access (the default compute
SA's `roles/editor` covers it). `NODE_ENV=production` (set in the Dockerfile)
forces the dev No-Auth fallback off.

Note: `allplays.ai` is served by **GitHub Pages** (DNS → GitHub IPs), not
Firebase Hosting, so a Hosting rewrite can't front this service at
`allplays.ai/mcp`. For a branded URL, map a subdomain to Cloud Run:

```bash
gcloud run domain-mappings create --service allplays-chatgpt-mcp \
  --domain mcp.allplays.ai --project game-flow-c6311 --region us-central1
```

then add the CNAME record it prints to allplays.ai DNS and verify domain
ownership. Otherwise the `*.run.app` URL above is stable and sufficient.

### OAuth broker

`src/oauth.js` implements the slice of OAuth 2.1 the MCP spec requires:
dynamic client registration, authorization code + PKCE (S256 only), refresh
grant, and opaque access tokens that map to the signed-in user's Firebase
refresh token. Codes are single-use with a 10-minute TTL; access tokens last
1 hour. Long-lived state (clients + refresh grants) persists via
`OAUTH_STORE_FIRESTORE=1` (Firestore, hosted) or `OAUTH_STORE_PATH` (a local
file, single-box dev); without either it is in-memory and a restart signs the
connector out.

Sign-in accepts AllPlays email/password (proxied to Firebase Identity Toolkit
with the site referer; the password is never stored). Google sign-in is a
follow-up.

For manual curl testing you can still bypass OAuth: a Firebase refresh token
or ID token works directly as the MCP bearer.

## Setup walkthrough (how this was stood up)

The first working end-to-end connection was built in this order — repeatable
from a fresh clone:

1. **Run the service**: `cd services/chatgpt-mcp && npm install && npm start`.
   No credentials or env vars needed; it listens on `:8787`.
2. **Expose it over HTTPS**: `ngrok http 8787` (any HTTPS tunnel or a dev
   Cloud Run revision works). Note the public hostname.
3. **Create the ChatGPT app**: ChatGPT → Settings → Apps → Advanced settings →
   enable Developer mode → New App:
   - Name: All Plays
   - Connection: Server URL → `https://<public-host>/mcp`
   - Authentication: **OAuth**
   - Accept the custom-MCP risk checkbox → Create.
4. **Sign in**: when you first use the app, ChatGPT runs OAuth discovery,
   registers itself, and opens the AllPlays sign-in page. Sign in with an
   AllPlays account (use a test account for development) and approve.
5. **Test prompts**: "What does my family have this weekend?", "What still
   needs my RSVP?", "Summarize our last game."

### Gotchas learned along the way

- **API key referer restriction**: the public Firebase web API key only
  accepts requests with an AllPlays referer. Server-side calls to
  `identitytoolkit` / `securetoken` must send `Referer: https://allplays.ai/`
  (the code does; override with `ALLPLAYS_REFERER`).
- **ChatGPT's connector UI has no static-token option** — it's OAuth, No Auth,
  or Mixed. That's why the OAuth broker exists. `DEV_FALLBACK_BEARER` (map
  unauthenticated requests to a test user's refresh token) exists for quick
  No-Auth experiments only: it exposes that account's data to anyone who can
  reach the endpoint, and the server refuses to start with it in production.
- **Server restart logs the connector out** (in-memory OAuth storage):
  re-running the sign-in flow reconnects. Firestore-backed storage is the
  planned fix before a multi-instance deploy.
- **Free ngrok hostnames** are stable per account but the tunnel must stay
  running; the connector URL must be updated if the hostname changes.

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

Unit tests (from the repo root):

```bash
npx vitest run tests/unit/chatgpt-mcp-core.test.js tests/unit/chatgpt-mcp-oauth.test.js
```
