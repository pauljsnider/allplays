import { describe, it, expect } from 'vitest';
import { createFirestoreStore } from '../../services/chatgpt-mcp/src/firestoreStore.js';
import { createOAuthBroker, s256Challenge } from '../../services/chatgpt-mcp/src/oauth.js';

// A tiny fake Firestore-over-REST backend: one document, PATCH writes it,
// GET reads it (404 before first write).
function fakeFirestore() {
    let doc = null; // Firestore REST { fields: {...} } shape
    const calls = { reads: 0, writes: 0 };
    const fetchImpl = async (url, options = {}) => {
        const method = options.method || 'GET';
        if (method === 'GET') {
            calls.reads += 1;
            if (!doc) return { ok: false, status: 404, json: async () => ({}) };
            return { ok: true, status: 200, json: async () => doc };
        }
        if (method === 'PATCH') {
            calls.writes += 1;
            doc = JSON.parse(options.body);
            return { ok: true, status: 200, json: async () => doc };
        }
        throw new Error(`unexpected method ${method}`);
    };
    return { fetchImpl, calls, current: () => doc };
}

function storeFor(backend) {
    return createFirestoreStore({
        projectId: 'game-flow-c6311',
        getToken: async () => 'fake-sa-token',
        fetchImpl: backend.fetchImpl
    });
}

describe('chatgpt-mcp firestore store', () => {
    it('warms up empty when the document does not exist yet', async () => {
        const backend = fakeFirestore();
        const store = storeFor(backend);
        const state = await store.warmup();
        expect(state).toEqual({ clients: {}, refreshTokens: {} });
        expect(store.load()).toEqual({ clients: {}, refreshTokens: {} });
    });

    it('round-trips broker state through Firestore encode/decode', async () => {
        const backend = fakeFirestore();
        const writer = storeFor(backend);
        await writer.warmup();
        const state = {
            clients: { 'client-1': { redirectUris: ['https://chatgpt.com/cb'], clientName: 'ChatGPT' } },
            refreshTokens: { 'brt-1': { firebaseRefreshToken: 'firebase-rt-xyz', clientId: 'client-1' } }
        };
        writer.save(state);
        // Let the fire-and-forget write settle.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(backend.calls.writes).toBe(1);

        // A fresh store instance reading the same backend recovers the state.
        const reader = storeFor(backend);
        const recovered = await reader.warmup();
        expect(recovered).toEqual(state);
    });

    it('persists an OAuth broker across a simulated restart', async () => {
        const backend = fakeFirestore();
        const redirect = 'https://chatgpt.com/connector/oauth/cb';
        const verifier = 'verifier-with-enough-entropy-0123456789abcdef';

        const store1 = storeFor(backend);
        await store1.warmup();
        const b1 = createOAuthBroker({ store: store1 });
        const client = b1.registerClient({ redirect_uris: [redirect] });
        const code = b1.approveAuthorization({
            clientId: client.client_id,
            redirectUri: redirect,
            codeChallenge: s256Challenge(verifier),
            firebaseRefreshToken: 'firebase-rt-survives'
        });
        const tokens = b1.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier });
        await new Promise((resolve) => setTimeout(resolve, 0));

        // New process: new store + broker reading the same Firestore doc.
        const store2 = storeFor(backend);
        await store2.warmup();
        const b2 = createOAuthBroker({ store: store2 });
        const refreshed = b2.exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
        expect(b2.resolveAccessToken(refreshed.access_token)).toEqual({ firebaseRefreshToken: 'firebase-rt-survives' });
    });

    it('keeps the in-memory mirror correct even if a write fails', async () => {
        const backend = fakeFirestore();
        const store = storeFor(backend);
        await store.warmup();
        // Force the next write to reject; save() must swallow it.
        backend.fetchImpl = async () => { throw new Error('network down'); };
        const failing = createFirestoreStore({
            projectId: 'p',
            getToken: async () => 't',
            fetchImpl: async () => { throw new Error('network down'); }
        });
        await failing.warmup().catch(() => {});
        expect(() => failing.save({ clients: {}, refreshTokens: { a: { firebaseRefreshToken: 'x' } } })).not.toThrow();
        expect(failing.load().refreshTokens.a.firebaseRefreshToken).toBe('x');
    });
});
