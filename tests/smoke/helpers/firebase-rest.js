const firestoreApiOrigin = 'https://firestore.googleapis.com';
const identityToolkitOrigin = 'https://identitytoolkit.googleapis.com';
const firebaseStorageOrigin = 'https://firebasestorage.googleapis.com';

function encodeDocumentPath(path) {
    return String(path || '')
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

async function readJson(response, operation) {
    if (!response.ok) {
        throw new Error(`${operation} failed with status ${response.status}`);
    }
    return response.json();
}

async function loadFirebaseSmokeConfig(appBaseUrl) {
    const origin = new URL(appBaseUrl).origin;
    const hostingResponse = await fetch(`${origin}/__/firebase/init.json`, {
        headers: { accept: 'application/json' }
    });
    if (hostingResponse.ok) {
        return hostingResponse.json();
    }

    const runtimeResponse = await fetch(`${origin}/.well-known/allplays-runtime-config.json`, {
        headers: { accept: 'application/json' }
    });
    const runtimeConfig = await readJson(runtimeResponse, 'AllPlays smoke runtime configuration load');
    return runtimeConfig.firebase || runtimeConfig.firebasePrimary || {};
}

export async function createFirebaseRestSession({ appBaseUrl, email, password }) {
    const appOrigin = new URL(appBaseUrl).origin;
    const config = await loadFirebaseSmokeConfig(appBaseUrl);
    if (!config.apiKey || !config.projectId) {
        throw new Error('Firebase smoke configuration is incomplete');
    }

    const authResponse = await fetch(
        `${identityToolkitOrigin}/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                referer: `${appOrigin}/`
            },
            body: JSON.stringify({
                email,
                password,
                returnSecureToken: true
            })
        }
    );
    const auth = await readJson(authResponse, 'Firebase smoke authentication');
    if (!auth.idToken || !auth.localId) {
        throw new Error('Firebase smoke authentication returned an incomplete session');
    }

    return {
        projectId: config.projectId,
        storageBucket: config.storageBucket || '',
        idToken: auth.idToken,
        localId: auth.localId
    };
}

function documentsUrl(session, collectionPath, pageToken = '') {
    const base = `${firestoreApiOrigin}/v1/projects/${encodeURIComponent(session.projectId)}/databases/(default)/documents/${encodeDocumentPath(collectionPath)}`;
    const url = new URL(base);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    return url;
}

export async function listFirestoreDocuments(session, collectionPath) {
    const documents = [];
    let pageToken = '';
    do {
        const response = await fetch(documentsUrl(session, collectionPath, pageToken), {
            headers: { authorization: `Bearer ${session.idToken}` }
        });
        if (response.status === 404) return documents;
        const payload = await readJson(response, 'Firestore smoke collection read');
        documents.push(...(payload.documents || []));
        pageToken = String(payload.nextPageToken || '');
    } while (pageToken);
    return documents;
}

export function getFirestoreStringField(document, fieldName) {
    return String(document?.fields?.[fieldName]?.stringValue || '');
}

function buildStructuredQuery(collectionPath, fields) {
    const segments = String(collectionPath || '').split('/').filter(Boolean);
    const collectionId = segments.pop();
    if (!collectionId) throw new Error('Firestore smoke query requires a collection');
    const fieldFilters = Object.entries(fields).map(([fieldPath, stringValue]) => ({
        fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: { stringValue: String(stringValue) }
        }
    }));
    return {
        parentPath: segments.join('/'),
        structuredQuery: {
            from: [{ collectionId }],
            where: fieldFilters.length === 1
                ? fieldFilters[0]
                : { compositeFilter: { op: 'AND', filters: fieldFilters } }
        }
    };
}

export async function findFirestoreDocumentsByStringFields(session, collectionPath, fields) {
    const entries = Object.entries(fields);
    if (!entries.length) throw new Error('Firestore smoke query requires at least one field');
    const { parentPath, structuredQuery } = buildStructuredQuery(
        collectionPath,
        Object.fromEntries([entries[0]])
    );
    const parentSuffix = parentPath ? `/${encodeDocumentPath(parentPath)}` : '';
    const url = `${firestoreApiOrigin}/v1/projects/${encodeURIComponent(session.projectId)}/databases/(default)/documents${parentSuffix}:runQuery`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${session.idToken}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await readJson(response, 'Firestore smoke filtered query');
    return payload
        .map((entry) => entry.document)
        .filter(Boolean)
        .filter((document) => entries.every(
            ([fieldName, expectedValue]) => getFirestoreStringField(document, fieldName) === String(expectedValue)
        ));
}

export async function findFirestoreDocumentsByStringField(session, collectionPath, fieldName, expectedValue) {
    return findFirestoreDocumentsByStringFields(session, collectionPath, {
        [fieldName]: expectedValue
    });
}

export function getFirestoreDocumentPath(document) {
    const marker = '/documents/';
    const name = String(document?.name || '');
    const index = name.indexOf(marker);
    if (index < 0) throw new Error('Firestore smoke document has no path');
    return name.slice(index + marker.length);
}

export async function deleteFirestoreDocument(session, documentPath) {
    const url = `${firestoreApiOrigin}/v1/projects/${encodeURIComponent(session.projectId)}/databases/(default)/documents/${encodeDocumentPath(documentPath)}`;
    const response = await fetch(url, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${session.idToken}` }
    });
    if (!response.ok && response.status !== 404) {
        throw new Error(`Firestore smoke cleanup failed with status ${response.status}`);
    }
}

