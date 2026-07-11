import { normalizeYouTubeEmbedUrl } from './live-stream-utils.js';
import { getChatMediaDownloadName, isSafeChatMediaUrl } from './team-chat-media.js';

export const MAX_HIGHLIGHT_CLIP_MS = 60_000;
export const BROADCAST_SETUP_STATUSES = Object.freeze({
    CHECKING: 'checking_permissions',
    READY: 'ready_for_managed_stream',
    FAILED: 'permission_failed'
});

export const BROADCAST_STREAM_STATUSES = Object.freeze({
    SETUP_REQUIRED: 'setup_required',
    READY: 'ready',
    STARTING: 'starting',
    LIVE: 'live',
    FAILED: 'failed'
});

export const BROADCAST_PROVIDER_TYPES = Object.freeze({
    TWITCH: 'twitch',
    YOUTUBE: 'youtube',
    EXTERNAL: 'external_provider',
    MANAGED_SETUP: 'managed_setup'
});

function toFiniteNumber(value) {
    const num = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(num) ? num : null;
}

function firstSafeString(values) {
    return values.find(value => typeof value === 'string' && value.trim()) || null;
}

function getClipVideoUrl(clip) {
    if (!clip || typeof clip !== 'object') return null;
    const video = clip.video && typeof clip.video === 'object' ? clip.video : {};
    return firstSafeString([
        clip.videoUrl,
        clip.url,
        clip.publicUrl,
        clip.sourceUrl,
        clip.downloadUrl,
        clip.src,
        clip.mediaUrl,
        video.url,
        video.publicUrl,
        video.sourceUrl
    ]);
}

function toCleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function compactObject(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ''));
}

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

function getClipVisibility(clip = {}) {
    return toCleanString(clip.visibility || clip.status).toLowerCase();
}

function isHiddenGameClip(clip = {}) {
    const visibility = getClipVisibility(clip);
    return clip.hidden === true || clip.deleted === true || clip.isHidden === true || clip.isDeleted === true || visibility === 'hidden' || visibility === 'deleted';
}

function getClipUrl(clip = {}) {
    return getClipVideoUrl(clip);
}

function getPlayerLabel(player = {}) {
    const number = toCleanString(player.number || player.jerseyNumber);
    const name = toCleanString(player.name || player.displayName || player.playerName);
    return [number ? `#${number}` : '', name].filter(Boolean).join(' ') || toCleanString(player.id || player.playerId);
}

function normalizeAssociatedPlayers(value) {
    const rawPlayers = Array.isArray(value) ? value : value ? [value] : [];
    return rawPlayers
        .map((player) => {
            if (typeof player === 'string') {
                return { id: player, name: player };
            }
            if (!player || typeof player !== 'object') return null;
            const name = firstSafeString([player.name, player.displayName, player.fullName, player.label]);
            const id = firstSafeString([player.id, player.playerId, player.uid]);
            const number = firstSafeString([player.number, player.jerseyNumber]);
            if (!name && !id && !number) return null;
            return { id, name, number };
        })
        .filter(Boolean);
}

function normalizeClipPlayers(rawPlayers = [], playersById = new Map()) {
    return toArray(rawPlayers)
        .map((entry) => {
            if (typeof entry === 'string') {
                const player = playersById.get(entry);
                return player ? getPlayerLabel(player) : entry;
            }
            const id = toCleanString(entry?.id || entry?.playerId);
            const player = id ? playersById.get(id) : null;
            return getPlayerLabel(player || entry);
        })
        .filter(Boolean);
}

function getGameClipCollections(game = {}) {
    return [
        ...toArray(game.clipRecords),
        ...toArray(game.gameClips),
        ...toArray(game.videoClips),
        ...toArray(game.clips),
        ...toArray(game.mediaClips)
    ];
}

function getClipSortMs(clip = {}) {
    const raw = clip.createdAt || clip.uploadedAt || clip.timestamp || clip.startMs || 0;
    if (typeof raw === 'number') return raw;
    if (raw?.toMillis) return raw.toMillis();
    if (raw?.toDate) return raw.toDate().getTime();
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStringSet(values) {
    if (!Array.isArray(values)) return new Set();
    return new Set(values
        .filter(value => typeof value === 'string')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean));
}

