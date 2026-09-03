import {
    db,
    doc,
    functions,
    getDoc,
    httpsCallable
} from './firebase.js?v=34';

const SAVE_PROFILE_PROJECTION_CALLABLE = 'saveAthleteProfileProjection';
const PROFILE_PROJECTION_SCHEMA_VERSION = 1;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_HASH_PATTERN = /^[a-f0-9]{64}$/;
const PROFILE_FIELDS = Object.freeze([
    'athlete',
    'bio',
    'privacy',
    'clips',
    'gameClips',
    'seasons',
    'careerSummary',
    'profilePhotoUrl',
    'profilePhotoPath',
    'profilePhotoMimeType',
    'profilePhotoSizeBytes',
    'profilePhotoUploadedAtMs'
]);
const AMBIGUOUS_FUNCTION_CODES = new Set([
    'cancelled',
    'deadline-exceeded',
    'internal',
    'unknown',
    'unavailable'
]);

const callSaveProfileProjection = (input) =>
    httpsCallable(functions, SAVE_PROFILE_PROJECTION_CALLABLE)(input);

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function requireIdentifier(value, label) {
    const normalized = cleanString(value);
    if (!normalized || normalized.length > 128 || normalized.includes('/')) {
        throw new TypeError(`${label} is required.`);
    }
    return normalized;
}

function stableJsonValue(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(stableJsonValue);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.keys(value)
            .sort()
            .map((key) => [key, stableJsonValue(value[key])]));
    }
    throw new TypeError('Athlete profile data contains an unsupported value.');
}

function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getAthleteProfileProjectionRequestHash(
    profileId,
    profile,
    cryptoImpl = globalThis.crypto
) {
    const normalizedProfileId = requireIdentifier(profileId, 'Profile ID');
    if (typeof cryptoImpl?.subtle?.digest !== 'function') {
        throw new Error('Secure hashing is unavailable; the athlete profile was not saved.');
    }
    const canonical = JSON.stringify(stableJsonValue({
        profileId: normalizedProfileId,
        profile
    }));
    const bytes = new TextEncoder().encode(
        `athlete-profile-projection-v${PROFILE_PROJECTION_SCHEMA_VERSION}:${canonical}`
    );
    return toHex(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes)));
}

export function createAthleteProfileProjectionMutationId(cryptoImpl = globalThis.crypto) {
    if (typeof cryptoImpl?.randomUUID === 'function') {
        const mutationId = cryptoImpl.randomUUID();
        if (MUTATION_ID_PATTERN.test(mutationId)) return mutationId;
        throw new Error('Secure mutation ID generation failed; the athlete profile was not saved.');
    }
    if (typeof cryptoImpl?.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        cryptoImpl.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = toHex(bytes);
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    throw new Error('Secure randomness is unavailable; the athlete profile was not saved.');
}

function unwrapCallableData(value) {
    const first = value && typeof value === 'object' && !Array.isArray(value) && 'data' in value
        ? value.data
        : value;
    return first && typeof first === 'object' && !Array.isArray(first) && 'data' in first
        ? first.data
        : first;
}

function hasExactProfileProjection(value, expectedProfile) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !expectedProfile || typeof expectedProfile !== 'object' || Array.isArray(expectedProfile)
        || !PROFILE_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field))) {
        return false;
    }
    try {
        const actualProjection = Object.fromEntries(
            PROFILE_FIELDS.map((field) => [field, value[field]])
        );
        return JSON.stringify(stableJsonValue(actualProjection))
            === JSON.stringify(stableJsonValue(expectedProfile));
    } catch {
        return false;
    }
}

