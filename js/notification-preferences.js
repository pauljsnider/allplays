export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
    liveChat: false,
    liveScore: false,
    schedule: false
});

function toBoolean(value) {
    return value === true;
}

export function normalizeTeamNotificationPreferences(rawPreferences) {
    const raw = rawPreferences && typeof rawPreferences === 'object' ? rawPreferences : {};
    return {
        liveChat: toBoolean(raw.liveChat),
        liveScore: toBoolean(raw.liveScore),
        schedule: toBoolean(raw.schedule)
    };
}

function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function changed(before, after, key) {
    return (before?.[key] ?? null) !== (after?.[key] ?? null);
}

export function getNotificationCategoryForGameChange(beforeGame, afterGame) {
    const beforeHome = asNumber(beforeGame?.homeScore);
    const beforeAway = asNumber(beforeGame?.awayScore);
    const afterHome = asNumber(afterGame?.homeScore);
    const afterAway = asNumber(afterGame?.awayScore);

    if (beforeHome !== afterHome || beforeAway !== afterAway) {
        return 'liveScore';
    }

    const scheduleFields = ['date', 'location', 'status', 'opponent', 'title'];
    if (scheduleFields.some((field) => changed(beforeGame, afterGame, field))) {
        return 'schedule';
    }

    return null;
}
