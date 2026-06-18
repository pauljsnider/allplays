import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    ANDROID_NOTIFICATION_CHANNELS,
    WEB_PUSH_NOTIFICATION_ASSETS,
    buildNotificationDeliveryOptions
} = require('../../functions/notification-delivery-metadata.cjs');

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const serviceWorkerSource = readFileSync(new URL('../../firebase-messaging-sw.js', import.meta.url), 'utf8');

describe('notification delivery metadata', () => {
    it('defines the five Android channels used by app startup and backend sends', () => {
        expect(ANDROID_NOTIFICATION_CHANNELS).toEqual([
            expect.objectContaining({ id: 'allplays_messages', name: 'Messages', importance: 4 }),
            expect.objectContaining({ id: 'allplays_game_day', name: 'Game day', importance: 4 }),
            expect.objectContaining({ id: 'allplays_schedule', name: 'Schedule', importance: 3 }),
            expect.objectContaining({ id: 'allplays_money', name: 'Money', importance: 3 }),
            expect.objectContaining({ id: 'allplays_team', name: 'Team', importance: 3 })
        ]);
    });

    it('routes message notifications to the messages channel and groups them by team on iOS', () => {
        const options = buildNotificationDeliveryOptions({
            category: 'liveChat',
            teamId: 'team 1',
            gameId: 'game-1'
        });

        expect(options.android.notification.channelId).toBe('allplays_messages');
        expect(options.apns.payload.aps['thread-id']).toBe('messages-team-1');
        expect(options.apns.headers).toBeUndefined();
    });

    it('collapses rapid live score notifications by game on iOS', () => {
        const options = buildNotificationDeliveryOptions({
            category: 'liveScore',
            teamId: 'team-1',
            gameId: 'game-9'
        });

        expect(options.android.notification.channelId).toBe('allplays_game_day');
        expect(options.apns.payload.aps['thread-id']).toBe('game-team-1-game-9');
        expect(options.apns.headers['apns-collapse-id']).toBe('score-team-1-game-9');
    });

    it('routes team-scoped award notifications to the team channel and iOS team thread', () => {
        const options = buildNotificationDeliveryOptions({
            category: 'awards',
            teamId: 'team-1',
            eventId: 'certificate-1'
        });

        expect(options.android.notification.channelId).toBe('allplays_team');
        expect(options.apns.payload.aps['thread-id']).toBe('team-team-1');
    });

    it('wires delivery metadata and branded web assets into both backend send paths', () => {
        const firstSendPath = functionsSource.slice(
            functionsSource.indexOf('async function sendCategoryNotification'),
            functionsSource.indexOf('async function sendDirectTargetsNotification')
        );
        const secondSendPath = functionsSource.slice(
            functionsSource.indexOf('async function sendDirectTargetsNotification'),
            functionsSource.indexOf('function normalizeScheduleStatus')
        );

        expect(WEB_PUSH_NOTIFICATION_ASSETS).toEqual({
            icon: '/img/logo_small.png',
            badge: '/img/logo_small.png'
        });
        expect(firstSendPath).toContain('buildNotificationDeliveryOptions({ category, teamId, gameId, eventId: eventId || gameId })');
        expect(firstSendPath).toContain('notification: WEB_PUSH_NOTIFICATION_ASSETS');
        expect(firstSendPath).toContain('...deliveryOptions');
        expect(secondSendPath).toContain('buildNotificationDeliveryOptions({ category, teamId, gameId, eventId: eventId || gameId })');
        expect(secondSendPath).toContain('notification: WEB_PUSH_NOTIFICATION_ASSETS');
        expect(secondSendPath).toContain('...deliveryOptions');
    });

    it('shows branded icon and badge assets from the web service worker', () => {
        expect(serviceWorkerSource).toContain("const WEB_PUSH_NOTIFICATION_ICON = '/img/logo_small.png';");
        expect(serviceWorkerSource).toContain("const WEB_PUSH_NOTIFICATION_BADGE = '/img/logo_small.png';");
        expect(serviceWorkerSource).toContain('icon,');
        expect(serviceWorkerSource).toContain('badge,');
    });
});
