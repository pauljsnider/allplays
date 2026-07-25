// AllPlays ChatGPT MCP service — Streamable HTTP entry point.
//
// Application reads remain user-credentialed: each request's Firebase token is
// resolved to the user's ID token, and Firestore access happens AS THAT USER.
// The Cloud Run service identity is used only for the isolated OAuth grant
// store; it never performs application-data reads.
//
// Tool names mirror the in-app private AI registry (apps/app/src/lib/
// privateAiService.ts) so the ChatGPT surface and the app assistant stay one
// catalog as the shared service layer is extracted.

import express from 'express';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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
import { escapeHtml, renderSignInPage } from './signInPage.js';
import {
    createFirestoreOAuthGrantStore,
    createMemoryOAuthGrantStore,
    createMetadataAccessTokenProvider
} from './oauthStore.js';

const PORT = Number(process.env.PORT) || 8787;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
const CONFIGURED_PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

if (!PROJECT_ID || !WEB_API_KEY) {
    throw new Error('FIREBASE_PROJECT_ID and FIREBASE_WEB_API_KEY must be set.');
}
if (IS_PRODUCTION && !CONFIGURED_PUBLIC_BASE_URL) {
    throw new Error('Production and Cloud Run require PUBLIC_BASE_URL for OAuth audience binding.');
}

const resolveIdentity = createIdentityResolver({ apiKey: WEB_API_KEY });

// Dev-only fallback for ChatGPT's "No Auth" connector mode: requests without
// an Authorization header authenticate as this token's user. Anyone who can
// reach the endpoint gets that user's (rules-scoped) data — use only with a
// test account behind a private tunnel, never in production.
const FALLBACK_BEARER = IS_PRODUCTION ? '' : (process.env.DEV_FALLBACK_BEARER || '');
if (IS_PRODUCTION && process.env.DEV_FALLBACK_BEARER) {
    throw new Error('DEV_FALLBACK_BEARER must not be set in production.');
}
if (FALLBACK_BEARER) {
    console.warn('[chatgpt-mcp] DEV_FALLBACK_BEARER is set: unauthenticated requests act as that user. Dev/test only.');
}

const OAUTH_GRANT_STORE = process.env.OAUTH_GRANT_STORE
    || (IS_PRODUCTION ? 'firestore' : 'memory');
if (IS_PRODUCTION && OAUTH_GRANT_STORE !== 'firestore') {
    throw new Error('Production and Cloud Run require OAUTH_GRANT_STORE=firestore.');
}
if (!['memory', 'firestore'].includes(OAUTH_GRANT_STORE)) {
    throw new Error('OAUTH_GRANT_STORE must be "memory" or "firestore".');
}
const OAUTH_GRANT_STORE_PROJECT_ID = process.env.OAUTH_GRANT_STORE_PROJECT_ID
    || (IS_PRODUCTION ? '' : PROJECT_ID);
const OAUTH_GRANT_STORE_DATABASE_ID = process.env.OAUTH_GRANT_STORE_DATABASE_ID
    || (IS_PRODUCTION ? '' : '(default)');
if (IS_PRODUCTION && (!OAUTH_GRANT_STORE_PROJECT_ID || !OAUTH_GRANT_STORE_DATABASE_ID)) {
    throw new Error(
        'Production and Cloud Run require explicit OAUTH_GRANT_STORE_PROJECT_ID '
        + 'and OAUTH_GRANT_STORE_DATABASE_ID values.'
    );
}
if (
    IS_PRODUCTION
    && OAUTH_GRANT_STORE_PROJECT_ID === PROJECT_ID
    && OAUTH_GRANT_STORE_DATABASE_ID === '(default)'
) {
    throw new Error(
        'Production OAuth grants must use an isolated project or a non-default Firestore database.'
    );
}
const oauthGrantStore = OAUTH_GRANT_STORE === 'firestore'
    ? createFirestoreOAuthGrantStore({
        projectId: OAUTH_GRANT_STORE_PROJECT_ID,
        databaseId: OAUTH_GRANT_STORE_DATABASE_ID,
        collectionId: process.env.OAUTH_GRANT_STORE_COLLECTION || 'chatgptMcpOAuthGrants',
        encryptionKey: process.env.OAUTH_GRANT_ENCRYPTION_KEY,
        accessTokenProvider: createMetadataAccessTokenProvider()
    })
    : createMemoryOAuthGrantStore();
