export const NOTIFICATION_CATEGORIES = Object.freeze([
    'liveChat',
    'mentions',
    'liveScore',
    'gameDay',
    'schedule',
    'rsvp',
    'fees',
    'practice',
    'access',
    'rideshare',
    'media',
    'awards',
    'officiating'
]);

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
    liveChat: false,
    mentions: true,
    liveScore: false,
    gameDay: false,
    schedule: true,
    rsvp: true,
    fees: true,
    practice: false,
    access: true,
    rideshare: true,
    media: false,
    awards: false,
    officiating: false
});

export const NOTIFICATION_PREFERENCE_GROUPS = Object.freeze([
    {
        id: 'gameDay',
        label: 'Game day',
        categories: [
            { id: 'gameDay', label: 'Game Day' },
            { id: 'schedule', label: 'Schedule Changes' },
            { id: 'liveScore', label: 'Live Score' },
            { id: 'rsvp', label: 'RSVP' },
            { id: 'practice', label: 'Practice Packets' },
            { id: 'officiating', label: 'Officiating' }
        ]
    },
    {
        id: 'money',
        label: 'Money',
        categories: [
            { id: 'fees', label: 'Fees' }
        ]
    },
    {
        id: 'team',
        label: 'Team',
        categories: [
            { id: 'mentions', label: 'Mentions' },
            { id: 'access', label: 'Invites & Access' },
            { id: 'awards', label: 'Awards' }
        ]
    },
    {
        id: 'social',
        label: 'Social',
        categories: [
            { id: 'liveChat', label: 'Live Chat' },
            { id: 'rideshare', label: 'Rideshare' },
            { id: 'media', label: 'Media' }
        ]
    }
]);

function toBoolean(value) {
    return value === true;
}

export function normalizeTeamNotificationPreferences(rawPreferences) {
    const raw = rawPreferences && typeof rawPreferences === 'object' ? rawPreferences : {};
    return NOTIFICATION_CATEGORIES.reduce((preferences, category) => {
        preferences[category] = Object.prototype.hasOwnProperty.call(raw, category)
            ? toBoolean(raw[category])
            : DEFAULT_NOTIFICATION_PREFERENCES[category];
        return preferences;
    }, {});
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
