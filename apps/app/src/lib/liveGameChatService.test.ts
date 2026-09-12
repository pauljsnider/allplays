import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
    postLiveChatMessage: vi.fn(),
    subscribeLiveChat: vi.fn(() => vi.fn()),
    isViewerChatEnabled: vi.fn(),
    resolveSafeProfilePhotoWriteUrl: vi.fn((value: unknown) => (
        typeof value === 'string' && value.startsWith('https://lh3.googleusercontent.com/') ? value : ''
    ))
}));

vi.mock('./adapters/legacyLiveGameChat', () => adapterMocks);

const diamondMocks = vi.hoisted(() => ({
    createDiamondLiveEngagementRequestId: vi.fn(() => '00000000-0000-4000-8000-000000000123'),
    moderateDiamondLiveChat: vi.fn(),
    postDiamondLiveChat: vi.fn(),
    subscribeDiamondLiveChat: vi.fn(() => vi.fn())
}));

vi.mock('./diamondLiveEngagementService', () => diamondMocks);

import { postLiveChatMessage, subscribeLiveChat } from './adapters/legacyLiveGameChat';
import { buildLiveGameChatPayload, canUseLiveGameChat, moderateLiveGameChatMessage, sendLiveGameChatMessage, subscribeToLiveGameChat } from './liveGameChatService';

describe('liveGameChatService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
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

        const attackerFirebasePhoto = 'https://firebasestorage.googleapis.com/v0/b/attacker-owned.firebasestorage.app/o/avatar.png?alt=media';
        expect(
            buildLiveGameChatPayload({
                text: 'Third-party Firebase avatar',
                user: { uid: 'user-3', displayName: 'Coach Ray', email: 'ray@example.com', photoUrl: attackerFirebasePhoto, roles: [] }
            }).senderPhotoUrl
        ).toBeNull();

        expect(adapterMocks.resolveSafeProfilePhotoWriteUrl).toHaveBeenCalledWith(trustedPhotoUrl);
        expect(adapterMocks.resolveSafeProfilePhotoWriteUrl).toHaveBeenCalledWith('https://example.com/photo.png');
        expect(adapterMocks.resolveSafeProfilePhotoWriteUrl).toHaveBeenCalledWith(attackerFirebasePhoto);
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
        expect(diamondMocks.postDiamondLiveChat).not.toHaveBeenCalled();
    });

    it('pins Diamond subscriptions and reuses one secure request ID after an ambiguous failure', async () => {
        const callback = vi.fn();
        const unsubscribe = vi.fn();
        diamondMocks.subscribeDiamondLiveChat.mockReturnValue(unsubscribe);
        expect(subscribeToLiveGameChat(
            'team-1',
            'game-1',
            callback,
            undefined,
            { diamond: { trackingEngine: 'diamond-v2', instanceId: '00000000-0000-4000-8000-000000000001' } }
        )).toBe(unsubscribe);
        expect(diamondMocks.subscribeDiamondLiveChat).toHaveBeenCalledWith(
            'team-1',
            'game-1',
            '00000000-0000-4000-8000-000000000001',
            callback,
            undefined
        );
        expect(subscribeLiveChat).not.toHaveBeenCalled();

        diamondMocks.postDiamondLiveChat
            .mockRejectedValueOnce(Object.assign(new Error('response lost'), { code: 'functions/unavailable' }))
            .mockResolvedValueOnce({ outcome: 'accepted' });
        const input = {
            text: 'Safe retry',
            user: { uid: 'user-1', displayName: 'Coach Kim', email: 'coach@example.com', roles: [] },
            diamond: { trackingEngine: 'diamond-v2' as const, instanceId: '00000000-0000-4000-8000-000000000001' }
        };
        await expect(sendLiveGameChatMessage('team-1', 'game-1', input)).rejects.toThrow('response lost');
        await expect(sendLiveGameChatMessage('team-1', 'game-1', input)).resolves.toMatchObject({ text: 'Safe retry' });

        expect(diamondMocks.createDiamondLiveEngagementRequestId).toHaveBeenCalledTimes(1);
        expect(diamondMocks.postDiamondLiveChat).toHaveBeenCalledTimes(2);
        expect(diamondMocks.postDiamondLiveChat.mock.calls[0]?.[0].requestId).toBe(
            diamondMocks.postDiamondLiveChat.mock.calls[1]?.[0].requestId
        );
        expect(postLiveChatMessage).not.toHaveBeenCalled();
    });

    it('reuses the exact moderation request after an ambiguous delete response', async () => {
        const messageId = `diamond-chat-${'a'.repeat(64)}`;
        diamondMocks.moderateDiamondLiveChat
            .mockRejectedValueOnce(Object.assign(new Error('response lost'), { code: 'functions/unavailable' }))
            .mockResolvedValueOnce({ outcome: 'accepted', removed: true });
        const input = {
            user: { uid: 'manager-1', displayName: 'Coach Kim', email: 'coach@example.com', roles: [] },
            diamond: { trackingEngine: 'diamond-v2' as const, instanceId: '00000000-0000-4000-8000-000000000001' }
        };
        await expect(moderateLiveGameChatMessage('team-1', 'game-1', messageId, input)).rejects.toThrow('response lost');
        await expect(moderateLiveGameChatMessage('team-1', 'game-1', messageId, input)).resolves.toBeUndefined();
        expect(diamondMocks.moderateDiamondLiveChat).toHaveBeenCalledTimes(2);
        expect(diamondMocks.moderateDiamondLiveChat.mock.calls[0]?.[0].requestId).toBe(
            diamondMocks.moderateDiamondLiveChat.mock.calls[1]?.[0].requestId
        );
    });
});
