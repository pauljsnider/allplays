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

const PORT = Number(process.env.PORT) || 8787;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

if (!PROJECT_ID || !WEB_API_KEY) {
    throw new Error('FIREBASE_PROJECT_ID and FIREBASE_WEB_API_KEY must be set.');
}

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

const oauth = createOAuthBroker();
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
        body { font-family: -apple-system, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; justify-content: center; padding: 3rem 1rem; }
        .card { background: #1e293b; border-radius: 12px; padding: 2rem; max-width: 22rem; width: 100%; }
        h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
        p { color: #94a3b8; font-size: 0.875rem; margin: 0 0 1.25rem; }
        label { display: block; font-size: 0.8rem; margin: 0.75rem 0 0.25rem; color: #cbd5e1; }
        input[type=email], input[type=password] { width: 100%; box-sizing: border-box; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; }
        button { margin-top: 1.25rem; width: 100%; padding: 0.7rem; border: 0; border-radius: 8px; background: #38bdf8; color: #0f172a; font-weight: 600; cursor: pointer; }
        .error { background: #7f1d1d; color: #fecaca; padding: 0.6rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 0.5rem; }
    </style>
</head>
<body>
    <div class="card">
        <h1>ALL PLAYS</h1>
        <p>Sign in to connect your AllPlays account to ChatGPT. ChatGPT will be able to read your teams, schedule, and game summaries.</p>
        ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
        <form method="POST" action="/oauth/authorize">
            ${hiddenInputs}
            <label for="email">Email</label>
            <input id="email" name="email" type="email" autocomplete="username" required>
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required>
            <button type="submit">Sign in &amp; approve</button>
        </form>
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

function buildServer(identity) {
    const server = new McpServer({ name: 'allplays', version: '0.2.0' });
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

app.get('/healthz', (req, res) => res.json({ ok: true }));

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
