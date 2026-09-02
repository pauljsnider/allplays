import { describe, expect, it } from 'vitest';
import type { ParentScheduleEvent } from './scheduleLogic';
import { buildGameHubDestinations } from './scheduleHub';

function buildGame(overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  return {
    eventKey: 'team-1::game-1::player-1',
    id: 'game-1',
    teamId: 'team-1',
    teamName: 'Vipers',
    type: 'game',
    date: new Date('2026-08-29T18:00:00.000Z'),
    location: 'Main Field',
    opponent: 'Wolves',
    childId: 'player-1',
    childName: 'Avery',
    isDbGame: true,
    isCancelled: false,
    assignments: [],
    openAssignmentCount: 0,
    replayVideo: {
      provider: 'youtube',
      videoId: 'PK1HyC37doc',
      embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
      publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
      status: 'ready'
    },
    ...overrides
  };
}

describe('buildGameHubDestinations replay lifecycle', () => {
  it.each([
    ['status-only completed', { status: 'completed', liveStatus: null }],
    ['status-only final', { status: 'final', liveStatus: null }],
    ['live-status-only final', { status: null, liveStatus: 'final' }]
  ])('shows Watch replay for a linked replay on a %s game', (_label, statuses) => {
    const destinations = buildGameHubDestinations(buildGame(statuses));

    expect(destinations[0]).toMatchObject({
      id: 'watch-replay',
      actionLabel: 'Watch replay',
      url: expect.stringContaining('replay=true')
    });
  });

  it('fails closed on contradictory completion state and preserves the live CTA', () => {
    const destinations = buildGameHubDestinations(buildGame({ status: 'completed', liveStatus: 'live' }));

    expect(destinations.map((destination) => destination.id)).toEqual(['watch-live', 'match-report']);
  });
});
