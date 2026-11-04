import { DomainError } from './core.js';
import { decodeFields, encodeValue } from './firestoreRest.js';

// Domain-limited user-credentialed adapter; no Admin SDK or generic MCP writer.
export function createDirectFavoriteStore({ projectId, uid, idToken, getIdToken, fetchImpl = fetch }) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('A verified actor is required.');
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const name = (path) => `${base.slice('https://firestore.googleapis.com/v1/'.length)}/${path}`;
    const proposal = new RegExp(`^users/${uid}/privateAiPendingActions/direct_[a-f0-9-]{36}$`);
    const favorite = /^teams\/[A-Za-z0-9_-]{1,128}\/drillFavorites\/[A-Za-z0-9_-]{1,128}$/;
    const assertPath = (path, write = false) => {
        if (!(proposal.test(path) || favorite.test(path) || (!write && /^(teams|drillLibrary)\/[A-Za-z0-9_-]{1,128}$/.test(path)))) {
            throw new DomainError('permission_denied', 'This adapter accepts only the connected actor’s favorite command paths.');
        }
    };
    async function request(suffix, options = {}, beforeSend) {
        const token = getIdToken ? await getIdToken() : idToken;
        await beforeSend?.();
        const response = await fetchImpl(`${base}${suffix}`, {
            ...options,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) {
            const code = [401, 403].includes(response.status) ? 'permission_denied' : response.status === 409 ? 'conflict' : 'unavailable';
            throw new DomainError(code, 'The favorite command could not be verified. Retry only with the same proposal ID.');
        }
        return response.json();
    }
    async function get(path, transaction) {
        assertPath(path);
        // batchGet represents missing documents explicitly and records their
        // absence in a transaction's read set, avoiding an unchecked create race.
        const body = await request(':batchGet', { method: 'POST', body: JSON.stringify({ documents: [name(path)], ...(transaction ? { transaction } : {}) }) });
        if (!Array.isArray(body) || body.length !== 1) throw new DomainError('unavailable', 'Invalid document response.');
        const row = body[0];
        if (row.missing === name(path)) return { exists: false, data: null, version: null };
        if (row.found?.name !== name(path) || !row.found.updateTime) throw new DomainError('unavailable', 'Document revision unavailable.');
        return { exists: true, data: decodeFields(row.found.fields), version: row.found.updateTime };
    }
    const write = (path, data) => {
        assertPath(path, true);
        return { update: { name: name(path), fields: encodeValue(data).mapValue.fields } };
    };
    return {
        get,
        async create(path, data) {
            if (!proposal.test(path)) throw new DomainError('permission_denied', 'Only proposals may be prepared.');
            await request(':commit', { method: 'POST', body: JSON.stringify({ writes: [{ ...write(path, data), currentDocument: { exists: false } }] }) });
        },
        async transaction(callback, { beforeCommit } = {}) {
            const started = await request(':beginTransaction', { method: 'POST', body: JSON.stringify({ options: { readWrite: {} } }) });
            if (!started.transaction) throw new DomainError('unavailable', 'Transaction unavailable.');
            const transaction = started.transaction;
            const writes = [];
            let committed = false;
            try {
                const result = await callback({
                    get: (path) => get(path, transaction),
                    set: (path, data) => writes.push(write(path, data)),
                    delete: (path) => {
                        assertPath(path, true);
                        if (!favorite.test(path)) throw new DomainError('permission_denied', 'Only a favorite may be removed.');
                        writes.push({ delete: name(path) });
                    }
                });
                if (writes.length) {
                    await request(':commit', { method: 'POST', body: JSON.stringify({ writes, transaction }) }, beforeCommit);
                    committed = true;
                }
                return result;
            } finally {
                if (!committed) await request(':rollback', { method: 'POST', body: JSON.stringify({ transaction }) }).catch(() => {});
            }
        }
    };
}
