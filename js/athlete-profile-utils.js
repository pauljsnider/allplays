function toCleanString(value) {
    return String(value || '').trim();
}

function toFiniteNumber(value) {
    const num = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(num) ? num : null;
}

function inferUploadMediaType({ mediaType = '', mimeType = '', url = '' } = {}) {
    const explicit = toCleanString(mediaType).toLowerCase();
    if (explicit === 'image' || explicit === 'video' || explicit === 'link') {
        return explicit;
    }

    const mime = toCleanString(mimeType).toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';

    const lowerUrl = toCleanString(url).toLowerCase();
    if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/.test(lowerUrl)) return 'image';
    if (/\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/.test(lowerUrl)) return 'video';

    return 'link';
}


function formatGameDateValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
    return '';
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

function isTruthyFlag(value) {
    return value === true || toCleanString(value).toLowerCase() === 'true';
}

function buildScoreContext(clip = {}, game = {}) {
    const explicit = toCleanString(clip.scoreContext || clip.score || clip.scoreLabel);
    if (explicit) return explicit;

    const homeScore = toFiniteNumber(clip.homeScore ?? game.homeScore ?? game.score?.home);
    const awayScore = toFiniteNumber(clip.awayScore ?? game.awayScore ?? game.score?.away);
    if (homeScore !== null && awayScore !== null) {
        const homeLabel = toCleanString(game.homeTeamName || game.teamName) || 'Home';
        const awayLabel = toCleanString(game.awayTeamName || game.opponent || game.opponentName || game.opponentTeamName) || 'Away';
        return `${homeLabel} ${homeScore}, ${awayLabel} ${awayScore}`;
    }

    const teamScore = toFiniteNumber(clip.teamScore ?? game.teamScore);
    const opponentScore = toFiniteNumber(clip.opponentScore ?? game.opponentScore);
    if (teamScore !== null && opponentScore !== null) {
        return `Score: ${teamScore}-${opponentScore}`;
    }

    return '';
}

export function collectAthleteGameClipsForPlayer(games = [], { teamId = '', teamName = '', playerId = '', isStaff = false } = {}) {
    return (Array.isArray(games) ? games : []).flatMap((game) => {
        const rawClips = [
            ...(Array.isArray(game?.gameClips) ? game.gameClips : []),
            ...(Array.isArray(game?.highlightClips) ? game.highlightClips : []),
            ...(Array.isArray(game?.replayVideo?.highlights) ? game.replayVideo.highlights : []),
            ...(Array.isArray(game?.replayHighlights) ? game.replayHighlights : [])
        ];

        return rawClips
            .filter((clip) => playerMatchesClip(clip, playerId))
            .filter((clip) => isStaff || (!isTruthyFlag(clip?.hidden) && !isTruthyFlag(clip?.deleted) && !isTruthyFlag(clip?.isDeleted)))
            .map((clip, index) => {
                const startMs = toFiniteNumber(clip.startMs ?? clip.clipStartMs);
                const endMs = toFiniteNumber(clip.endMs ?? clip.clipEndMs);
                return {
                    id: toCleanString(clip.id || clip.clipId) || `${toCleanString(game?.id || game?.gameId)}-${index}`,
                    source: 'game',
                    mediaType: toCleanString(clip.mediaType).toLowerCase() === 'video' ? 'video' : 'link',
                    title: toCleanString(clip.title || clip.playDescription || clip.description) || 'Game clip',
                    url: toCleanString(clip.url || clip.publicUrl || clip.videoUrl),
                    teamId: toCleanString(teamId || game?.teamId),
                    teamName: toCleanString(teamName || game?.teamName),
                    gameId: toCleanString(game?.id || game?.gameId),
                    game: toCleanString(game?.title || game?.name || game?.opponent || game?.opponentName || game?.opponentTeamName) || 'Game',
                    date: formatGameDateValue(game?.date || game?.gameDate || game?.startTime),
                    playDescription: toCleanString(clip.playDescription || clip.description || clip.title) || 'Score-linked highlight',
                    scoreContext: buildScoreContext(clip, game),
                    startMs,
                    endMs
                };
            });
    });
}

function normalizeClip(clip = {}) {
    const url = toCleanString(clip.url);
    if (!url) return null;

    const trimmedSource = toCleanString(clip.source).toLowerCase();
    const source = trimmedSource === 'upload' ? 'upload' : 'external';
    const mimeType = toCleanString(clip.mimeType);
    const mediaType = source === 'upload'
        ? inferUploadMediaType({ mediaType: clip.mediaType, mimeType, url })
        : (['image', 'video'].includes(toCleanString(clip.mediaType).toLowerCase())
            ? toCleanString(clip.mediaType).toLowerCase()
            : 'link');

    return {
        id: toCleanString(clip.id),
        source,
        mediaType,
        title: toCleanString(clip.title),
        url,
        label: toCleanString(clip.label),
        storagePath: toCleanString(clip.storagePath),
        mimeType,
        sizeBytes: toFiniteNumber(clip.sizeBytes),
        uploadedAtMs: toFiniteNumber(clip.uploadedAtMs)
    };
}

