// User-credentialed Firestore access over the REST API.
//
// Every request carries the *user's* Firebase ID token, so Firestore security
// rules authorize each read exactly as they do for the AllPlays web and app
// clients. The service itself holds no privileged credentials. The adapter
// exposes the same doc()/collection() surface core.js uses, so domain logic
// stays storage-agnostic and testable.

import { DomainError } from './core.js';

const OP_MAP = {
    '==': 'EQUAL',
    '>=': 'GREATER_THAN_OR_EQUAL',
    '<=': 'LESS_THAN_OR_EQUAL',
    '>': 'GREATER_THAN',
    '<': 'LESS_THAN',
    'array-contains': 'ARRAY_CONTAINS'
};

export function encodeValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
    if (typeof value === 'object') {
        return {
            mapValue: {
                fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeValue(entry)]))
            }
        };
    }
    throw new Error(`Cannot encode Firestore value of type ${typeof value}`);
}

export function decodeValue(value) {
    if (!value || typeof value !== 'object') return null;
    if ('nullValue' in value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('timestampValue' in value) return new Date(value.timestampValue);
    if ('referenceValue' in value) return value.referenceValue;
    if ('geoPointValue' in value) return value.geoPointValue;
    if ('mapValue' in value) return decodeFields(value.mapValue?.fields);
    if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeValue);
    return null;
}

export function decodeFields(fields) {
    return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeValue(value)]));
}

function throwForStatus(status, path) {
    if (status === 401 || status === 403) {
        throw new DomainError('permission_denied', 'You do not have access to this data.');
    }
    throw new Error(`Firestore request failed (${status}) for ${path}`);
}

export function buildStructuredQuery(collectionId, { filters = [], orderBy = null, limit = null } = {}) {
    const structuredQuery = { from: [{ collectionId }] };
    const fieldFilters = filters.map(({ field, op, value }) => ({
        fieldFilter: {
            field: { fieldPath: field },
            op: OP_MAP[op] || (() => { throw new Error(`Unsupported operator: ${op}`); })(),
            value: encodeValue(value)
        }
    }));
    if (fieldFilters.length === 1) structuredQuery.where = fieldFilters[0];
    if (fieldFilters.length > 1) {
        structuredQuery.where = { compositeFilter: { op: 'AND', filters: fieldFilters } };
    }
    if (orderBy) {
        structuredQuery.orderBy = [{
            field: { fieldPath: orderBy.field },
            direction: orderBy.direction === 'desc' ? 'DESCENDING' : 'ASCENDING'
        }];
    }
    if (limit) structuredQuery.limit = limit;
    return structuredQuery;
}

/**
 * Firestore handle scoped to one user's ID token. Interface matches what
 * core.js expects: doc(path).get(), collection(path).where().orderBy().limit().get().
 */
export function createUserDb({ projectId, idToken, fetchImpl = fetch }) {
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const headers = {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
    };

    return {
        doc(path) {
            return {
                async get() {
                    const response = await fetchImpl(`${baseUrl}/${path}`, { headers });
                    if (response.status === 404) {
                        return { exists: false, id: path.split('/').pop(), data: () => undefined };
                    }
                    if (!response.ok) throwForStatus(response.status, path);
                    const body = await response.json();
                    return {
                        exists: true,
                        id: path.split('/').pop(),
                        data: () => decodeFields(body.fields)
                    };
                }
            };
        },
        collection(path) {
            const segments = path.split('/');
            const collectionId = segments.pop();
            const parentPath = segments.join('/');
            const queryUrl = `${baseUrl}${parentPath ? `/${parentPath}` : ''}:runQuery`;

            const makeQuery = (options) => ({
                where(field, op, value) {
                    return makeQuery({ ...options, filters: [...options.filters, { field, op, value }] });
                },
                orderBy(field, direction = 'asc') {
                    return makeQuery({ ...options, orderBy: { field, direction } });
                },
                limit(count) {
                    return makeQuery({ ...options, limit: count });
                },
                async get() {
                    const response = await fetchImpl(queryUrl, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ structuredQuery: buildStructuredQuery(collectionId, options) })
                    });
                    if (!response.ok) throwForStatus(response.status, path);
                    const rows = await response.json();
                    const docs = (Array.isArray(rows) ? rows : [])
                        .filter((row) => row.document)
                        .map((row) => ({
                            id: row.document.name.split('/').pop(),
                            data: () => decodeFields(row.document.fields)
                        }));
                    return { docs };
                }
            });

            return makeQuery({ filters: [] });
        }
    };
}