export async function getFirestoreDocument(session, documentPath) {
    const url = `${firestoreApiOrigin}/v1/projects/${encodeURIComponent(session.projectId)}/databases/(default)/documents/${encodeDocumentPath(documentPath)}`;
    const response = await fetch(url, {
        headers: { authorization: `Bearer ${session.idToken}` }
    });
    if (response.status === 404) return null;
    return readJson(response, 'Firestore smoke document read');
}

export async function patchFirestoreDocumentFields(
    session,
    documentPath,
    fields,
    { updateTime = '' } = {}
) {
    const fieldEntries = Object.entries(fields || {});
    if (!fieldEntries.length) {
        throw new Error('Firestore smoke patch requires at least one field');
    }
    const url = new URL(
        `${firestoreApiOrigin}/v1/projects/${encodeURIComponent(session.projectId)}/databases/(default)/documents/${encodeDocumentPath(documentPath)}`
    );
    fieldEntries
        .map(([fieldPath]) => fieldPath)
        .sort()
        .forEach((fieldPath) => url.searchParams.append('updateMask.fieldPaths', fieldPath));
    if (updateTime) {
        url.searchParams.set('currentDocument.updateTime', updateTime);
    }
    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            authorization: `Bearer ${session.idToken}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            fields: Object.fromEntries(fieldEntries)
        })
    });
    return readJson(response, 'Firestore smoke document patch');
}

export async function restoreFirestoreDocumentFields(
    session,
    documentPath,
    originalDocument,
    fieldNames,
    { updateTime = '' } = {}
) {
    const normalizedFieldNames = [...new Set(
        (fieldNames || []).map((fieldName) => String(fieldName || '').trim()).filter(Boolean)
    )].sort();
    if (!normalizedFieldNames.length) {
        throw new Error('Firestore smoke field restore requires at least one field');
    }
    const url = new URL(
        `${firestoreApiOrigin}/v1/projects/${encodeURIComponent(session.projectId)}/databases/(default)/documents/${encodeDocumentPath(documentPath)}`
    );
    normalizedFieldNames.forEach((fieldPath) => url.searchParams.append('updateMask.fieldPaths', fieldPath));
    if (updateTime) {
        url.searchParams.set('currentDocument.updateTime', updateTime);
    }
    const originalFields = originalDocument?.fields || {};
    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            authorization: `Bearer ${session.idToken}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            fields: Object.fromEntries(
                normalizedFieldNames
                    .filter((fieldName) => Object.hasOwn(originalFields, fieldName))
                    .map((fieldName) => [fieldName, originalFields[fieldName]])
            )
        })
    });
    return readJson(response, 'Firestore smoke field restore');
}

