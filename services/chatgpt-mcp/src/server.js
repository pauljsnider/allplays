// AllPlays ChatGPT MCP service — Streamable HTTP entry point.
//
// Credential-free by design: the service holds no service account. Each
// request's bearer token (Firebase refresh token or ID token) is resolved to
// the user's ID token, and all Firestore access happens AS THAT USER over the
// REST API — the same security rules that protect the AllPlays web/app clients
// authorize every read here.
//
// Tool names mirror the in-app private AI registry (apps/app/src/lib/
// privateAiService.ts) so the ChatGPT surface and the app assistant stay one
// catalog as the shared service layer is extracted.

import { readFileSync } from 'node:fs';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
    DomainError,
    resolveUserContext,
    listMyTeams,
    getFamilySchedule,
    getGameSummary
} from './core.js';
import { createIdentityResolver, extractBearerToken } from './identity.js';
import { createUserDb } from './firestoreRest.js';
import { createOAuthBroker, metadataFor, OAuthError } from './oauth.js';
import { createFileStore } from './fileStore.js';
import { createFirestoreStore } from './firestoreStore.js';

const PORT = Number(process.env.PORT) || 8787;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'game-flow-c6311';
// Public web API key (client-side key; security is enforced by Firestore
// rules — see js/firebase-runtime-config.js and CLAUDE.md).
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc';

const resolveIdentity = createIdentityResolver({ apiKey: WEB_API_KEY });

// Dev-only fallback for ChatGPT's "No Auth" connector mode: requests without
// an Authorization header authenticate as this token's user. Anyone who can
// reach the endpoint gets that user's (rules-scoped) data — use only with a
// test account behind a private tunnel, never in production.
const FALLBACK_BEARER = process.env.NODE_ENV === 'production' ? '' : (process.env.DEV_FALLBACK_BEARER || '');
if (process.env.NODE_ENV === 'production' && process.env.DEV_FALLBACK_BEARER) {
    throw new Error('DEV_FALLBACK_BEARER must not be set in production.');
}
if (FALLBACK_BEARER) {
    console.warn('[chatgpt-mcp] DEV_FALLBACK_BEARER is set: unauthenticated requests act as that user. Dev/test only.');
}

// OAuth broker state (registered clients + refresh grants) survives restarts
// when a store is configured; otherwise it lives in memory and a restart signs
// the connector out. Access tokens and auth codes are always in-memory.
// Precedence: Firestore (hosted, multi-instance safe) > file (single-box dev).
let oauthStore = null;
if (process.env.OAUTH_STORE_FIRESTORE === '1') {
    oauthStore = createFirestoreStore({ projectId: PROJECT_ID });
    // A store hiccup at boot must not crash the service — degrade to an empty
    // mirror; existing grants reload on the next successful read/write.
    try {
        await oauthStore.warmup();
        console.log('[chatgpt-mcp] OAuth state persisted to Firestore (oauthBrokerState/state)');
    } catch (error) {
        console.error('[chatgpt-mcp] OAuth store warmup failed; continuing with empty state:', error.message);
    }
} else if (process.env.OAUTH_STORE_PATH) {
    oauthStore = createFileStore(process.env.OAUTH_STORE_PATH);
    console.log(`[chatgpt-mcp] OAuth state persisted to ${process.env.OAUTH_STORE_PATH}`);
}
const oauth = createOAuthBroker({ store: oauthStore });
const SIGNIN_REFERER = process.env.ALLPLAYS_REFERER || 'https://allplays.ai/';

// Public base URL for OAuth metadata: env override, else derive from the
// proxy-forwarded headers (ngrok / Cloud Run set these).
function publicBaseUrl(req) {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${proto}://${host}`;
}

async function firebaseSignIn(email, password) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Referer: SIGNIN_REFERER },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const body = await response.json();
    if (!response.ok) {
        const reason = body?.error?.message || 'Sign-in failed.';
        throw new OAuthError('access_denied', reason);
    }
    return { refreshToken: body.refreshToken, uid: body.localId };
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

