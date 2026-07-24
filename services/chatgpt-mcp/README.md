# AllPlays ChatGPT MCP Service (read-only, rules-enforced)

Remote MCP server exposing permission-aware AllPlays tools to ChatGPT:
`get_profile`, `list_schedule`, `get_game_summary` — names aligned with the
in-app private AI registry (`apps/app/src/lib/privateAiService.ts`).

Spec: `/spec/chatgpt-app-integration/` · Plan: `AllPlays_ChatGPT_App_Integration_Plan.docx`

## How authorization works

Application data access holds **no privileged credentials**. The connector's
bearer token resolves to the user's Firebase refresh token (or a short-lived ID
token). Per request the service exchanges it for an ID token and calls the
Firestore REST API as that user, so every application read is authorized by the
same `firestore.rules` that protect the AllPlays web and mobile clients.

The production OAuth grant store is a separate control plane. Cloud Run's
service identity may access only that Firestore store and its encryption secret;
it never reads application data with service privileges.

## Run locally

```bash
cd services/chatgpt-mcp
npm install
FIREBASE_PROJECT_ID=your-project-id \
FIREBASE_WEB_API_KEY=your-web-api-key \
CHATGPT_OAUTH_CLIENT_ID=allplays-chatgpt-connector \
npm start           # listens on :8787, endpoint POST /mcp
```

`FIREBASE_PROJECT_ID` and `FIREBASE_WEB_API_KEY` are required; the service
exits at startup when either is missing. `CHATGPT_OAUTH_CLIENT_ID` identifies
the trusted public ChatGPT client and defaults to `allplays-chatgpt-connector`;
set the same value on every broker instance.

Local development defaults to `OAUTH_GRANT_STORE=memory`. This mode is bounded
but process-local. Production rejects memory mode and requires the durable
configuration below.

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
1 hour. The trusted ChatGPT client registration is configuration-backed and
stable across instances. Access and refresh grants use Firestore in production,
so they survive restarts and resolve across Cloud Run instances. Refresh-token
consume-and-reissue is one conditional Firestore commit, so concurrent reuse has
one winner. Authorization codes remain process-local under issue #4159.

Raw broker tokens are not stored. Firestore document IDs contain SHA-256 token
digests, and the Firebase refresh-token binding is encrypted with AES-256-GCM.
The service checks `expiresAt` on every read or rotation; Firestore TTL provides
eventual physical cleanup.

Sign-in accepts AllPlays email/password (proxied to Firebase Identity Toolkit
with the site referer; the password is never stored). Google sign-in is a
follow-up.

For manual curl testing you can still bypass OAuth: a Firebase refresh token
or ID token works directly as the MCP bearer.

## Durable grant-store configuration

Required production variables:

| Variable | Purpose |
|---|---|
| `OAUTH_GRANT_STORE=firestore` | Enables shared durable grants. Production rejects any other value. |
| `OAUTH_GRANT_STORE_PROJECT_ID` | Project containing the isolated grant store. Defaults to `FIREBASE_PROJECT_ID`, but a dedicated project/database reduces blast radius. |
| `OAUTH_GRANT_STORE_DATABASE_ID` | Firestore database ID. Defaults to `(default)`. |
| `OAUTH_GRANT_STORE_COLLECTION` | Collection/collection-group name. Defaults to `chatgptMcpOAuthGrants`. |
| `OAUTH_GRANT_ENCRYPTION_KEY` | Base64-encoded 32-byte AES key, supplied from Secret Manager. |

Create the encryption secret without committing the key:

```bash
openssl rand -base64 32 | tr -d '\n' \
  | gcloud secrets create chatgpt-mcp-oauth-grant-key \
      --data-file=- \
      --replication-policy=automatic \
      --project "$OAUTH_GRANT_STORE_PROJECT_ID"
```

Use a dedicated Cloud Run service account. Grant it `roles/datastore.user` only
in the isolated grant-store project and `roles/secretmanager.secretAccessor`
only on `chatgpt-mcp-oauth-grant-key`. Do not grant Editor, Owner, or application
data administration roles. Firestore IAM is project/database scoped, not
collection scoped, which is why a dedicated project or database is preferred.

Enable TTL on the `expiresAt` field:

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=chatgptMcpOAuthGrants \
  --enable-ttl \
  --database='(default)' \
  --project "$OAUTH_GRANT_STORE_PROJECT_ID"
```

TTL deletion is asynchronous and is not an authorization control. The service
rejects expired grants immediately and opportunistically deletes them.

## Deploy (Cloud Run)

```bash
gcloud run deploy allplays-chatgpt-mcp \
  --source services/chatgpt-mcp \
  --project game-flow-c6311 \
  --region us-central1 \
  --service-account chatgpt-mcp@game-flow-c6311.iam.gserviceaccount.com \
  --set-env-vars OAUTH_GRANT_STORE=firestore,OAUTH_GRANT_STORE_PROJECT_ID=oauth-grant-project,OAUTH_GRANT_STORE_DATABASE_ID='(default)',OAUTH_GRANT_STORE_COLLECTION=chatgptMcpOAuthGrants \
  --set-secrets OAUTH_GRANT_ENCRYPTION_KEY=chatgpt-mcp-oauth-grant-key:latest
```

Before increasing the minimum or maximum instance count, verify cross-instance
access-token resolution, refresh exchange after a revision restart, and a
two-request refresh race with exactly one success.

### Key rotation and rollback

The current envelope version uses one active key. Replacing the secret value
makes existing grants unreadable and intentionally forces every connector to
reconnect. Treat key replacement as a controlled revocation:

1. Announce the reconnect window and record the change.
2. Add a new Secret Manager version and deploy a revision pinned to that version.
3. Verify new grants, then disable the old version after the maximum 30-day
   refresh lifetime or after explicitly accepting immediate revocation.

Rollback must keep the same key version and durable-store configuration. Never
roll a production revision back to `OAUTH_GRANT_STORE=memory`; that reintroduces
instance-local grants and invalidates the multi-instance guarantee.

## Security model

- Identity comes only from the bearer token; tool arguments are never trusted.
- Opaque broker tokens are stored only as SHA-256 lookup digests.
- Firebase refresh-token bindings are AES-256-GCM encrypted before persistence.
- Firestore refresh rotation atomically consumes the predecessor and creates
  both successor grants.
- All Firestore access is user-credentialed — `firestore.rules` is the
  enforcement point for application data, identical to the parent UI.
- The Cloud Run service identity is limited to the isolated OAuth grant store
  and encryption secret; audit both IAM access paths.
- Responses are additionally field-whitelisted in `src/core.js`;
  `players/*/private/*` and `privatePlayerStats` are never requested.
- A forged JWT yields no data: every Firestore call presents that same token
  and is rejected by the backend.

Focused OAuth tests:
`npx vitest run tests/unit/chatgpt-mcp-oauth.test.js --reporter=verbose`
from the repo root.
