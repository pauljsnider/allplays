import { describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    postLiveChatMessage: vi.fn(),
    subscribeLiveChat: vi.fn(() => vi.fn())
}));

const legacyChatMocks = vi.hoisted(() => ({
    isViewerChatEnabled: vi.fn()
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/live-game-chat.js', () => legacyChatMocks);

import { postLiveChatMessage, subscribeLiveChat } from '../../../../js/db.js';
import { buildLiveGameChatPayload, canUseLiveGameChat, sendLiveGameChatMessage, subscribeToLiveGameChat } from './liveGameChatService';

describe('liveGameChatService', () => {
    it('uses the legacy viewer chat gate for live, same-day, and replay decisions', () => {
        vi.mocked(legacyChatMocks.isViewerChatEnabled)
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false);

        expect(canUseLiveGameChat({ status: 'live' }, { now: new Date('2026-06-03T12:00:00Z') })).toBe(true);
        expect(canUseLiveGameChat({ date: '2026-06-03T09:00:00Z' }, { now: new Date('2026-06-03T12:00:00Z') })).toBe(true);
        expect(canUseLiveGameChat({ date: '2026-06-03T09:00:00Z' }, { isReplay: true, now: new Date('2026-06-03T12:00:00Z') })).toBe(false);

        expect(legacyChatMocks.isViewerChatEnabled).toHaveBeenNthCalledWith(1, { status: 'live', liveStatus: 'live' }, { now: new Date('2026-06-03T12:00:00Z') });
        expect(legacyChatMocks.isViewerChatEnabled).toHaveBeenNthCalledWith(2, { date: '2026-06-03T09:00:00Z', liveStatus: null }, { now: new Date('2026-06-03T12:00:00Z') });
        expect(legacyChatMocks.isViewerChatEnabled).toHaveBeenNthCalledWith(3, { date: '2026-06-03T09:00:00Z', liveStatus: null }, { isReplay: true, now: new Date('2026-06-03T12:00:00Z') });
    });

    it('builds signed-in live chat payloads', () => {
        expect(buildLiveGameChatPayload({
            text: ' Let\'s go ',
            user: { uid: 'user-1', displayName: 'Coach Kim', email: 'coach@example.com', roles: [] }
        })).toEqual({
            text: 'Let\'s go',
            senderId: 'user-1',
            senderName: 'Coach Kim',
            senderPhotoUrl: null,
            isAnonymous: false
        });

        expect(() => buildLiveGameChatPayload({ text: '   ', anonymousDisplayName: 'Pat' })).toThrow('Enter a message');
        expect(() => buildLiveGameChatPayload({ text: 'Hi', anonymousDisplayName: 'Pat' })).toThrow('Sign in before chatting.');
        expect(() => buildLiveGameChatPayload({ text: 'Hi', user: { uid: 'user-1', email: '', displayName: '', roles: [] } })).toThrow('Add a display name');
    });

    it('subscribes and posts through the legacy live chat data layer', async () => {
        const callback = vi.fn();
        const unsubscribe = vi.fn();
        vi.mocked(subscribeLiveChat).mockReturnValue(unsubscribe as never);

        expect(subscribeToLiveGameChat('team-1', 'game-1', callback)).toBe(unsubscribe);
        expect(subscribeLiveChat).toHaveBeenCalledWith('team-1', 'game-1', { limit: 100 }, callback, undefined);

        const payload = await sendLiveGameChatMessage('team-1', 'game-1', {
            text: 'Defense!',
            user: { uid: 'user-1', displayName: 'Pat', email: 'pat@example.test', roles: [] }
        });

        expect(payload).toMatchObject({ senderId: 'user-1', senderName: 'Pat', isAnonymous: false, text: 'Defense!' });
        expect(postLiveChatMessage).toHaveBeenCalledWith('team-1', 'game-1', payload);
    });
});
