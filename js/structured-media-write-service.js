import { functions, httpsCallable } from './firebase.js?v=34';

const MUTATE_STRUCTURED_MEDIA_CALLABLE = 'mutateStructuredMediaIdentity';
const STRUCTURED_MEDIA_WRITE_HASH_PREFIX = 'structured-media-write-v1:';
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const GENERATED_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_URL_LENGTH = 2_048;
const MAX_TITLE_LENGTH = 240;

const TEAM_FIXED_VIDEO_FIELDS = Object.freeze([
    'streamEmbedUrl',
    'youtubeEmbedUrl',
    'streamUrl',
    'livestreamUrl',
    'youtubeVideoId'
]);
const TEAM_FIXED_VIDEO_URL_FIELDS = Object.freeze(TEAM_FIXED_VIDEO_FIELDS.slice(0, 4));
const TEAM_MEDIA_CREATE_FIELDS = Object.freeze([
    'folderId',
    'title',
    'type',
    'url',
    'src',
    'downloadUrl'
]);
const DRILL_LIBRARY_VIDEO_FIELDS = Object.freeze(['youtubeUrl', 'resourceUrl']);
const AMBIGUOUS_FUNCTION_CODES = new Set([
    'cancelled',
    'deadline-exceeded',
    'internal',
    'unknown',
    'unavailable'
]);

export const STRUCTURED_MEDIA_WRITE_VERSION = 1;

export const STRUCTURED_MEDIA_RESOURCE_KINDS = Object.freeze({
    TEAM_FIXED_VIDEO: 'team-fixed-video',
    TEAM_MEDIA_VIDEO_LINK: 'team-media-video-link',
    DRILL_LIBRARY_VIDEO: 'drill-library-video'
});

export const STRUCTURED_MEDIA_ACTIONS = Object.freeze({
    SET: 'set',
    CREATE: 'create',
    REMOVE: 'remove',
    DELETE: 'delete'
});

const callStructuredMediaMutation = (input) =>
    httpsCallable(functions, MUTATE_STRUCTURED_MEDIA_CALLABLE)(input);

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isPlainObject(value) {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

function requireAllowedFields(value, allowedFields, label) {
    if (!isPlainObject(value)) {
        throw new TypeError(`${label} is invalid.`);
    }
    const unsupported = Object.keys(value).filter((key) => !allowedFields.includes(key));
    if (unsupported.length) {
        throw new TypeError(`${label} contains unsupported fields.`);
    }
}

function requireExactFields(value, expectedFields, label) {
    requireAllowedFields(value, expectedFields, label);
    if (expectedFields.some((key) => !hasOwn(value, key))) {
        throw new TypeError(`${label} contains missing fields.`);
    }
}

function requireIdentifier(value, label) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > 128 || normalized.includes('/')) {
        throw new TypeError(`${label} is invalid.`);
    }
    return normalized;
}

function normalizeNullableUrl(value, label) {
    if (value === null) return null;
    if (typeof value !== 'string') {
        throw new TypeError(`${label} must be a valid http:// or https:// URL.`);
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > MAX_URL_LENGTH) {
        throw new TypeError(`${label} must be a valid http:// or https:// URL.`);
    }
    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new TypeError(`${label} must be a valid http:// or https:// URL.`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new TypeError(`${label} must be a valid http:// or https:// URL.`);
    }
    return normalized;
}

function normalizeNullableYouTubeVideoId(value) {
    if (value === null) return null;
    if (typeof value !== 'string') {
        throw new TypeError('youtubeVideoId is invalid.');
    }
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(normalized) || normalized === 'live_stream') {
        throw new TypeError('youtubeVideoId is invalid.');
    }
    return normalized;
}

function normalizeTitle(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > MAX_TITLE_LENGTH) {
        throw new TypeError('title is invalid.');
    }
    return normalized;
}

function normalizeEmptyPayload(value) {
    requireExactFields(value, [], 'payload');
    return {};
}

function normalizeTeamFixedVideoPayload(value) {
    requireExactFields(value, TEAM_FIXED_VIDEO_FIELDS, 'Team video payload');
    const payload = {};
    TEAM_FIXED_VIDEO_URL_FIELDS.forEach((field) => {
        payload[field] = normalizeNullableUrl(value[field], field);
    });
    payload.youtubeVideoId = normalizeNullableYouTubeVideoId(value.youtubeVideoId);
    if (!Object.values(payload).some(Boolean)) {
        throw new TypeError('Use the remove action to clear team video fields.');
    }
    return payload;
}

