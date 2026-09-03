import { functions, httpsCallable } from './firebase.js?v=34';
import {
    getRecordedReplayRevision,
    hasRecordedReplayMarker,
    normalizeYouTubeReplayUrl
} from './game-replay-video.js?v=4';

export { getRecordedReplayRevision, hasRecordedReplayMarker };

const MANAGE_REPLAY_CALLABLE = 'manageGameReplayArchive';
const PLAYBACK_REPLAY_CALLABLE = 'getGameReplayPlayback';
const SAVE_HIGHLIGHT_CLIPS_CALLABLE = 'saveGameHighlightClips';
const REPLAY_MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const AMBIGUOUS_FUNCTION_CODES = new Set([
    'cancelled',
    'data-loss',
    'deadline-exceeded',
    'internal',
    'unknown',
    'unavailable'
]);

const callManageReplayArchive = httpsCallable(functions, MANAGE_REPLAY_CALLABLE);
const callReplayPlayback = httpsCallable(functions, PLAYBACK_REPLAY_CALLABLE);
const callSaveHighlightClips = httpsCallable(functions, SAVE_HIGHLIGHT_CLIPS_CALLABLE);

function toCleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function unwrapCallableData(value) {
    const first = value && typeof value === 'object' && !Array.isArray(value) && 'data' in value
        ? value.data
        : value;
    return first && typeof first === 'object' && !Array.isArray(first) && 'data' in first
        ? first.data
        : first;
}

function requireResourceId(value, label) {
    const normalized = toCleanString(value);
    if (!normalized || normalized.length > 128 || normalized.includes('/')) {
        throw new TypeError(`${label} is required.`);
    }
    return normalized;
}

function normalizeReplayRevision(value) {
    const revision = toCleanString(value);
    return revision && revision.length <= 256 ? revision : null;
}

function normalizeReplayTitle(value) {
    const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return title ? title.slice(0, 120) : null;
}

