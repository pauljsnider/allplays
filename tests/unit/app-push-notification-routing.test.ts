// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearPendingPushRoute,
    readPendingPushRoute,
    rememberPendingPushRoute,
    resolvePushNotificationRoute
} from '../../apps/app/src/lib/pushNotificationRouting.ts';

function installMemoryLocalStorage() {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            clear: () => values.clear(),
            getItem: (key: string) => values.get(String(key)) ?? null,
            removeItem: (key: string) => values.delete(String(key)),
            setItem: (key: string, value: string) => values.set(String(key), String(value))
        }
    });
}

describe('app push notification routing', () => {
    beforeEach(() => {
        installMemoryLocalStorage();
        window.localStorage.clear();
    });

    it('maps live chat, live score, and schedule payloads to app routes', () => {
        expect(resolvePushNotificationRoute({ category: 'liveChat', teamId: 'team-1' })).toBe('/messages/team-1');
        expect(resolvePushNotificationRoute({ category: 'liveChat', teamId: 'team-1', conversationId: 'staff-2' })).toBe('/messages/team-1?conversationId=staff-2');
        expect(resolvePushNotificationRoute({ category: 'liveChat', teamId: 'team-1', conversationId: 'staff-2', appRoute: '/messages/team-1' })).toBe('/messages/team-1');
        expect(resolvePushNotificationRoute({ category: 'liveScore', teamId: 'team-1', gameId: 'game-7' })).toBe('/schedule/team-1/game-7?section=game');
        expect(resolvePushNotificationRoute({ category: 'liveScore', teamId: 'team-1', gameId: 'game-7', appRoute: '/schedule/team-1/game-7?section=game' })).toBe('/schedule/team-1/game-7?section=game');
        expect(resolvePushNotificationRoute({ category: 'liveScore', gameId: 'game-7' })).toBe('/games/game-7');
        expect(resolvePushNotificationRoute({ category: 'practice', teamId: 'team-1', eventId: 'practice-4' })).toBe('/schedule/team-1/practice-4?section=game');
        expect(resolvePushNotificationRoute({ category: 'practice', teamId: 'team-1', eventId: 'session-4', appRoute: '/schedule/team-1/practice-4?section=game' })).toBe('/schedule/team-1/practice-4?section=game');
        expect(resolvePushNotificationRoute({ category: 'rsvp', teamId: 'team-1', eventId: 'game-9' })).toBe('/schedule/team-1/game-9?section=availability');
        expect(resolvePushNotificationRoute({ category: 'rsvp', teamId: 'team-1', eventId: 'game-9', childId: 'player-2' })).toBe('/schedule/team-1/game-9?childId=player-2&section=availability');
        expect(resolvePushNotificationRoute({ category: 'media', teamId: 'team-1' })).toBe('/teams/team-1/media');
        expect(resolvePushNotificationRoute({ category: 'schedule', teamId: 'team-1', eventId: 'event-9' })).toBe('/schedule/team-1/event-9');
    });

    it('uses backend-supplied appRoute as the source of truth when present', () => {
        expect(resolvePushNotificationRoute({ category: 'liveScore', teamId: 'team-1', gameId: 'game-7', appRoute: '/schedule/team-1/game-7' })).toBe('/schedule/team-1/game-7');
        expect(resolvePushNotificationRoute({ category: 'liveScore', teamId: 'team-1', gameId: 'game-7', appRoute: '/schedule/team-1/game-7?section=availability' })).toBe('/schedule/team-1/game-7?section=availability');
        expect(resolvePushNotificationRoute({ category: 'schedule', teamId: 'team-1', eventId: 'event-9', appRoute: '/schedule/team-1/event-9' })).toBe('/schedule/team-1/event-9');
    });

    it('maps expanded notification categories to deterministic fallback routes', () => {
        expect(resolvePushNotificationRoute({ category: 'fees', teamId: 'team 1', batchId: 'batch/1', recipientId: 'recipient?1' })).toBe('/teams/team%201/fees/batch%2F1?recipientId=recipient%3F1');
        expect(resolvePushNotificationRoute({ category: 'fees', teamId: 'team 1' })).toBe('/parent-tools/fees?teamId=team+1');
        expect(resolvePushNotificationRoute({ category: 'access', teamId: 'team 1' })).toBe('/parent-tools/access?teamId=team+1');
        expect(resolvePushNotificationRoute({ category: 'rideshare', teamId: 'team-1', eventId: 'game-7' })).toBe('/schedule/team-1/game-7?section=rideshare');
        expect(resolvePushNotificationRoute({ category: 'rideshare', teamId: 'team-1', eventId: 'game-7', childId: 'player-2' })).toBe('/schedule/team-1/game-7?childId=player-2&section=rideshare');
        expect(resolvePushNotificationRoute({ category: 'media', teamId: 'team-1' })).toBe('/teams/team-1/media');
        expect(resolvePushNotificationRoute({ category: 'awards', teamId: 'team-1', certificateId: 'cert-9' })).toBe('/parent-tools/certificates?teamId=team-1&certificateId=cert-9');
        expect(resolvePushNotificationRoute({ category: 'mentions', teamId: 'team-1', conversationId: 'staff-2' })).toBe('/messages/team-1?conversation=staff-2');
        expect(resolvePushNotificationRoute({ category: 'mentions', teamId: 'team-1', conversation: 'staff-2' })).toBe('/messages/team-1?conversation=staff-2');
        expect(resolvePushNotificationRoute({ category: 'gameDay', teamId: 'team-1', gameId: 'game-7' })).toBe('/schedule/team-1/game-7?section=game');
        expect(resolvePushNotificationRoute({ category: 'officiating', teamId: 'team-1' })).toBe('/officials?teamId=team-1');
    });

    it('falls back to legacy web links when an explicit app route is absent', () => {
        expect(resolvePushNotificationRoute({ link: 'https://allplays.ai/team-chat.html?teamId=team-1' })).toBe('/messages/team-1');
        expect(resolvePushNotificationRoute({ link: 'https://allplays.ai/team-chat.html?teamId=team-1&conversationId=staff-2' })).toBe('/messages/team-1?conversationId=staff-2');
        expect(resolvePushNotificationRoute({ link: 'https://allplays.ai/team-chat.html?teamId=team-1&conversation=staff-2' })).toBe('/messages/team-1?conversation=staff-2');
        expect(resolvePushNotificationRoute({ link: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-7' })).toBe('/schedule/team-1/game-7?section=game');
        expect(resolvePushNotificationRoute({ link: 'https://allplays.ai/game-day.html?teamId=team-1&gameId=game-7' })).toBe('/schedule/team-1/game-7?section=game');
    });

    it('returns the home route when notification data is missing', () => {
        expect(resolvePushNotificationRoute(undefined)).toBe('/home');
        expect(resolvePushNotificationRoute(null)).toBe('/home');
        expect(resolvePushNotificationRoute({ data: undefined })).toBe('/home');
    });

    it('accepts Capacitor notification wrappers without requiring data to be dereferenced first', () => {
        expect(resolvePushNotificationRoute({ data: { category: 'rsvp', teamId: 'team-1', eventId: 'game-9', childId: 'player-2' } })).toBe('/schedule/team-1/game-9?childId=player-2&section=availability');
    });

    it('keeps and clears pending notification routes for delayed auth hydration', () => {
        rememberPendingPushRoute('/teams/team-1/fees/batch-1?recipientId=recipient-1');
        expect(readPendingPushRoute()).toBe('/teams/team-1/fees/batch-1?recipientId=recipient-1');
        rememberPendingPushRoute('https://allplays.ai/app/#/messages/team-1');
        expect(readPendingPushRoute()).toBe('/teams/team-1/fees/batch-1?recipientId=recipient-1');
        rememberPendingPushRoute('//evil.example/app/#/messages/team-1');
        expect(readPendingPushRoute()).toBe('/teams/team-1/fees/batch-1?recipientId=recipient-1');
        clearPendingPushRoute();
        expect(readPendingPushRoute()).toBe('');
    });
});