export function normalizeAthleteProfileProjectionResponse(
    value,
    { profileId, mutationId, requestHash, profile: expectedProfile }
) {
    const data = unwrapCallableData(value);
    const profile = data?.profile;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)
        || profile.id !== profileId
        || profile.profileProjectionSchemaVersion !== PROFILE_PROJECTION_SCHEMA_VERSION
        || profile.profileProjectionMutationId !== mutationId
        || profile.profileProjectionMutationHash !== requestHash
        || !Array.isArray(profile.gameClips)
        || !Array.isArray(profile.seasons)
        || !hasExactProfileProjection(profile, expectedProfile)) {
        throw new Error('Athlete profile save returned an invalid response.');
    }
    return profile;
}

function getCallableErrorCode(error) {
    return cleanString(error?.code)
        .toLowerCase()
        .replace(/^functions\//, '');
}

function isAmbiguousCallableError(error) {
    const code = getCallableErrorCode(error);
    return !code || AMBIGUOUS_FUNCTION_CODES.has(code);
}

function buildUnknownCommitError(cause) {
    const error = new Error(
        'Could not confirm whether the athlete profile was saved. Refresh it before trying again.'
    );
    error.code = 'athlete-profile-save-unconfirmed';
    error.preserveUploadedMedia = true;
    error.cause = cause;
    return error;
}

export function isAthleteProfileSaveUnconfirmedError(error) {
    return Boolean(error
        && typeof error === 'object'
        && error.code === 'athlete-profile-save-unconfirmed'
        && error.preserveUploadedMedia === true);
}

function normalizeAuthoritativeProfile(snapshot, expected) {
    if (!snapshot?.exists?.()) return null;
    const data = snapshot.data() || {};
    if (data.profileProjectionSchemaVersion !== PROFILE_PROJECTION_SCHEMA_VERSION
        || data.profileProjectionMutationId !== expected.mutationId
        || data.profileProjectionMutationHash !== expected.requestHash
        || !Array.isArray(data.gameClips)
        || !Array.isArray(data.seasons)
        || !hasExactProfileProjection(data, expected.profile)) return null;
    return { id: expected.profileId, ...data };
}

export function createAthleteProfileProjectionService({
    saveCall = callSaveProfileProjection,
    readProfile = async (profileId) => getDoc(doc(db, 'athleteProfiles', profileId)),
    cryptoImpl = globalThis.crypto
} = {}) {
    return Object.freeze({
        async save({ profileId, profile }) {
            const normalizedProfileId = requireIdentifier(profileId, 'Profile ID');
            const mutationId = createAthleteProfileProjectionMutationId(cryptoImpl);
            const exactProfile = stableJsonValue(profile);
            const requestHash = await getAthleteProfileProjectionRequestHash(
                normalizedProfileId,
                exactProfile,
                cryptoImpl
            );
            if (!REQUEST_HASH_PATTERN.test(requestHash)) {
                throw new Error('Secure hashing failed; the athlete profile was not saved.');
            }
            const request = {
                profileId: normalizedProfileId,
                mutationId,
                requestHash,
                profile: exactProfile
            };
            const expected = {
                profileId: normalizedProfileId,
                mutationId,
                requestHash,
                profile: exactProfile
            };
            const execute = async () => normalizeAthleteProfileProjectionResponse(
                await saveCall(request),
                expected
            );

            try {
                return await execute();
            } catch (initialError) {
                if (!isAmbiguousCallableError(initialError)) throw initialError;
                let reconciliationCause = initialError;
                try {
                    // Replay the exact normalized payload with the same secure
                    // mutation ID and hash after a possibly lost response.
                    return await execute();
                } catch (retryError) {
                    reconciliationCause = retryError;
                }
                try {
                    const authoritative = normalizeAuthoritativeProfile(
                        await readProfile(normalizedProfileId),
                        expected
                    );
                    if (authoritative) return authoritative;
                } catch {
                    // An unreadable result is unknown, never proof that the
                    // server write failed or that its uploaded media is orphaned.
                }
                throw buildUnknownCommitError(reconciliationCause);
            }
        }
    });
}

export const athleteProfileProjectionService = createAthleteProfileProjectionService();