function normalizeCallableCode(error) {
    return toCleanString(error?.code)
        .toLowerCase()
        .replace(/^functions\//, '');
}

function isAmbiguousCallableError(error) {
    const code = normalizeCallableCode(error);
    return !code || AMBIGUOUS_FUNCTION_CODES.has(code);
}

function normalizeMutationId(value) {
    const mutationId = toCleanString(value);
    if (!REPLAY_MUTATION_ID_PATTERN.test(mutationId)) {
        throw new TypeError('Replay mutation ID is invalid.');
    }
    return mutationId;
}

/**
 * Replay writes must remain idempotent across a lost callable response. A
 * secure, locally reserved token is reused for the original call and every
 * reconciliation retry. There is deliberately no Math.random fallback.
 */
export function createReplayMutationId(cryptoImpl = globalThis.crypto) {
    if (typeof cryptoImpl?.randomUUID === 'function') {
        return normalizeMutationId(cryptoImpl.randomUUID());
    }
    if (typeof cryptoImpl?.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        cryptoImpl.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
        return normalizeMutationId([
            hex.slice(0, 4).join(''),
            hex.slice(4, 6).join(''),
            hex.slice(6, 8).join(''),
            hex.slice(8, 10).join(''),
            hex.slice(10).join('')
        ].join('-'));
    }
    throw new Error('Secure randomness is unavailable; the replay was not changed.');
}

/**
 * Validate capability-bearing replay data returned by a callable. This value
 * is for the current view only and must never be merged into a Firestore game
 * model, IndexedDB cache, sessionStorage, or localStorage.
 */
export function normalizeTransientReplayVideo(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const provider = toCleanString(value.provider).toLowerCase();
    if (provider && provider !== 'youtube') return null;

    const candidates = [
        toCleanString(value.videoId) ? `https://youtu.be/${toCleanString(value.videoId)}` : '',
        toCleanString(value.publicUrl),
        toCleanString(value.embedUrl),
        toCleanString(value.youtubeUrl)
    ]
        .filter(Boolean)
        .map(normalizeYouTubeReplayUrl);
    if (!candidates.length || candidates.some((candidate) => !candidate)) return null;
    if (new Set(candidates.map((candidate) => candidate.videoId)).size !== 1) return null;

    return {
        ...candidates[0],
        title: normalizeReplayTitle(value.title)
    };
}

export function normalizeReplayManagementResponse(value) {
    const data = unwrapCallableData(value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Replay management returned an invalid response.');
    }

    const state = toCleanString(data.state).toLowerCase();
    if (!['ready', 'removed', 'none'].includes(state)) {
        throw new Error('Replay management returned an invalid state.');
    }
    const hasReplayVideoPayload = data.replayVideo !== null && data.replayVideo !== undefined;
    const replayVideo = normalizeTransientReplayVideo(data.replayVideo);
    const hasRecordedReplay = data.hasRecordedReplay === true;
    const replayArchiveRevision = normalizeReplayRevision(data.replayArchiveRevision);
    if (state === 'ready') {
        if (!hasRecordedReplay || !replayArchiveRevision || !replayVideo) {
            throw new Error('Replay management did not return a complete ready replay.');
        }
    } else if (hasRecordedReplay || hasReplayVideoPayload) {
        throw new Error('Replay management returned replay data for a non-ready state.');
    }

    return {
        state,
        hasRecordedReplay,
        replayArchiveRevision,
        replayVideo: state === 'ready' ? replayVideo : null,
        lastMutationId: REPLAY_MUTATION_ID_PATTERN.test(toCleanString(data.lastMutationId))
            ? toCleanString(data.lastMutationId)
            : null
    };
}

export function normalizeReplayPlaybackResponse(value) {
    const data = unwrapCallableData(value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Replay playback returned an invalid response.');
    }

    const hasReplayVideoPayload = data.replayVideo !== null && data.replayVideo !== undefined;
    const replayVideo = normalizeTransientReplayVideo(data.replayVideo);
    const available = data.available === true;
    const hasRecordedReplay = data.hasRecordedReplay === true;
    const replayArchiveRevision = normalizeReplayRevision(data.replayArchiveRevision);
    if (available && (!hasRecordedReplay || !replayArchiveRevision || !replayVideo)) {
        throw new Error('Replay playback did not return a complete available replay.');
    }
    if (!available && hasReplayVideoPayload) {
        throw new Error('Replay playback returned a capability while unavailable.');
    }
    if (hasRecordedReplay && !replayArchiveRevision) {
        throw new Error('Replay playback returned an unversioned replay marker.');
    }

    const reason = toCleanString(data.reason).toLowerCase();
    return {
        available,
        hasRecordedReplay,
        replayArchiveRevision,
        replayVideo: available ? replayVideo : null,
        reason: reason && reason.length <= 80 ? reason : null
    };
}

export function normalizeHighlightClipsResponse(value) {
    const data = unwrapCallableData(value);
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || !Array.isArray(data.highlightClips)
        || data.highlightClips.length > 24) {
        throw new Error('Highlight save returned an invalid response.');
    }
    const highlightClipsRevision = normalizeReplayRevision(data.highlightClipsRevision);
    const lastMutationId = toCleanString(data.lastMutationId);
    if (!highlightClipsRevision || !REPLAY_MUTATION_ID_PATTERN.test(lastMutationId)) {
        throw new Error('Highlight save returned an unversioned response.');
    }
    return {
        highlightClips: data.highlightClips,
        highlightClipsRevision,
        lastMutationId
    };
}

function isDesiredReplayState(result, { action, normalizedReplay, expectedRevision, mutationId }) {
    if (result.lastMutationId !== mutationId || result.replayArchiveRevision === expectedRevision) {
        return false;
    }
    const hasDesiredState = action === 'remove'
        ? result.state === 'removed' && result.hasRecordedReplay === false && result.replayVideo === null
        : result.state === 'ready'
        && result.hasRecordedReplay === true
        && result.replayVideo?.videoId === normalizedReplay?.videoId
        && (result.replayVideo?.title || '') === (normalizedReplay?.title || '');
    return hasDesiredState;
}

function buildUnknownCommitError(action, cause) {
    const error = new Error(
        action === 'remove'
            ? 'Could not confirm whether the replay was removed. Refresh and check before trying again.'
            : 'Could not confirm whether the replay was saved. Refresh and check before trying again.'
    );
    error.code = 'replay-commit-unknown';
    error.cause = cause;
    return error;
}

