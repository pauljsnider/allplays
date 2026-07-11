import { formatDateTime } from './datetime';

type TimestampLike = {
    seconds?: unknown;
    toDate?: () => unknown;
    toMillis?: () => unknown;
};

export function normalizeNotificationTimestamp(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (value === null || value === undefined || value === '') return null;

    const timestamp = value as TimestampLike;
    if (typeof timestamp.toDate === 'function') {
        try {
            return normalizeNotificationTimestamp(timestamp.toDate());
        } catch {
            return null;
        }
    }

    if (typeof timestamp.toMillis === 'function') {
        try {
            return normalizeNotificationTimestamp(timestamp.toMillis());
        } catch {
            return null;
        }
    }

    if (typeof timestamp.seconds === 'number') {
        return normalizeNotificationTimestamp(timestamp.seconds * 1000);
    }

    if (typeof value === 'number') {
        const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
        const date = new Date(milliseconds);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value !== 'string') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatNotificationRecency(value: unknown, now = new Date()): string {
    const date = normalizeNotificationTimestamp(value);
    if (!date || Number.isNaN(now.getTime())) return '';

    const ageMilliseconds = Math.max(0, now.getTime() - date.getTime());
    const ageMinutes = Math.floor(ageMilliseconds / 60_000);
    if (ageMinutes < 1) return 'Just now';
    if (ageMinutes < 60) return `${ageMinutes}m`;

    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours < 24) return `${ageHours}h`;

    return formatDateTime(date, {
        month: 'short',
        day: 'numeric',
        ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
    });
}