export async function createFirestoreDocument(session, documentPath, fields) {
    const url = new URL(
        `${firestoreApiOrigin}/v1/projects/${encodeURIComponent(session.projectId)}/databases/(default)/documents/${encodeDocumentPath(documentPath)}`
    );
    url.searchParams.set('currentDocument.exists', 'false');
    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            authorization: `Bearer ${session.idToken}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({ fields })
    });
    return readJson(response, 'Firestore smoke document create');
}

export async function restoreFirestoreDocument(session, documentPath, originalDocument) {
    if (!originalDocument) {
        await deleteFirestoreDocument(session, documentPath);
        return;
    }
    const url = `${firestoreApiOrigin}/v1/projects/${encodeURIComponent(session.projectId)}/databases/(default)/documents/${encodeDocumentPath(documentPath)}`;
    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            authorization: `Bearer ${session.idToken}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({ fields: originalDocument.fields || {} })
    });
    await readJson(response, 'Firestore smoke document restore');
}

export async function deleteFirestoreDocumentsByStringField(session, collectionPath, fieldName, expectedValue) {
    return deleteFirestoreDocumentsByStringFields(session, collectionPath, {
        [fieldName]: expectedValue
    });
}

export async function deleteFirestoreDocumentsByStringFields(session, collectionPath, fields) {
    const documents = await findFirestoreDocumentsByStringFields(session, collectionPath, fields);
    for (const document of documents) {
        await deleteFirestoreDocument(session, getFirestoreDocumentPath(document));
    }
    return documents.length;
}

export async function uploadFirebaseStorageObject(session, storagePath, body, contentType = 'image/png') {
    if (!storagePath) throw new Error('Firebase smoke storage upload requires a path');
    if (!session.storageBucket) throw new Error('Firebase smoke storage bucket is unavailable');
    const url = new URL(
        `${firebaseStorageOrigin}/v0/b/${encodeURIComponent(session.storageBucket)}/o`
    );
    url.searchParams.set('uploadType', 'media');
    url.searchParams.set('name', storagePath);
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${session.idToken}`,
            'content-type': contentType
        },
        body
    });
    return readJson(response, 'Firebase smoke storage upload');
}

export async function deleteFirebaseStorageObject(session, storagePath) {
    if (!storagePath) return;
    if (!session.storageBucket) throw new Error('Firebase smoke storage bucket is unavailable');
    const url = `${firebaseStorageOrigin}/v0/b/${encodeURIComponent(session.storageBucket)}/o/${encodeURIComponent(storagePath)}`;
    const response = await fetch(url, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${session.idToken}` }
    });
    if (!response.ok && response.status !== 404) {
        throw new Error(`Firebase smoke storage cleanup failed with status ${response.status}`);
    }
}

export async function deleteSmokeMediaByTitle(session, collectionPath, title) {
    const documents = await findFirestoreDocumentsByStringField(session, collectionPath, 'title', title);
    for (const document of documents) {
        await deleteFirebaseStorageObject(session, getFirestoreStringField(document, 'storagePath'));
        await deleteFirestoreDocument(session, getFirestoreDocumentPath(document));
    }
    return documents.length;
}

export async function runSmokeCleanup(runId, cleanupTasks) {
    const failures = [];
    for (const task of cleanupTasks.reverse()) {
        try {
            await task.cleanup();
        } catch {
            failures.push(task.recordType);
        }
    }
    if (failures.length) {
        throw new Error(`Smoke cleanup failed for ${[...new Set(failures)].join(', ')} in run ${runId}`);
    }
}
