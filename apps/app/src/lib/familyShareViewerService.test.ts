import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const familyShareMocks = vi.hoisted(() => ({
  functions: { name: 'functions' },
  getFamilyShareToken: vi.fn(),
  httpsCallable: vi.fn(),
  resolveFamilyShareTokenChildren: vi.fn()
}));
const scheduleDbMocks = vi.hoisted(() => ({
  getGames: vi.fn(),
  getTeam: vi.fn()
}));
const scheduleHelperMocks = vi.hoisted(() => ({
  expandRecurrence: vi.fn(() => []),
  extractOpponent: vi.fn((summary: string) => summary.replace(/^vs\s+/i, '') || 'TBD'),
  fetchAndParseCalendar: vi.fn(async () => []),
  getCalendarEventTrackingId: vi.fn((event: any) => event.uid || ''),
  isPracticeEvent: vi.fn((summary: string) => /practice/i.test(summary)),
  isTrackedCalendarEvent: vi.fn(() => false)
}));

vi.mock('./adapters/legacyParentTools', () => familyShareMocks);
vi.mock('./adapters/legacyScheduleDb', () => scheduleDbMocks);
vi.mock('./adapters/legacyScheduleHelpers', () => scheduleHelperMocks);

import {
  FamilyShareTokenError,
  loadFamilyShareView,
  normalizeFamilyShareChildren,
  resolveFamilyShareWatchCta,
  type FamilyShareEvent
} from './familyShareViewerService';

function buildFamilyEvent(overrides: Partial<FamilyShareEvent> = {}): FamilyShareEvent {
  return {
    eventKey: 'team-1:game-1',
    id: 'game-1',
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    date: new Date('2026-07-08T18:00:00Z'),
    title: '',
    opponent: 'Owls',
    location: 'Field 2',
    status: 'completed',
    liveStatus: 'scheduled',
    isCancelled: false,
    isDbGame: true,
    hasReplayVideo: true,
    canOpenPublicViewer: true,
    childIds: ['player-1'],
    childNames: ['Sam Player'],
    homeScore: 4,
    awayScore: 2,
    ...overrides
  };
}