function normalizeTeamMediaCreatePayload(value) {
    requireExactFields(value, TEAM_MEDIA_CREATE_FIELDS, 'Team media payload');
    if (value.type !== 'video-link' || value.src !== null || value.downloadUrl !== null) {
        throw new TypeError('Team media payload is not a canonical video link.');
    }
    return {
        folderId: requireIdentifier(value.folderId, 'folderId'),
        title: normalizeTitle(value.title),
        type: 'video-link',
        url: normalizeNullableUrl(value.url, 'url'),
        src: null,
        downloadUrl: null
    };
}

function normalizeDrillVideoPayload(value) {
    requireExactFields(value, DRILL_LIBRARY_VIDEO_FIELDS, 'Drill video payload');
    const payload = {
        youtubeUrl: normalizeNullableUrl(value.youtubeUrl, 'youtubeUrl'),
        resourceUrl: normalizeNullableUrl(value.resourceUrl, 'resourceUrl')
    };
    if (!Object.values(payload).some(Boolean)) {
        throw new TypeError('Use the remove action to clear drill video fields.');
    }
    return payload;
}

function stableJsonValue(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(stableJsonValue);
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.keys(value)
            .sort()
            .map((key) => [key, stableJsonValue(value[key])]));
    }
    throw new TypeError('Structured media data contains an unsupported value.');
}

function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeSemanticInput(input = {}) {
    requireAllowedFields(
        input,
        ['version', 'resourceKind', 'action', 'teamId', 'targetId', 'payload'],
        'Structured media request'
    );
    if (hasOwn(input, 'version') && input.version !== STRUCTURED_MEDIA_WRITE_VERSION) {
        throw new TypeError('Structured media request version is invalid.');
    }
    if (!hasOwn(input, 'payload')) {
        throw new TypeError('Structured media request payload is required.');
    }

    const resourceKind = input.resourceKind;
    const action = input.action;
    const teamId = requireIdentifier(input.teamId, 'teamId');
    let targetId;
    let payload;

    if (resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO) {
        if (![STRUCTURED_MEDIA_ACTIONS.SET, STRUCTURED_MEDIA_ACTIONS.REMOVE].includes(action)) {
            throw new TypeError('Team video action is invalid.');
        }
        if (hasOwn(input, 'targetId')) {
            throw new TypeError('targetId is not supported for team video updates.');
        }
        payload = action === STRUCTURED_MEDIA_ACTIONS.SET
            ? normalizeTeamFixedVideoPayload(input.payload)
            : normalizeEmptyPayload(input.payload);
    } else if (resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK) {
        if (![STRUCTURED_MEDIA_ACTIONS.CREATE, STRUCTURED_MEDIA_ACTIONS.REMOVE].includes(action)) {
            throw new TypeError('Team media action is invalid.');
        }
        if (action === STRUCTURED_MEDIA_ACTIONS.CREATE) {
            if (hasOwn(input, 'targetId')) {
                throw new TypeError('targetId is server-assigned for team media creation.');
            }
            payload = normalizeTeamMediaCreatePayload(input.payload);
            if (!payload.url) {
                throw new TypeError('A team media video URL is required.');
            }
        } else {
            targetId = requireIdentifier(input.targetId, 'targetId');
            payload = normalizeEmptyPayload(input.payload);
        }
    } else if (resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.DRILL_LIBRARY_VIDEO) {
        if (![STRUCTURED_MEDIA_ACTIONS.SET, STRUCTURED_MEDIA_ACTIONS.REMOVE, STRUCTURED_MEDIA_ACTIONS.DELETE]
            .includes(action)) {
            throw new TypeError('Drill video action is invalid.');
        }
        targetId = requireIdentifier(input.targetId, 'targetId');
        payload = action === STRUCTURED_MEDIA_ACTIONS.SET
            ? normalizeDrillVideoPayload(input.payload)
            : normalizeEmptyPayload(input.payload);
    } else {
        throw new TypeError('resourceKind is invalid.');
    }

    return {
        version: STRUCTURED_MEDIA_WRITE_VERSION,
        resourceKind,
        action,
        teamId,
        ...(targetId ? { targetId } : {}),
        payload
    };
}

export function normalizeStructuredMediaMutationInput(input) {
    return normalizeSemanticInput(input);
}

