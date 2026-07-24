import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
    createOAuthBroker,
    metadataFor,
    s256Challenge,
    OAuthError
} from '../../services/chatgpt-mcp/src/oauth.js';
import {
    createFirestoreOAuthGrantStore,
    createMemoryOAuthGrantStore
} from '../../services/chatgpt-mcp/src/oauthStore.js';

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

    it('uses one configured client registration across broker instances', () => {
        const options = { trustedClientId: 'configured-chatgpt-client' };
        const firstBroker = createOAuthBroker({
            ...options,
            randomId: () => 'instance-one-random-id'
        });
        const secondBroker = createOAuthBroker({
            ...options,
            randomId: () => 'instance-two-random-id'
        });

        const firstRegistration = firstBroker.registerClient({ redirect_uris: [REDIRECT] });
        const secondRegistration = secondBroker.registerClient({ redirect_uris: [REDIRECT] });

        expect(firstRegistration.client_id).toBe('configured-chatgpt-client');
        expect(secondRegistration.client_id).toBe(firstRegistration.client_id);

        const freshBroker = createOAuthBroker(options);
        expect(freshBroker.validateAuthorizeRequest({
            client_id: firstRegistration.client_id,
            redirect_uri: REDIRECT,
            response_type: 'code',
            code_challenge: s256Challenge(VERIFIER),
            code_challenge_method: 'S256'
        })).toMatchObject({
            clientId: 'configured-chatgpt-client',
            redirectUri: REDIRECT
        });
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

    it('does not accept an unverified refresh token at the authorization endpoint', async () => {
        const previousProjectId = process.env.FIREBASE_PROJECT_ID;
        const previousApiKey = process.env.FIREBASE_WEB_API_KEY;
        const realFetch = globalThis.fetch;
        process.env.FIREBASE_PROJECT_ID = 'test-project';
        process.env.FIREBASE_WEB_API_KEY = 'test-api-key';
        const { app } = await import('../../services/chatgpt-mcp/src/server.js');
        const server = createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

        try {
            const { port } = server.address();
            const registration = await realFetch(`http://127.0.0.1:${port}/oauth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [REDIRECT] })
            });
            const client = await registration.json();
            let signInCalls = 0;
            globalThis.fetch = async (url, options) => {
                if (String(url).startsWith('https://identitytoolkit.googleapis.com/')) {
                    signInCalls += 1;
                    return { ok: false, json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) };
                }
                return realFetch(url, options);
            };

            const response = await realFetch(`http://127.0.0.1:${port}/oauth/authorize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: client.client_id,
                    redirect_uri: REDIRECT,
                    code_challenge: s256Challenge(VERIFIER),
                    refresh_token: 'attacker-controlled-unverified-token'
                })
            });

            expect(response.status).toBe(401);
            expect(signInCalls).toBe(1);
            expect(response.headers.get('location')).toBeNull();
        } finally {
            globalThis.fetch = realFetch;
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
    it('exchanges a code with the right PKCE verifier for tokens bound to the Firebase credential', async () => {
        const { broker, clientId } = registeredBroker();
        const code = authorize(broker, clientId, 'firebase-rt-42');
        const tokens = await broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER,
            client_id: clientId,
            redirect_uri: REDIRECT
        });
        expect(tokens.token_type).toBe('Bearer');
        expect(tokens.expires_in).toBeGreaterThan(0);
        await expect(broker.resolveAccessToken(tokens.access_token)).resolves.toEqual({
            firebaseRefreshToken: 'firebase-rt-42'
        });
    });

    it('rejects a wrong PKCE verifier and burns the code', async () => {
        const { broker, clientId } = registeredBroker();
        const code = authorize(broker, clientId);
        await expect(broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: 'wrong'
        })).rejects.toThrow(/PKCE/);
        // Code is single-use even after a failed attempt.
        await expect(broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER
        })).rejects.toThrow(/invalid or expired/);
    });

    it('rejects reuse of a successfully exchanged code', async () => {
        const { broker, clientId } = registeredBroker();
        const code = authorize(broker, clientId);
        await broker.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER });
        await expect(broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER
        })).rejects.toThrow(OAuthError);
    });

    it('rejects expired codes', async () => {
        let time = 0;
        const { broker, clientId } = registeredBroker({ now: () => time });
        const code = authorize(broker, clientId);
        time = 11 * 60 * 1000;
        await expect(broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER
        })).rejects.toThrow(/expired/);
    });

    it('rejects a mismatched client_id on exchange', async () => {
        const { broker, clientId } = registeredBroker();
        const code = authorize(broker, clientId);
        await expect(broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER,
            client_id: 'other'
        })).rejects.toThrow(/client_id/);
    });
});

