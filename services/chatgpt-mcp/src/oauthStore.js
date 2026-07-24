// OAuth access/refresh grant persistence.
//
// Production grants live in Firestore under SHA-256 token identifiers. The
// user's Firebase refresh-token binding is encrypted with AES-256-GCM before
// it crosses the storage boundary. The in-memory adapter is intentionally
// limited to local development and tests.

import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes
} from 'node:crypto';
import { decodeFields, encodeValue } from './firestoreRest.js';

const DEFAULT_COLLECTION_ID = 'chatgptMcpOAuthGrants';
const DEFAULT_DATABASE_ID = '(default)';
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

function tokenDigest(token) {
    return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function initializeMemoryState(state) {
    if (!state.accessTokens) state.accessTokens = new Map();
    if (!state.refreshTokens) state.refreshTokens = new Map();
    return state;
}

function pruneExpired(store, now) {
    for (const [key, record] of store) {
        if (record.expiresAt <= now) store.delete(key);
    }
}

function setBounded(store, key, record, now, maxStoredGrants) {
    pruneExpired(store, now);
    while (store.size >= maxStoredGrants) {
        store.delete(store.keys().next().value);
    }
    store.set(key, record);
}

export function createMemoryOAuthGrantStore({
    state = {},
    now = () => Date.now(),
    maxStoredGrants = 1000
} = {}) {
    if (!Number.isInteger(maxStoredGrants) || maxStoredGrants < 1) {
        throw new Error('maxStoredGrants must be a positive integer.');
    }
    const stores = initializeMemoryState(state);

    return {
        async issueGrantPair({
            accessToken,
            refreshToken,
            firebaseRefreshToken,
            clientId,
            accessExpiresAt,
            refreshExpiresAt
        }) {
            const currentTime = now();
            setBounded(stores.accessTokens, accessToken, {
                firebaseRefreshToken,
                clientId,
                expiresAt: accessExpiresAt
            }, currentTime, maxStoredGrants);
            setBounded(stores.refreshTokens, refreshToken, {
                firebaseRefreshToken,
                clientId,
                expiresAt: refreshExpiresAt
            }, currentTime, maxStoredGrants);
        },

        async resolveAccessToken(token) {
            pruneExpired(stores.accessTokens, now());
            const record = stores.accessTokens.get(token);
            return record ? { firebaseRefreshToken: record.firebaseRefreshToken } : null;
        },

        async rotateRefreshToken({
            refreshToken,
            newAccessToken,
            newRefreshToken,
            accessExpiresAt,
            refreshExpiresAt
        }) {
            const currentTime = now();
            pruneExpired(stores.refreshTokens, currentTime);
            const record = stores.refreshTokens.get(refreshToken);
            if (!record) return false;

            // No await occurs between the read and delete, so concurrent calls
            // against shared state have one consume winner.
            stores.refreshTokens.delete(refreshToken);
            setBounded(stores.accessTokens, newAccessToken, {
                firebaseRefreshToken: record.firebaseRefreshToken,
                clientId: record.clientId,
                expiresAt: accessExpiresAt
            }, currentTime, maxStoredGrants);
            setBounded(stores.refreshTokens, newRefreshToken, {
                firebaseRefreshToken: record.firebaseRefreshToken,
                clientId: record.clientId,
                expiresAt: refreshExpiresAt
            }, currentTime, maxStoredGrants);
            return true;
        }
    };
}

function decodeEncryptionKey(value) {
    const encoded = String(value || '').trim();
    if (encoded.length !== 44 || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
        throw new Error('OAUTH_GRANT_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    }
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded) {
        throw new Error('OAUTH_GRANT_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    }
    return key;
}

function authenticatedMetadata({ type, digest, clientId, expiresAt }) {
    return Buffer.from(JSON.stringify({
        type,
        digest,
        clientId: clientId || '',
        expiresAt
    }), 'utf8');
}

function encryptBinding(key, firebaseRefreshToken, metadata) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(authenticatedMetadata(metadata));
    const ciphertext = Buffer.concat([
        cipher.update(firebaseRefreshToken, 'utf8'),
        cipher.final()
    ]);
    return {
        version: 1,
        iv: iv.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        tag: cipher.getAuthTag().toString('base64')
    };
}

function decryptBinding(key, envelope, metadata) {
    if (envelope?.version !== 1 || !envelope.iv || !envelope.ciphertext || !envelope.tag) {
        throw new Error('Stored OAuth grant has an invalid encrypted binding.');
    }
    const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(envelope.iv, 'base64')
    );
    decipher.setAAD(authenticatedMetadata(metadata));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final()
    ]).toString('utf8');
}