function normalizeUidSet(values) {
    if (!Array.isArray(values)) return new Set();
    return new Set(values
        .filter(value => typeof value === 'string')
        .map(value => value.trim())
        .filter(Boolean));
}

function hasSelectedVideographerGrant(user, team) {
    const videography = team?.teamPermissions?.videography || {};
    if (videography.mode && videography.mode !== 'selected') return false;
    return Boolean(user?.uid && normalizeUidSet(videography.memberIds).has(user.uid));
}

function isGameCameraEligible(game) {
    if (!game || typeof game !== 'object') return false;
    const status = String(game.status || game.liveStatus || '').toLowerCase();
    return !['cancelled', 'canceled', 'completed', 'final'].includes(status);
}

export function canAccessNativeCameraCapture({ user, team, game }) {
    if (!user || !team || !isGameCameraEligible(game)) return false;

    if (user.isAdmin) return true;
    if (team.ownerId && user.uid === team.ownerId) return true;

    const userEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    const adminEmails = normalizeStringSet(team.adminEmails);
    if (userEmail && adminEmails.has(userEmail)) return true;
    if (hasSelectedVideographerGrant(user, team)) return true;

    const approvedUidFields = [
        team.mediaContributorUids,
        team.gameMediaContributorUids,
        team.approvedMediaContributorUids,
        game.mediaContributorUids,
        game.gameMediaContributorUids,
        game.approvedMediaContributorUids,
        game.nativeCameraContributorUids
    ];
    if (user.uid && approvedUidFields.some(values => normalizeUidSet(values).has(user.uid))) {
        return true;
    }

    const approvedEmailFields = [
        team.mediaContributorEmails,
        team.gameMediaContributorEmails,
        team.approvedMediaContributorEmails,
        game.mediaContributorEmails,
        game.gameMediaContributorEmails,
        game.approvedMediaContributorEmails,
        game.nativeCameraContributorEmails
    ];
    return Boolean(userEmail && approvedEmailFields.some(values => normalizeStringSet(values).has(userEmail)));
}

export function canSaveBroadcastSetupSession({ user, team, game }) {
    if (!user || !team || !isGameCameraEligible(game)) return false;

    if (user.isAdmin) return true;
    if (team.ownerId && user.uid === team.ownerId) return true;

    const userEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    if (userEmail && normalizeStringSet(team.adminEmails).has(userEmail)) return true;

    return hasSelectedVideographerGrant(user, team);
}

export function resolveBroadcastStreamControlState({
    status = BROADCAST_STREAM_STATUSES.SETUP_REQUIRED,
    cameraReady = false,
    microphoneReady = false
} = {}) {
    const safeStatus = Object.values(BROADCAST_STREAM_STATUSES).includes(status)
        ? status
        : BROADCAST_STREAM_STATUSES.SETUP_REQUIRED;
    const mediaReady = cameraReady === true && microphoneReady === true;
    const requiresReadyMedia = [
        BROADCAST_STREAM_STATUSES.READY,
        BROADCAST_STREAM_STATUSES.STARTING,
        BROADCAST_STREAM_STATUSES.LIVE
    ].includes(safeStatus);
    const resolvedStatus = requiresReadyMedia && !mediaReady
        ? BROADCAST_STREAM_STATUSES.FAILED
        : safeStatus;
    const labels = {
        [BROADCAST_STREAM_STATUSES.SETUP_REQUIRED]: 'Setup required',
        [BROADCAST_STREAM_STATUSES.READY]: 'Ready to stream',
        [BROADCAST_STREAM_STATUSES.STARTING]: 'Starting...',
        [BROADCAST_STREAM_STATUSES.LIVE]: 'Live',
        [BROADCAST_STREAM_STATUSES.FAILED]: 'Start failed'
    };

    return {
        status: resolvedStatus,
        label: labels[resolvedStatus],
        mediaReady,
        showBegin: mediaReady && resolvedStatus === BROADCAST_STREAM_STATUSES.READY,
        beginDisabled: !mediaReady || resolvedStatus !== BROADCAST_STREAM_STATUSES.READY,
        showRetry: resolvedStatus === BROADCAST_STREAM_STATUSES.FAILED,
        isLive: resolvedStatus === BROADCAST_STREAM_STATUSES.LIVE
    };
}

