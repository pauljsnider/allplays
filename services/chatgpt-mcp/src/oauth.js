// Minimal OAuth 2.1 broker for the ChatGPT MCP connector.
//
// Implements the slice of OAuth that ChatGPT Developer Mode requires:
// dynamic client registration, authorization code + PKCE (S256 only), and a
// token endpoint. Each authorization ends by binding the signed-in user's
// Firebase refresh token to broker-issued opaque tokens; MCP requests then
// resolve broker token → Firebase credential → rules-enforced Firestore
// access, unchanged from the direct-bearer path.
//
// Authorization codes and issued grants use an injected store so production
// instances share one durable, atomic lifecycle boundary.

import { createHash, randomBytes } from 'node:crypto';
import { createMemoryOAuthGrantStore } from './oauthStore.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_STORED_GRANTS = 1000;
const DEFAULT_TRUSTED_CLIENT_ID = 'allplays-chatgpt-connector';
const LEGACY_CHATGPT_REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';
const CHATGPT_REDIRECT_PATH = /^\/connector\/oauth\/[A-Za-z0-9._~-]{1,256}$/;
const REDIRECT_CLIENT_ID_DIGEST = /^[A-Za-z0-9_-]{43}$/;

export class OAuthError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'OAuthError';
        this.code = code; // OAuth error codes: invalid_request, invalid_grant, invalid_client
    }
}

