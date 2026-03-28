import { describe, expect, it } from 'vitest';
import {
  buildReplaySessionState,
  collectReplayStreamWindow
} from '../../js/live-game-replay.js';

describe('live game replay viewer coverage', () => {
  it('keeps completed-game replay usable without play-by-play data', () => {
    const session = buildReplaySessionState({
      teamId: 'team-1',
      gameId: 'game-9',
      game: {
        homeScore: 61,
        awayScore: 58,
        period: 'Final'
      },
      defaultPeriod: 'Q1',
      replayEvents: [],
      replayChat: [
        { id: 'chat-1', text: 'What a finish', createdAt: { toMillis: () => 2_000 } }
      ],
      replayReactions: []
    });

    expect(session.hasReplayEvents).toBe(false);
    expect(session.showReplayControls).toBe(true);
    expect(session.hideReactionsBar).toBe(true);
    expect(session.hideEndedOverlay).toBe(true);
    expect(session.disableChatComposer).toBe(true);
    expect(session.replayGameHref).toBe('game.html#teamId=team-1&gameId=game-9');
    expect(session.emptyStateMessage).toBe('No play-by-play data available for this game.');
    expect(session.finalScoreText).toBe('61 - 58');
    expect(session.scoreboard).toEqual({
      homeScore: 61,
      awayScore: 58,
      period: 'Final',
      gameClockMs: 0
    });
  });

  it('reveals replay events and chat only when their timestamps are reached', () => {
    const createdAt = (value) => ({ toMillis: () => value });
    const session = buildReplaySessionState({
      teamId: 'team-1',
      gameId: 'game-9',
      game: {
        homeScore: 61,
        awayScore: 58,
        period: 'Final'
      },
      defaultPeriod: 'Q1',
      replayEvents: [
        { id: 'event-2', description: 'Layup', gameClockMs: 15_000, homeScore: 4, awayScore: 2, period: 'Q1', createdAt: createdAt(115_000) },
        { id: 'event-1', description: 'Tip-off', gameClockMs: 5_000, homeScore: 0, awayScore: 0, period: 'Q1', createdAt: createdAt(105_000) }
      ],
      replayChat: [
        { id: 'chat-2', text: 'Huge bucket', createdAt: createdAt(116_000) },
        { id: 'chat-1', text: 'Let us go', createdAt: createdAt(106_000) }
      ],
      replayReactions: [
        { id: 'reaction-1', type: 'fire', createdAt: createdAt(117_000) }
      ]
    });

    expect(session.hasReplayEvents).toBe(true);
    expect(session.disableChatComposer).toBe(true);
    expect(session.replayStartAt).toBe(105_000);
    expect(session.replayEvents.map((event) => event.id)).toEqual(['event-1', 'event-2']);

    const beforeTip = collectReplayStreamWindow(session, 999);
    expect(beforeTip.events.map((event) => event.id)).toEqual([]);
    expect(beforeTip.chatMessages.map((message) => message.id)).toEqual([]);
    expect(beforeTip.reactions.map((reaction) => reaction.id)).toEqual([]);

    const afterFirstChat = collectReplayStreamWindow(session, 1_000);
    expect(afterFirstChat.events.map((event) => event.id)).toEqual([]);
    expect(afterFirstChat.chatMessages.map((message) => message.id)).toEqual(['chat-1']);

    const afterTip = collectReplayStreamWindow(session, 5_000);
    expect(afterTip.events.map((event) => event.id)).toEqual(['event-1']);
    expect(afterTip.chatMessages.map((message) => message.id)).toEqual(['chat-1']);
    expect(afterTip.reactions.map((reaction) => reaction.id)).toEqual([]);

    const afterSecondEvent = collectReplayStreamWindow(session, 15_000);
    expect(afterSecondEvent.events.map((event) => event.id)).toEqual(['event-1', 'event-2']);
    expect(afterSecondEvent.chatMessages.map((message) => message.id)).toEqual(['chat-1', 'chat-2']);
    expect(afterSecondEvent.reactions.map((reaction) => reaction.id)).toEqual(['reaction-1']);
  });
});
