export function normalizeAthleteProfileDraft(input = {}) {
    const athlete = input?.athlete || {};
    const bio = input?.bio || {};
    const rawClips = Array.isArray(input?.clips) ? input.clips : [];
    const rawSeasonKeys = Array.isArray(input?.selectedSeasonKeys) ? input.selectedSeasonKeys : [];
    const privacy = input?.privacy === 'public' ? 'public' : 'private';

    return {
        athlete: {
            name: String(athlete.name || '').trim(),
            headline: String(athlete.headline || '').trim()
        },
        bio: {
            hometown: String(bio.hometown || '').trim(),
            graduationYear: String(bio.graduationYear || '').trim(),
            position: String(bio.position || '').trim(),
            dominantHand: String(bio.dominantHand || '').trim(),
            achievements: String(bio.achievements || '').trim()
        },
        privacy,
        clips: rawClips
            .map((clip) => ({
                title: String(clip?.title || '').trim(),
                url: String(clip?.url || '').trim(),
                label: String(clip?.label || '').trim()
            }))
            .filter((clip) => clip.url),
        selectedSeasonKeys: [...new Set(
            rawSeasonKeys
                .map((key) => String(key || '').trim())
                .filter(Boolean)
        )]
    };
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