function buildHighlightUnknownCommitError(cause) {
    const error = new Error(
        'Could not confirm whether the highlights were saved. Refresh before trying again.'
    );
    error.code = 'highlight-clips-commit-unknown';
    error.cause = cause;
    return error;
}

export function createGameReplayService({
    manageCall = callManageReplayArchive,
    playbackCall = callReplayPlayback,
    highlightCall = callSaveHighlightClips,
    cryptoImpl = globalThis.crypto
} = {}) {
    async function readManagement({ teamId, gameId }) {
        const result = await manageCall({
            action: 'read',
            teamId: requireResourceId(teamId, 'Team ID'),
            gameId: requireResourceId(gameId, 'Game ID')
        });
        return normalizeReplayManagementResponse(result);
    }

    async function mutate({ action, teamId, gameId, expectedRevision = null, youtubeUrl = null, title = null }) {
        const safeTeamId = requireResourceId(teamId, 'Team ID');
        const safeGameId = requireResourceId(gameId, 'Game ID');
        const safeExpectedRevision = normalizeReplayRevision(expectedRevision);
        const mutationId = createReplayMutationId(cryptoImpl);
        let normalizedReplay = null;
        if (action === 'set') {
            normalizedReplay = normalizeYouTubeReplayUrl(youtubeUrl);
            if (!normalizedReplay) throw new TypeError('Paste a valid YouTube video link.');
            normalizedReplay.title = normalizeReplayTitle(title);
        }

        const request = {
            action,
            teamId: safeTeamId,
            gameId: safeGameId,
            expectedRevision: safeExpectedRevision,
            mutationId,
            ...(action === 'set' ? {
                youtubeUrl: normalizedReplay.publicUrl,
                ...(normalizedReplay.title ? { title: normalizedReplay.title } : {})
            } : {})
        };

        try {
            return normalizeReplayManagementResponse(await manageCall(request));
        } catch (initialError) {
            if (!isAmbiguousCallableError(initialError)) throw initialError;
            try {
                // Reuse the exact provider-independent mutation request so the
                // server can replay a committed result without a second write.
                return normalizeReplayManagementResponse(await manageCall(request));
            } catch (retryError) {
                try {
                    const authoritative = await readManagement({ teamId: safeTeamId, gameId: safeGameId });
                    if (isDesiredReplayState(authoritative, {
                        action,
                        normalizedReplay,
                        expectedRevision: safeExpectedRevision,
                        mutationId
                    })) {
                        return { ...authoritative, reconciled: true };
                    }
                } catch {
                    // The caller must treat an unreadable authoritative state as
                    // unknown, never as proof that the mutation did not commit.
                }
                throw buildUnknownCommitError(action, retryError);
            }
        }
    }

    return Object.freeze({
        readManagement,
        setReplay(options) {
            return mutate({ ...options, action: 'set' });
        },
        removeReplay(options) {
            return mutate({ ...options, action: 'remove' });
        },
        async saveHighlightClips({ teamId, gameId, expectedRevision = null, highlightClips = [] }) {
            const request = {
                teamId: requireResourceId(teamId, 'Team ID'),
                gameId: requireResourceId(gameId, 'Game ID'),
                expectedRevision: normalizeReplayRevision(expectedRevision),
                mutationId: createReplayMutationId(cryptoImpl),
                highlightClips
            };
            try {
                return normalizeHighlightClipsResponse(await highlightCall(request));
            } catch (initialError) {
                if (!isAmbiguousCallableError(initialError)) throw initialError;
                try {
                    return normalizeHighlightClipsResponse(await highlightCall(request));
                } catch (retryError) {
                    throw buildHighlightUnknownCommitError(retryError);
                }
            }
        },
        async getPlayback({ teamId, gameId, seasonId = null }) {
            const result = await playbackCall({
                teamId: requireResourceId(teamId, 'Team ID'),
                gameId: requireResourceId(gameId, 'Game ID'),
                ...(toCleanString(seasonId) ? {
                    seasonId: requireResourceId(seasonId, 'Season ID')
                } : {})
            });
            return normalizeReplayPlaybackResponse(result);
        }
    });
}

export const gameReplayService = createGameReplayService();
