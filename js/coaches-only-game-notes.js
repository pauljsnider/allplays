export const COACHES_ONLY_GAME_NOTE_MAX_LENGTH = 5000;
export const COACHES_ONLY_GAME_NOTE_DOCUMENT_ID = 'main';

const SHARED_GAME_ID_PREFIX = 'shared_';
const LEGACY_SHARED_GAME_ID_PREFIX = 'shared::';
const HASHED_SHARED_GAME_ID_PREFIX = 'sharedh_';
const MAX_SHARED_GAME_PATH_BYTES = 6144;
const MAX_FIRESTORE_SEGMENT_BYTES = 1500;
const SUPPORTED_SHARED_GAME_ROOTS = new Set(['organizations', 'tournaments']);

function normalizeDocumentId(value, label, maximumBytes = 1500) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || utf8ByteLength(normalized) > maximumBytes || normalized.includes('/')) {
        throw new Error(`${label} is invalid.`);
    }
    return normalized;
}

function normalizeUserId(value) {
    if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > 128 ||
        value.includes('/')
    ) {
        throw new Error('User ID is invalid.');
    }
    return value;
}

function requireFunction(value, label) {
    if (typeof value !== 'function') {
        throw new Error(`${label} is unavailable.`);
    }
    return value;
}

function utf8ByteLength(value) {
    return new TextEncoder().encode(value).length;
}

function normalizeSharedGamePath(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    if (!normalized || utf8ByteLength(normalized) > MAX_SHARED_GAME_PATH_BYTES) return '';
    const segments = normalized.split('/');
    if (
        segments.length !== 4 ||
        !SUPPORTED_SHARED_GAME_ROOTS.has(segments[0]) ||
        segments[2] !== 'sharedGames' ||
        segments.some((segment) => (
            !segment ||
            segment === '.' ||
            segment === '..' ||
            utf8ByteLength(segment) > MAX_FIRESTORE_SEGMENT_BYTES
        ))
    ) {
        return '';
    }
    return normalized;
}

function decodeSharedGamePathFromRouteId(gameId) {
    const prefix = gameId.startsWith(SHARED_GAME_ID_PREFIX)
        ? SHARED_GAME_ID_PREFIX
        : gameId.startsWith(LEGACY_SHARED_GAME_ID_PREFIX)
            ? LEGACY_SHARED_GAME_ID_PREFIX
            : '';
    if (!prefix) return '';
    try {
        return normalizeSharedGamePath(decodeURIComponent(gameId.slice(prefix.length)));
    } catch {
        return '';
    }
}

async function hashSharedGamePath(sharedGamePath, cryptoApi = globalThis.crypto) {
    if (!cryptoApi?.subtle || typeof cryptoApi.subtle.digest !== 'function') {
        throw new Error('Shared game identity validation is unavailable.');
    }
    const digest = new Uint8Array(await cryptoApi.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(sharedGamePath)
    ));
    let binary = '';
    digest.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return `${HASHED_SHARED_GAME_ID_PREFIX}${btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')}`;
}

async function buildSharedGameRouteId(sharedGamePath, cryptoApi = globalThis.crypto) {
    const reversibleId = `${SHARED_GAME_ID_PREFIX}${encodeURIComponent(sharedGamePath)}`;
    if (reversibleId.length <= 128) return reversibleId;
    return hashSharedGamePath(sharedGamePath, cryptoApi);
}

