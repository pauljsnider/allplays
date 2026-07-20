import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
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
    it('registers clients with the approved ChatGPT redirect uri', () => {
        const broker = createOAuthBroker();
        const client = broker.registerClient({ redirect_uris: [REDIRECT] });
        expect(client.client_id).toBeTruthy();
        expect(client.token_endpoint_auth_method).toBe('none');
    });

    it('rejects untrusted redirect uris regardless of scheme', () => {
        const broker = createOAuthBroker();
        expect(() => broker.registerClient({ redirect_uris: ['https://evil.example/cb'] })).toThrow(OAuthError);
        expect(() => broker.registerClient({ redirect_uris: ['http://localhost:3000/cb'] })).toThrow(OAuthError);
        expect(() => broker.registerClient({ redirect_uris: ['http://evil.example/cb'] })).toThrow(OAuthError);
        expect(() => broker.registerClient({})).toThrow(OAuthError);
    });

    it('rejects untrusted redirects and reuses one bounded client at the registration endpoint', async () => {
        const previousProjectId = process.env.FIREBASE_PROJECT_ID;
        const previousApiKey = process.env.FIREBASE_WEB_API_KEY;
        process.env.FIREBASE_PROJECT_ID = 'test-project';
        process.env.FIREBASE_WEB_API_KEY = 'test-api-key';
        const { app } = await import('../../services/chatgpt-mcp/src/server.js');
        const server = createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

        try {
            const { port } = server.address();
            const response = await fetch(`http://127.0.0.1:${port}/oauth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_name: 'Fake ChatGPT',
                    redirect_uris: ['https://attacker.example/oauth/callback']
                })
            });
            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' });

            const registrations = await Promise.all(Array.from({ length: 20 }, () => fetch(
                `http://127.0.0.1:${port}/oauth/register`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [REDIRECT] })
                }
            )));
            expect(registrations.every((registration) => registration.status === 201)).toBe(true);
            const clients = await Promise.all(registrations.map((registration) => registration.json()));
            expect(new Set(clients.map((client) => client.client_id))).toHaveLength(1);
        } finally {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
            if (previousProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
            else process.env.FIREBASE_PROJECT_ID = previousProjectId;
            if (previousApiKey === undefined) delete process.env.FIREBASE_WEB_API_KEY;
            else process.env.FIREBASE_WEB_API_KEY = previousApiKey;
        }
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
        expect(() => broker.validateAuthorizeRequest({ ...valid, client_id: 'nope' })).toThrow(/client_id/);
        expect(() => broker.validateAuthorizeRequest({ ...valid, redirect_uri: 'https://evil.example/cb' })).toThrow(/redirect_uri/);
        expect(() => broker.validateAuthorizeRequest({ ...valid, code_challenge_method: 'plain' })).toThrow(/S256/);
        expect(() => broker.validateAuthorizeRequest({ ...valid, code_challenge: '' })).toThrow(/code_challenge/);
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

describe('chatgpt-mcp oauth: metadata', () => {
    it('publishes endpoints under the given base url', () => {
        const meta = metadataFor('https://example.ngrok.dev');
        expect(meta.authorizationServer.authorization_endpoint).toBe('https://example.ngrok.dev/oauth/authorize');
        expect(meta.authorizationServer.code_challenge_methods_supported).toEqual(['S256']);
        expect(meta.protectedResource.resource).toBe('https://example.ngrok.dev/mcp');
        expect(meta.protectedResource.authorization_servers).toEqual(['https://example.ngrok.dev']);
    });
});