describe('chatgpt-mcp oauth: refresh and access tokens', () => {
    it('supports the refresh_token grant', async () => {
        const { broker, clientId } = registeredBroker();
        const code = authorize(broker, clientId, 'firebase-rt-9');
        const first = await broker.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER });
        const second = await broker.exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
        expect(second.access_token).not.toBe(first.access_token);
        await expect(broker.resolveAccessToken(second.access_token)).resolves.toEqual({
            firebaseRefreshToken: 'firebase-rt-9'
        });
        await expect(broker.exchange({
            grant_type: 'refresh_token',
            refresh_token: first.refresh_token
        })).rejects.toThrow(/Unknown/);
    });

    it('expires refresh tokens and bounds retained access grants', async () => {
        let time = 0;
        const { broker, clientId } = registeredBroker({ now: () => time, maxStoredGrants: 2 });
        const issued = [];
        for (let index = 0; index < 3; index += 1) {
            const code = authorize(broker, clientId, `firebase-rt-${index}`);
            issued.push(await broker.exchange({
                grant_type: 'authorization_code',
                code,
                code_verifier: VERIFIER
            }));
        }

        await expect(broker.resolveAccessToken(issued[0].access_token)).resolves.toBeNull();
        await expect(broker.resolveAccessToken(issued[2].access_token)).resolves.toBeTruthy();
        time = 31 * 24 * 60 * 60 * 1000;
        await expect(broker.exchange({
            grant_type: 'refresh_token',
            refresh_token: issued[2].refresh_token
        })).rejects.toThrow(/Unknown/);
    });

    it('expires access tokens and returns null for unknown tokens', async () => {
        let time = 0;
        const { broker, clientId } = registeredBroker({ now: () => time });
        const code = authorize(broker, clientId);
        const tokens = await broker.exchange({ grant_type: 'authorization_code', code, code_verifier: VERIFIER });
        await expect(broker.resolveAccessToken(tokens.access_token)).resolves.toBeTruthy();
        time = 2 * 60 * 60 * 1000;
        await expect(broker.resolveAccessToken(tokens.access_token)).resolves.toBeNull();
        await expect(broker.resolveAccessToken('unknown')).resolves.toBeNull();
    });

    it('rejects unsupported grant types', async () => {
        const { broker } = registeredBroker();
        await expect(broker.exchange({ grant_type: 'password' })).rejects.toThrow(/grant_type/);
    });

    it('resolves an access grant through another broker instance', async () => {
        const state = {};
        const first = registeredBroker({
            grantStore: createMemoryOAuthGrantStore({ state })
        });
        const second = registeredBroker({
            grantStore: createMemoryOAuthGrantStore({ state })
        });
        const code = authorize(first.broker, first.clientId, 'firebase-cross-instance');
        const tokens = await first.broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER
        });

        await expect(second.broker.resolveAccessToken(tokens.access_token)).resolves.toEqual({
            firebaseRefreshToken: 'firebase-cross-instance'
        });
    });

    it('exchanges a pre-restart refresh grant through a recreated broker', async () => {
        const state = {};
        const beforeRestart = registeredBroker({
            grantStore: createMemoryOAuthGrantStore({ state })
        });
        const code = authorize(beforeRestart.broker, beforeRestart.clientId, 'firebase-after-restart');
        const first = await beforeRestart.broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER
        });
        const afterRestart = registeredBroker({
            grantStore: createMemoryOAuthGrantStore({ state })
        });

        const rotated = await afterRestart.broker.exchange({
            grant_type: 'refresh_token',
            refresh_token: first.refresh_token
        });
        await expect(afterRestart.broker.resolveAccessToken(rotated.access_token)).resolves.toEqual({
            firebaseRefreshToken: 'firebase-after-restart'
        });
    });

    it('allows exactly one concurrent refresh rotation across brokers', async () => {
        const state = {};
        const firstBroker = registeredBroker({
            grantStore: createMemoryOAuthGrantStore({ state })
        });
        const secondBroker = registeredBroker({
            grantStore: createMemoryOAuthGrantStore({ state })
        });
        const code = authorize(firstBroker.broker, firstBroker.clientId, 'firebase-atomic');
        const first = await firstBroker.broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER
        });

        const attempts = await Promise.allSettled([
            firstBroker.broker.exchange({
                grant_type: 'refresh_token',
                refresh_token: first.refresh_token
            }),
            secondBroker.broker.exchange({
                grant_type: 'refresh_token',
                refresh_token: first.refresh_token
            })
        ]);

        expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
        expect(attempts.find(({ status }) => status === 'rejected').reason).toMatchObject({
            code: 'invalid_grant'
        });
        await expect(firstBroker.broker.exchange({
            grant_type: 'refresh_token',
            refresh_token: first.refresh_token
        })).rejects.toThrow(/Unknown/);
    });

    it('removes expired durable records while preserving unexpired grants', async () => {
        let time = 0;
        const state = {};
        const { broker, clientId } = registeredBroker({
            now: () => time,
            grantStore: createMemoryOAuthGrantStore({ state, now: () => time })
        });
        const code = authorize(broker, clientId, 'firebase-expiring');
        const tokens = await broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER
        });

        expect(state.accessTokens.size).toBe(1);
        expect(state.refreshTokens.size).toBe(1);
        time = 2 * 60 * 60 * 1000;
        await expect(broker.resolveAccessToken(tokens.access_token)).resolves.toBeNull();
        expect(state.accessTokens.size).toBe(0);
        expect(state.refreshTokens.size).toBe(1);
    });
});

