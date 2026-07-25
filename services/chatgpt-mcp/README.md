# AllPlays ChatGPT MCP Service (read-only, rules-enforced)

Remote MCP server exposing permission-aware AllPlays tools to ChatGPT:
`get_profile`, `list_schedule`, `get_game_summary` — names aligned with the
in-app private AI registry (`apps/app/src/lib/privateAiService.ts`).

`list_schedule` combines Firestore games and practices with events from the
private ICS feeds already attached to each authorized team. External feeds are
retrieved through the same SSRF-protected calendar proxy used by the AllPlays
app; private feed URLs are never returned to ChatGPT.

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
PUBLIC_BASE_URL=https://your-public-host \
CHATGPT_OAUTH_CLIENT_ID=allplays-chatgpt-connector \
npm start           # listens on :8787, endpoint POST /mcp
```

`FIREBASE_PROJECT_ID` and `FIREBASE_WEB_API_KEY` are required; the service
exits at startup when either is missing. Production also requires
`PUBLIC_BASE_URL`, which binds authorization codes and access/refresh grants to
that exact `${PUBLIC_BASE_URL}/mcp` resource. `CHATGPT_OAUTH_CLIENT_ID`
identifies the trusted public ChatGPT client and defaults to
`allplays-chatgpt-connector`; set the same value on every broker instance.
During a migration, `CHATGPT_OAUTH_LEGACY_CLIENT_IDS` may contain a
comma-separated allowlist of previously issued public client IDs. Remove each
entry after its ChatGPT connection has been recreated.

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
stable across instances. Both ChatGPT's current per-connection callback
(`https://chatgpt.com/connector/oauth/{id}`) and its legacy callback are
strictly allowlisted. Access and refresh grants use Firestore in production, so
they survive restarts and resolve across Cloud Run instances. Authorization
codes use the same durable store, retain their
PKCE/client/redirect/resource/scope/expiry binding, and are atomically consumed
before token-exchange validation.
Refresh-token consume-and-reissue and authorization-code consumption use
conditional Firestore commits, so concurrent reuse has one winner.

Raw broker tokens and authorization codes are not stored. Firestore document IDs
contain SHA-256 digests, and the Firebase refresh-token binding is encrypted
with AES-256-GCM. Authorization-code client, redirect, PKCE, and expiry metadata
is authenticated with that encryption envelope. The service checks `expiresAt`
on every consume, read, or rotation; Firestore TTL provides eventual physical
cleanup.

Sign-in accepts AllPlays email/password (proxied to Firebase Identity Toolkit
with the site referer; the password is never stored) and Google through the
same Firebase browser SDK used by the app. Google refresh credentials are
validated through Firebase Secure Token before any broker grant is created.
The page also provides the app's password-reset flow and a read-only consent
summary.

For Google sign-in, add the MCP hostname (for example,
`mcp.allplays.ai`) to Firebase Authentication's authorized domains and add
`https://mcp.allplays.ai/*` to the Firebase browser API key's HTTP-referrer
allowlist.

For manual curl testing you can still bypass OAuth: a Firebase refresh token
or ID token works directly as the MCP bearer.

## Durable grant-store configuration

Required production variables:

| Variable | Purpose |
|---|---|
| `OAUTH_GRANT_STORE=firestore` | Enables shared durable grants. Production rejects any other value. |
| `OAUTH_GRANT_STORE_PROJECT_ID` | Explicit project containing the isolated grant store. Required in production; it never defaults to the application project. |
| `OAUTH_GRANT_STORE_DATABASE_ID` | Explicit Firestore database ID. Required in production. The application project's `(default)` database is rejected. |
| `OAUTH_GRANT_STORE_COLLECTION` | Collection/collection-group name. Defaults to `chatgptMcpOAuthGrants`. |
| `OAUTH_GRANT_ENCRYPTION_KEY` | Base64-encoded 32-byte AES key, supplied from Secret Manager. |
| `PUBLIC_BASE_URL` | Canonical HTTPS issuer/resource base. Required in production, without a trailing slash. |
| `CHATGPT_OAUTH_LEGACY_CLIENT_IDS` | Optional comma-separated migration allowlist for public client IDs issued by an older broker. |
| `CALENDAR_FETCH_FUNCTION_URL` | Optional calendar proxy override. Defaults to the production AllPlays `fetchCalendarIcs` function. |

Create the encryption secret without committing the key:

```bash
openssl rand -base64 32 | tr -d '\n' \
  | gcloud secrets create chatgpt-mcp-oauth-grant-key \
      --data-file=- \
      --replication-policy=automatic \
      --project "$OAUTH_GRANT_STORE_PROJECT_ID"
```

Use a dedicated Cloud Run service account. Grant it `roles/datastore.user` only
in an isolated grant-store project, or use an IAM condition that limits the role
to a dedicated non-default database. For example:

```bash
gcloud projects add-iam-policy-binding "$OAUTH_GRANT_STORE_PROJECT_ID" \
  --member="serviceAccount:$OAUTH_SERVICE_ACCOUNT" \
  --role=roles/datastore.user \
  --condition="expression=resource.name=='projects/$OAUTH_GRANT_STORE_PROJECT_ID/databases/$OAUTH_GRANT_STORE_DATABASE_ID',title=oauth-grant-database"
```

Grant `roles/secretmanager.secretAccessor` only on
`chatgpt-mcp-oauth-grant-key`. Do not grant Editor, Owner, project-wide
application data access, or application data administration roles. Firestore
IAM cannot be collection-scoped.

Enable TTL on the `expiresAt` field:

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group="$OAUTH_GRANT_STORE_COLLECTION" \
  --enable-ttl \
  --database="$OAUTH_GRANT_STORE_DATABASE_ID" \
  --project "$OAUTH_GRANT_STORE_PROJECT_ID"
```

TTL deletion is asynchronous and is not an authorization control. The service
rejects expired grants immediately and opportunistically deletes them.

## Deploy (Cloud Run)

```bash
OAUTH_GRANT_KEY_VERSION=1 # Pin the numeric version created above.

gcloud run deploy allplays-chatgpt-mcp \
  --source services/chatgpt-mcp \
  --project game-flow-c6311 \
  --region us-central1 \
  --service-account chatgpt-mcp@game-flow-c6311.iam.gserviceaccount.com \
  --set-env-vars FIREBASE_PROJECT_ID=game-flow-c6311,FIREBASE_WEB_API_KEY=your-web-api-key,PUBLIC_BASE_URL=https://mcp.allplays.ai,CHATGPT_OAUTH_CLIENT_ID=allplays-chatgpt-connector,OAUTH_GRANT_STORE=firestore,OAUTH_GRANT_STORE_PROJECT_ID=game-flow-c6311,OAUTH_GRANT_STORE_DATABASE_ID=chatgpt-mcp-oauth,OAUTH_GRANT_STORE_COLLECTION=chatgptMcpOAuthGrants \
  --set-secrets "OAUTH_GRANT_ENCRYPTION_KEY=chatgpt-mcp-oauth-grant-key:$OAUTH_GRANT_KEY_VERSION"
```

Before increasing the minimum or maximum instance count, verify cross-instance
authorization-code exchange, concurrent single-use code consumption,
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