const oauth = createOAuthBroker({
    trustedClientId: process.env.CHATGPT_OAUTH_CLIENT_ID,
    legacyClientIds: String(process.env.CHATGPT_OAUTH_LEGACY_CLIENT_IDS || '')
        .split(',')
        .map((clientId) => clientId.trim())
        .filter(Boolean),
    resource: CONFIGURED_PUBLIC_BASE_URL ? `${CONFIGURED_PUBLIC_BASE_URL}/mcp` : '',
    grantStore: oauthGrantStore
});
const SIGNIN_REFERER = process.env.ALLPLAYS_REFERER || 'https://allplays.ai/';
const FIREBASE_CLIENT_CONFIG = {
    apiKey: WEB_API_KEY,
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID
};
const READ_SCOPE = 'allplays.read';
const READ_SECURITY_SCHEMES = [{ type: 'oauth2', scopes: [READ_SCOPE] }];

// Public base URL for OAuth metadata: env override, else derive from the
// proxy-forwarded headers (ngrok / Cloud Run set these).
function publicBaseUrl(req) {
    if (CONFIGURED_PUBLIC_BASE_URL) return CONFIGURED_PUBLIC_BASE_URL;
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

async function verifyFirebaseRefreshToken(refreshToken) {
    const value = String(refreshToken || '').trim();
    if (!value || value.split('.').length === 3) {
        throw new OAuthError('access_denied', 'Google sign-in did not produce a valid refresh credential.');
    }
    try {
        const identity = await resolveIdentity(`Bearer ${value}`);
        if (identity.via !== 'refresh-token' || !identity.uid) {
            throw new Error('Unexpected credential type.');
        }
        return { refreshToken: value, uid: identity.uid };
    } catch {
        throw new OAuthError('access_denied', 'Google sign-in could not be verified.');
    }
}

async function firebasePasswordReset(email) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${WEB_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Referer: SIGNIN_REFERER },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email })
    });
    // Keep the response account-enumeration safe. Firebase may return
    // EMAIL_NOT_FOUND depending on the project's enumeration-protection mode.
    if (!response.ok) {
        await response.json().catch(() => ({}));
    }
}

function signInPage(params) {
    return renderSignInPage({
        ...params,
        firebaseConfig: FIREBASE_CLIENT_CONFIG
    });
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
        annotations: { readOnlyHint: true },
        securitySchemes: READ_SECURITY_SCHEMES,
        _meta: { securitySchemes: READ_SECURITY_SCHEMES }
    }, run((context) => listMyTeams(db, context)));

    server.registerTool('list_schedule', {
        title: 'List schedule',
        description: 'Games and practices in a date range (default: next 7 days) across the user\'s teams, with RSVP state for linked players and deep links into AllPlays.',
        inputSchema: {
            startDate: z.string().optional().describe('ISO date, inclusive. Defaults to today.'),
            endDate: z.string().optional().describe('ISO date, inclusive. Defaults to startDate + 7 days.')
        },
        annotations: { readOnlyHint: true },
        securitySchemes: READ_SECURITY_SCHEMES,
        _meta: { securitySchemes: READ_SECURITY_SCHEMES }
    }, run((context, args) => getFamilySchedule(db, context, args)));

    server.registerTool('get_game_summary', {
        title: 'Get game summary',
        description: 'Score, status, summary, and aggregated player statistics for one game on a team the user belongs to.',
        inputSchema: {
            teamId: z.string().describe('Team id from get_profile'),
            gameId: z.string().describe('Game id from list_schedule')
        },
        annotations: { readOnlyHint: true },
        securitySchemes: READ_SECURITY_SCHEMES,
        _meta: { securitySchemes: READ_SECURITY_SCHEMES }
    }, run((context, args) => getGameSummary(db, context, args)));

    // The current MCP TypeScript SDK accepts securitySchemes in registerTool()
    // but does not yet emit the field in tools/list. ChatGPT's plugin contract
    // requires the top-level field (the _meta copy remains for compatibility),
    // so decorate the SDK-generated catalog until the SDK emits it natively.
    const sdkListToolsHandler = server.server._requestHandlers.get('tools/list');
    server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
        const result = await sdkListToolsHandler(request, extra);
        return {
            ...result,
            tools: result.tools.map((tool) => ({
                ...tool,
                securitySchemes: READ_SECURITY_SCHEMES
            }))
        };
    });

    return server;
}

export const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/oauth', (req, res, next) => {
    res.set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    });
    next();
});

app.get('/', (req, res) => res.json({
    ok: true,
    service: 'allplays-chatgpt-mcp',
    mcp: `${publicBaseUrl(req)}/mcp`
}));
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// --- OAuth broker endpoints (discovery, registration, authorize, token) ---

