import { describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
  sendReaction: vi.fn(),
  subscribeReactions: vi.fn(() => vi.fn()),
  isViewerChatEnabled: vi.fn()
}));

vi.mock('./adapters/legacyLiveGameReactions', () => adapterMocks);

import { sendReaction, subscribeReactions } from './adapters/legacyLiveGameReactions';
import {
  buildLiveGameReactionPayload,
  canUseLiveGameReactions,
  liveGameReactionOptions,
  sendLiveGameReaction,
  subscribeToLiveGameReactions
} from './liveGameReactionsService';

describe('liveGameReactionsService', () => {
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
  });
});
