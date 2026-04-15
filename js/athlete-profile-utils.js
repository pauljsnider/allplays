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
