import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
  sendReaction: vi.fn(),
  subscribeReactions: vi.fn(() => vi.fn()),
  isViewerChatEnabled: vi.fn()
}));

vi.mock('./adapters/legacyLiveGameReactions', () => adapterMocks);

const diamondMocks = vi.hoisted(() => ({
  createDiamondLiveEngagementRequestId: vi.fn(() => '00000000-0000-4000-8000-000000000124'),
  postDiamondLiveReaction: vi.fn(),
  subscribeDiamondLiveReactions: vi.fn(() => vi.fn())
}));

vi.mock('./diamondLiveEngagementService', () => diamondMocks);

import { sendReaction, subscribeReactions } from './adapters/legacyLiveGameReactions';
import {
  buildLiveGameReactionPayload,
  canUseLiveGameReactions,
  liveGameReactionOptions,
  sendLiveGameReaction,
  subscribeToLiveGameReactions
} from './liveGameReactionsService';

describe('liveGameReactionsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('uses the legacy viewer gate for live, same-day, and replay decisions', () => {
    vi.mocked(adapterMocks.isViewerChatEnabled)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    expect(canUseLiveGameReactions({ status: 'live' }, { now: new Date('2026-06-03T12:00:00Z') })).toBe(true);
    expect(canUseLiveGameReactions({ date: '2026-06-03T09:00:00Z' }, { now: new Date('2026-06-03T12:00:00Z') })).toBe(true);
    expect(canUseLiveGameReactions({ date: '2026-06-03T09:00:00Z' }, { isReplay: true, now: new Date('2026-06-03T12:00:00Z') })).toBe(false);

    expect(adapterMocks.isViewerChatEnabled).toHaveBeenNthCalledWith(1, { status: 'live', liveStatus: 'live' }, { now: new Date('2026-06-03T12:00:00Z') });
    expect(adapterMocks.isViewerChatEnabled).toHaveBeenNthCalledWith(2, { date: '2026-06-03T09:00:00Z', liveStatus: null }, { now: new Date('2026-06-03T12:00:00Z') });
    expect(adapterMocks.isViewerChatEnabled).toHaveBeenNthCalledWith(3, { date: '2026-06-03T09:00:00Z', liveStatus: null }, { isReplay: true, now: new Date('2026-06-03T12:00:00Z') });
  });

  it('builds web-parity live reaction payloads', () => {
    expect(buildLiveGameReactionPayload({
      type: 'heart',
      user: { uid: 'user-1', displayName: 'Coach Kim', email: 'coach@example.com', roles: [] }
    })).toEqual({
      type: 'heart',
      senderId: 'user-1'
    });

    expect(buildLiveGameReactionPayload({
      type: 'fire',
      senderId: 'viewer-123'
    })).toEqual({
      type: 'fire',
      senderId: 'viewer-123'
    });

    expect(liveGameReactionOptions.map((reaction) => reaction.key)).toEqual(['fire', 'clap', 'wow', 'heart', 'hundred']);
    expect(() => buildLiveGameReactionPayload({ type: 'boom' as any, senderId: 'viewer-123' })).toThrow('Choose a supported reaction.');
    expect(() => buildLiveGameReactionPayload({ type: 'heart', senderId: '   ' })).toThrow('Sign in before reacting.');
  });

  it('subscribes and sends through the legacy live reactions data layer', async () => {
    const callback = vi.fn();
    const unsubscribe = vi.fn();
    vi.mocked(subscribeReactions).mockReturnValue(unsubscribe as never);

    expect(subscribeToLiveGameReactions('team-1', 'game-1', callback)).toBe(unsubscribe);
    expect(subscribeReactions).toHaveBeenCalledWith('team-1', 'game-1', callback, undefined);

    const payload = await sendLiveGameReaction('team-1', 'game-1', {
      type: 'wow',
      senderId: 'viewer-123'
    });

    expect(payload).toEqual({ type: 'wow', senderId: 'viewer-123' });
    expect(sendReaction).toHaveBeenCalledWith('team-1', 'game-1', payload);
    expect(diamondMocks.postDiamondLiveReaction).not.toHaveBeenCalled();
  });

  it('pins Diamond subscriptions and reuses one secure request ID after an ambiguous failure', async () => {
    const callback = vi.fn();
    const unsubscribe = vi.fn();
    diamondMocks.subscribeDiamondLiveReactions.mockReturnValue(unsubscribe);
    expect(subscribeToLiveGameReactions(
      'team-1',
      'game-1',
      callback,
      undefined,
      { diamond: { trackingEngine: 'diamond-v2', instanceId: '00000000-0000-4000-8000-000000000001' } }
    )).toBe(unsubscribe);
    expect(diamondMocks.subscribeDiamondLiveReactions).toHaveBeenCalledWith(
      'team-1',
      'game-1',
      '00000000-0000-4000-8000-000000000001',
      callback,
      undefined
    );
    expect(subscribeReactions).not.toHaveBeenCalled();

    diamondMocks.postDiamondLiveReaction
      .mockRejectedValueOnce(Object.assign(new Error('response lost'), { code: 'functions/unavailable' }))
      .mockResolvedValueOnce({ outcome: 'accepted' });
    const input = {
      type: 'heart' as const,
      user: { uid: 'user-1', displayName: 'Coach Kim', email: 'coach@example.com', roles: [] },
      diamond: { trackingEngine: 'diamond-v2' as const, instanceId: '00000000-0000-4000-8000-000000000001' }
    };
    await expect(sendLiveGameReaction('team-1', 'game-1', input)).rejects.toThrow('response lost');
    await expect(sendLiveGameReaction('team-1', 'game-1', input)).resolves.toMatchObject({ type: 'heart' });

    expect(diamondMocks.createDiamondLiveEngagementRequestId).toHaveBeenCalledTimes(1);
    expect(diamondMocks.postDiamondLiveReaction).toHaveBeenCalledTimes(2);
    expect(diamondMocks.postDiamondLiveReaction.mock.calls[0]?.[0].requestId).toBe(
      diamondMocks.postDiamondLiveReaction.mock.calls[1]?.[0].requestId
    );
    expect(sendReaction).not.toHaveBeenCalled();
  });
});
