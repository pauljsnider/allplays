import { describe, it, expect } from 'vitest';
import { isViewerChatEnabled } from '../../js/live-game-chat.js';

describe('live game chat availability', () => {
  it('enables chat when the game is scheduled for today', () => {
    const now = new Date('2026-02-24T18:00:00.000Z');
    const game = { date: '2026-02-24T01:00:00.000Z', liveStatus: 'scheduled' };
    expect(isViewerChatEnabled(game, { now })).toBe(true);
  });

  it('disables chat in replay mode', () => {
    const now = new Date('2026-02-24T18:00:00.000Z');
    const game = { date: '2026-02-24T01:00:00.000Z', liveStatus: 'live' };
    expect(isViewerChatEnabled(game, { isReplay: true, now })).toBe(false);
  });

  it('keeps chat enabled for live games even if the scheduled date is not today', () => {
    const now = new Date('2026-02-24T18:00:00.000Z');
    const game = { date: '2026-02-23T23:30:00.000Z', liveStatus: 'live' };
    expect(isViewerChatEnabled(game, { now })).toBe(true);
  });
});
