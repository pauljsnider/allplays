// Bearer-token identity for the MCP service — no privileged credentials.
//
// The connector's bearer token is either:
//   - a Firebase *refresh token* (long-lived; exchanged here for a short-lived
//     ID token via the public securetoken endpoint and cached), or
//   - a raw Firebase *ID token* (JWT; useful for short manual tests).
//
// The resolved ID token is then presented to Firestore on every read, so
// security rules — not this module — are the enforcement point. A forged JWT
// yields identity claims here but fails every Firestore call. This mirrors the
// planned OAuth broker: token in, user-scoped credential out.

import { DomainError } from './core.js';

const TOKEN_ENDPOINT = 'https://securetoken.googleapis.com/v1/token';
const EXPIRY_MARGIN_MS = 60 * 1000;
// The public API key is referrer-restricted to the AllPlays site; API-key
// endpoints need this header. (Firestore REST uses the ID token, not the key.)
const DEFAULT_REFERER = 'https://allplays.ai/';

export function extractBearerToken(authorizationHeader) {
    if (typeof authorizationHeader !== 'string') return null;
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}

export function decodeJwtPayload(token) {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) return null;
    try {
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

export function createIdentityResolver({ apiKey, referer = DEFAULT_REFERER, fetchImpl = fetch, now = () => Date.now() }) {
    if (!apiKey) throw new Error('createIdentityResolver requires the Firebase web API key.');
    const cache = new Map();

    return async function resolveIdentity(authorizationHeader) {
        const token = extractBearerToken(authorizationHeader);
        if (!token) throw new DomainError('unauthenticated', 'Missing bearer token.');

        const jwtPayload = decodeJwtPayload(token);
        if (jwtPayload) {
            if (typeof jwtPayload.exp === 'number' && jwtPayload.exp * 1000 <= now()) {
                throw new DomainError('unauthenticated', 'ID token is expired. Use a refresh token as the bearer for long-lived access.');
            }
            return {
                uid: jwtPayload.user_id || jwtPayload.sub || '',
                email: jwtPayload.email || '',
                idToken: token,
                via: 'id-token'
            };
        }

        const cached = cache.get(token);
        if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > now()) return cached;

        const response = await fetchImpl(`${TOKEN_ENDPOINT}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token }).toString()
        });
        if (!response.ok) {
            throw new DomainError('unauthenticated', 'Invalid or revoked token.');
        }
        const body = await response.json();
        const idPayload = decodeJwtPayload(body.id_token) || {};
        const identity = {
            uid: body.user_id || idPayload.user_id || '',
            email: idPayload.email || '',
            idToken: body.id_token,
            expiresAt: now() + (Number(body.expires_in) || 3600) * 1000,
            via: 'refresh-token'
        };
        cache.set(token, identity);
        return identity;
    };
}
