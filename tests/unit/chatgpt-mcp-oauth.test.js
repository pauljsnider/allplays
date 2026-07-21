import { describe, it, expect } from 'vitest';
import {
    createOAuthBroker,
    metadataFor,
    s256Challenge,
    OAuthError
} from '../../services/chatgpt-mcp/src/oauth.js';

const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const VERIFIER = 'test-verifier-string-with-plenty-of-entropy-1234567890';

function registeredBroker(overrides = {}) {
    const broker = createOAuthBroker(overrides);
    const client = broker.registerClient({ redirect_uris: [REDIRECT], client_name: 'ChatGPT' });
    return { broker, clientId: client.client_id };
}

function authorize(broker, clientId, firebaseRefreshToken = 'firebase-rt-1') {
    return broker.approveAuthorization({
        clientId,
        redirectUri: REDIRECT,
        codeChallenge: s256Challenge(VERIFIER),
        firebaseRefreshToken
    });
}

describe('chatgpt-mcp oauth: registration', () => {
    it('registers clients with https redirect uris', () => {
        const broker = createOAuthBroker();
        const client = broker.registerClient({ redirect_uris: [REDIRECT] });
        expect(client.client_id).toBeTruthy();
        expect(client.token_endpoint_auth_method).toBe('none');
    });

    it('allows localhost and rejects other http redirect uris', () => {
        const broker = createOAuthBroker();
        expect(broker.registerClient({ redirect_uris: ['http://localhost:3000/cb'] }).client_id).toBeTruthy();
        expect(() => broker.registerClient({ redirect_uris: ['http://evil.example/cb'] })).toThrow(OAuthError);
        expect(() => broker.registerClient({})).toThrow(OAuthError);
    });
});

describe('chatgpt-mcp oauth: authorize validation', () => {
    it('rejects unknown clients, unregistered redirects, and non-S256 PKCE', () => {
        const { broker, clientId } = registeredBroker();
        const valid = {
            client_id: clientId,
            redirect_uri: REDIRECT,
            response_type: 'code',
            code_challenge: s256Challenge(VERIFIER),
            code_challenge_method: 'S256'
        };
        expect(broker.validateAuthorizeRequest(valid).clientId).toBe(clientId);
        expect(() => broker.validateAuthorizeRequest({ ...valid, redirect_uri: 'https://evil.example/cb' })).toThrow(/redirect_uri/);
        expect(() => broker.validateAuthorizeRequest({ ...valid, code_challenge_method: 'plain' })).toThrow(/S256/);
        expect(() => broker.validateAuthorizeRequest({ ...valid, code_challenge: '' })).toThrow(/code_challenge/);
    });
});

describe('chatgpt-mcp oauth: cached client survives store restart', () => {
    it('re-admits an unknown client_id with a valid redirect_uri (open registration equivalence)', () => {
        const broker = createOAuthBroker(); // fresh store, no registrations
        const result = broker.validateAuthorizeRequest({
            client_id: 'cached-by-chatgpt',
            redirect_uri: REDIRECT,
            response_type: 'code',
            code_challenge: s256Challenge(VERIFIER),
            code_challenge_method: 'S256'
        });
        expect(result.clientId).toBe('cached-by-chatgpt');
    });

    it('still rejects unknown clients with disallowed redirect uris', () => {
        const broker = createOAuthBroker();
        expect(() => broker.validateAuthorizeRequest({
            client_id: 'cached-by-chatgpt',
            redirect_uri: 'http://evil.example/cb',
            response_type: 'code',
            code_challenge: s256Challenge(VERIFIER),
            code_challenge_method: 'S256'
        })).toThrow(/client_id/);
    });
});

describe('chatgpt-mcp oauth: code exchange', () => {
    it('exchanges a code with the right PKCE verifier for tokens bound to the Firebase credential', () => {
        const { broker, clientId } = registeredBroker();
        const code = authorize(broker, clientId, 'firebase-rt-42');
        const tokens = broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER,
            client_id: clientId,
            redirect_uri: REDIRECT
        });
        expect(tokens.token_type).toBe('Bearer');
        expect(tokens.expires_in).toBeGreaterThan(0);
        expect(broker.resolveAccessToken(tokens.access_token)).toEqual({ firebaseRefreshToken: 'firebase-rt-42' });
    });

    it('rejects a wrong PKCE verifier and burns the code', () => {
        const { broker, clientId } = registeredBroker();
        const code = authorize(broker, clientId);
        expect(() => broker.exchange({ grant_type: 'authorization_code', code, code_verifier: 'wrong' })).toThrow(/PKCE/);
        // Code is single-use even after a failed attempt.
        expect(() => broker.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER })).toThrow(/invalid or expired/);
    });

    it('rejects reuse of a successfully exchanged code', () => {
        const { broker, clientId } = registeredBroker();
        const code = authorize(broker, clientId);
        broker.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER });
        expect(() => broker.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER })).toThrow(OAuthError);
    });

    it('rejects expired codes', () => {
        let time = 0;
        const { broker, clientId } = registeredBroker({ now: () => time });
        const code = authorize(broker, clientId);
        time = 11 * 60 * 1000;
        expect(() => broker.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER })).toThrow(/expired/);
    });

    it('rejects a mismatched client_id on exchange', () => {
        const { broker, clientId } = registeredBroker();
        const code = authorize(broker, clientId);
        expect(() => broker.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'other' })).toThrow(/client_id/);
    });
});

