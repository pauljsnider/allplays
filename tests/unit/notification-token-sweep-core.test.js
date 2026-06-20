import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
    STALE_NOTIFICATION_DEVICE_TOKEN_MS,
    getNotificationDeviceUpdatedAtMillis,
    getStaleNotificationTokenCutoffMillis,
    isStaleNotificationDeviceRecord
} = require('../../functions/notification-token-sweep-core.cjs');

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('notification token sweep helpers', () => {
    it('computes the 90 day stale token cutoff', () => {
        const now = Date.parse('2026-06-20T12:00:00.000Z');
        expect(getStaleNotificationTokenCutoffMillis(now)).toBe(now - STALE_NOTIFICATION_DEVICE_TOKEN_MS);
    });

    it('normalizes Firestore, Date, and string token timestamps', () => {
        expect(getNotificationDeviceUpdatedAtMillis({ updatedAt: { toMillis: () => 1234 } })).toBe(1234);
        expect(getNotificationDeviceUpdatedAtMillis({ updatedAt: { toDate: () => new Date('2026-01-01T00:00:00.000Z') } })).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
        expect(getNotificationDeviceUpdatedAtMillis({ updatedAt: new Date('2026-02-01T00:00:00.000Z') })).toBe(Date.parse('2026-02-01T00:00:00.000Z'));
        expect(getNotificationDeviceUpdatedAtMillis({ updatedAt: '2026-03-01T00:00:00.000Z' })).toBe(Date.parse('2026-03-01T00:00:00.000Z'));
    });

    it('treats missing or older token timestamps as stale', () => {
        const now = Date.parse('2026-06-20T12:00:00.000Z');
        expect(isStaleNotificationDeviceRecord({}, now)).toBe(true);
        expect(isStaleNotificationDeviceRecord({ updatedAt: '2026-02-01T00:00:00.000Z' }, now)).toBe(true);
        expect(isStaleNotificationDeviceRecord({ updatedAt: '2026-06-01T00:00:00.000Z' }, now)).toBe(false);
    });

    it('wires a scheduled collectionGroup sweep into Cloud Functions', () => {
        expect(functionsSource).toContain("firestore.collectionGroup('notificationDevices')");
        expect(functionsSource).toContain(".where('updatedAt', '<', cutoff)");
        expect(functionsSource).toContain('exports.sweepStaleNotificationDeviceTokens = functions.pubsub');
        expect(functionsSource).toContain(".schedule('every 24 hours')");
    });
});