export function resolveBroadcastProviderMetadata(team = {}) {
    if (toCleanString(team.twitchChannel)) {
        return {
            type: BROADCAST_PROVIDER_TYPES.TWITCH,
            name: 'Twitch',
            channel: toCleanString(team.twitchChannel)
        };
    }

    const youtubeUrl = firstSafeString([team.streamEmbedUrl, team.youtubeEmbedUrl]);
    if (youtubeUrl || toCleanString(team.youtubeVideoId)) {
        return compactObject({
            type: BROADCAST_PROVIDER_TYPES.YOUTUBE,
            name: 'YouTube',
            embedUrl: youtubeUrl,
            videoId: toCleanString(team.youtubeVideoId)
        });
    }

    return {
        type: BROADCAST_PROVIDER_TYPES.MANAGED_SETUP,
        name: 'ALL PLAYS managed setup'
    };
}

export function buildBroadcastSetupSession({ existingSession = {}, sessionName = '', user = {}, permissions = {}, status = BROADCAST_SETUP_STATUSES.CHECKING, errorMessage = '', provider = null, now = new Date() } = {}) {
    const timestamp = now instanceof Date ? now.toISOString() : String(now || new Date().toISOString());
    const safeName = toCleanString(sessionName) || toCleanString(existingSession.name) || 'Game broadcast setup';
    const safeStatus = Object.values(BROADCAST_SETUP_STATUSES).includes(status) ? status : BROADCAST_SETUP_STATUSES.CHECKING;
    const providerMetadata = provider && typeof provider === 'object' ? provider : existingSession?.provider;
    const session = {
        ...(existingSession && typeof existingSession === 'object' ? existingSession : {}),
        id: toCleanString(existingSession?.id) || `broadcast-${Date.parse(timestamp) || Date.now()}`,
        name: safeName.slice(0, 80),
        status: safeStatus,
        streamStatus: safeStatus,
        setupOnly: true,
        managedStreamReady: safeStatus === BROADCAST_SETUP_STATUSES.READY,
        provider: compactObject({
            type: toCleanString(providerMetadata?.type) || BROADCAST_PROVIDER_TYPES.MANAGED_SETUP,
            name: toCleanString(providerMetadata?.name) || 'ALL PLAYS managed setup',
            channel: toCleanString(providerMetadata?.channel),
            embedUrl: toCleanString(providerMetadata?.embedUrl),
            videoId: toCleanString(providerMetadata?.videoId)
        }),
        setupMetadata: {
            setupOnly: true,
            managedStreamReady: safeStatus === BROADCAST_SETUP_STATUSES.READY,
            cameraVerified: permissions.camera === true,
            microphoneVerified: permissions.microphone === true
        },
        permissions: {
            camera: permissions.camera === true,
            microphone: permissions.microphone === true
        },
        updatedAt: timestamp,
        updatedBy: user?.uid || existingSession?.updatedBy || null,
        updatedByEmail: toCleanString(user?.email || existingSession?.updatedByEmail) || null
    };

    if (!session.createdAt) session.createdAt = timestamp;
    if (safeStatus === BROADCAST_SETUP_STATUSES.CHECKING && !session.startedAt) session.startedAt = timestamp;
    if (safeStatus === BROADCAST_SETUP_STATUSES.READY) session.readyAt = timestamp;
    if (safeStatus === BROADCAST_SETUP_STATUSES.FAILED) session.failedAt = timestamp;
    if (errorMessage) {
        session.errorMessage = String(errorMessage).slice(0, 180);
    } else {
        delete session.errorMessage;
    }

    return session;
}

export function buildStreamScoreContext(game = {}) {
    const session = game?.broadcastSession && typeof game.broadcastSession === 'object' ? game.broadcastSession : null;
    if (!session) return null;
    const homeScore = Number.isFinite(game.homeScore) ? game.homeScore : Number(game.homeScore) || 0;
    const awayScore = Number.isFinite(game.awayScore) ? game.awayScore : Number(game.awayScore) || 0;
    return {
        sessionId: session.id || null,
        streamStatus: session.streamStatus || session.status || '',
        providerName: session.provider?.name || '',
        score: { home: homeScore, away: awayScore },
        scoreUpdatedAt: game.scoreUpdatedAt || game.scoreLastUpdatedAt || null,
        sessionUpdatedAt: session.updatedAt || null
    };
}

