import { normalizeYouTubeEmbedUrl } from './live-stream-utils.js';

export const MAX_HIGHLIGHT_CLIP_MS = 60_000;

function toFiniteNumber(value) {
    const num = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(num) ? num : null;
}

function firstSafeString(values) {
    return values.find(value => typeof value === 'string' && value.trim()) || null;
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

export function createHighlightClipDraft({ startMs, endMs, durationMs = null, title = '' }, options = {}) {
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

    return {
        title: typeof title === 'string' ? title.trim() : '',
        startMs: safeStartMs,
        endMs: safeEndMs
    };
}

export function normalizeSavedHighlightClips(game, options = {}) {
    const durationMs = toFiniteNumber(options.durationMs);
    const rawClips = [];

    if (Array.isArray(game?.highlightClips)) {
        rawClips.push(...game.highlightClips);
    }
    if (Array.isArray(game?.replayVideo?.highlights)) {
        rawClips.push(...game.replayVideo.highlights);
    }
    if (Array.isArray(game?.replayHighlights)) {
        rawClips.push(...game.replayHighlights);
    }

    return rawClips
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
                title: clip?.title || `Highlight ${index + 1}`
            }, options);
            return normalized;
        })
        .filter(Boolean);
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

export function resolveReplayVideoOptions({ team, game, isReplay, clipStartMs = null, clipEndMs = null }) {
    const recorded = getRecordedReplayConfig(game);
    const savedHighlights = normalizeSavedHighlightClips(game, { durationMs: recorded?.durationMs });
    const firstAttachedClip = savedHighlights.find(clip => clip.mediaUrl);
    const canUseRecordedReplay = Boolean(recorded?.sourceUrl) && (isReplay || game?.liveStatus === 'completed' || game?.status === 'completed');
    const isCompletedGame = game?.liveStatus === 'completed' || game?.status === 'completed';

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
            savedHighlights
        };
    }

    const liveEmbed = getLiveEmbedConfig(team);
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
            savedHighlights
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
            savedHighlights
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
            savedHighlights: []
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
        savedHighlights: []
    };
}

export function shouldReloadVideoPlayback(previousPlayback, nextPlayback) {
    const previousMode = previousPlayback?.mode || 'none';
    const nextMode = nextPlayback?.mode || 'none';

    if (previousMode !== nextMode) {
        return true;
    }

    if (nextMode === 'embed' || nextMode === 'recorded') {
        return (previousPlayback?.sourceUrl || '') !== (nextPlayback?.sourceUrl || '');
    }

    return false;
}