export function s256Challenge(verifier) {
    return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

function isAllowedRedirectUri(uri) {
    if (typeof uri !== 'string') return false;
    if (uri === LEGACY_CHATGPT_REDIRECT_URI) return true;
    try {
        const parsed = new URL(uri);
        return parsed.protocol === 'https:'
            && parsed.hostname === 'chatgpt.com'
            && parsed.port === ''
            && parsed.username === ''
            && parsed.password === ''
            && parsed.search === ''
            && parsed.hash === ''
            && CHATGPT_REDIRECT_PATH.test(parsed.pathname);
    } catch {
        return false;
    }
}

function clientIdForRedirectUri(trustedClientId, redirectUri) {
    if (redirectUri === LEGACY_CHATGPT_REDIRECT_URI) return trustedClientId;
    const redirectDigest = createHash('sha256')
        .update(`allplays-chatgpt-redirect\0${redirectUri}`, 'utf8')
        .digest('base64url');
    return `${trustedClientId}.${redirectDigest}`;
}

function hasKnownClientIdShape(trustedClientId, clientId) {
    if (clientId === trustedClientId) return true;
    if (typeof clientId !== 'string' || !clientId.startsWith(`${trustedClientId}.`)) return false;
    return REDIRECT_CLIENT_ID_DIGEST.test(clientId.slice(trustedClientId.length + 1));
}

export function createOAuthBroker({
    now = () => Date.now(),
    randomId = (bytes = 32) => randomBytes(bytes).toString('base64url'),
    maxStoredGrants = MAX_STORED_GRANTS,
    trustedClientId = DEFAULT_TRUSTED_CLIENT_ID,
    grantStore = createMemoryOAuthGrantStore({ now, maxStoredGrants })
} = {}) {
    if (!Number.isInteger(maxStoredGrants) || maxStoredGrants < 1) {
        throw new Error('maxStoredGrants must be a positive integer.');
    }
    if (typeof trustedClientId !== 'string' || !trustedClientId.trim()) {
        throw new Error('trustedClientId must be a non-empty string.');
    }
    if (
        !grantStore
        || typeof grantStore.issueAuthorizationCode !== 'function'
        || typeof grantStore.consumeAuthorizationCode !== 'function'
        || typeof grantStore.issueGrantPair !== 'function'
        || typeof grantStore.resolveAccessToken !== 'function'
        || typeof grantStore.rotateRefreshToken !== 'function'
    ) {
        throw new Error('grantStore must implement the OAuth grant store contract.');
    }
    const configuredClientId = trustedClientId.trim();
    function registerClient({ redirect_uris: redirectUris } = {}) {
        if (!Array.isArray(redirectUris) || redirectUris.length !== 1) {
            throw new OAuthError('invalid_request', 'Exactly one redirect_uri is required.');
        }
        const [redirectUri] = redirectUris;
        if (!isAllowedRedirectUri(redirectUri)) {
            throw new OAuthError('invalid_request', 'redirect_uris must use an approved ChatGPT callback.');
        }
        // Bind each current ChatGPT callback to a stable, stateless client ID.
        // This remains deterministic across Cloud Run instances without letting
        // one connector reuse another connector's redirect URI. Published apps
        // keep the configured client ID through the legacy callback.
        return {
            client_id: clientIdForRedirectUri(configuredClientId, redirectUri),
            redirect_uris: [redirectUri],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code']
        };
    }

    function validateAuthorizeRequest({ client_id: clientId, redirect_uri: redirectUri, response_type: responseType, code_challenge: codeChallenge, code_challenge_method: method }) {
        if (!hasKnownClientIdShape(configuredClientId, clientId)) {
            throw new OAuthError('invalid_client', 'Unknown client_id.');
        }
        if (
            !isAllowedRedirectUri(redirectUri)
            || clientId !== clientIdForRedirectUri(configuredClientId, redirectUri)
        ) {
            throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client.');
        }
        if (responseType !== 'code') throw new OAuthError('invalid_request', 'Only response_type=code is supported.');
        if (!codeChallenge) throw new OAuthError('invalid_request', 'code_challenge is required (PKCE).');
        if (method !== 'S256') throw new OAuthError('invalid_request', 'Only code_challenge_method=S256 is supported.');
        return { clientId, redirectUri, codeChallenge };
    }

    async function approveAuthorization({ clientId, redirectUri, codeChallenge, firebaseRefreshToken }) {
        if (!firebaseRefreshToken) throw new OAuthError('invalid_request', 'Sign-in did not produce a credential.');
        // Re-validate so a tampered approval form cannot bypass the checks.
        validateAuthorizeRequest({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        });
        const code = randomId(32);
        await grantStore.issueAuthorizationCode({
            code,
            clientId,
            redirectUri,
            codeChallenge,
            firebaseRefreshToken,
            expiresAt: now() + CODE_TTL_MS
        });
        return code;
    }

    function tokenResponse(accessToken, refreshToken) {
        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
            refresh_token: refreshToken
        };
    }

    async function issueTokens(firebaseRefreshToken, clientId) {
        const accessToken = randomId(32);
        const refreshToken = randomId(32);
        const issuedAt = now();
        await grantStore.issueGrantPair({
            accessToken,
            refreshToken,
            firebaseRefreshToken,
            clientId,
            accessExpiresAt: issuedAt + ACCESS_TOKEN_TTL_MS,
            refreshExpiresAt: issuedAt + REFRESH_TOKEN_TTL_MS
        });
        return tokenResponse(accessToken, refreshToken);
    }

    async function exchange(params = {}) {
        const grantType = params.grant_type;
        if (grantType === 'authorization_code') {
            const record = await grantStore.consumeAuthorizationCode(params.code);
            if (!record || record.expiresAt <= now()) {
                throw new OAuthError('invalid_grant', 'Authorization code is invalid or expired.');
            }
            if (params.client_id && params.client_id !== record.clientId) {
                throw new OAuthError('invalid_grant', 'client_id does not match the authorization.');
            }
            if (params.redirect_uri && params.redirect_uri !== record.redirectUri) {
                throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization.');
            }
            if (!params.code_verifier || s256Challenge(params.code_verifier) !== record.codeChallenge) {
                throw new OAuthError('invalid_grant', 'PKCE verification failed.');
            }
            return issueTokens(record.firebaseRefreshToken, record.clientId);
        }
        if (grantType === 'refresh_token') {
            const accessToken = randomId(32);
            const refreshToken = randomId(32);
            const issuedAt = now();
            const rotated = await grantStore.rotateRefreshToken({
                refreshToken: params.refresh_token,
                newAccessToken: accessToken,
                newRefreshToken: refreshToken,
                accessExpiresAt: issuedAt + ACCESS_TOKEN_TTL_MS,
                refreshExpiresAt: issuedAt + REFRESH_TOKEN_TTL_MS
            });
            if (!rotated) throw new OAuthError('invalid_grant', 'Unknown refresh token.');
            return tokenResponse(accessToken, refreshToken);
        }
        throw new OAuthError('invalid_request', 'Unsupported grant_type.');
    }

    async function resolveAccessToken(token) {
        return grantStore.resolveAccessToken(token);
    }

    return { registerClient, validateAuthorizeRequest, approveAuthorization, exchange, resolveAccessToken };
}

export function metadataFor(baseUrl) {
    return {
        authorizationServer: {
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/oauth/authorize`,
            token_endpoint: `${baseUrl}/oauth/token`,
            registration_endpoint: `${baseUrl}/oauth/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
            scopes_supported: ['allplays.read']
        },
        protectedResource: {
            resource: `${baseUrl}/mcp`,
            authorization_servers: [baseUrl],
            bearer_methods_supported: ['header'],
            scopes_supported: ['allplays.read']
        }
    };
}