function isSafeVideoUrl(value) {
    if (!value) return false;
    try {
        const url = new URL(value, 'https://allplays.local');
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function getRecordedReplayConfig(game) {
    if (!game || typeof game !== 'object') return null;

    const replayVideo = game.replayVideo && typeof game.replayVideo === 'object' ? game.replayVideo : {};
    const recordedVideo = game.recordedVideo && typeof game.recordedVideo === 'object' ? game.recordedVideo : {};
    const videoReplay = game.videoReplay && typeof game.videoReplay === 'object' ? game.videoReplay : {};

    const sourceUrl = firstSafeString([
        replayVideo.url,
        replayVideo.src,
        recordedVideo.url,
        recordedVideo.src,
        videoReplay.url,
        videoReplay.src,
        game.replayVideoUrl,
        game.recordedVideoUrl,
        game.videoReplayUrl,
        game.archivedVideoUrl
    ]);

    if (!sourceUrl) return null;

    return {
        sourceUrl,
        publicUrl: firstSafeString([
            replayVideo.publicUrl,
            recordedVideo.publicUrl,
            videoReplay.publicUrl,
            game.replayVideoPublicUrl
        ]),
        posterUrl: firstSafeString([
            replayVideo.posterUrl,
            recordedVideo.posterUrl,
            videoReplay.posterUrl,
            game.replayVideoPosterUrl
        ]),
        title: firstSafeString([
            replayVideo.title,
            recordedVideo.title,
            videoReplay.title,
            game.replayVideoTitle
        ]),
        durationMs: toFiniteNumber(
            replayVideo.durationMs ??
            recordedVideo.durationMs ??
            videoReplay.durationMs ??
            game.replayVideoDurationMs
        )
    };
}

function normalizeReplayStatus(value) {
    const status = toCleanString(value).toLowerCase().replace(/[_\s-]+/g, '-');
    if (['processing', 'pending', 'queued', 'recording', 'transcoding', 'encoding'].includes(status)) return 'processing';
    if (['failed', 'error', 'errored', 'unavailable', 'rejected'].includes(status)) return 'failed';
    if (['ready', 'available', 'complete', 'completed', 'published'].includes(status)) return 'ready';
    return '';
}

function getReplayAvailabilityState(game = {}, { hasReplay = false, isReplay = false, isCompletedGame = false } = {}) {
    const replayVideo = game.replayVideo && typeof game.replayVideo === 'object' ? game.replayVideo : {};
    const recordedVideo = game.recordedVideo && typeof game.recordedVideo === 'object' ? game.recordedVideo : {};
    const videoReplay = game.videoReplay && typeof game.videoReplay === 'object' ? game.videoReplay : {};
    const status = normalizeReplayStatus(firstSafeString([
        game.replayStatus,
        game.recordedReplayStatus,
        game.videoReplayStatus,
        replayVideo.status,
        replayVideo.processingStatus,
        recordedVideo.status,
        recordedVideo.processingStatus,
        videoReplay.status,
        videoReplay.processingStatus
    ]));

    if (status === 'processing') {
        return {
            status,
            title: 'Replay is processing',
            message: 'The full-game replay is being prepared. Coaches, parents, and fans can watch it here when processing finishes.'
        };
    }

    if (status === 'failed') {
        return {
            status,
            title: 'Replay unavailable',
            message: 'The full-game replay could not be prepared for this game. Coaches, parents, and fans can still follow the saved plays and clips.'
        };
    }

    if (hasReplay) return null;
    if (!isReplay && !isCompletedGame) return null;

    return {
        status: 'unavailable',
        title: 'Replay unavailable',
        message: 'No full-game replay is available for this game yet. Coaches, parents, and fans can still follow the saved plays and clips.'
    };
}

function getLiveEmbedConfig(team) {
    const parentHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    if (team?.twitchChannel) {
        return {
            embedUrl: `https://player.twitch.tv/?channel=${team.twitchChannel}&parent=${parentHost}&autoplay=true&muted=true`,
            publicUrl: `https://twitch.tv/${team.twitchChannel}`,
            publicLabel: 'Watch on Twitch ↗'
        };
    }

    const sourceUrl = firstSafeString([
        team?.streamEmbedUrl,
        team?.youtubeEmbedUrl,
        team?.youtubeVideoId ? `https://www.youtube.com/embed/${team.youtubeVideoId}?autoplay=1&mute=1` : null
    ]);
    if (!sourceUrl) return null;

    const embedUrl = normalizeYouTubeEmbedUrl(sourceUrl) || sourceUrl;
    const channelMatch = embedUrl.match(/channel=(UC[a-zA-Z0-9_-]{22})/);
    const videoMatch = embedUrl.match(/\/embed\/([a-zA-Z0-9_-]{11})/);

    return {
        embedUrl,
        publicUrl: channelMatch
            ? `https://www.youtube.com/channel/${channelMatch[1]}`
            : videoMatch ? `https://www.youtube.com/watch?v=${videoMatch[1]}` : null,
        publicLabel: 'Watch on YouTube ↗'
    };
}

function normalizeTaggedPlayerIds(taggedPlayerIds) {
    if (!Array.isArray(taggedPlayerIds)) return [];

    return [...new Set(
        taggedPlayerIds
            .map(id => typeof id === 'string' ? id.trim() : '')
            .filter(Boolean)
    )];
}

export function createHighlightClipDraft({ startMs, endMs, durationMs = null, title = '', taggedPlayerIds = [] }, options = {}) {
    const maxDurationMs = toFiniteNumber(options.maxDurationMs) || MAX_HIGHLIGHT_CLIP_MS;
    const safeDurationMs = toFiniteNumber(durationMs);
    const safeStartMs = Math.max(0, toFiniteNumber(startMs) || 0);

    let safeEndMs = toFiniteNumber(endMs);
    if (!Number.isFinite(safeEndMs)) {
        safeEndMs = safeStartMs + maxDurationMs;
    }
    if (Number.isFinite(safeDurationMs)) {
        safeEndMs = Math.min(safeEndMs, safeDurationMs);
    }
    safeEndMs = Math.min(safeEndMs, safeStartMs + maxDurationMs);

    if (!Number.isFinite(safeEndMs) || safeEndMs <= safeStartMs) {
        return null;
    }

    const normalized = {
        title: typeof title === 'string' ? title.trim() : '',
        startMs: safeStartMs,
        endMs: safeEndMs
    };
    const safeTaggedPlayerIds = normalizeTaggedPlayerIds(taggedPlayerIds);
    if (safeTaggedPlayerIds.length) {
        normalized.taggedPlayerIds = safeTaggedPlayerIds;
    }

    return normalized;
}

export function collectRawHighlightClips(game) {
    const rawClips = [];

    if (Array.isArray(game?.highlightClips)) {
        rawClips.push(...game.highlightClips);
    }
    if (Array.isArray(game?.clipMetadata)) {
        rawClips.push(...game.clipMetadata);
    }
    if (Array.isArray(game?.clips)) {
        rawClips.push(...game.clips);
    }
    if (Array.isArray(game?.replayVideo?.highlights)) {
        rawClips.push(...game.replayVideo.highlights);
    }
    if (Array.isArray(game?.replayHighlights)) {
        rawClips.push(...game.replayHighlights);
    }

    return rawClips;
}

export function normalizeSavedHighlightClips(game, options = {}) {
    const durationMs = toFiniteNumber(options.durationMs);

    return collectRawHighlightClips(game)
        .map((clip, index) => {
            const mediaUrl = firstSafeString([clip?.mediaUrl, clip?.url, clip?.sourceUrl]);
            if (clip?.type === 'score-linked' && isSafeVideoUrl(mediaUrl)) {
                return {
                    id: clip.id || null,
                    type: 'score-linked',
                    source: clip.source || 'external',
                    title: firstSafeString([clip.title, clip.caption, `Scored play clip ${index + 1}`]) || `Scored play clip ${index + 1}`,
                    caption: clip.caption || '',
                    mediaUrl,
                    url: mediaUrl,
                    playEventId: clip.playEventId || null,
                    selectedPlayerIds: Array.isArray(clip.selectedPlayerIds) ? clip.selectedPlayerIds : [],
                    scoreContext: clip.scoreContext || null,
                    mediaType: clip.mediaType || 'video',
                    mimeType: clip.mimeType || null,
                    sizeBytes: toFiniteNumber(clip.sizeBytes),
                    storagePath: clip.storagePath || ''
                };
            }
            const normalized = createHighlightClipDraft({
                startMs: clip?.startMs,
                endMs: clip?.endMs,
                durationMs,
                title: clip?.title || clip?.playDescription || clip?.description || `Highlight ${index + 1}`,
                taggedPlayerIds: clip?.taggedPlayerIds || clip?.selectedPlayerIds || clip?.playerIds
            }, options);
            if (!normalized) return null;
            return {
                ...normalized,
                durationMs: normalized.endMs - normalized.startMs,
                description: firstSafeString([clip?.playDescription, clip?.description, clip?.text, clip?.message]) || normalized.title,
                period: firstSafeString([clip?.period, clip?.inning, clip?.quarter, clip?.half]),
                gameTime: firstSafeString([clip?.gameTime, clip?.clock, clip?.time]),
                scoreContext: clip?.scoreContext || null,
                playEventId: clip?.playEventId || clip?.eventId || null,
                players: normalizeAssociatedPlayers(clip?.players || clip?.associatedPlayers || clip?.playerIds || clip?.playerId),
                videoUrl: getClipVideoUrl(clip),
                order: toFiniteNumber(clip?.order ?? clip?.sortOrder ?? clip?.sequence ?? clip?.rank) ?? index
            };
        })
        .filter(Boolean)
        .sort((a, b) => (a.order - b.order) || (a.startMs - b.startMs));
}

export function normalizeGameRecapHighlightClips(game, options = {}) {
    const durationMs = toFiniteNumber(options.durationMs);
    const recorded = getRecordedReplayConfig(game);
    const replayUrl = recorded?.publicUrl || recorded?.sourceUrl || null;

    return collectRawHighlightClips(game)
        .map((clip, index) => {
            const videoUrl = getClipVideoUrl(clip) || replayUrl;
            const rawStartMs = toFiniteNumber(clip?.startMs ?? clip?.clipStartMs);
            const rawEndMs = toFiniteNumber(clip?.endMs ?? clip?.clipEndMs);
            const normalized = Number.isFinite(rawStartMs) ? createHighlightClipDraft({
                startMs: rawStartMs,
                endMs: rawEndMs,
                durationMs: durationMs ?? recorded?.durationMs,
                title: clip?.title || clip?.playDescription || clip?.description || `Highlight ${index + 1}`
            }, options) : null;
            if (!normalized && !videoUrl) return null;
            const startMs = normalized?.startMs ?? rawStartMs;
            const endMs = normalized?.endMs ?? rawEndMs;
            return {
                title: normalized?.title || firstSafeString([clip?.title, clip?.playDescription, clip?.description]) || `Highlight ${index + 1}`,
                description: firstSafeString([clip?.playDescription, clip?.description, clip?.text, clip?.message]) || normalized?.title || `Highlight ${index + 1}`,
                startMs: Number.isFinite(startMs) ? startMs : null,
                endMs: Number.isFinite(endMs) ? endMs : null,
                period: firstSafeString([clip?.period, clip?.inning, clip?.quarter, clip?.half]),
                gameTime: firstSafeString([clip?.gameTime, clip?.clock, clip?.time]),
                players: normalizeAssociatedPlayers(clip?.players || clip?.associatedPlayers || clip?.playerIds || clip?.playerId),
                videoUrl,
                order: toFiniteNumber(clip?.order ?? clip?.sortOrder ?? clip?.sequence ?? clip?.rank) ?? index
            };
        })
        .filter(Boolean)
        .sort((a, b) => (a.order - b.order) || ((a.startMs ?? 0) - (b.startMs ?? 0)));
}

export function resolveGameMediaHub({ team, game, durationMs = null } = {}) {
    const recorded = getRecordedReplayConfig(game);
    const liveEmbed = getLiveEmbedConfig(team);
    const highlightDurationMs = toFiniteNumber(durationMs) ?? recorded?.durationMs ?? null;

    return {
        liveStream: liveEmbed?.embedUrl ? {
            sourceUrl: liveEmbed.embedUrl,
            publicUrl: liveEmbed.publicUrl,
            publicLabel: liveEmbed.publicLabel || 'Open live stream ↗'
        } : null,
        replay: recorded?.sourceUrl ? {
            sourceUrl: recorded.sourceUrl,
            publicUrl: recorded.publicUrl || recorded.sourceUrl,
            publicLabel: recorded.publicUrl ? 'Open replay video ↗' : 'Open replay video',
            title: recorded.title,
            durationMs: recorded.durationMs
        } : null,
        highlights: normalizeSavedHighlightClips(game, { durationMs: highlightDurationMs })
    };
}

export function normalizeGameClipRecords(game, { players = [], includeHidden = false } = {}) {
    const playersById = new Map(toArray(players).map((player) => [player.id, player]));

    return getGameClipCollections(game)
        .filter((clip) => clip && typeof clip === 'object')
        .filter((clip) => includeHidden || !isHiddenGameClip(clip))
        .map((clip, index) => {
            const url = getClipUrl(clip);
            if (!isSafeChatMediaUrl(url)) return null;
            const title = firstSafeString([
                clip.title,
                clip.name,
                clip.label,
                `Clip ${index + 1}`
            ]);
            const players = normalizeClipPlayers(
                clip.relatedPlayers || clip.players || clip.playerIds || clip.relatedPlayerIds || [],
                playersById
            );
            const mediaEntry = {
                type: 'video',
                url,
                name: clip.name || clip.title || `game-clip-${index + 1}.mp4`,
                mimeType: clip.mimeType || clip.type || 'video/mp4',
                createdAt: clip.createdAt || clip.uploadedAt || null
            };

            return {
                id: toCleanString(clip.id) || `clip-${index}`,
                title,
                playDescription: firstSafeString([clip.playDescription, clip.description, clip.play, clip.caption]),
                scoreContext: firstSafeString([clip.scoreContext, clip.score, clip.scoreLabel]),
                period: firstSafeString([clip.period, clip.inning, clip.quarter, clip.segment]),
                players,
                url,
                posterUrl: firstSafeString([clip.posterUrl, clip.thumbnailUrl]),
                downloadName: getChatMediaDownloadName(mediaEntry),
                createdAtMs: getClipSortMs(clip)
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.createdAtMs - a.createdAtMs || a.title.localeCompare(b.title));
}

export function buildHighlightShareUrl({ origin, teamId, gameId, startMs, endMs }) {
    const url = new URL('/live-game.html', origin);
    url.searchParams.set('teamId', teamId);
    url.searchParams.set('gameId', gameId);
    url.searchParams.set('replay', 'true');
    url.searchParams.set('clipStart', `${Math.max(0, toFiniteNumber(startMs) || 0)}`);
    url.searchParams.set('clipEnd', `${Math.max(0, toFiniteNumber(endMs) || 0)}`);
    return url.toString();
}

export function resolveReplayVideoOptions({ team, game, players = [], isReplay, clipStartMs = null, clipEndMs = null }) {
    const recorded = getRecordedReplayConfig(game);
    const mediaHub = resolveGameMediaHub({ team, game, durationMs: recorded?.durationMs });
    const gameClips = normalizeGameClipRecords(game, { players });
    const savedHighlights = mediaHub.highlights;
    const firstAttachedClip = savedHighlights.find(clip => clip.mediaUrl);
    const isCompletedGame = game?.liveStatus === 'completed' || game?.status === 'completed';
    const isActiveGame = game?.liveStatus === 'live' || game?.status === 'live';
    const activeLiveEmbed = isActiveGame ? getLiveEmbedConfig(team) : null;
    const canUseRecordedReplay = Boolean(recorded?.sourceUrl) && (isReplay || isCompletedGame);
    const replayState = getReplayAvailabilityState(game, {
        hasReplay: canUseRecordedReplay,
        isReplay,
        isCompletedGame
    });

    if (activeLiveEmbed?.embedUrl) {
        return {
            mode: 'embed',
            hasVideo: true,
            sourceUrl: activeLiveEmbed.embedUrl,
            publicUrl: activeLiveEmbed.publicUrl,
            publicLabel: activeLiveEmbed.publicLabel,
            posterUrl: null,
            title: null,
            durationMs: null,
            clipStartMs: null,
            clipEndMs: null,
            savedHighlights,
            mediaHub,
            gameClips,
            replayState: null
        };
    }

    if (replayState?.status === 'processing' || replayState?.status === 'failed') {
        return {
            mode: 'none',
            hasVideo: false,
            sourceUrl: null,
            publicUrl: null,
            publicLabel: null,
            posterUrl: null,
            title: null,
            durationMs: null,
            clipStartMs: null,
            clipEndMs: null,
            savedHighlights,
            mediaHub,
            gameClips,
            replayState
        };
    }

    if (canUseRecordedReplay) {
        const activeClip = createHighlightClipDraft({
            startMs: clipStartMs,
            endMs: clipEndMs,
            durationMs: recorded.durationMs
        });

        return {
            mode: 'recorded',
            hasVideo: true,
            sourceUrl: recorded.sourceUrl,
            publicUrl: recorded.publicUrl,
            publicLabel: recorded.publicUrl ? 'Open replay video ↗' : null,
            posterUrl: recorded.posterUrl,
            title: recorded.title,
            durationMs: recorded.durationMs,
            clipStartMs: activeClip?.startMs ?? null,
            clipEndMs: activeClip?.endMs ?? null,
            savedHighlights,
            mediaHub,
            gameClips,
            replayState: null
        };
    }

    const liveEmbed = activeLiveEmbed || getLiveEmbedConfig(team);
    if (liveEmbed?.embedUrl && !isReplay && !isCompletedGame) {
        return {
            mode: 'embed',
            hasVideo: true,
            sourceUrl: liveEmbed.embedUrl,
            publicUrl: liveEmbed.publicUrl,
            publicLabel: liveEmbed.publicLabel,
            posterUrl: null,
            title: null,
            durationMs: null,
            clipStartMs: null,
            clipEndMs: null,
            savedHighlights,
            mediaHub,
            gameClips,
            replayState: null
        };
    }

    if (firstAttachedClip) {
        return {
            mode: 'recorded',
            hasVideo: true,
            sourceUrl: firstAttachedClip.mediaUrl,
            publicUrl: firstAttachedClip.mediaUrl,
            publicLabel: 'Open attached clip ↗',
            posterUrl: null,
            title: firstAttachedClip.title,
            durationMs: null,
            clipStartMs: null,
            clipEndMs: null,
            savedHighlights,
            mediaHub,
            gameClips,
            replayState: null
        };
    }

    if (liveEmbed?.embedUrl) {
        return {
            mode: 'embed',
            hasVideo: true,
            sourceUrl: liveEmbed.embedUrl,
            publicUrl: liveEmbed.publicUrl,
            publicLabel: liveEmbed.publicLabel,
            posterUrl: null,
            title: null,
            durationMs: null,
            clipStartMs: null,
            clipEndMs: null,
            savedHighlights,
            mediaHub,
            gameClips,
            replayState: null
        };
    }

    return {
        mode: 'none',
        hasVideo: false,
        sourceUrl: null,
        publicUrl: null,
        publicLabel: null,
        posterUrl: null,
        title: null,
        durationMs: null,
        clipStartMs: null,
        clipEndMs: null,
        savedHighlights,
        mediaHub,
        gameClips,
        replayState
    };
}

export function shouldReloadVideoPlayback(previousPlayback, nextPlayback) {
    const previousMode = previousPlayback?.mode || 'none';
    const nextMode = nextPlayback?.mode || 'none';

    if (previousMode !== nextMode) {
        return true;
    }

    const previousReplayState = previousPlayback?.replayState ? `${previousPlayback.replayState.status}:${previousPlayback.replayState.title}:${previousPlayback.replayState.message}` : '';
    const nextReplayState = nextPlayback?.replayState ? `${nextPlayback.replayState.status}:${nextPlayback.replayState.title}:${nextPlayback.replayState.message}` : '';
    if (previousReplayState !== nextReplayState) {
        return true;
    }

    const previousClipIds = (previousPlayback?.gameClips || []).map((clip) => `${clip.id}:${clip.url}:${clip.title}:${clip.playDescription}:${clip.scoreContext}:${clip.period}:${clip.players.join(',')}`).join('|');
    const nextClipIds = (nextPlayback?.gameClips || []).map((clip) => `${clip.id}:${clip.url}:${clip.title}:${clip.playDescription}:${clip.scoreContext}:${clip.period}:${clip.players.join(',')}`).join('|');
    if (previousClipIds !== nextClipIds) {
        return true;
    }

    if (nextMode === 'embed' || nextMode === 'recorded') {
        return (previousPlayback?.sourceUrl || '') !== (nextPlayback?.sourceUrl || '');
    }

    return false;
}