describe('chatgpt-mcp oauth: Firestore grant store', () => {
    it('encrypts Firebase bindings and uses one conditional commit for refresh rotation', async () => {
        const requests = [];
        const documents = new Map();
        let updateCounter = 0;
        let time = 0;
        const fetchImpl = async (url, options = {}) => {
            const resourceName = String(url)
                .split('?')[0]
                .replace('https://firestore.googleapis.com/v1/', '');
            const request = {
                url: String(url),
                method: options.method || 'GET',
                body: options.body ? JSON.parse(options.body) : null
            };
            requests.push(request);

            if (request.url.endsWith('/documents:commit')) {
                for (const write of request.body.writes) {
                    if (write.delete) {
                        const current = documents.get(write.delete);
                        if (!current || current.updateTime !== write.currentDocument?.updateTime) {
                            return {
                                ok: false,
                                status: 409,
                                json: async () => ({ error: { status: 'ABORTED' } })
                            };
                        }
                        documents.delete(write.delete);
                    } else {
                        const name = write.update.name;
                        if (write.currentDocument?.exists === false && documents.has(name)) {
                            return {
                                ok: false,
                                status: 409,
                                json: async () => ({ error: { status: 'ALREADY_EXISTS' } })
                            };
                        }
                        updateCounter += 1;
                        documents.set(name, {
                            ...write.update,
                            updateTime: `2026-07-23T00:00:0${updateCounter}Z`
                        });
                    }
                }
                return { ok: true, json: async () => ({ writeResults: [] }) };
            }

            if (request.method === 'DELETE') {
                documents.delete(resourceName);
                return { ok: true, json: async () => ({}) };
            }

            const document = documents.get(resourceName);
            if (!document) return { ok: false, status: 404, json: async () => ({}) };
            return { ok: true, json: async () => document };
        };
        const store = createFirestoreOAuthGrantStore({
            projectId: 'oauth-project',
            encryptionKey: Buffer.alloc(32, 7).toString('base64'),
            accessTokenProvider: async () => 'service-access-token',
            fetchImpl,
            now: () => time
        });
        const { broker, clientId } = registeredBroker({ grantStore: store, now: () => time });
        const { broker: secondBroker } = registeredBroker({ grantStore: store, now: () => time });
        const code = authorize(broker, clientId, 'firebase-secret-binding');
        const first = await broker.exchange({
            grant_type: 'authorization_code',
            code,
            code_verifier: VERIFIER
        });

        const persisted = JSON.stringify([...documents.values()]);
        expect(persisted).not.toContain('firebase-secret-binding');
        expect(persisted).not.toContain(first.access_token);
        expect(persisted).not.toContain(first.refresh_token);
        await expect(broker.resolveAccessToken(first.access_token)).resolves.toEqual({
            firebaseRefreshToken: 'firebase-secret-binding'
        });

        const rotations = await Promise.allSettled([
            broker.exchange({
                grant_type: 'refresh_token',
                refresh_token: first.refresh_token
            }),
            secondBroker.exchange({
                grant_type: 'refresh_token',
                refresh_token: first.refresh_token
            })
        ]);
        expect(rotations.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        expect(rotations.filter(({ status }) => status === 'rejected')).toHaveLength(1);
        const second = rotations.find(({ status }) => status === 'fulfilled').value;
        expect(second.refresh_token).not.toBe(first.refresh_token);
        const rotationCommit = requests
            .filter(({ url }) => url.endsWith('/documents:commit'))
            .at(-1).body;
        expect(rotationCommit.writes).toHaveLength(3);
        expect(rotationCommit.writes[0]).toMatchObject({
            delete: expect.stringContaining('/refresh_'),
            currentDocument: { updateTime: expect.any(String) }
        });
        expect(rotationCommit.writes.slice(1).every((write) => (
            write.currentDocument?.exists === false
        ))).toBe(true);
        await expect(broker.resolveAccessToken(second.access_token)).resolves.toEqual({
            firebaseRefreshToken: 'firebase-secret-binding'
        });

        for (const document of documents.values()) {
            if (document.fields.type.stringValue === 'refresh') {
                document.fields.encryptedBinding.mapValue.fields.tag.stringValue = Buffer.alloc(16, 9).toString('base64');
            }
        }
        await expect(broker.exchange({
            grant_type: 'refresh_token',
            refresh_token: second.refresh_token
        })).rejects.toMatchObject({ code: 'invalid_grant' });

        const expiringCode = authorize(broker, clientId, 'firebase-expiring-binding');
        const expiring = await broker.exchange({
            grant_type: 'authorization_code',
            code: expiringCode,
            code_verifier: VERIFIER
        });
        time = 2 * 60 * 60 * 1000;
        await expect(broker.resolveAccessToken(expiring.access_token)).resolves.toBeNull();
        expect(requests.some(({ method, url }) => (
            method === 'DELETE' && url.includes('/access_')
        ))).toBe(true);

        time = 0;
        for (const document of documents.values()) {
            if (document.fields.type.stringValue === 'access') {
                document.fields.encryptedBinding.mapValue.fields.tag.stringValue = Buffer.alloc(16, 9).toString('base64');
            }
        }
        await expect(broker.resolveAccessToken(second.access_token)).rejects.toThrow();
    });

    it('fails closed when credential-protection configuration is invalid', () => {
        const validKey = Buffer.alloc(32).toString('base64');
        expect(() => createFirestoreOAuthGrantStore({
            projectId: 'oauth-project',
            encryptionKey: Buffer.alloc(16).toString('base64'),
            accessTokenProvider: async () => 'service-access-token'
        })).toThrow(/32-byte/);
        expect(() => createFirestoreOAuthGrantStore({
            projectId: 'oauth-project',
            encryptionKey: `${validKey}=`,
            accessTokenProvider: async () => 'service-access-token'
        })).toThrow(/32-byte/);
        const storeSource = readFileSync(
            new URL('../../services/chatgpt-mcp/src/oauthStore.js', import.meta.url),
            'utf8'
        );
        expect(storeSource).toContain('encoded.length !== 44');
    });
});

describe('chatgpt-mcp oauth: durable deployment configuration', () => {
    it('fails production closed and documents store, TTL, IAM, encryption, and rollback', () => {
        const serverModuleUrl = new URL(
            '../../services/chatgpt-mcp/src/server.js',
            import.meta.url
        ).href;
        const productionEnv = {
            ...process.env,
            NODE_ENV: 'production',
            FIREBASE_PROJECT_ID: 'application-project',
            FIREBASE_WEB_API_KEY: 'test-api-key',
            OAUTH_GRANT_STORE: 'firestore',
            OAUTH_GRANT_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64')
        };
        delete productionEnv.K_SERVICE;
        delete productionEnv.OAUTH_GRANT_STORE_PROJECT_ID;
        delete productionEnv.OAUTH_GRANT_STORE_DATABASE_ID;
        const importServer = (env) => spawnSync(
            process.execPath,
            ['--input-type=module', '--eval', `import(${JSON.stringify(serverModuleUrl)})`],
            { encoding: 'utf8', env }
        );

        const implicitApplicationStore = importServer(productionEnv);
        expect(implicitApplicationStore.status).not.toBe(0);
        expect(implicitApplicationStore.stderr).toContain(
            'require explicit OAUTH_GRANT_STORE_PROJECT_ID and OAUTH_GRANT_STORE_DATABASE_ID'
        );

        const explicitApplicationStore = importServer({
            ...productionEnv,
            OAUTH_GRANT_STORE_PROJECT_ID: 'application-project',
            OAUTH_GRANT_STORE_DATABASE_ID: '(default)'
        });
        expect(explicitApplicationStore.status).not.toBe(0);
        expect(explicitApplicationStore.stderr).toContain(
            'must use an isolated project or a non-default Firestore database'
        );

        const isolatedStore = importServer({
            ...productionEnv,
            OAUTH_GRANT_STORE_PROJECT_ID: 'oauth-grant-project',
            OAUTH_GRANT_STORE_DATABASE_ID: '(default)'
        });
        expect(isolatedStore.status).toBe(0);

        const serverSource = readFileSync(
            new URL('../../services/chatgpt-mcp/src/server.js', import.meta.url),
            'utf8'
        );
        const readme = readFileSync(
            new URL('../../services/chatgpt-mcp/README.md', import.meta.url),
            'utf8'
        );

        expect(serverSource).toContain(
            "const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);"
        );
        expect(serverSource).toContain('Production and Cloud Run require OAUTH_GRANT_STORE=firestore.');
        expect(serverSource).toContain('process.env.OAUTH_GRANT_ENCRYPTION_KEY');
        expect(readme).toContain('roles/datastore.user');
        expect(readme).toContain('resource.name==');
        expect(readme).toContain('roles/secretmanager.secretAccessor');
        expect(readme).toContain('gcloud firestore fields ttls update expiresAt');
        expect(readme).toContain('--collection-group="$OAUTH_GRANT_STORE_COLLECTION"');
        expect(readme).toContain('--enable-ttl');
        expect(readme).toContain('--database="$OAUTH_GRANT_STORE_DATABASE_ID"');
        expect(readme).toContain('OAUTH_GRANT_KEY_VERSION=1');
        expect(readme).toContain(
            'projects/$OAUTH_GRANT_STORE_PROJECT_ID/secrets/chatgpt-mcp-oauth-grant-key:$OAUTH_GRANT_KEY_VERSION'
        );
        expect(readme).not.toContain('chatgpt-mcp-oauth-grant-key:latest');
        expect(readme).toContain('Key rotation and rollback');
        expect(readme).toContain('Never');
        expect(readme).toContain('OAUTH_GRANT_STORE=memory');
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