describe('familyShareViewerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00Z'));
    familyShareMocks.getFamilyShareToken.mockReset();
    familyShareMocks.httpsCallable.mockReset();
    familyShareMocks.httpsCallable.mockReturnValue(vi.fn(async () => {
      throw new Error('callable unavailable');
    }));
    familyShareMocks.resolveFamilyShareTokenChildren.mockReset();
    scheduleDbMocks.getGames.mockReset();
    scheduleDbMocks.getTeam.mockReset();
    scheduleHelperMocks.expandRecurrence.mockClear();
    scheduleHelperMocks.extractOpponent.mockClear();
    scheduleHelperMocks.fetchAndParseCalendar.mockClear();
    scheduleHelperMocks.getCalendarEventTrackingId.mockClear();
    scheduleHelperMocks.isPracticeEvent.mockClear();
    scheduleHelperMocks.isTrackedCalendarEvent.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads a valid token into children, upcoming events, and recent results without auth', async () => {
    familyShareMocks.getFamilyShareToken.mockResolvedValue({
      id: 'token-1',
      label: 'Grandma schedule',
      active: true,
      expiresAt: new Date('2026-08-01T00:00:00Z'),
      children: [
        { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Sam Player', playerNumber: 12 }
      ]
    });
    scheduleDbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', calendarUrls: [] });
    scheduleDbMocks.getGames.mockResolvedValue([
      {
        id: 'game-1',
        type: 'game',
        date: new Date('2026-07-13T18:00:00Z'),
        opponent: 'Tigers',
        location: 'Field 1',
        status: 'scheduled'
      },
      {
        id: 'game-0',
        type: 'game',
        date: new Date('2026-07-08T18:00:00Z'),
        opponent: 'Owls',
        location: 'Field 2',
        status: 'final',
        homeScore: 4,
        awayScore: 2
      }
    ]);

    const model = await loadFamilyShareView('token-1');

    expect(model).toMatchObject({
      tokenId: 'token-1',
      label: 'Grandma schedule',
      children: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Sam Player' }],
      teams: [{ teamId: 'team-1', teamName: 'Bears', playerNames: ['Sam Player'] }]
    });
    expect(model.upcomingEvents.map((event) => event.id)).toEqual(['game-1']);
    expect(model.recentResults.map((event) => event.id)).toEqual(['game-0']);
    expect(familyShareMocks.resolveFamilyShareTokenChildren).not.toHaveBeenCalled();
    expect(scheduleDbMocks.getTeam).toHaveBeenCalledWith('team-1');
    expect(scheduleDbMocks.getGames).toHaveBeenCalledWith('team-1');
  });

  it('loads private team schedules through the bearer-token callable without direct team reads', async () => {
    const scheduleCallable = vi.fn(async () => ({
      data: {
        children: [
          { teamId: 'team-private', teamName: 'Bears', playerId: 'player-1', playerName: 'Sam Player' }
        ],
        teams: [
          {
            teamId: 'team-private',
            teamName: 'Bears',
            calendarUrls: [],
            games: [
              {
                id: 'private-game-1',
                type: 'game',
                date: '2026-07-13T18:00:00.000Z',
                opponent: 'Tigers',
                location: 'Private Field',
                status: 'scheduled'
              }
            ]
          }
        ]
      }
    }));
    familyShareMocks.httpsCallable.mockReturnValue(scheduleCallable);
    familyShareMocks.getFamilyShareToken.mockResolvedValue({
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      label: 'Grandma schedule',
      active: true,
      expiresAt: new Date('2026-08-01T00:00:00Z'),
      children: [
        { teamId: 'team-private', teamName: 'Bears', playerId: 'player-1', playerName: 'Sam Player' }
      ]
    });

    const model = await loadFamilyShareView('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(familyShareMocks.httpsCallable).toHaveBeenCalledWith(familyShareMocks.functions, 'getFamilyShareSchedule');
    expect(scheduleCallable).toHaveBeenCalledWith({ tokenId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(scheduleDbMocks.getTeam).not.toHaveBeenCalled();
    expect(scheduleDbMocks.getGames).not.toHaveBeenCalled();
    expect(model.upcomingEvents).toEqual([
      expect.objectContaining({
        id: 'private-game-1',
        teamId: 'team-private',
        teamName: 'Bears',
        opponent: 'Tigers'
      })
    ]);
  });

  it('does not classify an active game with scores as a recent result', async () => {
    const viewCallable = vi.fn(async () => ({
      data: {
        projectionVersion: 2,
        presentation: { label: 'Live family schedule', expiresAt: null },
        children: [{ teamId: 'team-live', teamName: 'Bears', playerId: 'player-1', playerName: 'Sam Player' }],
        teams: [{
          teamId: 'team-live',
          teamName: 'Bears',
          games: [{
            id: 'game-live',
            type: 'game',
            date: '2026-07-12T18:00:00.000Z',
            opponent: 'Tigers',
            status: 'scheduled',
            liveStatus: 'live',
            homeScore: 3,
            awayScore: 2,
            canOpenPublicViewer: true
          }]
        }],
        externalEvents: [],
        calendarWarnings: []
      }
    }));
    familyShareMocks.httpsCallable.mockReturnValue(viewCallable);

    const model = await loadFamilyShareView('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(model.upcomingEvents.map((event) => event.id)).toEqual(['game-live']);
    expect(model.recentResults).toEqual([]);
  });

  it('uses the versioned view projection without reading token source fields or fetching raw calendars', async () => {
    const viewCallable = vi.fn(async () => ({
      data: {
        projectionVersion: 2,
        presentation: { label: 'Grandma schedule', expiresAt: '2026-08-01T00:00:00.000Z' },
        children: [{ teamId: 'team-private', teamName: 'Bears', playerId: 'player-1', playerName: 'Sam Player' }],
        teams: [{
          teamId: 'team-private',
          teamName: 'Bears',
          games: [
            {
              id: 'game-1',
              type: 'game',
              date: '2026-07-13T18:00:00.000Z',
              opponent: 'Tigers',
              status: 'completed',
              liveStatus: 'scheduled',
              hasReplayVideo: true,
              canOpenPublicViewer: true
            },
            {
              id: 'game-timeline',
              type: 'game',
              date: '2026-07-12T18:00:00.000Z',
              opponent: 'Foxes',
              liveStatus: 'completed',
              hasReplayVideo: false,
              canOpenPublicViewer: true
            }
          ]
        }],
        externalEvents: [{
          eventKey: 'external-1',
          id: 'external-1',
          teamId: '',
          teamName: 'Shared calendar',
          type: 'practice',
          date: '2026-07-14T18:00:00.000Z',
          title: 'Skills practice',
          location: 'Blue Valley Recreation Sports Complex',
          locationDetail: 'Field 2',
          childIds: ['player-1'],
          childNames: ['Sam Player']
        }],
        calendarWarnings: []
      }
    }));
    familyShareMocks.httpsCallable.mockImplementation((_functions, name) => {
      expect(name).toBe('getFamilyShareView');
      return viewCallable;
    });

    const model = await loadFamilyShareView('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(familyShareMocks.getFamilyShareToken).not.toHaveBeenCalled();
    expect(scheduleDbMocks.getTeam).not.toHaveBeenCalled();
    expect(scheduleDbMocks.getGames).not.toHaveBeenCalled();
    expect(scheduleHelperMocks.fetchAndParseCalendar).not.toHaveBeenCalled();
    expect(model.events.map((event) => event.id)).toEqual(['game-timeline', 'game-1', 'external-1']);
    expect(model.events.find((event) => event.id === 'external-1')?.locationDetail).toBe('Field 2');
    expect(model.events.find((event) => event.id === 'game-1')).toMatchObject({
      status: 'completed',
      liveStatus: 'scheduled',
      hasReplayVideo: true,
      canOpenPublicViewer: true
    });
    expect(model.events.find((event) => event.id === 'external-1')).toMatchObject({
      liveStatus: null,
      hasReplayVideo: false,
      canOpenPublicViewer: false
    });
    const timelineEvent = model.events.find((event) => event.id === 'game-timeline');
    expect(timelineEvent).toMatchObject({
      status: '',
      liveStatus: 'completed',
      hasReplayVideo: false,
      canOpenPublicViewer: true
    });
    expect(timelineEvent && resolveFamilyShareWatchCta(timelineEvent)).toMatchObject({
      kind: 'replay',
      label: 'Watch Replay'
    });
    expect(JSON.stringify(model)).not.toContain('extraCalendarUrls');
    expect(JSON.stringify(model)).not.toContain('ownerUserId');
  });

  it('preserves authoritative expired projection errors without falling back to the raw token document', async () => {
    const callable = vi.fn(async () => {
      throw { code: 'functions/permission-denied', details: { reason: 'expired' } };
    });
    familyShareMocks.httpsCallable.mockReturnValue(callable);

    await expect(loadFamilyShareView('token-expired-projection')).rejects.toMatchObject({
      name: 'FamilyShareTokenError',
      reason: 'expired'
    });
    expect(familyShareMocks.getFamilyShareToken).not.toHaveBeenCalled();
  });

  it('propagates a throttled view projection without invoking any fallback reader', async () => {
    const viewCallable = vi.fn(async () => {
      throw { code: 'functions/resource-exhausted', details: { retryAfterSeconds: 37 } };
    });
    familyShareMocks.httpsCallable.mockImplementation((_functions, name) => {
      expect(name).toBe('getFamilyShareView');
      return viewCallable;
    });

    await expect(loadFamilyShareView('token-throttled-projection')).rejects.toMatchObject({
      name: 'FamilyShareTokenError',
      reason: 'throttled',
      retryAfterSeconds: 37
    });
    expect(viewCallable).toHaveBeenCalledTimes(1);
    expect(familyShareMocks.getFamilyShareToken).not.toHaveBeenCalled();
    expect(familyShareMocks.resolveFamilyShareTokenChildren).not.toHaveBeenCalled();
    expect(familyShareMocks.httpsCallable).toHaveBeenCalledTimes(1);
  });

  it('honors a successful empty server projection without trusting stored token children', async () => {
    const scheduleCallable = vi.fn(async () => ({
      data: {
        children: [],
        teams: []
      }
    }));
    familyShareMocks.httpsCallable.mockReturnValue(scheduleCallable);
    familyShareMocks.getFamilyShareToken.mockResolvedValue({
      id: 'token-with-revoked-scope',
      label: 'Former family access',
      active: true,
      children: [
        { teamId: 'team-private', teamName: 'Bears', playerId: 'player-1', playerName: 'Sam Player' }
      ]
    });
    scheduleDbMocks.getTeam.mockResolvedValue({ id: 'team-private', name: 'Bears', calendarUrls: [] });
    scheduleDbMocks.getGames.mockResolvedValue([
      {
        id: 'private-game-1',
        type: 'game',
        date: new Date('2026-07-13T18:00:00Z'),
        opponent: 'Tigers',
        status: 'scheduled'
      }
    ]);

    const model = await loadFamilyShareView('token-with-revoked-scope');

    expect(scheduleCallable).toHaveBeenCalledWith({ tokenId: 'token-with-revoked-scope' });
    expect(model.children).toEqual([]);
    expect(model.teams).toEqual([]);
    expect(model.events).toEqual([]);
    expect(familyShareMocks.resolveFamilyShareTokenChildren).not.toHaveBeenCalled();
    expect(scheduleDbMocks.getTeam).not.toHaveBeenCalled();
    expect(scheduleDbMocks.getGames).not.toHaveBeenCalled();
  });

  it('resolves legacy callable children when older tokens do not store children', async () => {
    familyShareMocks.getFamilyShareToken.mockResolvedValue({
      id: 'token-legacy',
      label: 'Legacy family',
      active: true,
      children: []
    });
    familyShareMocks.resolveFamilyShareTokenChildren.mockResolvedValue([
      { teamId: 'team-2', teamName: 'Hawks', childId: 'player-2', childName: 'Ari Player' }
    ]);
    scheduleDbMocks.getTeam.mockResolvedValue({ id: 'team-2', name: 'Hawks', calendarUrls: [] });
    scheduleDbMocks.getGames.mockResolvedValue([]);

    const model = await loadFamilyShareView('token-legacy');

    expect(model.children).toEqual([
      expect.objectContaining({ teamId: 'team-2', playerId: 'player-2', playerName: 'Ari Player' })
    ]);
    expect(familyShareMocks.resolveFamilyShareTokenChildren).toHaveBeenCalledWith('token-legacy');
  });

  it.each([
    ['missing', '', null],
    ['invalid', 'token-missing', null],
    ['revoked', 'token-revoked', { active: false }],
    ['expired', 'token-expired', { active: true, expiresAt: new Date('2026-07-01T00:00:00Z') }]
  ] as const)('rejects %s family share tokens with a friendly reason', async (reason, tokenId, token) => {
    if (tokenId) familyShareMocks.getFamilyShareToken.mockResolvedValue(token);

    await expect(loadFamilyShareView(tokenId)).rejects.toMatchObject({
      name: 'FamilyShareTokenError',
      reason
    } satisfies Partial<FamilyShareTokenError>);
  });

  it('normalizes token children and removes incomplete or duplicate links', () => {
    expect(normalizeFamilyShareChildren([
      { teamId: 'team-1', playerId: 'player-1', playerName: 'Sam' },
      { teamId: 'team-1', playerId: 'player-1', playerName: 'Sam Duplicate' },
      { teamId: 'team-2', childId: 'player-2', childName: 'Ari' },
      { teamId: '', playerId: 'missing-team' },
      { teamId: 'team-3' }
    ])).toEqual([
      expect.objectContaining({ teamId: 'team-1', playerId: 'player-1', playerName: 'Sam' }),
      expect.objectContaining({ teamId: 'team-2', playerId: 'player-2', playerName: 'Ari' })
    ]);
  });

  it('builds public replay and live links only from ordered server-projected lifecycle signals', () => {
    expect(resolveFamilyShareWatchCta(buildFamilyEvent())).toEqual({
      kind: 'replay',
      label: 'Watch Replay',
      href: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true'
    });
    expect(resolveFamilyShareWatchCta(buildFamilyEvent({
      hasReplayVideo: false,
      liveStatus: 'FINAL'
    }))).toBeNull();
    expect(resolveFamilyShareWatchCta(buildFamilyEvent({
      status: '',
      liveStatus: 'completed',
      hasReplayVideo: false
    }))).toMatchObject({ kind: 'replay', label: 'Watch Replay' });
    expect(resolveFamilyShareWatchCta(buildFamilyEvent({
      status: 'scheduled',
      liveStatus: 'live',
      hasReplayVideo: false
    }))).toEqual({
      kind: 'live',
      label: 'Watch Live',
      href: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1'
    });
    const sharedPath = `organizations/${'o'.repeat(128)}/sharedGames/${'g'.repeat(128)}`;
    const sharedId = `shared_${encodeURIComponent(sharedPath)}`;
    expect(resolveFamilyShareWatchCta(buildFamilyEvent({ id: sharedId }))).toEqual({
      kind: 'replay',
      label: 'Watch Replay',
      href: `https://allplays.ai/live-game.html?teamId=team-1&gameId=${encodeURIComponent(sharedId)}&replay=true`
    });
  });

  it.each([
    ['missing replay evidence', { hasReplayVideo: false }],
    ['private public projection', { canOpenPublicViewer: false }],
    ['completed report while still live', { liveStatus: 'live' }],
    ['reverse completion lifecycle', { status: 'scheduled', liveStatus: 'completed' }],
    ['padded lifecycle rejected by server', { status: ' completed ', liveStatus: 'scheduled' }],
    ['cancelled game', { isCancelled: true }],
    ['practice', { type: 'practice' as const }],
    ['missing team identifier', { teamId: '' }],
    ['missing game identifier', { id: '' }]
  ])('does not expose a family watch link for %s', (_label, overrides) => {
    expect(resolveFamilyShareWatchCta(buildFamilyEvent(overrides))).toBeNull();
  });
});
