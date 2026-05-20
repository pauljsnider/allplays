export function hasPlayerProfileParticipation(statData = {}) {
    if (statData.didNotPlay === true) {
        return false;
    }

    if (
        statData.participated === true
        || statData.participationStatus === 'appeared'
        || statData.participationSource === 'statsheet-import'
    ) {
        return true;
    }

    if (statData.participationStatus === 'unused') {
        return false;
    }

    const timeMs = Number(statData.timeMs || 0);
    if (timeMs > 0) {
        return true;
    }

    const stats = statData.stats || {};
    return Object.values(stats).some((value) => Number(value || 0) !== 0);
}


function toCleanString(value) {
    return String(value || '').trim();
}

function toFiniteNumber(value) {
    const num = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(num) ? num : null;
}

function formatClipGameDate(value) {
    if (!value) return '';
    if (typeof value?.toDate === 'function') {
        return value.toDate().toLocaleDateString();
    }
    if (typeof value?.seconds === 'number') {
        return new Date(value.seconds * 1000).toLocaleDateString();
    }
    const cleanValue = toCleanString(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
        const [year, month, day] = cleanValue.split('-').map(Number);
        return new Date(year, month - 1, day).toLocaleDateString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? cleanValue : date.toLocaleDateString();
}

function playerMatchesClip(clip = {}, playerId = '') {
    const target = toCleanString(playerId);
    if (!target) return false;

    const directIds = [
        clip.playerId,
        clip.athleteId,
        clip.taggedPlayerId,
        clip.scoringPlayerId
    ].map(toCleanString);
    if (directIds.includes(target)) return true;

    const arrayFields = [clip.playerIds, clip.athleteIds, clip.taggedPlayerIds, clip.players, clip.taggedPlayers];
    return arrayFields.some((field) => Array.isArray(field) && field.some((entry) => {
        if (typeof entry === 'string') return toCleanString(entry) === target;
        return [entry?.id, entry?.playerId, entry?.athleteId].map(toCleanString).includes(target);
    }));
}

function isHiddenClip(clip = {}) {
    return clip.hidden === true
        || clip.deleted === true
        || clip.isDeleted === true
        || toCleanString(clip.hidden).toLowerCase() === 'true'
        || toCleanString(clip.deleted).toLowerCase() === 'true'
        || toCleanString(clip.isDeleted).toLowerCase() === 'true';
}

function firstCleanString(values = []) {
    return values.map(toCleanString).find(Boolean) || '';
}

function getGameReplayUrl(game = {}) {
    return firstCleanString([
        game.replayVideo?.publicUrl,
        game.recordedVideo?.publicUrl,
        game.videoReplay?.publicUrl,
        game.replayVideo?.url,
        game.replayVideo?.src,
        game.recordedVideo?.url,
        game.recordedVideo?.src,
        game.videoReplay?.url,
        game.videoReplay?.src,
        game.replayVideoPublicUrl,
        game.replayVideoUrl,
        game.recordedVideoUrl,
        game.videoReplayUrl,
        game.archivedVideoUrl
    ]);
}

function isSafeHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
        return false;
    }
}

function isSafeClipUrl(value) {
    const url = toCleanString(value);
    return isSafeHttpUrl(url) || /^live-game\.html\?/.test(url);
}

function buildReplayClipUrl({ teamId, gameId, startMs, endMs }) {
    if (!toCleanString(teamId) || !toCleanString(gameId) || startMs === null || endMs === null) return '';

    const params = new URLSearchParams({
        teamId: toCleanString(teamId),
        gameId: toCleanString(gameId),
        replay: 'true',
        clipStart: `${Math.max(0, startMs)}`,
        clipEnd: `${Math.max(0, endMs)}`
    });
    return `live-game.html?${params.toString()}`;
}

export function collectPlayerVideoClips(games = [], { teamId = '', playerId = '' } = {}) {
    return (Array.isArray(games) ? games : []).flatMap((game = {}) => {
        const gameId = toCleanString(game.id || game.gameId);
        const replayUrl = getGameReplayUrl(game);
        const rawClips = [
            ...(Array.isArray(game.gameClips) ? game.gameClips : []),
            ...(Array.isArray(game.highlightClips) ? game.highlightClips : []),
            ...(Array.isArray(game.clipMetadata) ? game.clipMetadata : []),
            ...(Array.isArray(game.clips) ? game.clips : []),
            ...(Array.isArray(game.videoClips) ? game.videoClips : []),
            ...(Array.isArray(game.replayVideo?.highlights) ? game.replayVideo.highlights : []),
            ...(Array.isArray(game.replayHighlights) ? game.replayHighlights : [])
        ];

        return rawClips
            .filter((clip) => playerMatchesClip(clip, playerId))
            .filter((clip) => !isHiddenClip(clip))
            .map((clip, index) => {
                const startMs = toFiniteNumber(clip.startMs ?? clip.clipStartMs);
                const endMs = toFiniteNumber(clip.endMs ?? clip.clipEndMs);
                const explicitUrl = firstCleanString([clip.url, clip.publicUrl, clip.videoUrl, clip.href]);
                const url = isSafeClipUrl(explicitUrl)
                    ? explicitUrl
                    : (replayUrl && isSafeClipUrl(replayUrl)
                        ? buildReplayClipUrl({ teamId: teamId || game.teamId, gameId, startMs, endMs })
                        : '');

                if (!url || !isSafeClipUrl(url)) return null;

                const thumbnailUrl = firstCleanString([
                    clip.thumbnailUrl,
                    clip.posterUrl,
                    clip.imageUrl,
                    game.replayVideo?.posterUrl,
                    game.recordedVideo?.posterUrl,
                    game.videoReplay?.posterUrl,
                    game.replayVideoPosterUrl
                ]);

                return {
                    id: firstCleanString([clip.id, clip.clipId]) || `${gameId || 'game'}-${index}`,
                    title: firstCleanString([clip.title, clip.playDescription, clip.description]) || 'Game clip',
                    gameDate: formatClipGameDate(game.date || game.gameDate || game.startTime),
                    playLabel: firstCleanString([clip.playLabel, clip.playDescription, clip.description, clip.eventType, clip.statLabel]) || 'Highlight',
                    url,
                    thumbnailUrl: isSafeHttpUrl(thumbnailUrl) ? thumbnailUrl : '',
                    gameLabel: firstCleanString([game.title, game.name, game.opponent, game.opponentName, game.opponentTeamName]) || 'Game'
                };
            })
            .filter(Boolean);
    });
}