function normalizeProfilePhoto(profilePhoto = null, input = {}) {
    const candidate = profilePhoto || {
        url: input?.profilePhotoUrl,
        storagePath: input?.profilePhotoPath,
        mimeType: input?.profilePhotoMimeType,
        sizeBytes: input?.profilePhotoSizeBytes,
        uploadedAtMs: input?.profilePhotoUploadedAtMs
    };

    const url = toCleanString(candidate?.url);
    const storagePath = toCleanString(candidate?.storagePath);
    const mimeType = toCleanString(candidate?.mimeType);
    const sizeBytes = toFiniteNumber(candidate?.sizeBytes);
    const uploadedAtMs = toFiniteNumber(candidate?.uploadedAtMs);

    if (!url && !storagePath) {
        return null;
    }

    return {
        url,
        storagePath,
        mimeType,
        sizeBytes,
        uploadedAtMs
    };
}

export function normalizeAthleteProfileDraft(input = {}) {
    const athlete = input?.athlete || {};
    const bio = input?.bio || {};
    const rawClips = Array.isArray(input?.clips) ? input.clips : [];
    const rawSeasonKeys = Array.isArray(input?.selectedSeasonKeys) ? input.selectedSeasonKeys : [];
    const privacy = input?.privacy === 'public' ? 'public' : 'private';

    return {
        athlete: {
            name: toCleanString(athlete.name),
            headline: toCleanString(athlete.headline)
        },
        bio: {
            hometown: toCleanString(bio.hometown),
            graduationYear: toCleanString(bio.graduationYear),
            position: toCleanString(bio.position),
            dominantHand: toCleanString(bio.dominantHand),
            achievements: toCleanString(bio.achievements)
        },
        privacy,
        profilePhoto: normalizeProfilePhoto(input?.profilePhoto, input),
        clips: rawClips
            .map((clip) => normalizeClip(clip))
            .filter(Boolean),
        selectedSeasonKeys: [...new Set(
            rawSeasonKeys
                .map((key) => toCleanString(key))
                .filter(Boolean)
        )]
    };
}

export function collectAthleteProfileMediaCleanupPaths(previousProfile = {}, nextDraft = {}) {
    const normalizedNext = normalizeAthleteProfileDraft(nextDraft);
    const retainedPaths = new Set(
        [
            normalizedNext.profilePhoto?.storagePath || '',
            ...normalizedNext.clips.map((clip) => clip.storagePath || '')
        ].filter(Boolean)
    );

    const cleanupPaths = [];
    const previousPhotoPath = toCleanString(previousProfile?.profilePhotoPath || previousProfile?.profilePhoto?.storagePath);
    if (previousPhotoPath && !retainedPaths.has(previousPhotoPath)) {
        cleanupPaths.push(previousPhotoPath);
    }

    const previousClips = Array.isArray(previousProfile?.clips) ? previousProfile.clips : [];
    previousClips.forEach((clip) => {
        const storagePath = toCleanString(clip?.storagePath);
        if (storagePath && !retainedPaths.has(storagePath) && !cleanupPaths.includes(storagePath)) {
            cleanupPaths.push(storagePath);
        }
    });

    return cleanupPaths;
}

export function summarizeAthleteProfileCareer(seasons = []) {
    const summary = {
        gamesPlayed: 0,
        totalMinutes: 0,
        statTotals: {},
        statAverages: {}
    };

    seasons.forEach((season) => {
        const gamesPlayed = Number(season?.gamesPlayed || 0);
        const totalTimeMs = Number(season?.totalTimeMs || 0);
        const statTotals = season?.statTotals || {};

        summary.gamesPlayed += gamesPlayed;
        summary.totalMinutes += totalTimeMs / 60000;

        Object.entries(statTotals).forEach(([statKey, value]) => {
            const numericValue = Number(value || 0);
            summary.statTotals[statKey] = (summary.statTotals[statKey] || 0) + numericValue;
        });
    });

    summary.totalMinutes = Number(summary.totalMinutes.toFixed(1));

    Object.entries(summary.statTotals).forEach(([statKey, total]) => {
        summary.statAverages[statKey] = summary.gamesPlayed > 0
            ? (total / summary.gamesPlayed).toFixed(1)
            : '0.0';
    });

    return summary;
}

export function buildAthleteProfileShareUrl(origin, profileId) {
    const base = String(origin || '').replace(/\/$/, '');
    return `${base}/athlete-profile.html?profileId=${encodeURIComponent(profileId || '')}`;
}
