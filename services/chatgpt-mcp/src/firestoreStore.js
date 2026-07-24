// Firestore-backed persistence for the OAuth broker's long-lived state.
//
// Unlike user-data reads (which use each user's own ID token so rules enforce
// access), the broker's own bookkeeping — registered OAuth clients and the
// broker-token → Firebase-refresh-token map — is service state with no owning
// user. It is written with the Cloud Run runtime service account's access
// token (fetched from the metadata server) via the Firestore REST API. The
// collection is denied to all client access by the default-deny rule in
// firestore.rules; only service-account/REST access (which bypasses rules)
// can touch it.
//
// The whole broker state lives in a single document (volume is tiny — a
// handful of ChatGPT clients and refresh grants). The broker calls load()/
// save() synchronously, so this store keeps an in-memory mirror: warmup()
// loads it once before the broker is built, load() returns the mirror, and
// save() updates the mirror and writes to Firestore fire-and-forget (writes
// are serialized to preserve order).

import { encodeValue, decodeFields } from './firestoreRest.js';

const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const TOKEN_MARGIN_MS = 60 * 1000;

function createMetadataTokenSource(fetchImpl, now) {
    let cached = null;
    return async function getToken() {
        if (cached && cached.expiresAt - TOKEN_MARGIN_MS > now()) return cached.token;
        const response = await fetchImpl(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
        if (!response.ok) throw new Error(`Metadata token request failed (${response.status}).`);
        const body = await response.json();
        cached = { token: body.access_token, expiresAt: now() + (Number(body.expires_in) || 3600) * 1000 };
        return cached.token;
    };
}

/**
 * @param projectId   Firebase/GCP project id.
 * @param docPath     Firestore document path, e.g. "oauthBrokerState/state".
 * @param getToken    optional async () => access token (defaults to the
 *                    Cloud Run metadata server). Injectable for tests.
 */
export function createFirestoreStore({ projectId, docPath = 'oauthBrokerState/state', getToken, fetchImpl = fetch, now = () => Date.now() }) {
    const tokenSource = getToken || createMetadataTokenSource(fetchImpl, now);
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
    let mirror = { clients: {}, refreshTokens: {} };
    let writeChain = Promise.resolve();

    async function readState() {
        const token = await tokenSource();
        const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
        if (response.status === 404) return { clients: {}, refreshTokens: {} };
        if (!response.ok) throw new Error(`OAuth store read failed (${response.status}).`);
        const body = await response.json();
        const fields = decodeFields(body.fields);
        return {
            clients: fields.clients && typeof fields.clients === 'object' ? fields.clients : {},
            refreshTokens: fields.refreshTokens && typeof fields.refreshTokens === 'object' ? fields.refreshTokens : {}
        };
    }

    async function writeState(state) {
        const token = await tokenSource();
        const response = await fetchImpl(url, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: {
                    clients: encodeValue(state.clients || {}),
                    refreshTokens: encodeValue(state.refreshTokens || {})
                }
            })
        });
        if (!response.ok) throw new Error(`OAuth store write failed (${response.status}).`);
    }

    return {
        async warmup() {
            mirror = await readState();
            return mirror;
        },
        load() {
            return mirror;
        },
        save(state) {
            mirror = state;
            // Serialize writes so rapid saves land in order; swallow errors so a
            // transient Firestore failure never breaks the auth flow (the mirror
            // stays correct in memory until the next successful write).
            writeChain = writeChain
                .then(() => writeState(state))
                .catch((error) => console.warn('[chatgpt-mcp] OAuth store write failed:', error.message));
        }
    };
}