function documentFields(record) {
    return Object.fromEntries(
        Object.entries(record).map(([field, value]) => [field, encodeValue(value)])
    );
}

function grantRecord({ type, token, firebaseRefreshToken, clientId, expiresAt, encryptionKey }) {
    const digest = tokenDigest(token);
    const metadata = { type, digest, clientId, expiresAt };
    return {
        id: `${type}_${digest}`,
        digest,
        fields: {
            type,
            clientId,
            expiresAt: new Date(expiresAt),
            encryptedBinding: encryptBinding(encryptionKey, firebaseRefreshToken, metadata)
        }
    };
}

function createdDocumentWrite(documentName, record) {
    return {
        update: {
            name: documentName,
            fields: documentFields(record.fields)
        },
        currentDocument: { exists: false }
    };
}

export function createMetadataAccessTokenProvider({
    fetchImpl = fetch,
    now = () => Date.now(),
    metadataUrl = METADATA_TOKEN_URL
} = {}) {
    let cachedToken = null;
    let refreshAt = 0;

    return async () => {
        if (cachedToken && now() < refreshAt) return cachedToken;
        const response = await fetchImpl(metadataUrl, {
            headers: { 'Metadata-Flavor': 'Google' }
        });
        if (!response.ok) {
            throw new Error(`Cloud Run service-identity token request failed (${response.status}).`);
        }
        const body = await response.json();
        if (!body.access_token || !Number.isFinite(Number(body.expires_in))) {
            throw new Error('Cloud Run service-identity token response was invalid.');
        }
        cachedToken = body.access_token;
        refreshAt = now() + Math.max(0, Number(body.expires_in) - 60) * 1000;
        return cachedToken;
    };
}

