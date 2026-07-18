import { describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
    postLiveChatMessage: vi.fn(),
    subscribeLiveChat: vi.fn(() => vi.fn()),
    isViewerChatEnabled: vi.fn(),
    resolveSafeProfilePhotoUrl: vi.fn((value: unknown) => (
        typeof value === 'string' && value.startsWith('https://lh3.googleusercontent.com/') ? value : ''
    ))
}));

vi.mock('./adapters/legacyLiveGameChat', () => adapterMocks);

import { postLiveChatMessage, subscribeLiveChat } from './adapters/legacyLiveGameChat';
import { buildLiveGameChatPayload, canUseLiveGameChat, sendLiveGameChatMessage, subscribeToLiveGameChat } from './liveGameChatService';

describe('liveGameChatService', () => {
    it('uses the legacy viewer chat gate for live, same-day, and replay decisions', () => {
        vi.mocked(adapterMocks.isViewerChatEnabled)
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false);

        expect(canUseLiveGameChat({ status: 'live' }, { now: new Date('2026-06-03T12:00:00Z') })).toBe(true);
        expect(canUseLiveGameChat({ date: '2026-06-03T09:00:00Z' }, { now: new Date('2026-06-03T12:00:00Z') })).toBe(true);
        expect(canUseLiveGameChat({ date: '2026-06-03T09:00:00Z' }, { isReplay: true, now: new Date('2026-06-03T12:00:00Z') })).toBe(false);

        expect(adapterMocks.isViewerChatEnabled).toHaveBeenNthCalledWith(1, { status: 'live', liveStatus: 'live' }, { now: new Date('2026-06-03T12:00:00Z') });
        expect(adapterMocks.isViewerChatEnabled).toHaveBeenNthCalledWith(2, { date: '2026-06-03T09:00:00Z', liveStatus: null }, { now: new Date('2026-06-03T12:00:00Z') });
        expect(adapterMocks.isViewerChatEnabled).toHaveBeenNthCalledWith(3, { date: '2026-06-03T09:00:00Z', liveStatus: null }, { isReplay: true, now: new Date('2026-06-03T12:00:00Z') });
    });

    it('builds signed-in and anonymous live chat payloads', () => {
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

        expect(buildLiveGameChatPayload({
            text: 'Nice play',
            anonymousDisplayName: 'Grandma Pat'
        })).toEqual({
            text: 'Nice play',
            senderId: null,
            senderName: 'Grandma Pat',
            senderPhotoUrl: null,
            isAnonymous: true
        });

        expect(() => buildLiveGameChatPayload({ text: '   ', anonymousDisplayName: 'Pat' })).toThrow('Enter a message');
        expect(() => buildLiveGameChatPayload({ text: 'Hi', anonymousDisplayName: '   ' })).toThrow('Add a display name');
    });

    it('keeps trusted profile photos and drops legacy untrusted photos without blocking chat', () => {
        const trustedPhotoUrl = 'https://lh3.googleusercontent.com/a/profile-photo';

        expect(
            buildLiveGameChatPayload({
                text: 'Trusted avatar',
                user: { uid: 'user-1', displayName: 'Coach Kim', email: 'coach@example.com', photoUrl: trustedPhotoUrl, roles: [] }
            }).senderPhotoUrl
        ).toBe(trustedPhotoUrl);

        expect(
            buildLiveGameChatPayload({
                text: 'Legacy avatar',
                user: { uid: 'user-2', displayName: 'Coach Lee', email: 'lee@example.com', photoUrl: 'https://example.com/photo.png', roles: [] }
            }).senderPhotoUrl
        ).toBeNull();

        expect(adapterMocks.resolveSafeProfilePhotoUrl).toHaveBeenCalledWith(trustedPhotoUrl);
        expect(adapterMocks.resolveSafeProfilePhotoUrl).toHaveBeenCalledWith('https://example.com/photo.png');
    });

    it('subscribes and posts through the legacy live chat data layer', async () => {
        const callback = vi.fn();
        const unsubscribe = vi.fn();
        vi.mocked(subscribeLiveChat).mockReturnValue(unsubscribe as never);

        expect(subscribeToLiveGameChat('team-1', 'game-1', callback)).toBe(unsubscribe);
        expect(subscribeLiveChat).toHaveBeenCalledWith('team-1', 'game-1', { limit: 100 }, callback, undefined);

        const payload = await sendLiveGameChatMessage('team-1', 'game-1', {
            text: 'Defense!',
            anonymousDisplayName: 'Pat'
        });

        expect(payload).toMatchObject({ senderName: 'Pat', isAnonymous: true, text: 'Defense!' });
        expect(postLiveChatMessage).toHaveBeenCalledWith('team-1', 'game-1', payload);
    });
});