app.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'], (req, res) => {
    res.json(metadataFor(publicBaseUrl(req)).authorizationServer);
});
// ChatGPT probes both RFC 8414 and OpenID discovery after token exchange.
// This broker is OAuth-only, but the authorization-server fields are valid at
// either discovery location and publishing both avoids a post-login 404.
app.get(['/.well-known/openid-configuration', '/.well-known/openid-configuration/mcp'], (req, res) => {
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
        const validated = oauth.validateAuthorizeRequest(req.query || {});
        res.type('html').send(signInPage({
            clientId: validated.clientId,
            redirectUri: validated.redirectUri,
            codeChallenge: validated.codeChallenge,
            resource: validated.resource,
            scope: validated.scope,
            state: req.query.state
        }));
    } catch (error) {
        const message = error instanceof OAuthError ? error.message : 'Invalid authorization request.';
        res.status(400).type('html').send(`<p>${escapeHtml(message)}</p>`);
    }
});

app.post('/oauth/authorize', async (req, res) => {
    const params = req.body || {};
    try {
        const validated = oauth.validateAuthorizeRequest({
            client_id: params.client_id,
            redirect_uri: params.redirect_uri,
            response_type: 'code',
            code_challenge: params.code_challenge,
            code_challenge_method: 'S256',
            resource: params.resource,
            scope: params.scope
        });
        if (params.intent === 'password_reset') {
            const email = String(params.email || '').trim();
            if (!email) throw new OAuthError('invalid_request', 'Enter your email address.');
            await firebasePasswordReset(email);
            res.type('html').send(signInPage({
                ...validated,
                state: params.state,
                email,
                message: 'If that email belongs to an AllPlays account, a password-reset link is on the way.'
            }));
            return;
        }

        // Email/password credentials are exchanged by the server. Google uses
        // the same Firebase browser SDK as the app, then posts a refresh
        // credential that is verified against Secure Token before storage.
        const signedIn = params.firebase_refresh_token
            ? await verifyFirebaseRefreshToken(params.firebase_refresh_token)
            : await firebaseSignIn(String(params.email || ''), String(params.password || ''));
        const firebaseRefreshToken = signedIn.refreshToken;
        const code = await oauth.approveAuthorization({
            clientId: validated.clientId,
            redirectUri: validated.redirectUri,
            codeChallenge: validated.codeChallenge,
            resource: validated.resource,
            scope: validated.scope,
            firebaseRefreshToken
        });
        const redirect = new URL(validated.redirectUri);
        redirect.searchParams.set('code', code);
        if (params.state) redirect.searchParams.set('state', params.state);
        redirect.searchParams.set('iss', publicBaseUrl(req));
        res.redirect(302, redirect.toString());
    } catch (error) {
        if (error instanceof OAuthError && error.code === 'access_denied') {
            res.status(401).type('html').send(signInPage({
                clientId: params.client_id,
                redirectUri: params.redirect_uri,
                codeChallenge: params.code_challenge,
                state: params.state,
                scope: params.scope,
                resource: params.resource,
                email: params.email,
                error: 'Sign-in failed. Check your email and password.'
            }));
            return;
        }
        const message = error instanceof OAuthError ? error.message : 'Authorization failed.';
        console.error('[chatgpt-mcp] authorize failure:', error);
        res.status(400).type('html').send(`<p>${escapeHtml(message)}</p>`);
    }
});

app.post('/oauth/token', async (req, res) => {
    try {
        res.json(await oauth.exchange(req.body || {}));
    } catch (error) {
        const code = error instanceof OAuthError ? error.code : 'server_error';
        if (!(error instanceof OAuthError)) console.error('[chatgpt-mcp] token failure:', error);
        res.status(error instanceof OAuthError ? 400 : 503).json({
            error: code,
            error_description: error instanceof OAuthError ? error.message : 'OAuth grant store unavailable.'
        });
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
        const brokerGrant = bearer ? await oauth.resolveAccessToken(bearer) : null;
        if (brokerGrant) {
            const expectedResource = metadataFor(publicBaseUrl(req)).protectedResource.resource;
            const grantedScopes = String(brokerGrant.scope || '').split(/\s+/);
            if (brokerGrant.resource !== expectedResource || !grantedScopes.includes(READ_SCOPE)) {
                throw new DomainError('unauthenticated', 'OAuth token is not valid for this AllPlays resource.');
            }
            authHeader = `Bearer ${brokerGrant.firebaseRefreshToken}`;
        }
        identity = await resolveIdentity(authHeader);
    } catch (error) {
        const message = error instanceof DomainError ? error.message : 'Unauthorized.';
        res.status(401)
            .set(
                'WWW-Authenticate',
                `Bearer resource_metadata="${publicBaseUrl(req)}/.well-known/oauth-protected-resource/mcp", scope="${READ_SCOPE}"`
            )
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    app.listen(PORT, () => {
        console.log(`[chatgpt-mcp] listening on :${PORT} (POST /mcp) — project ${PROJECT_ID}, user-credentialed Firestore access`);
    });
}
