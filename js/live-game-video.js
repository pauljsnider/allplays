import { normalizeYouTubeEmbedUrl } from './live-stream-utils.js';
import { getChatMediaDownloadName, isSafeChatMediaUrl } from './team-chat-media.js';

export const MAX_HIGHLIGHT_CLIP_MS = 60_000;

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

function getLiveEmbedConfig(team) {
    if (team?.twitchChannel) {
        return {
            embedUrl: `https://player.twitch.tv/?channel=${team.twitchChannel}&parent=${window.location.hostname}&autoplay=true&muted=true`,
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
                taggedPlayerIds: clip?.taggedPlayerIds
            }, options);
            if (!normalized) return null;
            return {
                ...normalized,
                description: firstSafeString([clip?.playDescription, clip?.description, clip?.text, clip?.message]) || normalized.title,
                period: firstSafeString([clip?.period, clip?.inning, clip?.quarter, clip?.half]),
                gameTime: firstSafeString([clip?.gameTime, clip?.clock, clip?.time]),
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
    const gameClips = normalizeGameClipRecords(game, { players });
    const savedHighlights = normalizeSavedHighlightClips(game, { durationMs: recorded?.durationMs });
    const firstAttachedClip = savedHighlights.find(clip => clip.mediaUrl);
    const canUseRecordedReplay = Boolean(recorded?.sourceUrl) && (isReplay || game?.liveStatus === 'completed' || game?.status === 'completed');

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
            gameClips
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
            gameClips
        };
    }

    const liveEmbed = getLiveEmbedConfig(team);
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
            savedHighlights: [],
            gameClips
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
        savedHighlights: [],
        gameClips
    };
}

export function shouldReloadVideoPlayback(previousPlayback, nextPlayback) {
    const previousMode = previousPlayback?.mode || 'none';
    const nextMode = nextPlayback?.mode || 'none';

    if (previousMode !== nextMode) {
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
