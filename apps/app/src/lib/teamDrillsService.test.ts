import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPracticeAiCoachPrompt, filterDrillSummaries, loadFavoriteDrills, loadTeamDrillLibraryPage, setTeamDrillFavorite } from './teamDrillsService';

const dbMocks = vi.hoisted(() => ({
  addDrillFavorite: vi.fn(),
  getDrill: vi.fn(),
  getDrillFavorites: vi.fn(),
  getDrills: vi.fn(),
  getPublishedDrills: vi.fn(),
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
    dbMocks.getPublishedDrills.mockResolvedValue([]);
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

  it('builds a practice AI coach prompt from team goals and favorite drills', () => {
    const prompt = buildPracticeAiCoachPrompt({
      teamName: 'Bears',
      sport: 'Soccer',
      ageGroup: 'U12',
      availableMinutes: 75,
      rosterSize: 14,
      goals: ['Press after turnovers', 'Finish from wide service'],
      focusSkills: ['first touch', 'finishing'],
      constraints: ['Half field only', 'Two keepers unavailable'],
      favoriteDrills: [{
        id: 'drill-1',
        title: 'Rondo 4v2',
        sport: 'Soccer',
        type: 'Technical',
        level: 'Intermediate',
        ageGroup: 'U12',
        skills: ['passing', 'support'],
        description: 'Keep the ball moving.',
        instructions: 'Two-touch max.',
        youtubeUrl: '',
        diagramUrls: [],
        attribution: null,
        setup: { duration: 15, players: '8-10', cones: 6, balls: '2', area: '20x20', pinnies: '4' }
      }]
    });

    expect(prompt.system).toContain('Soccer practices');
    expect(prompt.user).toContain('Team: Bears');
    expect(prompt.user).toContain('Available time: 75 minutes');
    expect(prompt.user).toContain('- Press after turnovers');
    expect(prompt.user).toContain('- first touch');
    expect(prompt.user).toContain('- Half field only');
    expect(prompt.user).toContain('- Rondo 4v2 (Technical; 15 min, 8-10 players, 20x20). Skills: passing, support.');
    expect(prompt.user).toContain('minute-by-minute practice plan');
  });

  it('keeps practice prompt section headers on their own source line so prompts stay readable', () => {
    const source = readFileSync(new URL('./teamDrillsService.ts', import.meta.url), 'utf8');

    expect(source).toContain("`Practice goals:\n${goalLines.map((goal) => `- ${goal}`).join('\\n')}`");
    expect(source).toContain("`Focus skills:\n${skillLines.map((skill) => `- ${skill}`).join('\\n')}`");
    expect(source).toContain("`Constraints:\n${constraintLines.map((constraint) => `- ${constraint}`).join('\\n')}`");
    expect(source).toContain("`Favorite drills to prefer when they fit:\n${drillLines.length ? drillLines.join('\\n') : '- No favorites supplied.'}`");
    expect(source).not.toContain("`Practice goals:\\n${goalLines.map((goal) => `- ${goal}`).join('\\n')}`");
    expect(source).not.toContain("`Favorite drills to prefer when they fit:\\n${drillLines.length ? drillLines.join('\\n') : '- No favorites supplied.'}`");
  });

  it('loads a bounded community drill page and merges team-published drills for staff users', async () => {
    dbMocks.getPublishedDrills.mockResolvedValue([
      {
        id: 'drill-3',
        title: 'Community finishing',
        sport: 'Soccer',
        type: 'Technical',
        level: 'Intermediate',
        skills: ['finishing'],
        description: 'Published by a coach.',
        instructions: 'Rotate every rep.',
        setup: { duration: 10, players: '6-8', cones: 4 }
      }
    ]);

    const result = await loadTeamDrillLibraryPage('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, {
      searchText: ' rondo ',
      type: 'Technical',
      level: 'Intermediate'
    });

    expect(dbMocks.getDrills).toHaveBeenCalledWith({
      sport: 'Soccer',
      type: 'Technical',
      level: 'Intermediate',
      searchText: 'rondo',
      limitCount: 12,
      startAfterDoc: null
    });
    expect(dbMocks.getPublishedDrills).toHaveBeenCalledWith({
      sport: 'Soccer',
      type: 'Technical',
      level: 'Intermediate',
      searchText: 'rondo',
      limitCount: 12
    });
    expect(result.favoriteIds).toEqual(['drill-2']);
    expect(result.nextCursor).toEqual({ communityCursor: { id: 'cursor-1' }, pendingDrills: [] });
    expect(result.drills.map((drill) => drill.id)).toEqual(['drill-3', 'drill-1']);
  });

  it('skips published drill fetches on cursor-based pages and only returns new page drills', async () => {
    dbMocks.getPublishedDrills.mockResolvedValue([
      {
        id: 'published-1',
        title: 'Published finishing',
        sport: 'Soccer',
        type: 'Technical',
        level: 'Intermediate',
        skills: ['finishing'],
        description: 'Published by a coach.',
        instructions: 'Rotate every rep.',
        setup: { duration: 10, players: '6-8', cones: 4 }
      }
    ]);
    dbMocks.getDrills.mockResolvedValue({
      drills: [
        {
          id: 'community-2',
          title: 'Second page build-out',
          sport: 'Soccer',
          type: 'Technical',
          level: 'Intermediate',
          skills: ['support'],
          description: 'New page result.',
          instructions: 'Stay connected.',
          setup: { duration: 12, players: '8-10', cones: 6 }
        }
      ],
      lastDoc: { id: 'cursor-2' }
    });

    const result = await loadTeamDrillLibraryPage('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, {
      searchText: 'rondo',
      type: 'Technical',
      level: 'Intermediate',
      cursor: { communityCursor: { id: 'cursor-1' }, pendingDrills: [] }
    });

    expect(dbMocks.getDrills).toHaveBeenCalledWith({
      sport: 'Soccer',
      type: 'Technical',
      level: 'Intermediate',
      searchText: 'rondo',
      limitCount: 12,
      startAfterDoc: { id: 'cursor-1' }
    });
    expect(dbMocks.getPublishedDrills).not.toHaveBeenCalled();
    expect(result.drills.map((drill) => drill.id)).toEqual(['community-2']);
    expect(result.nextCursor).toEqual({ communityCursor: { id: 'cursor-2' }, pendingDrills: [] });
  });

  it('carries overflow drills into the next page so published drills are not dropped', async () => {
    dbMocks.getPublishedDrills.mockResolvedValue([
      {
        id: 'published-1',
        title: 'Zulu finishing',
        sport: 'Soccer',
        type: 'Technical',
        level: 'Intermediate',
        skills: ['finishing'],
        description: 'Published by a coach.',
        instructions: 'Rotate every rep.',
        setup: { duration: 10, players: '6-8', cones: 4 }
      }
    ]);
    dbMocks.getDrills.mockResolvedValueOnce({
      drills: Array.from({ length: 12 }, (_, index) => ({
        id: `community-${index + 1}`,
        title: `Community drill ${String(index + 1).padStart(2, '0')}`,
        sport: 'Soccer',
        type: 'Technical',
        level: 'Intermediate',
        skills: ['passing'],
        description: 'Community result.',
        instructions: 'Keep moving.',
        setup: { duration: 12, players: '8-10', cones: 6 }
      })),
      lastDoc: { id: 'cursor-1' }
    });
    dbMocks.getDrills.mockResolvedValueOnce({
      drills: [
        {
          id: 'community-13',
          title: 'Community drill 13',
          sport: 'Soccer',
          type: 'Technical',
          level: 'Intermediate',
          skills: ['support'],
          description: 'Next page result.',
          instructions: 'Stay connected.',
          setup: { duration: 12, players: '8-10', cones: 6 }
        }
      ],
      lastDoc: null
    });

    const firstPage = await loadTeamDrillLibraryPage('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, {
      type: 'Technical',
      level: 'Intermediate'
    });
    const secondPage = await loadTeamDrillLibraryPage('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, {
      type: 'Technical',
      level: 'Intermediate',
      cursor: firstPage.nextCursor
    });

    expect(firstPage.drills).toHaveLength(12);
    expect(firstPage.drills.map((drill) => drill.id)).not.toContain('published-1');
    expect(secondPage.drills.map((drill) => drill.id)).toContain('published-1');
    expect(secondPage.nextCursor).toBeNull();
  });

  it('does not return the same published drill twice across sequential page loads', async () => {
    dbMocks.getPublishedDrills.mockResolvedValue([
      {
        id: 'published-1',
        title: 'Published finishing',
        sport: 'Soccer',
        type: 'Technical',
        level: 'Intermediate',
        skills: ['finishing'],
        description: 'Published by a coach.',
        instructions: 'Rotate every rep.',
        setup: { duration: 10, players: '6-8', cones: 4 }
      }
    ]);
    dbMocks.getDrills
      .mockResolvedValueOnce({
        drills: [
          {
            id: 'community-1',
            title: 'First page rondo',
            sport: 'Soccer',
            type: 'Technical',
            level: 'Intermediate',
            skills: ['passing'],
            description: 'First page result.',
            instructions: 'Stay sharp.',
            setup: { duration: 12, players: '8-10', cones: 6 }
          }
        ],
        lastDoc: { id: 'cursor-1' }
      })
      .mockResolvedValueOnce({
        drills: [
          {
            id: 'community-2',
            title: 'Second page rondo',
            sport: 'Soccer',
            type: 'Technical',
            level: 'Intermediate',
            skills: ['support'],
            description: 'Second page result.',
            instructions: 'Keep shape.',
            setup: { duration: 12, players: '8-10', cones: 6 }
          }
        ],
        lastDoc: { id: 'cursor-2' }
      });

    const firstPage = await loadTeamDrillLibraryPage('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, {
      type: 'Technical',
      level: 'Intermediate'
    });
    const secondPage = await loadTeamDrillLibraryPage('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, {
      type: 'Technical',
      level: 'Intermediate',
      cursor: firstPage.nextCursor
    });

    const combinedIds = [...firstPage.drills, ...secondPage.drills].map((drill) => drill.id);
    expect(new Set(combinedIds)).toEqual(new Set(['published-1', 'community-1', 'community-2']));
    expect(new Set(combinedIds).size).toBe(combinedIds.length);
  });

  it('replays overflow drills without refetching community pages when only pending results remain', async () => {
    const result = await loadTeamDrillLibraryPage('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, {
      cursor: {
        communityCursor: null,
        pendingDrills: [
          {
            id: 'published-1',
            title: 'Published finishing',
            sport: 'Soccer',
            type: 'Technical',
            level: 'Intermediate',
            skills: ['finishing'],
            description: 'Published by a coach.',
            instructions: 'Rotate every rep.',
            setup: { duration: 10, players: '6-8', cones: 4 }
          }
        ]
      }
    });

    expect(dbMocks.getDrills).not.toHaveBeenCalled();
    expect(dbMocks.getPublishedDrills).not.toHaveBeenCalled();
    expect(result.drills.map((drill) => drill.id)).toEqual(['published-1']);
    expect(result.nextCursor).toBeNull();
  });

  it('loads favorite drill details from the shared team favorites store and skips missing drills', async () => {
    dbMocks.getDrillFavorites.mockResolvedValue(['drill-2', 'missing-drill']);
    dbMocks.getDrill.mockImplementation(async (drillId: string) => {
      if (drillId === 'missing-drill') return null;
      return {
        id: drillId,
        title: 'Finishing ladder',
        sport: 'Soccer',
        type: 'Technical',
        level: 'All',
        skills: ['finishing'],
        description: 'Sharpen the final touch.',
        instructions: 'Rotate lines every 2 reps.',
        setup: { duration: 12, players: '6-8', cones: 4 }
      };
    });

    const result = await loadFavoriteDrills('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] });

    expect(dbMocks.getDrillFavorites).toHaveBeenCalledWith('team-1');
    expect(dbMocks.getDrill).toHaveBeenCalledWith('drill-2');
    expect(dbMocks.getDrill).toHaveBeenCalledWith('missing-drill');
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
