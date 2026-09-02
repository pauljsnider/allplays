import { describe, it, expect } from 'vitest';
import { isViewerChatEnabled } from '../../js/live-game-chat.js';

describe('live game chat availability', () => {
  it('enables chat when the game is scheduled for today', () => {
    const now = new Date(2026, 1, 24, 18, 0, 0);
    const game = { date: new Date(2026, 1, 24, 1, 0, 0), liveStatus: 'scheduled' };
    expect(isViewerChatEnabled(game, { now })).toBe(true);
  });

  it('disables chat in replay mode', () => {
    const now = new Date(2026, 1, 24, 18, 0, 0);
    const game = { date: new Date(2026, 1, 24, 1, 0, 0), liveStatus: 'live' };
    expect(isViewerChatEnabled(game, { isReplay: true, now })).toBe(false);
  });

  it('keeps chat enabled for live games even if the scheduled date is not today', () => {
    const now = new Date(2026, 1, 24, 18, 0, 0);
    const game = { date: new Date(2026, 1, 23, 23, 30, 0), liveStatus: 'live' };
    expect(isViewerChatEnabled(game, { now })).toBe(true);
  });

  it('disables chat for a cancelled same-day game with stale live status', () => {
    const now = new Date(2026, 1, 24, 18, 0, 0);
    const game = {
      date: new Date(2026, 1, 24, 1, 0, 0),
      status: 'cancelled',
      liveStatus: 'live'
    };

    expect(isViewerChatEnabled(game, { now })).toBe(false);
  });

  it.each([
    { status: 'completed', liveStatus: 'live' },
    { status: 'cancelled', liveStatus: 'live' },
    { status: 'postponed', liveStatus: 'live' },
    { status: 'scheduled', liveStatus: 'live', isCancelled: true }
  ])('disables chat for an incompatible active lifecycle %#', (lifecycle) => {
    const now = new Date(2026, 1, 24, 18, 0, 0);
    expect(isViewerChatEnabled({
      date: new Date(2026, 1, 24, 1, 0, 0),
      ...lifecycle
    }, { now })).toBe(false);
  });

  it('keeps chat enabled for a compatible scheduled live lifecycle', () => {
    const now = new Date(2026, 1, 24, 18, 0, 0);
    expect(isViewerChatEnabled({
      date: new Date(2026, 1, 23, 1, 0, 0),
      status: 'scheduled',
      liveStatus: 'live'
    }, { now })).toBe(true);
  });
});
