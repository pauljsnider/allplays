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

function normalizeComparableValue(value) {
    if (value == null) {
        return null;
    }

    if (typeof value?.toMillis === 'function') {
        const millis = value.toMillis();
        if (Number.isFinite(millis)) {
            return { __type: 'timestamp', value: millis };
        }
    }

    if (value instanceof Date) {
        return { __type: 'date', value: value.getTime() };
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeComparableValue(entry));
    }

    if (typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((normalized, key) => {
                normalized[key] = normalizeComparableValue(value[key]);
                return normalized;
            }, {});
    }

    return value;
}

function changed(before, after, key) {
    const beforeValue = normalizeComparableValue(before?.[key] ?? null);
    const afterValue = normalizeComparableValue(after?.[key] ?? null);
    return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
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