describe('chatgpt-mcp oauth: refresh and access tokens', () => {
    it('supports the refresh_token grant', () => {
        const { broker, clientId } = registeredBroker();
        const code = authorize(broker, clientId, 'firebase-rt-9');
        const first = broker.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER });
        const second = broker.exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
        expect(second.access_token).not.toBe(first.access_token);
        expect(broker.resolveAccessToken(second.access_token)).toEqual({ firebaseRefreshToken: 'firebase-rt-9' });
    });

    it('expires access tokens and returns null for unknown tokens', () => {
        let time = 0;
        const { broker, clientId } = registeredBroker({ now: () => time });
        const code = authorize(broker, clientId);
        const tokens = broker.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER });
        expect(broker.resolveAccessToken(tokens.access_token)).toBeTruthy();
        time = 2 * 60 * 60 * 1000;
        expect(broker.resolveAccessToken(tokens.access_token)).toBeNull();
        expect(broker.resolveAccessToken('unknown')).toBeNull();
    });

    it('rejects unsupported grant types', () => {
        const { broker } = registeredBroker();
        expect(() => broker.exchange({ grant_type: 'password' })).toThrow(/grant_type/);
    });
});

describe('chatgpt-mcp oauth: persistence across restart', () => {
    function memoryStore() {
        let state = null;
        return {
            load: () => state,
            save: (next) => { state = JSON.parse(JSON.stringify(next)); },
            peek: () => state
        };
    }

    it('persists clients and refresh grants but not codes or access tokens', () => {
        const store = memoryStore();
        const b1 = createOAuthBroker({ store });
        const client = b1.registerClient({ redirect_uris: [REDIRECT] });
        const code = b1.approveAuthorization({
            clientId: client.client_id,
            redirectUri: REDIRECT,
            codeChallenge: s256Challenge(VERIFIER),
            firebaseRefreshToken: 'firebase-rt-persist'
        });
        const tokens = b1.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER });

        // Only long-lived state is written.
        expect(Object.keys(store.peek().clients)).toContain(client.client_id);
        expect(Object.keys(store.peek().refreshTokens)).toContain(tokens.refresh_token);
        expect(store.peek()).not.toHaveProperty('codes');
        expect(store.peek()).not.toHaveProperty('accessTokens');

        // A fresh broker loading the same store honors the refresh grant and
        // still knows the client — the two things that broke on restart.
        const b2 = createOAuthBroker({ store });
        const refreshed = b2.exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
        expect(b2.resolveAccessToken(refreshed.access_token)).toEqual({ firebaseRefreshToken: 'firebase-rt-persist' });
        expect(b2.validateAuthorizeRequest({
            client_id: client.client_id,
            redirect_uri: REDIRECT,
            response_type: 'code',
            code_challenge: s256Challenge(VERIFIER),
            code_challenge_method: 'S256'
        }).clientId).toBe(client.client_id);
    });

    it('access tokens do NOT survive a restart (in-memory by design)', () => {
        const store = memoryStore();
        const b1 = createOAuthBroker({ store });
        const client = b1.registerClient({ redirect_uris: [REDIRECT] });
        const code = b1.approveAuthorization({
            clientId: client.client_id,
            redirectUri: REDIRECT,
            codeChallenge: s256Challenge(VERIFIER),
            firebaseRefreshToken: 'rt'
        });
        const tokens = b1.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER });
        const b2 = createOAuthBroker({ store });
        expect(b2.resolveAccessToken(tokens.access_token)).toBeNull();
    });
});

describe('chatgpt-mcp oauth: metadata', () => {
    it('publishes endpoints under the given base url', () => {
        const meta = metadataFor('https://example.ngrok.dev');
        expect(meta.authorizationServer.authorization_endpoint).toBe('https://example.ngrok.dev/oauth/authorize');
        expect(meta.authorizationServer.code_challenge_methods_supported).toEqual(['S256']);
        expect(meta.protectedResource.resource).toBe('https://example.ngrok.dev/mcp');
        expect(meta.protectedResource.authorization_servers).toEqual(['https://example.ngrok.dev']);
    });
});