export function createFirestoreOAuthGrantStore({
    projectId,
    databaseId = DEFAULT_DATABASE_ID,
    collectionId = DEFAULT_COLLECTION_ID,
    encryptionKey,
    accessTokenProvider,
    fetchImpl = fetch,
    now = () => Date.now()
} = {}) {
    if (!projectId || typeof projectId !== 'string') {
        throw new Error('OAUTH_GRANT_STORE_PROJECT_ID must be set for Firestore grant storage.');
    }
    if (!databaseId || !collectionId) {
        throw new Error('OAuth grant Firestore database and collection must be configured.');
    }
    if (typeof accessTokenProvider !== 'function') {
        throw new Error('A Cloud Run service-identity access token provider is required.');
    }
    const key = decodeEncryptionKey(encryptionKey);
    const documentsRoot = `projects/${projectId}/databases/${databaseId}/documents`;
    const collectionRoot = `${documentsRoot}/${collectionId}`;
    const apiRoot = `https://firestore.googleapis.com/v1/${documentsRoot}`;

    function documentName(id) {
        return `${collectionRoot}/${id}`;
    }

    function documentUrl(id) {
        return `${apiRoot}/${collectionId}/${id}`;
    }

    async function request(url, options = {}) {
        const serviceAccessToken = await accessTokenProvider();
        return fetchImpl(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${serviceAccessToken}`,
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
    }

    async function commit(writes) {
        const response = await request(`${apiRoot}:commit`, {
            method: 'POST',
            body: JSON.stringify({ writes })
        });
        if (response.ok) return { ok: true };
        const body = await response.json().catch(() => ({}));
        const status = body?.error?.status;
        if (
            response.status === 409
            || status === 'ABORTED'
            || status === 'FAILED_PRECONDITION'
            || status === 'ALREADY_EXISTS'
        ) {
            return { ok: false, conflict: true };
        }
        throw new Error(`OAuth grant Firestore commit failed (${response.status}).`);
    }

    async function readGrant(type, token) {
        const digest = tokenDigest(token);
        const response = await request(documentUrl(`${type}_${digest}`));
        if (response.status === 404) return null;
        if (!response.ok) {
            throw new Error(`OAuth grant Firestore read failed (${response.status}).`);
        }
        const document = await response.json();
        return {
            digest,
            document,
            record: decodeFields(document.fields)
        };
    }

    async function deleteExpired(type, digest, updateTime) {
        const precondition = updateTime
            ? `?currentDocument.updateTime=${encodeURIComponent(updateTime)}`
            : '';
        try {
            await request(`${documentUrl(`${type}_${digest}`)}${precondition}`, {
                method: 'DELETE'
            });
        } catch {
            // Expiry is enforced before this best-effort cleanup. Firestore TTL
            // remains the durable cleanup backstop.
        }
    }

    function decryptGrant(type, result) {
        const expiresAt = result.record.expiresAt instanceof Date
            ? result.record.expiresAt.getTime()
            : Number.NaN;
        if (
            result.record.type !== type
            || !Number.isFinite(expiresAt)
            || typeof result.record.clientId !== 'string'
        ) {
            throw new Error('Stored OAuth grant has an invalid schema.');
        }
        return {
            clientId: result.record.clientId,
            expiresAt,
            firebaseRefreshToken: decryptBinding(key, result.record.encryptedBinding, {
                type,
                digest: result.digest,
                clientId: result.record.clientId,
                expiresAt
            })
        };
    }

    return {
        async issueGrantPair({
            accessToken,
            refreshToken,
            firebaseRefreshToken,
            clientId,
            accessExpiresAt,
            refreshExpiresAt
        }) {
            const access = grantRecord({
                type: 'access',
                token: accessToken,
                firebaseRefreshToken,
                clientId,
                expiresAt: accessExpiresAt,
                encryptionKey: key
            });
            const refresh = grantRecord({
                type: 'refresh',
                token: refreshToken,
                firebaseRefreshToken,
                clientId,
                expiresAt: refreshExpiresAt,
                encryptionKey: key
            });
            const result = await commit([
                createdDocumentWrite(documentName(access.id), access),
                createdDocumentWrite(documentName(refresh.id), refresh)
            ]);
            if (!result.ok) throw new Error('OAuth grant token collision.');
        },

        async resolveAccessToken(token) {
            const result = await readGrant('access', token);
            if (!result) return null;
            const grant = decryptGrant('access', result);
            if (grant.expiresAt <= now()) {
                await deleteExpired('access', result.digest, result.document.updateTime);
                return null;
            }
            return { firebaseRefreshToken: grant.firebaseRefreshToken };
        },

        async rotateRefreshToken({
            refreshToken,
            newAccessToken,
            newRefreshToken,
            accessExpiresAt,
            refreshExpiresAt
        }) {
            const current = await readGrant('refresh', refreshToken);
            if (!current) return false;
            let grant;
            try {
                grant = decryptGrant('refresh', current);
            } catch {
                // Key replacement and corrupt records make this specific grant
                // unusable; clients must reconnect instead of retrying it.
                return false;
            }
            if (grant.expiresAt <= now()) {
                await deleteExpired('refresh', current.digest, current.document.updateTime);
                return false;
            }

            const access = grantRecord({
                type: 'access',
                token: newAccessToken,
                firebaseRefreshToken: grant.firebaseRefreshToken,
                clientId: grant.clientId,
                expiresAt: accessExpiresAt,
                encryptionKey: key
            });
            const refresh = grantRecord({
                type: 'refresh',
                token: newRefreshToken,
                firebaseRefreshToken: grant.firebaseRefreshToken,
                clientId: grant.clientId,
                expiresAt: refreshExpiresAt,
                encryptionKey: key
            });
            const result = await commit([
                {
                    delete: documentName(`refresh_${current.digest}`),
                    currentDocument: { updateTime: current.document.updateTime }
                },
                createdDocumentWrite(documentName(access.id), access),
                createdDocumentWrite(documentName(refresh.id), refresh)
            ]);
            return result.ok;
        }
    };
}
