// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearPendingPushRoute,
    readPendingPushRoute,
    rememberPendingPushRoute,
    resolvePushNotificationRoute
} from '../../apps/app/src/lib/pushNotificationRouting.ts';

describe('app push notification routing', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('maps live chat, live score, and schedule payloads to app routes', () => {
        expect(resolvePushNotificationRoute({ category: 'liveChat', teamId: 'team-1' })).toBe('/messages/team-1');
        expect(resolvePushNotificationRoute({ category: 'liveChat', teamId: 'team-1', conversationId: 'staff-2' })).toBe('/messages/team-1?conversationId=staff-2');
        expect(resolvePushNotificationRoute({ category: 'liveChat', teamId: 'team-1', conversationId: 'staff-2', appRoute: '/messages/team-1' })).toBe('/messages/team-1?conversationId=staff-2');
        expect(resolvePushNotificationRoute({ category: 'liveScore', teamId: 'team-1', gameId: 'game-7' })).toBe('/schedule/team-1/game-7');
        expect(resolvePushNotificationRoute({ category: 'liveScore', gameId: 'game-7' })).toBe('/games/game-7');
        expect(resolvePushNotificationRoute({ category: 'schedule', teamId: 'team-1', eventId: 'event-9' })).toBe('/schedule/team-1/event-9');
    });

    it('falls back to legacy web links when an explicit app route is absent', () => {
        expect(resolvePushNotificationRoute({ link: 'https://allplays.ai/team-chat.html?teamId=team-1' })).toBe('/messages/team-1');
        expect(resolvePushNotificationRoute({ link: 'https://allplays.ai/team-chat.html?teamId=team-1&conversationId=staff-2' })).toBe('/messages/team-1?conversationId=staff-2');
        expect(resolvePushNotificationRoute({ link: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-7' })).toBe('/schedule/team-1/game-7');
        expect(resolvePushNotificationRoute({ link: 'https://allplays.ai/game-day.html?teamId=team-1&gameId=game-7' })).toBe('/schedule/team-1/game-7');
    });

    it('keeps and clears pending notification routes for delayed auth hydration', () => {
        rememberPendingPushRoute('/messages/team-1');
        expect(readPendingPushRoute()).toBe('/messages/team-1');
        clearPendingPushRoute();
        expect(readPendingPushRoute()).toBe('');
    });
});
