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
const appServiceWorkerSource = readFileSync(new URL('../../apps/app/public/firebase-messaging-sw.js', import.meta.url), 'utf8');

function extractChunk(startMarker, endMarker) {
    const start = functionsSource.indexOf(startMarker);
    const end = functionsSource.indexOf(endMarker, start);
    if (start === -1 || end === -1) {
        throw new Error(`Unable to extract source chunk for ${startMarker}.`);
    }
    return functionsSource.slice(start, end);
}

const mergeNotificationWebpushOptions = new Function(
    `${extractChunk('function mergeNotificationWebpushOptions(', 'async function sendCategoryNotification(')}\nreturn mergeNotificationWebpushOptions;`
)();
const notificationRouteHelpers = new Function(
    `${extractChunk('function buildScheduleSectionQuery', 'function buildTeamMediaNotificationAudienceContext')}\nreturn { buildNotificationLink, buildNotificationAppRoute };`
)();

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

    it('builds conversation deep links for mention notifications', () => {
        const mentionLink = notificationRouteHelpers.buildNotificationLink({
            category: 'mentions',
            teamId: 'team 1',
            conversationId: 'parents/thread 2'
        });
        const appRoute = notificationRouteHelpers.buildNotificationAppRoute({
            category: 'mentions',
            teamId: 'team 1',
            conversationId: 'parents/thread 2'
        });

        expect(mentionLink).toBe('https://allplays.ai/team-chat.html?teamId=team%201&conversationId=parents%2Fthread%202');
        expect(appRoute).toBe('/messages/team%201?conversation=parents%2Fthread%202');
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

    it('collapses practice packet notifications by session while keeping them in the team thread', () => {
        const options = buildNotificationDeliveryOptions({
            category: 'practice',
            teamId: 'team-1',
            eventId: 'session-1'
        });

        expect(options.android.notification.channelId).toBe('allplays_game_day');
        expect(options.android.notification.tag).toBe('event-team-1-session-1');
        expect(options.webpush.notification.tag).toBe('event-team-1-session-1');
        expect(options.apns.payload.aps['thread-id']).toBe('team-team-1');
        expect(options.apns.headers['apns-collapse-id']).toBe('event-team-1-session-1');
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

    it('routes rideshare notifications to the team channel without collapsing distinct events', () => {
        const options = buildNotificationDeliveryOptions({
            category: 'rideshare',
            teamId: 'team 1',
            eventId: 'game-1'
        });

        expect(options.android.notification.channelId).toBe('allplays_team');
        expect(options.android.notification.tag).toBeUndefined();
        expect(options.webpush).toBeUndefined();
        expect(options.apns.payload.aps['thread-id']).toBe('team-team-1');
        expect(options.apns.headers).toBeUndefined();
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
        expect(firstSendPath).toContain('buildNotificationDeliveryOptions({ category, teamId, gameId, eventId: eventId || gameId, timeSensitive })');
        expect(firstSendPath).toContain('const mergeWebpushOptions = typeof mergeNotificationWebpushOptions === \'function\'');
        expect(firstSendPath).toContain('if (!runtimeDeliveryOptions?.webpush) return baseWebpush;');
        expect(firstSendPath).toContain('...deliveryOptions');
        expect(firstSendPath).toContain('webpush: mergeWebpushOptions({');
        expect(firstSendPath).toContain('notification: WEB_PUSH_NOTIFICATION_ASSETS');
        expect(secondSendPath).toContain('buildNotificationDeliveryOptions({ category, teamId, gameId, eventId: eventId || gameId, timeSensitive })');
        expect(secondSendPath).toContain('const mergeWebpushOptions = typeof mergeNotificationWebpushOptions === \'function\'');
        expect(secondSendPath).toContain('if (!runtimeDeliveryOptions?.webpush) return baseWebpush;');
        expect(secondSendPath).toContain('...deliveryOptions');
        expect(secondSendPath).toContain('webpush: mergeWebpushOptions({');
        expect(secondSendPath).toContain('notification: WEB_PUSH_NOTIFICATION_ASSETS');
    });

    it('merges web push collapse tags without dropping the notification link', () => {
        expect(mergeNotificationWebpushOptions({
            notification: WEB_PUSH_NOTIFICATION_ASSETS,
            fcmOptions: { link: 'https://allplays.ai/app/#/schedule/team-1/practice-1' }
        }, {
            webpush: {
                notification: { tag: 'event-team-1-session-1' }
            }
        })).toEqual({
            notification: {
                icon: '/img/logo_small.png',
                badge: '/img/logo_small.png',
                tag: 'event-team-1-session-1'
            },
            fcmOptions: { link: 'https://allplays.ai/app/#/schedule/team-1/practice-1' }
        });
    });

    it('shows branded icon and badge assets from the web service worker', () => {
        expect(serviceWorkerSource).toContain("const WEB_PUSH_NOTIFICATION_ICON = '/img/logo_small.png';");
        expect(serviceWorkerSource).toContain("const WEB_PUSH_NOTIFICATION_BADGE = '/img/logo_small.png';");
        expect(serviceWorkerSource).toContain('icon,');
        expect(serviceWorkerSource).toContain('badge,');
    });

    it('normalizes web notification taps to native app hash routes when appRoute is present', () => {
        expect(serviceWorkerSource).toContain('function buildAppRouteNotificationLink');
        expect(serviceWorkerSource).toContain("new URL(`/app/#${appRoute}`, self.location.origin).toString()");
        expect(serviceWorkerSource).toContain('buildAppRouteNotificationLink(payload?.data?.appRoute)');
        expect(serviceWorkerSource).toContain('payload?.fcmOptions?.link');
        expect(serviceWorkerSource).toContain('event.waitUntil(clients.openWindow(link));');
    });

    it('versions and expires cached Firebase service worker config', () => {
        expect(serviceWorkerSource).toContain("const CONFIG_CACHE_VERSION = 'v2';");
        expect(serviceWorkerSource).toContain('const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;');
        expect(serviceWorkerSource).toContain('cached?.version !== CONFIG_CACHE_VERSION');
        expect(serviceWorkerSource).toContain('Date.now() - cached.cachedAt > CONFIG_CACHE_TTL_MS');
        expect(serviceWorkerSource).toContain('cachedAt: Date.now()');
    });

    it('keeps the app-hosted service worker lint-safe without changing its push handling behavior', () => {
        expect(appServiceWorkerSource).toContain('/* eslint-env serviceworker */');
        expect(appServiceWorkerSource.replace('/* eslint-env serviceworker */\n', '')).toBe(serviceWorkerSource);
    });
});
