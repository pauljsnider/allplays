import { DomainError } from './core.js';
import { decodeFields, encodeValue } from './firestoreRest.js';

// Domain-limited user-credentialed adapter; no Admin SDK or generic MCP writer.
export function createDirectCommandStore({ projectId, uid, idToken, getIdToken, fetchImpl = fetch, preserveTimestampPrecision = false }, policy) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('A verified actor is required.');
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const name = (path) => `${base.slice('https://firestore.googleapis.com/v1/'.length)}/${path}`;
    const proposal = new RegExp(`^users/${uid}/privateAiPendingActions/direct_[a-f0-9-]{36}$`);
    const assertPath = (path, write = false) => {
        if (!proposal.test(path) && !(write ? policy.write(path) : policy.read(path))) {
            throw new DomainError('permission_denied', 'This adapter accepts only the selected command domain paths.');
        }
    };
    async function request(suffix, options = {}, beforeSend) {
        const token = getIdToken ? await getIdToken() : idToken;
        const beforeFetch = await beforeSend?.();
        beforeFetch?.();
        const response = await fetchImpl(`${base}${suffix}`, {
            ...options,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) {
            const code = [401, 403].includes(response.status) ? 'permission_denied' : response.status === 409 ? 'conflict' : 'unavailable';
            throw new DomainError(code, 'The command could not be verified. Retry only with the same proposal ID.');
        }
        return response.json();
    }
    async function get(path, transaction, observations) {
        assertPath(path);
        // batchGet represents missing documents explicitly and records their
        // absence in a transaction's read set, avoiding an unchecked create race.
        const body = await request(':batchGet', { method: 'POST', body: JSON.stringify({ documents: [name(path)], ...(transaction ? { transaction } : {}) }) });
        if (!Array.isArray(body) || body.length !== 1) throw new DomainError('unavailable', 'Invalid document response.');
        const row = body[0];
        observations?.set(path, structuredClone(row));
        if (row.missing === name(path)) return { exists: false, data: null, version: null };
        if (row.found?.name !== name(path) || !row.found.updateTime) throw new DomainError('unavailable', 'Document revision unavailable.');
        return { exists: true, data: decodeFields(row.found.fields, { preserveTimestampPrecision }), version: row.found.updateTime };
    }
    async function list(path, transaction, queryArgs = {}) {
        const query = policy.query?.(path, queryArgs);
        if (!query) throw new DomainError('permission_denied', 'This query is outside the command domain.');
        const segments = path.split('/');
        const collectionId = segments.pop();
        const parent = segments.join('/');
        const rows = await request(`/${parent}:runQuery`, { method: 'POST', body: JSON.stringify({
            structuredQuery: { from: [{ collectionId }], select: { fields: query.fields.map((fieldPath) => ({ fieldPath })) },
                orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: query.limit,
                ...(query.where ? { where: { fieldFilter: { field: { fieldPath: query.where.field }, op: 'EQUAL', value: encodeValue(query.where.value) } } } : {}) },
            ...(transaction ? { transaction } : {})
        }) });
        if (!Array.isArray(rows) || rows.some((row) => !row || row.error || (!row.document && typeof row.readTime !== 'string'))) {
            throw new DomainError('unavailable', 'The query response could not be verified.');
        }
        return rows.filter((row) => row.document).map(({ document }) => {
            const prefix = `${name(path)}/`;
            const id = document.name?.startsWith(prefix) ? document.name.slice(prefix.length) : '';
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !document.updateTime) throw new DomainError('unavailable', 'A query revision could not be verified.');
            return { id, exists: true, data: decodeFields(document.fields), version: document.updateTime };
        });
    }
    const write = (path, data) => {
        assertPath(path, true);
        const timestamps = policy.serverTimestamps?.(path, data) || [];
        if (!Array.isArray(timestamps) || new Set(timestamps).size !== timestamps.length
            || timestamps.some((field) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(field) || !(data[field] instanceof Date))) {
            throw new DomainError('permission_denied', 'Invalid server timestamp field policy.');
        }
        return { update: { name: name(path), fields: encodeValue(Object.fromEntries(Object.entries(data).filter(([key]) => !timestamps.includes(key)))).mapValue.fields },
            ...(timestamps.length ? { updateTransforms: timestamps.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}) };
    };
    return {
        get,
        list: (path, queryArgs) => list(path, undefined, queryArgs),
        async create(path, data, companions = []) {
            if (!proposal.test(path)) throw new DomainError('permission_denied', 'Only proposals may be prepared.');
            if (companions.length > 1 || companions.some((entry) => !policy.prepare?.(entry.path))) throw new DomainError('permission_denied', 'The proposal companion is outside this domain.');
            await request(':commit', { method: 'POST', body: JSON.stringify({ writes: [{ path, data }, ...companions].map((entry) => ({ ...write(entry.path, entry.data), currentDocument: { exists: false } })) }) });
        },
        async transaction(callback, { beforeCommit, beforeDispatch, afterCommit, commitFailed } = {}) {
            const started = await request(':beginTransaction', { method: 'POST', body: JSON.stringify({ options: { readWrite: {} } }) });
            if (!started.transaction) throw new DomainError('unavailable', 'Transaction unavailable.');
            const transaction = started.transaction;
            const writes = [];
            const observations = new Map();
            let committed = false;
            let dispatched = false;
            try {
                const result = await callback({
                    get: (path) => get(path, transaction, observations),
                    list: (path, queryArgs) => list(path, transaction, queryArgs),
                    set: (path, data) => writes.push(write(path, data)),
                    patch: (path, data) => {
                        if (!policy.patch?.(path, data)) throw new DomainError('permission_denied', 'This patch is outside the command domain.');
                        const encoded = write(path, data);
                        const fieldPaths = Object.keys(encoded.update.fields);
                        writes.push(!fieldPaths.length && encoded.updateTransforms?.length
                            ? { transform: { document: name(path), fieldTransforms: encoded.updateTransforms }, currentDocument: { exists: true } }
                            : { ...encoded, updateMask: { fieldPaths }, currentDocument: { exists: true } });
                    },
                    patchFields: (path, data, fieldPaths) => {
                        if (!policy.patchFields?.(path, data, fieldPaths)) throw new DomainError('permission_denied', 'This field-mask patch is outside the command domain.');
                        writes.push({ ...write(path, data), updateMask: { fieldPaths }, currentDocument: { exists: true } });
                    },
                    append: (path, field, values, data) => {
                        if (!policy.append?.(path, field, values, data)) throw new DomainError('permission_denied', 'This array append is outside the command domain.');
                        writes.push({ ...write(path, data), updateMask: { fieldPaths: Object.keys(data) }, currentDocument: { exists: true },
                            updateTransforms: [{ fieldPath: field, appendMissingElements: { values: values.map(encodeValue) } }] });
                    },
                    delete: (path) => {
                        assertPath(path, true);
                        if (!policy.delete?.(path)) throw new DomainError('permission_denied', 'Deletion is outside this command domain.');
                        writes.push({ delete: name(path) });
                    }
                });
                if (writes.length) {
                    const plan = { writes: structuredClone(writes), reads: Object.fromEntries(observations) };
                    const response = await request(':commit', { method: 'POST', body: JSON.stringify({ writes, transaction }) }, async () => {
                        await beforeCommit?.(structuredClone(plan));
                        const assertReady = await beforeDispatch?.();
                        return () => { assertReady?.(); dispatched = true; };
                    });
                    committed = true;
                    await afterCommit?.({ plan: structuredClone(plan), response: structuredClone(response) });
                }
                return result;
            } catch (error) {
                if (commitFailed) await Promise.resolve().then(() => commitFailed({ dispatched })).catch(() => {});
                throw error;
            } finally {
                if (!committed) await request(':rollback', { method: 'POST', body: JSON.stringify({ transaction }) }).catch(() => {});
            }
        }
    };
}