// ALL PLAYS logo, inlined so the sign-in page is fully self-contained.
const LOGO_DATA_URI = `data:image/png;base64,${readFileSync(new URL('./ui/logo.png', import.meta.url)).toString('base64')}`;

// Sign-in page styled to match the AllPlays app auth screen
// (apps/app/src/pages/AuthPage.tsx + components/AuthFrame.tsx): light theme,
// indigo primary (#4f46e5→#4338ca), app-card / auth-input / primary-button.
function renderSignInPage({ clientId, redirectUri, codeChallenge, state, scope, error }) {
    const hidden = { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, state, scope };
    const hiddenInputs = Object.entries(hidden)
        .filter(([, value]) => value)
        .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
        .join('\n            ');
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in to ALL PLAYS</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #f9fafb; color: #030712; -webkit-font-smoothing: antialiased; }
        .wrap { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px 16px; }
        .brand { display: flex; align-items: center; gap: 12px; width: 100%; max-width: 28rem; margin-bottom: 20px; }
        .brand img { height: 44px; width: 44px; border-radius: 12px; box-shadow: 0 1px 2px rgba(16,24,40,0.08); }
        .brand .name { display: block; font-size: 1.125rem; font-weight: 900; line-height: 1.15; color: #030712; }
        .brand .eyebrow { display: block; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #4338ca; }
        .card { width: 100%; max-width: 28rem; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; box-shadow: 0 10px 24px rgba(16,24,40,0.07); padding: 22px; }
        .head { display: flex; align-items: flex-start; gap: 12px; }
        .head .icon { flex: none; height: 44px; width: 44px; border-radius: 12px; background: #eef2ff; color: #4338ca; display: flex; align-items: center; justify-content: center; }
        h1 { font-size: 1.4rem; font-weight: 900; color: #030712; margin: 0; }
        .sub { margin: 4px 0 0; font-size: 0.875rem; font-weight: 600; line-height: 1.5; color: #4b5563; }
        label { display: block; margin-top: 14px; margin-bottom: 6px; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
        input[type=email], input[type=password] { width: 100%; min-height: 44px; border: 1px solid #d0d5dd; border-radius: 10px; background: #ffffff; padding: 10px 12px; color: #111827; font-size: 1rem; font-weight: 600; outline: none; }
        input:focus { border-color: #818cf8; box-shadow: 0 0 0 3px #e0e7ff; }
        button { margin-top: 20px; width: 100%; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 10px; background: linear-gradient(90deg, #4f46e5, #4338ca); padding: 10px 14px; color: #ffffff; font-size: 0.95rem; font-weight: 800; cursor: pointer; box-shadow: 0 10px 20px rgba(79,70,229,0.22); }
        button:hover { filter: brightness(1.05); }
        .error { margin-top: 16px; border: 1px solid #fecdd3; background: #fff1f2; color: #be123c; border-radius: 12px; padding: 12px; font-size: 0.85rem; font-weight: 700; }
        .foot { margin-top: 16px; text-align: center; font-size: 0.75rem; font-weight: 600; color: #6b7280; }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="brand">
            <img src="${LOGO_DATA_URI}" alt="ALL PLAYS">
            <span>
                <span class="name">ALL PLAYS</span>
                <span class="eyebrow">Connect to ChatGPT</span>
            </span>
        </div>
        <div class="card">
            <div class="head">
                <div class="icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                </div>
                <div>
                    <h1>Sign in</h1>
                    <p class="sub">Connect your ALL PLAYS account to ChatGPT. It will be able to read your teams, schedule, and game summaries.</p>
                </div>
            </div>
            ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
            <form method="POST" action="/oauth/authorize">
                ${hiddenInputs}
                <label for="email">Email</label>
                <input id="email" name="email" type="email" autocomplete="username" placeholder="you@example.com" required>
                <label for="password">Password</label>
                <input id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required>
                <button type="submit">Sign in &amp; approve</button>
            </form>
            <div class="foot">Uses your existing ALL PLAYS login.</div>
        </div>
    </div>
</body>
</html>`;
}

function toolResult(payload) {
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
}

function toolError(error) {
    const code = error instanceof DomainError ? error.code : 'internal';
    const message = error instanceof DomainError ? error.message : 'Internal error.';
    if (!(error instanceof DomainError)) console.error('[chatgpt-mcp] tool failure:', error);
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }] };
}

// Embedded UI templates (Apps SDK): served as MCP resources and referenced by
// tools via _meta["openai/outputTemplate"]. ChatGPT renders them in a
// sandboxed iframe; data arrives via the tool result's structuredContent.
const SCHEDULE_CARD_URI = 'ui://widget/allplays-schedule.html';
const SCHEDULE_CARD_HTML = readFileSync(new URL('./ui/schedule-card.html', import.meta.url), 'utf8');

function buildServer(identity) {
    const server = new McpServer({ name: 'allplays', version: '0.2.0' });

    server.registerResource('allplays-schedule-card', SCHEDULE_CARD_URI, {}, async () => ({
        contents: [{
            uri: SCHEDULE_CARD_URI,
            mimeType: 'text/html+skybridge',
            text: SCHEDULE_CARD_HTML
        }]
    }));
    const db = createUserDb({ projectId: PROJECT_ID, idToken: identity.idToken });

    const run = (handler) => async (args) => {
        try {
            const context = await resolveUserContext(db, identity);
            return toolResult(await handler(context, args));
        } catch (error) {
            return toolError(error);
        }
    };

    server.registerTool('get_profile', {
        title: 'Get profile',
        description: 'Account roles, linked teams, and linked players for the signed-in AllPlays user.',
        inputSchema: {},
        annotations: { readOnlyHint: true }
    }, run((context) => listMyTeams(db, context)));

    server.registerTool('list_schedule', {
        title: 'List schedule',
        description: 'Games and practices in a date range (default: next 7 days) across the user\'s teams, with RSVP state for linked players and deep links into AllPlays.',
        _meta: {
            'openai/outputTemplate': SCHEDULE_CARD_URI,
            'openai/toolInvocation/invoking': 'Checking your family schedule',
            'openai/toolInvocation/invoked': 'Found your family schedule'
        },
        inputSchema: {
            startDate: z.string().optional().describe('ISO date, inclusive. Defaults to today.'),
            endDate: z.string().optional().describe('ISO date, inclusive. Defaults to startDate + 7 days.')
        },
        annotations: { readOnlyHint: true }
    }, run((context, args) => getFamilySchedule(db, context, args)));

    server.registerTool('get_game_summary', {
        title: 'Get game summary',
        description: 'Score, status, summary, and aggregated player statistics for one game on a team the user belongs to.',
        inputSchema: {
            teamId: z.string().describe('Team id from get_profile'),
            gameId: z.string().describe('Game id from list_schedule')
        },
        annotations: { readOnlyHint: true }
    }, run((context, args) => getGameSummary(db, context, args)));

    return server;
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Liveness. Not /healthz — Google's Front End reserves that path on Cloud Run
// and returns a 404 before the request reaches the container.
app.get(['/', '/health'], (req, res) => res.json({ ok: true, service: 'allplays-chatgpt-mcp' }));

// --- OAuth broker endpoints (discovery, registration, authorize, token) ---

app.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'], (req, res) => {
    res.json(metadataFor(publicBaseUrl(req)).authorizationServer);
});

app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (req, res) => {
    res.json(metadataFor(publicBaseUrl(req)).protectedResource);
});

app.post('/oauth/register', (req, res) => {
    try {
        res.status(201).json(oauth.registerClient(req.body || {}));
    } catch (error) {
        const code = error instanceof OAuthError ? error.code : 'server_error';
        res.status(400).json({ error: code, error_description: error.message });
    }
});

app.get('/oauth/authorize', (req, res) => {
    try {
        const { clientId, redirectUri, codeChallenge } = oauth.validateAuthorizeRequest(req.query || {});
        res.type('html').send(renderSignInPage({
            clientId,
            redirectUri,
            codeChallenge,
            state: req.query.state,
            scope: req.query.scope
        }));
    } catch (error) {
        const message = error instanceof OAuthError ? error.message : 'Invalid authorization request.';
        res.status(400).type('html').send(`<p>${escapeHtml(message)}</p>`);
    }
});

app.post('/oauth/authorize', async (req, res) => {
    const params = req.body || {};
    try {
        const { clientId, redirectUri, codeChallenge } = oauth.validateAuthorizeRequest({
            client_id: params.client_id,
            redirect_uri: params.redirect_uri,
            response_type: 'code',
            code_challenge: params.code_challenge,
            code_challenge_method: 'S256'
        });
        // Normal path: AllPlays email/password sign-in. A caller may instead
        // present an existing Firebase refresh token (itself a credential) —
        // used by automated tests; the token is validated on first use.
        let firebaseRefreshToken = typeof params.refresh_token === 'string' && params.refresh_token ? params.refresh_token : null;
        if (!firebaseRefreshToken) {
            const signedIn = await firebaseSignIn(String(params.email || ''), String(params.password || ''));
            firebaseRefreshToken = signedIn.refreshToken;
        }
        const code = oauth.approveAuthorization({ clientId, redirectUri, codeChallenge, firebaseRefreshToken });
        const redirect = new URL(redirectUri);
        redirect.searchParams.set('code', code);
        if (params.state) redirect.searchParams.set('state', params.state);
        res.redirect(302, redirect.toString());
    } catch (error) {
        if (error instanceof OAuthError && error.code === 'access_denied') {
            res.status(401).type('html').send(renderSignInPage({
                clientId: params.client_id,
                redirectUri: params.redirect_uri,
                codeChallenge: params.code_challenge,
                state: params.state,
                scope: params.scope,
                error: 'Sign-in failed. Check your email and password.'
            }));
            return;
        }
        const message = error instanceof OAuthError ? error.message : 'Authorization failed.';
        console.error('[chatgpt-mcp] authorize failure:', error);
        res.status(400).type('html').send(`<p>${escapeHtml(message)}</p>`);
    }
});

app.post('/oauth/token', (req, res) => {
    try {
        res.json(oauth.exchange(req.body || {}));
    } catch (error) {
        const code = error instanceof OAuthError ? error.code : 'server_error';
        if (!(error instanceof OAuthError)) console.error('[chatgpt-mcp] token failure:', error);
        res.status(400).json({ error: code, error_description: error.message });
    }
});

app.post('/mcp', async (req, res) => {
    let identity;
    try {
        let authHeader = req.headers.authorization
            || (FALLBACK_BEARER ? `Bearer ${FALLBACK_BEARER}` : undefined);
        // Broker-issued access tokens resolve to the user's Firebase refresh
        // token; direct Firebase refresh/ID tokens pass through unchanged.
        const bearer = extractBearerToken(authHeader);
        const brokerGrant = bearer ? oauth.resolveAccessToken(bearer) : null;
        if (brokerGrant) authHeader = `Bearer ${brokerGrant.firebaseRefreshToken}`;
        identity = await resolveIdentity(authHeader);
    } catch (error) {
        const message = error instanceof DomainError ? error.message : 'Unauthorized.';
        res.status(401)
            .set('WWW-Authenticate', `Bearer resource_metadata="${publicBaseUrl(req)}/.well-known/oauth-protected-resource"`)
            .json({
                jsonrpc: '2.0',
                error: { code: -32001, message },
                id: null
            });
        return;
    }

    try {
        const server = buildServer(identity);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
            transport.close();
            server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error('[chatgpt-mcp] request failure:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null
            });
        }
    }
});

// Stateless server: no SSE notification stream or session teardown to serve.
app.get('/mcp', (req, res) => res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
}));
app.delete('/mcp', (req, res) => res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
}));

app.listen(PORT, () => {
    console.log(`[chatgpt-mcp] listening on :${PORT} (POST /mcp) — project ${PROJECT_ID}, user-credentialed Firestore access`);
});
