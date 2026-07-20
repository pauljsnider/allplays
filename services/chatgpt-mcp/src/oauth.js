// Minimal OAuth 2.1 broker for the ChatGPT MCP connector.
//
// Implements the slice of OAuth that ChatGPT Developer Mode requires:
// dynamic client registration, authorization code + PKCE (S256 only), and a
// token endpoint. Each authorization ends by binding the signed-in user's
// Firebase refresh token to broker-issued opaque tokens; MCP requests then
// resolve broker token → Firebase credential → rules-enforced Firestore
// access, unchanged from the direct-bearer path.
//
// Storage is in-memory: fine for a single-instance dev deployment, replaced
// by Firestore-backed storage before multi-instance Cloud Run (see spec).

import { createHash, randomBytes } from 'node:crypto';

const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const TRUSTED_REDIRECT_URIS = new Set([
    'https://chatgpt.com/connector_platform_oauth_redirect'
]);

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
    return typeof uri === 'string' && TRUSTED_REDIRECT_URIS.has(uri);
}

export function createOAuthBroker({ now = () => Date.now(), randomId = (bytes = 32) => randomBytes(bytes).toString('base64url') } = {}) {
    let registeredClient = null;
    const codes = new Map();
    const accessTokens = new Map();
    const refreshTokens = new Map();

    function registerClient({ redirect_uris: redirectUris, client_name: clientName } = {}) {
        if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
            throw new OAuthError('invalid_request', 'redirect_uris is required.');
        }
        if (!redirectUris.every(isAllowedRedirectUri)) {
            throw new OAuthError('invalid_request', 'redirect_uris must use an approved ChatGPT callback.');
        }
        // This broker only serves one trusted public client. Reusing its ID keeps
        // unauthenticated dynamic registration from growing server memory.
        if (!registeredClient) {
            registeredClient = {
                clientId: randomId(16),
                redirectUris: [...new Set(redirectUris)],
                clientName: typeof clientName === 'string' ? clientName : ''
            };
        }
        return {
            client_id: registeredClient.clientId,
            redirect_uris: registeredClient.redirectUris,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code']
        };
    }

    function validateAuthorizeRequest({ client_id: clientId, redirect_uri: redirectUri, response_type: responseType, code_challenge: codeChallenge, code_challenge_method: method }) {
        if (!registeredClient || clientId !== registeredClient.clientId) {
            throw new OAuthError('invalid_client', 'Unknown client_id.');
        }
        if (!registeredClient.redirectUris.includes(redirectUri)) {
            throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client.');
        }
        if (responseType !== 'code') throw new OAuthError('invalid_request', 'Only response_type=code is supported.');
        if (!codeChallenge) throw new OAuthError('invalid_request', 'code_challenge is required (PKCE).');
        if (method !== 'S256') throw new OAuthError('invalid_request', 'Only code_challenge_method=S256 is supported.');
        return { clientId, redirectUri, codeChallenge };
    }

    function approveAuthorization({ clientId, redirectUri, codeChallenge, firebaseRefreshToken }) {
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
        codes.set(code, { clientId, redirectUri, codeChallenge, firebaseRefreshToken, expiresAt: now() + CODE_TTL_MS });
        return code;
    }

    function issueTokens(firebaseRefreshToken, clientId) {
        const accessToken = randomId(32);
        const refreshToken = randomId(32);
        accessTokens.set(accessToken, { firebaseRefreshToken, expiresAt: now() + ACCESS_TOKEN_TTL_MS });
        refreshTokens.set(refreshToken, { firebaseRefreshToken, clientId });
        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
            refresh_token: refreshToken
        };
    }

    function exchange(params = {}) {
        const grantType = params.grant_type;
        if (grantType === 'authorization_code') {
            const record = codes.get(params.code);
            codes.delete(params.code); // single-use, success or not
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
            const record = refreshTokens.get(params.refresh_token);
            if (!record) throw new OAuthError('invalid_grant', 'Unknown refresh token.');
            return issueTokens(record.firebaseRefreshToken, record.clientId);
        }
        throw new OAuthError('invalid_request', 'Unsupported grant_type.');
    }

    function resolveAccessToken(token) {
        const record = accessTokens.get(token);
        if (!record) return null;
        if (record.expiresAt <= now()) {
            accessTokens.delete(token);
            return null;
        }
        return { firebaseRefreshToken: record.firebaseRefreshToken };
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