async function resolveSharedGamePath(gameId, sharedGamePath = '', cryptoApi = globalThis.crypto) {
    const routeGameId = typeof gameId === 'string' ? gameId.trim() : '';
    if (!routeGameId) {
        throw new Error('Game ID is invalid.');
    }

    const isReversibleSharedRoute = routeGameId.startsWith(SHARED_GAME_ID_PREFIX)
        || routeGameId.startsWith(LEGACY_SHARED_GAME_ID_PREFIX);
    const isHashedSharedRoute = routeGameId.startsWith(HASHED_SHARED_GAME_ID_PREFIX);
    const isSharedRoute = isReversibleSharedRoute || isHashedSharedRoute;
    // React Router may decode the escaped slashes inside a reversible synthetic
    // ID before this module sees it. Direct and opaque hashed IDs remain one
    // Firestore segment and must never contain a slash.
    if (routeGameId.includes('/') && !isReversibleSharedRoute) {
        throw new Error('Game ID is invalid.');
    }

    const rawSharedGamePath = typeof sharedGamePath === 'string' ? sharedGamePath.trim() : '';
    const normalizedExplicitPath = normalizeSharedGamePath(rawSharedGamePath);
    if (rawSharedGamePath && !normalizedExplicitPath) {
        throw new Error('Shared game path is invalid.');
    }

    const routeSharedPath = decodeSharedGamePathFromRouteId(routeGameId);

    if (normalizedExplicitPath) {
        if (!isSharedRoute) {
            throw new Error('Shared game identity does not match its path.');
        }
        if (isHashedSharedRoute) {
            if (await buildSharedGameRouteId(normalizedExplicitPath, cryptoApi) !== routeGameId) {
                throw new Error('Shared game identity does not match its path.');
            }
        } else if (!routeSharedPath || routeSharedPath !== normalizedExplicitPath) {
            throw new Error('Shared game identity does not match its path.');
        }
        return normalizedExplicitPath;
    }

    if (routeSharedPath) return routeSharedPath;
    if (isHashedSharedRoute) {
        throw new Error('Shared game path is required.');
    }
    if (isSharedRoute) {
        throw new Error('Shared game identity is invalid.');
    }
    return '';
}

export function normalizeCoachesOnlyGameNoteText(value) {
    if (typeof value !== 'string') {
        throw new Error('Coaches-only note text must be a string.');
    }

    const normalized = value.replace(/\r\n?/g, '\n');
    if (normalized.length > COACHES_ONLY_GAME_NOTE_MAX_LENGTH) {
        throw new Error(`Coaches-only note text cannot exceed ${COACHES_ONLY_GAME_NOTE_MAX_LENGTH} characters.`);
    }
    return normalized;
}

export async function getCoachesOnlyGameNotePath(teamId, gameId, sharedGamePath = '', cryptoApi = globalThis.crypto) {
    const normalizedTeamId = normalizeDocumentId(teamId, 'Team ID');
    const canonicalSharedPath = await resolveSharedGamePath(gameId, sharedGamePath, cryptoApi);
    if (canonicalSharedPath) {
        return [
            ...canonicalSharedPath.split('/'),
            'coachNotes',
            normalizedTeamId
        ];
    }
    return [
        'teams',
        normalizedTeamId,
        'games',
        normalizeDocumentId(gameId, 'Game ID'),
        'coachNotes',
        COACHES_ONLY_GAME_NOTE_DOCUMENT_ID
    ];
}

export async function loadCoachesOnlyGameNote({ db, doc, getDoc, teamId, gameId, sharedGamePath = '' }) {
    const createDocumentReference = requireFunction(doc, 'Firestore document access');
    const readDocument = requireFunction(getDoc, 'Firestore note loading');
    const reference = createDocumentReference(db, ...await getCoachesOnlyGameNotePath(teamId, gameId, sharedGamePath));
    const snapshot = await readDocument(reference);

    if (!snapshot || typeof snapshot.exists !== 'function' || typeof snapshot.data !== 'function') {
        throw new Error('Coaches-only note response is invalid.');
    }
    if (!snapshot.exists()) {
        return {
            exists: false,
            text: '',
            updatedAt: null,
            updatedBy: null
        };
    }

    const data = snapshot.data();
    if (!data || typeof data !== 'object' || typeof data.text !== 'string') {
        throw new Error('Coaches-only note data is invalid.');
    }

    return {
        exists: true,
        text: normalizeCoachesOnlyGameNoteText(data.text),
        updatedAt: data.updatedAt || null,
        updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null
    };
}

export async function saveCoachesOnlyGameNote({
    db,
    doc,
    setDoc,
    serverTimestamp,
    teamId,
    gameId,
    userId,
    text,
    sharedGamePath = ''
}) {
    const createDocumentReference = requireFunction(doc, 'Firestore document access');
    const writeDocument = requireFunction(setDoc, 'Firestore note saving');
    const createServerTimestamp = requireFunction(serverTimestamp, 'Firestore server timestamp');
    const normalizedUserId = normalizeUserId(userId);
    const normalizedText = normalizeCoachesOnlyGameNoteText(text);
    const reference = createDocumentReference(db, ...await getCoachesOnlyGameNotePath(teamId, gameId, sharedGamePath));
    const payload = {
        text: normalizedText,
        updatedAt: createServerTimestamp(),
        updatedBy: normalizedUserId
    };

    await writeDocument(reference, payload);
    return {
        text: normalizedText,
        updatedBy: normalizedUserId
    };
}
