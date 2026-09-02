import { describe, expect, it } from 'vitest';
import type { ParentScheduleEvent } from './scheduleLogic';
import { buildGameHubDestinations } from './scheduleHub';

function buildGame(overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  const event: ParentScheduleEvent = {
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
    rawReplayLifecycle: { type: 'game', status: 'completed', liveStatus: 'completed' },
    assignments: [],
    openAssignmentCount: 0,
    hasRecordedReplay: true,
    hasReplayVideo: true,
    replayArchiveRevision: 'revision-1',
    replayArchiveState: 'ready',
    ...overrides
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'rawReplayLifecycle')) {
    event.rawReplayLifecycle = {
      type: event.type,
      status: event.status,
      liveStatus: event.liveStatus
    };
  }
  return event;
}

describe('buildGameHubDestinations replay lifecycle', () => {
  it.each([
    ['status-only completed', { status: 'completed', liveStatus: null }],
    ['status-only final', { status: 'final', liveStatus: null }],
    ['live-status-only final', { status: null, liveStatus: 'final' }],
    ['statsheet completed', { status: 'completed', liveStatus: 'scheduled' }]
  ])('shows Watch replay for a linked replay on a %s game', (_label, statuses) => {
    const destinations = buildGameHubDestinations(buildGame(statuses));

    expect(destinations[0]).toMatchObject({
      id: 'watch-replay',
      actionLabel: 'Watch replay',
      url: expect.stringContaining('replay=true')
    });
  });

  it('fails closed on contradictory completion state without advertising a live feed', () => {
    const destinations = buildGameHubDestinations(buildGame({
      status: 'completed',
      liveStatus: 'live',
      rawReplayLifecycle: { type: 'game', status: 'completed', liveStatus: 'live' }
    }));

    expect(destinations.map((destination) => destination.id)).toEqual(['match-report']);
  });

  it('shows Watch live only for a compatible active lifecycle', () => {
    expect(buildGameHubDestinations(buildGame({
      status: 'scheduled',
      liveStatus: 'live',
      rawReplayLifecycle: { type: 'game', status: 'scheduled', liveStatus: 'live' }
    }))[0]?.id)
      .toBe('watch-live');
    for (const status of ['cancelled', 'postponed']) {
      expect(buildGameHubDestinations(buildGame({
        status,
        liveStatus: 'live',
        rawReplayLifecycle: { type: 'game', status, liveStatus: 'live' }
      }))
        .map((destination) => destination.id)).toEqual(['match-report']);
    }
  });

  it('does not advertise replay or live from normalized values when the raw lifecycle is padded', () => {
    const destinations = buildGameHubDestinations(buildGame({
      status: 'completed',
      liveStatus: 'scheduled',
      rawReplayLifecycle: { type: 'game', status: 'completed ', liveStatus: 'scheduled' }
    }));

    expect(destinations.map((destination) => destination.id)).toEqual(['match-report']);
  });

  it('keeps report-only statsheet completions from advertising an unavailable replay', () => {
    const destinations = buildGameHubDestinations(buildGame({
      status: 'completed',
      liveStatus: 'scheduled',
      hasRecordedReplay: false,
      hasReplayVideo: false,
      replayArchiveState: 'none'
    }));

    expect(destinations.map((destination) => destination.id)).toEqual(['match-report']);
  });

  it('does not treat a false safe marker as playable video evidence', () => {
    const destinations = buildGameHubDestinations(buildGame({
      status: 'completed',
      liveStatus: 'scheduled',
      hasRecordedReplay: false,
      hasReplayVideo: false,
      replayArchiveState: 'none'
    }));

    expect(destinations.map((destination) => destination.id)).toEqual(['match-report']);
  });
});
