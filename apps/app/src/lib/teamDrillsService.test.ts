import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterDrillSummaries, loadFavoriteDrills, loadTeamDrillLibraryPage, setTeamDrillFavorite } from './teamDrillsService';

const dbMocks = vi.hoisted(() => ({
  addDrillFavorite: vi.fn(),
  getDrill: vi.fn(),
  getDrillFavorites: vi.fn(),
  getDrills: vi.fn(),
  getTeam: vi.fn(),
  removeDrillFavorite: vi.fn()
}));

const teamAccessMocks = vi.hoisted(() => ({
  hasFullTeamAccess: vi.fn()
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/team-access.js', () => teamAccessMocks);

describe('teamDrillsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', sport: 'Soccer', ownerId: 'coach-1', adminEmails: ['coach@example.com'] });
    dbMocks.getDrillFavorites.mockResolvedValue(['drill-2']);
    dbMocks.getDrills.mockResolvedValue({
      drills: [{
        id: 'drill-1',
        title: 'Rondo 4v2',
        sport: 'Soccer',
        type: 'Technical',
        level: 'Intermediate',
        skills: ['passing', 'support'],
        description: 'Keep the ball moving.',
        instructions: 'Two-touch max.',
        setup: { duration: 15, players: '8-10', cones: 6 }
      }],
      lastDoc: { id: 'cursor-1' }
    });
    dbMocks.getDrill.mockImplementation(async (drillId: string) => ({
      id: drillId,
      title: drillId === 'drill-2' ? 'Finishing ladder' : 'Other drill',
      sport: 'Soccer',
      type: 'Technical',
      level: 'All',
      skills: ['finishing'],
      description: 'Sharpen the final touch.',
      instructions: 'Rotate lines every 2 reps.',
      setup: { duration: 12, players: '6-8', cones: 4 }
    }));
    dbMocks.addDrillFavorite.mockResolvedValue(undefined);
    dbMocks.removeDrillFavorite.mockResolvedValue(undefined);
    teamAccessMocks.hasFullTeamAccess.mockReturnValue(true);
  });

  it('filters drill fixtures by search text, type, and level', () => {
    const drills = [
      {
        id: 'drill-1',
        title: 'Rondo 4v2',
        sport: 'Soccer',
        type: 'Technical',
        level: 'Intermediate',
        ageGroup: 'All',
        skills: ['passing', 'support'],
        description: 'Fast passing under pressure.',
        instructions: 'Two-touch max.',
        youtubeUrl: '',
        diagramUrls: [],
        attribution: null,
        setup: { duration: 15, players: '8-10', cones: 6, balls: '', area: '', pinnies: '' }
      },
      {
        id: 'drill-2',
        title: 'Warm-up lanes',
        sport: 'Soccer',
        type: 'Warm-up',
        level: 'All',
        ageGroup: 'All',
        skills: ['dribbling'],
        description: 'Gentle touches and turns.',
        instructions: 'Keep it flowing.',
        youtubeUrl: '',
        diagramUrls: [],
        attribution: null,
        setup: { duration: 10, players: '6-12', cones: 8, balls: '', area: '', pinnies: '' }
      },
      {
        id: 'drill-3',
        title: 'Finishing ladder',
        sport: 'Soccer',
        type: 'Technical',
        level: 'Advanced',
        ageGroup: 'All',
        skills: ['finishing'],
        description: 'Close-range finishing pattern.',
        instructions: 'Finish first time when possible.',
        youtubeUrl: '',
        diagramUrls: [],
        attribution: null,
        setup: { duration: 12, players: '4-8', cones: 5, balls: '', area: '', pinnies: '' }
      }
    ];

    expect(filterDrillSummaries(drills, { searchText: 'finish' }).map((drill) => drill.id)).toEqual(['drill-3']);
    expect(filterDrillSummaries(drills, { type: 'Technical', level: 'Intermediate' }).map((drill) => drill.id)).toEqual(['drill-1']);
    expect(filterDrillSummaries(drills, { type: 'Warm-up' }).map((drill) => drill.id)).toEqual(['drill-2']);
  });

  it('loads a bounded community drill page and favorites for staff users', async () => {
    const result = await loadTeamDrillLibraryPage('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, {
      searchText: ' rondo ',
      type: 'Technical',
      level: 'Intermediate',
      cursor: { id: 'cursor-0' }
    });

    expect(dbMocks.getDrills).toHaveBeenCalledWith({
      sport: 'Soccer',
      type: 'Technical',
      level: 'Intermediate',
      searchText: 'rondo',
      limitCount: 12,
      startAfterDoc: { id: 'cursor-0' }
    });
    expect(result.favoriteIds).toEqual(['drill-2']);
    expect(result.nextCursor).toEqual({ id: 'cursor-1' });
    expect(result.drills[0]).toEqual(expect.objectContaining({
      id: 'drill-1',
      title: 'Rondo 4v2',
      type: 'Technical',
      level: 'Intermediate'
    }));
  });

  it('loads favorite drill details from the shared team favorites store', async () => {
    const result = await loadFavoriteDrills('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] });

    expect(dbMocks.getDrillFavorites).toHaveBeenCalledWith('team-1');
    expect(dbMocks.getDrill).toHaveBeenCalledWith('drill-2');
    expect(result.drills).toEqual([
      expect.objectContaining({
        id: 'drill-2',
        title: 'Finishing ladder'
      })
    ]);
  });

  it('writes favorite toggles to the same team-scoped favorites store as the website', async () => {
    await setTeamDrillFavorite('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, 'drill-2', true);
    expect(dbMocks.addDrillFavorite).toHaveBeenCalledWith('team-1', 'drill-2');

    await setTeamDrillFavorite('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, 'drill-2', false);
    expect(dbMocks.removeDrillFavorite).toHaveBeenCalledWith('team-1', 'drill-2');
  });
});