export async function getStructuredMediaWriteRequestHash(
    input,
    cryptoImpl = globalThis.crypto
) {
    const semanticRequest = normalizeSemanticInput(input);
    if (typeof cryptoImpl?.subtle?.digest !== 'function') {
        throw new Error('Secure hashing is unavailable; team media was not changed.');
    }
    const canonical = JSON.stringify(stableJsonValue(semanticRequest));
    const bytes = new TextEncoder().encode(`${STRUCTURED_MEDIA_WRITE_HASH_PREFIX}${canonical}`);
    return toHex(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes)));
}

export function createStructuredMediaMutationId(cryptoImpl = globalThis.crypto) {
    if (typeof cryptoImpl?.randomUUID === 'function') {
        const mutationId = cryptoImpl.randomUUID();
        if (GENERATED_UUID_PATTERN.test(mutationId) && MUTATION_ID_PATTERN.test(mutationId)) {
            return mutationId;
        }
        throw new Error('Secure mutation ID generation failed; team media was not changed.');
    }
    if (typeof cryptoImpl?.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        cryptoImpl.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = toHex(bytes);
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    throw new Error('Secure randomness is unavailable; team media was not changed.');
}

function unwrapCallableData(value) {
    const first = isPlainObject(value) && hasOwn(value, 'data') ? value.data : value;
    return isPlainObject(first) && hasOwn(first, 'data') ? first.data : first;
}

function invalidResponse() {
    return new Error('Structured media update returned an invalid response.');
}

export function normalizeStructuredMediaMutationResponse(value, expectedRequest) {
    const data = unwrapCallableData(value);
    try {
        requireExactFields(data, [
            'version',
            'mutationId',
            'requestHash',
            'resourceKind',
            'action',
            'committed',
            'targetId',
            'resource'
        ], 'Structured media response');
        if (data.version !== STRUCTURED_MEDIA_WRITE_VERSION
            || data.mutationId !== expectedRequest.mutationId
            || data.requestHash !== expectedRequest.requestHash
            || data.resourceKind !== expectedRequest.resourceKind
            || data.action !== expectedRequest.action
            || data.committed !== true) {
            throw invalidResponse();
        }

        const hasRequestedTarget = hasOwn(expectedRequest, 'targetId');
        const isMediaCreate = expectedRequest.resourceKind
            === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK
            && expectedRequest.action === STRUCTURED_MEDIA_ACTIONS.CREATE;
        const expectedTargetId = hasRequestedTarget
            ? expectedRequest.targetId
            : isMediaCreate
                ? requireIdentifier(data.targetId, 'response targetId')
                : null;
        if (data.targetId !== expectedTargetId) throw invalidResponse();

        const removesResource = [STRUCTURED_MEDIA_ACTIONS.REMOVE, STRUCTURED_MEDIA_ACTIONS.DELETE]
            .includes(expectedRequest.action);
        if (removesResource) {
            if (data.resource !== null) throw invalidResponse();
        } else {
            requireExactFields(data.resource, ['id'], 'Structured media resource');
            const expectedResourceId = expectedRequest.resourceKind
                === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO
                ? expectedRequest.teamId
                : expectedTargetId;
            if (data.resource.id !== expectedResourceId) throw invalidResponse();
        }
        return {
            version: STRUCTURED_MEDIA_WRITE_VERSION,
            mutationId: data.mutationId,
            requestHash: data.requestHash,
            resourceKind: data.resourceKind,
            action: data.action,
            committed: true,
            targetId: data.targetId,
            resource: data.resource
        };
    } catch {
        throw invalidResponse();
    }
}

function getCallableErrorCode(error) {
    return typeof error?.code === 'string'
        ? error.code.trim().toLowerCase().replace(/^functions\//, '')
        : '';
}

function isAmbiguousCallableError(error) {
    const code = getCallableErrorCode(error);
    return !code || AMBIGUOUS_FUNCTION_CODES.has(code);
}

function buildUnconfirmedError(cause) {
    const error = new Error(
        'Could not confirm whether team media changed. Refresh it before trying again.'
    );
    error.code = 'structured-media-write-unconfirmed';
    error.preserveExistingMedia = true;
    error.cause = cause;
    return error;
}

export function isStructuredMediaWriteUnconfirmedError(error) {
    return Boolean(error
        && typeof error === 'object'
        && error.code === 'structured-media-write-unconfirmed'
        && error.preserveExistingMedia === true);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

export function createStructuredMediaWriteService({
    callMutation = callStructuredMediaMutation,
    cryptoImpl = globalThis.crypto
} = {}) {
    if (typeof callMutation !== 'function') {
        throw new TypeError('callMutation must be a function.');
    }

    async function mutate(input) {
        const semanticRequest = normalizeSemanticInput(input);
        const mutationId = createStructuredMediaMutationId(cryptoImpl);
        const requestHash = await getStructuredMediaWriteRequestHash(semanticRequest, cryptoImpl);
        if (!REQUEST_HASH_PATTERN.test(requestHash)) {
            throw new Error('Secure hashing failed; team media was not changed.');
        }
        const request = deepFreeze({
            version: STRUCTURED_MEDIA_WRITE_VERSION,
            mutationId,
            requestHash,
            resourceKind: semanticRequest.resourceKind,
            action: semanticRequest.action,
            teamId: semanticRequest.teamId,
            ...(semanticRequest.targetId ? { targetId: semanticRequest.targetId } : {}),
            payload: semanticRequest.payload
        });
        const execute = async () => normalizeStructuredMediaMutationResponse(
            await callMutation(request),
            request
        );

        try {
            return await execute();
        } catch (initialError) {
            if (!isAmbiguousCallableError(initialError)) throw initialError;
            try {
                return await execute();
            } catch (retryError) {
                if (!isAmbiguousCallableError(retryError)) throw retryError;
                throw buildUnconfirmedError(retryError);
            }
        }
    }

    return Object.freeze({
        mutate,
        setTeamFixedVideo(options = {}) {
            requireExactFields(options, ['teamId', ...TEAM_FIXED_VIDEO_FIELDS], 'Team video options');
            return mutate({
                resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
                action: STRUCTURED_MEDIA_ACTIONS.SET,
                teamId: options.teamId,
                payload: Object.fromEntries(TEAM_FIXED_VIDEO_FIELDS.map((field) => [field, options[field]]))
            });
        },
        removeTeamFixedVideo(options = {}) {
            requireAllowedFields(options, ['teamId'], 'Team video options');
            return mutate({
                resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO,
                action: STRUCTURED_MEDIA_ACTIONS.REMOVE,
                teamId: options.teamId,
                payload: {}
            });
        },
        createTeamMediaVideoLink(options = {}) {
            requireAllowedFields(options, ['teamId', 'folderId', 'title', 'url'], 'Team media options');
            return mutate({
                resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK,
                action: STRUCTURED_MEDIA_ACTIONS.CREATE,
                teamId: options.teamId,
                payload: {
                    folderId: options.folderId,
                    title: options.title,
                    type: 'video-link',
                    url: options.url,
                    src: null,
                    downloadUrl: null
                }
            });
        },
        removeTeamMediaVideoLink(options = {}) {
            requireAllowedFields(options, ['teamId', 'targetId'], 'Team media options');
            return mutate({
                resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK,
                action: STRUCTURED_MEDIA_ACTIONS.REMOVE,
                teamId: options.teamId,
                targetId: options.targetId,
                payload: {}
            });
        },
        setDrillLibraryVideo(options = {}) {
            requireExactFields(
                options,
                ['teamId', 'targetId', ...DRILL_LIBRARY_VIDEO_FIELDS],
                'Drill video options'
            );
            return mutate({
                resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.DRILL_LIBRARY_VIDEO,
                action: STRUCTURED_MEDIA_ACTIONS.SET,
                teamId: options.teamId,
                targetId: options.targetId,
                payload: {
                    youtubeUrl: options.youtubeUrl,
                    resourceUrl: options.resourceUrl
                }
            });
        },
        removeDrillLibraryVideo(options = {}) {
            requireAllowedFields(options, ['teamId', 'targetId'], 'Drill video options');
            return mutate({
                resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.DRILL_LIBRARY_VIDEO,
                action: STRUCTURED_MEDIA_ACTIONS.REMOVE,
                teamId: options.teamId,
                targetId: options.targetId,
                payload: {}
            });
        },
        deleteDrillLibraryVideo(options = {}) {
            requireAllowedFields(options, ['teamId', 'targetId'], 'Drill video options');
            return mutate({
                resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.DRILL_LIBRARY_VIDEO,
                action: STRUCTURED_MEDIA_ACTIONS.DELETE,
                teamId: options.teamId,
                targetId: options.targetId,
                payload: {}
            });
        }
    });
}

export const structuredMediaWriteService = createStructuredMediaWriteService();
