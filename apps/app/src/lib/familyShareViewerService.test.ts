import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const familyShareMocks = vi.hoisted(() => ({
  functions: { name: 'functions' },
  httpsCallable: vi.fn()
}));
const scheduleHelperMocks = vi.hoisted(() => ({
  expandRecurrence: vi.fn(() => [])
}));

vi.mock('./adapters/legacyParentTools', () => familyShareMocks);
vi.mock('./adapters/legacyScheduleHelpers', () => scheduleHelperMocks);

import { FamilyShareTokenError, loadFamilyShareView, normalizeFamilyShareChildren } from './familyShareViewerService';

describe('familyShareViewerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00Z'));
    familyShareMocks.httpsCallable.mockReset();
    scheduleHelperMocks.expandRecurrence.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the complete server projection and preserves known events plus calendar warnings', async () => {
    const viewCallable = vi.fn(async () => ({
      data: {
        projectionVersion: 2,
        presentation: { label: 'Grandma schedule', expiresAt: '2026-08-01T00:00:00.000Z' },
        children: [{
          teamId: 'team-private',
          teamName: 'Bears',
          playerId: 'player-1',
          playerName: 'Sam Player'
        }],
        teams: [{
          teamId: 'team-private',
          teamName: 'Bears',
          games: [{
            id: 'game-1',
            type: 'game',
            date: '2026-07-13T18:00:00.000Z',
            opponent: 'Tigers',
            location: 'Field 1'
          }]
        }],
        externalEvents: [{
          eventKey: 'team-private:calendar-uid-1:2026-07-14T18:00:00.000Z:practice',
          id: 'calendar-uid-1',
          teamId: 'team-private',
          teamName: 'Bears',
          type: 'practice',
          date: '2026-07-14T18:00:00.000Z',
          title: 'Skills practice',
          location: 'Blue Valley Recreation Sports Complex',
          locationDetail: 'Field 2',
          childIds: ['player-1'],
          childNames: ['Sam Player']
        }],
        calendarWarnings: ['Bears could not be loaded.']
      }
    }));
    familyShareMocks.httpsCallable.mockImplementation((_functions, name) => {
      expect(name).toBe('getFamilyShareView');
      return viewCallable;
    });

    const model = await loadFamilyShareView('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(viewCallable).toHaveBeenCalledWith({ tokenId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(model).toMatchObject({
      label: 'Grandma schedule',
      children: [{ teamId: 'team-private', playerId: 'player-1', playerName: 'Sam Player' }],
      calendarWarnings: ['Bears could not be loaded.']
    });
    expect(model.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'game-1', isDbGame: true }),
      expect.objectContaining({
        id: 'calendar-uid-1',
        eventKey: 'team-private:calendar-uid-1:2026-07-14T18:00:00.000Z:practice',
        isDbGame: false,
        locationDetail: 'Field 2'
      })
    ]));
    expect(model.upcomingEvents).toHaveLength(2);
  });

  it('has no anonymous raw-token or raw-calendar fallback path', () => {
    const source = readFileSync('src/lib/familyShareViewerService.ts', 'utf8');

    expect(source).not.toContain('fetchAndParseCalendar');
    expect(source).not.toContain('getFamilyShareSchedule');
    expect(source).not.toContain('getFamilyShareToken');
    expect(source).not.toContain('resolveFamilyShareTokenChildren');
  });

  it('fails retryably when the complete server projection cannot load instead of returning partial-empty absence', async () => {
    const viewCallable = vi.fn(async () => {
      throw new Error('callable unavailable');
    });
    familyShareMocks.httpsCallable.mockReturnValue(viewCallable);

    await expect(loadFamilyShareView('token-load-failure')).rejects.toMatchObject({
      name: 'FamilyShareTokenError',
      reason: 'load-failed'
    });
    expect(familyShareMocks.httpsCallable).toHaveBeenCalledTimes(1);
    expect(familyShareMocks.httpsCallable).toHaveBeenCalledWith(familyShareMocks.functions, 'getFamilyShareView');
    expect(viewCallable).toHaveBeenCalledTimes(1);
  });

  it('rejects an unversioned response rather than treating it as a complete empty schedule', async () => {
    familyShareMocks.httpsCallable.mockReturnValue(vi.fn(async () => ({
      data: {
        children: [],
        teams: [],
        externalEvents: [],
        calendarWarnings: []
      }
    })));

    await expect(loadFamilyShareView('token-old-projection')).rejects.toMatchObject({
      name: 'FamilyShareTokenError',
      reason: 'load-failed'
    });
  });

  it.each([
    ['missing presentation', { presentation: null, children: [], teams: [], externalEvents: [], calendarWarnings: [] }],
    ['missing children', { presentation: {}, children: null, teams: [], externalEvents: [], calendarWarnings: [] }],
    ['missing teams', { presentation: {}, children: [], teams: null, externalEvents: [], calendarWarnings: [] }],
    ['missing external events', { presentation: {}, children: [], teams: [], externalEvents: null, calendarWarnings: [] }],
    ['missing warnings', { presentation: {}, children: [], teams: [], externalEvents: [], calendarWarnings: null }],
    ['child without a projected team', {
      presentation: {},
      children: [{ teamId: 'team-missing', playerId: 'player-1', playerName: 'Sam' }],
      teams: [],
      externalEvents: [],
      calendarWarnings: []
    }],
    ['team without a games array', {
      presentation: {},
      children: [],
      teams: [{ teamId: 'team-1', teamName: 'Bears', games: null }],
      externalEvents: [],
      calendarWarnings: []
    }],
    ['invalid projected event', {
      presentation: {},
      children: [],
      teams: [],
      externalEvents: [{ id: 'event-1', type: 'practice', date: 'not-a-date' }],
      calendarWarnings: []
    }],
    ['invalid warning evidence', {
      presentation: {},
      children: [],
      teams: [],
      externalEvents: [],
      calendarWarnings: [null]
    }]
  ])('rejects a malformed v2 projection with %s instead of confirming empty absence', async (_label, projection) => {
    familyShareMocks.httpsCallable.mockReturnValue(vi.fn(async () => ({
      data: { projectionVersion: 2, ...projection }
    })));

    await expect(loadFamilyShareView('token-malformed-projection')).rejects.toMatchObject({
      name: 'FamilyShareTokenError',
      reason: 'load-failed'
    });
  });

  it('honors a successful complete-empty server projection', async () => {
    familyShareMocks.httpsCallable.mockReturnValue(vi.fn(async () => ({
      data: {
        projectionVersion: 2,
        presentation: { label: 'Former family access', expiresAt: null },
        children: [],
        teams: [],
        externalEvents: [],
        calendarWarnings: []
      }
    })));

    const model = await loadFamilyShareView('token-empty-projection');

    expect(model).toMatchObject({
      label: 'Former family access',
      children: [],
      teams: [],
      events: [],
      upcomingEvents: [],
      recentResults: [],
      calendarWarnings: []
    });
  });

  it.each(['invalid', 'revoked', 'expired'] as const)(
    'preserves authoritative %s projection errors',
    async (reason) => {
      familyShareMocks.httpsCallable.mockReturnValue(vi.fn(async () => {
        throw { code: 'functions/permission-denied', details: { reason } };
      }));

      await expect(loadFamilyShareView(`token-${reason}`)).rejects.toMatchObject({
        name: 'FamilyShareTokenError',
        reason
      } satisfies Partial<FamilyShareTokenError>);
    }
  );

  it('propagates throttling evidence from the server projection', async () => {
    familyShareMocks.httpsCallable.mockReturnValue(vi.fn(async () => {
      throw { code: 'functions/resource-exhausted', details: { retryAfterSeconds: 37 } };
    }));

    await expect(loadFamilyShareView('token-throttled')).rejects.toMatchObject({
      name: 'FamilyShareTokenError',
      reason: 'throttled',
      retryAfterSeconds: 37
    });
  });

  it('rejects a missing token before calling the server', async () => {
    await expect(loadFamilyShareView('')).rejects.toMatchObject({
      name: 'FamilyShareTokenError',
      reason: 'missing'
    });
    expect(familyShareMocks.httpsCallable).not.toHaveBeenCalled();
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
});
