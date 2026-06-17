import { describe, it, expect } from 'vitest';
import { resolvePushNotificationRoute } from './pushNotificationRouting';

describe('resolvePushNotificationRoute', () => {
    describe('liveScore', () => {
        it('routes to game hub with section=game when teamId and gameId are present', () => {
            const route = resolvePushNotificationRoute({
                category: 'liveScore',
                teamId: 'team1',
                gameId: 'game1',
            });
            expect(route).toBe('/schedule/team1/game1?section=game');
        });

        it('routes to game hub with section=game even when appRoute is present in payload', () => {
            const route = resolvePushNotificationRoute({
                category: 'liveScore',
                teamId: 'team1',
                gameId: 'game1',
                appRoute: '/schedule/team1/game1',
            });
            expect(route).toBe('/schedule/team1/game1?section=game');
        });

        it('falls back to /games/:gameId when teamId is missing', () => {
            const route = resolvePushNotificationRoute({
                category: 'liveScore',
                gameId: 'game1',
            });
            expect(route).toBe('/games/game1');
        });

        it('encodes special characters in teamId and gameId', () => {
            const route = resolvePushNotificationRoute({
                category: 'liveScore',
                teamId: 'team/1',
                gameId: 'game 2',
            });
            expect(route).toBe('/schedule/team%2F1/game%202?section=game');
        });
    });

    describe('liveChat', () => {
        it('routes to messages with conversationId when both are present', () => {
            const route = resolvePushNotificationRoute({
                category: 'liveChat',
                teamId: 'team1',
                conversationId: 'conv1',
            });
            expect(route).toBe('/messages/team1?conversationId=conv1');
        });

        it('routes to messages without conversationId when only teamId is present', () => {
            const route = resolvePushNotificationRoute({
                category: 'liveChat',
                teamId: 'team1',
            });
            expect(route).toBe('/messages/team1');
        });
    });

    describe('appRoute passthrough', () => {
        it('uses appRoute for non-liveScore categories', () => {
            const route = resolvePushNotificationRoute({
                category: 'schedule',
                teamId: 'team1',
                appRoute: '/schedule/team1/event1',
            });
            expect(route).toBe('/schedule/team1/event1');
        });
    });

    describe('schedule', () => {
        it('routes to schedule event when teamId and eventId are present', () => {
            const route = resolvePushNotificationRoute({
                category: 'schedule',
                teamId: 'team1',
                eventId: 'evt1',
            });
            expect(route).toBe('/schedule/team1/evt1');
        });

        it('routes to schedule with teamId when only teamId is present', () => {
            const route = resolvePushNotificationRoute({
                category: 'schedule',
                teamId: 'team1',
            });
            expect(route).toBe('/schedule?teamId=team1');
        });

        it('routes to /schedule when no ids are present', () => {
            const route = resolvePushNotificationRoute({
                category: 'schedule',
            });
            expect(route).toBe('/schedule');
        });
    });

    describe('fallback', () => {
        it('returns /home for an empty payload', () => {
            const route = resolvePushNotificationRoute({});
            expect(route).toBe('/home');
        });

        it('returns /home for a null payload', () => {
            const route = resolvePushNotificationRoute(null);
            expect(route).toBe('/home');
        });
    });
});
