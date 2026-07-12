import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const familyShareMocks = vi.hoisted(() => ({
  getFamilyShareToken: vi.fn(),
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

import { FamilyShareTokenError, loadFamilyShareView, normalizeFamilyShareChildren } from './familyShareViewerService';

describe('familyShareViewerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00Z'));
    familyShareMocks.getFamilyShareToken.mockReset();
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
});
