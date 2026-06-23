// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamDrills } from './TeamDrills';
import type { AuthState } from '../lib/types';

const teamDrillsServiceMocks = vi.hoisted(() => ({
  filterDrillSummaries: vi.fn((drills, filters) => {
    const searchText = String(filters?.searchText || '').trim().toLowerCase();
    const type = String(filters?.type || '').trim();
    const level = String(filters?.level || '').trim();
    return (Array.isArray(drills) ? drills : []).filter((drill) => {
      if (type && drill.type !== type) return false;
      if (level && drill.level !== level) return false;
      if (!searchText) return true;
      return String(drill.title || '').toLowerCase().includes(searchText)
        || (Array.isArray(drill.skills) && drill.skills.some((skill: string) => skill.toLowerCase().includes(searchText)));
    });
  }),
  loadFavoriteDrills: vi.fn(),
  loadTeamDrillLibraryPage: vi.fn(),
  setTeamDrillFavorite: vi.fn()
}));

const practiceAiCoachServiceMocks = vi.hoisted(() => ({
  generatePracticeAiCoachPlan: vi.fn()
}));

const practiceTimelineServiceMocks = vi.hoisted(() => ({
  getPracticeTimelineTotalMinutes: vi.fn((blocks) => (Array.isArray(blocks) ? blocks : []).reduce((sum, block) => sum + (Number.parseInt(String(block?.duration ?? 0), 10) || 0), 0)),
  loadPracticeTimelineModel: vi.fn(),
  savePracticeTimelineForApp: vi.fn()
}));

const publicActionsMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn()
}));

vi.mock('../lib/teamDrillsService', () => teamDrillsServiceMocks);
vi.mock('../lib/practiceAiCoachService', () => practiceAiCoachServiceMocks);
vi.mock('../lib/practiceTimelineService', () => practiceTimelineServiceMocks);
vi.mock('../lib/publicActions', () => publicActionsMocks);

const auth: AuthState = {
  user: {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach'
  } as any,
  profile: null,
  loading: false,
  error: null,
  roles: ['coach'],
  isParent: false,
  isCoach: true,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

function createDrill(overrides: Record<string, any> = {}) {
  return {
    id: 'drill-1',
    title: 'Rondo 4v2',
    sport: 'Soccer',
    type: 'Technical',
    level: 'Intermediate',
    ageGroup: 'All',
    skills: ['passing', 'support'],
    description: 'Fast keep-away drill.',
    instructions: 'Two-touch max.',
    youtubeUrl: '',
    diagramUrls: [],
    attribution: null,
    setup: { duration: 15, players: '8-10', cones: 6, balls: '', area: '', pinnies: '' },
    ...overrides
  };
}

function createPage(overrides: Record<string, any> = {}) {
  return {
    team: { id: 'team-1', name: 'Bears', sport: 'Soccer' },
    canManageDrills: true,
    drills: [createDrill()],
    favoriteIds: ['drill-2'],
    nextCursor: null,
    filters: { searchText: '', type: '', level: '' },
    ...overrides
  };
}

function renderTeamDrills() {
  return render(
    <MemoryRouter initialEntries={['/teams/team-1/drills']}>
      <Routes>
        <Route path="/teams/:teamId/drills" element={<TeamDrills auth={auth} />} />
        <Route path="/teams/:teamId" element={<div>Team detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TeamDrills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teamDrillsServiceMocks.loadTeamDrillLibraryPage.mockResolvedValue(createPage({
      drills: [
        createDrill(),
        createDrill({ id: 'drill-2', title: 'Finishing ladder', type: 'Technical', level: 'Advanced', skills: ['finishing'], description: 'Close-range finishing.' })
      ],
      favoriteIds: ['drill-2'],
      nextCursor: null
    }));
    teamDrillsServiceMocks.loadFavoriteDrills.mockResolvedValue({
      team: { id: 'team-1', name: 'Bears', sport: 'Soccer' },
      canManageDrills: true,
      favoriteIds: ['drill-2'],
      drills: [createDrill({ id: 'drill-2', title: 'Finishing ladder', type: 'Technical', level: 'Advanced', skills: ['finishing'], description: 'Close-range finishing.' })]
    });
    teamDrillsServiceMocks.setTeamDrillFavorite.mockResolvedValue(undefined);
    practiceTimelineServiceMocks.loadPracticeTimelineModel.mockResolvedValue({
      sessionId: 'session-1',
      teamId: 'team-1',
      eventId: 'practice-1',
      teamName: 'Bears',
      teamSport: 'Soccer',
      date: new Date('2026-06-11T18:00:00Z'),
      location: 'Main Field',
      blocks: [{
        order: 0,
        drillId: 'drill-1',
        drillTitle: 'Warm-up lanes',
        type: 'Warm-up',
        duration: 10,
        description: 'Start clean.',
        notes: '',
        notesLog: []
      }],
      drillOptions: [{
        id: 'drill-2',
        title: 'Finishing ladder',
        type: 'Technical',
        duration: 12,
        description: 'Close-range finishing.',
        source: 'team'
      }]
    });
    practiceTimelineServiceMocks.savePracticeTimelineForApp.mockResolvedValue('session-1');
    practiceAiCoachServiceMocks.generatePracticeAiCoachPlan.mockResolvedValue({
      assistantMessage: 'Use quality touches before finishing.',
      errors: [],
      blocks: [{
        order: 0,
        drillId: 'drill-2',
        drillTitle: 'Finishing ladder',
        type: 'Technical',
        duration: 12,
        description: 'Close-range finishing.',
        notes: 'Rotate every two reps.',
        notesLog: []
      }]
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('passes search and filter selections into the bounded community drill query', async () => {
    renderTeamDrills();

    expect(await screen.findByRole('heading', { name: 'Bears drills' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search drills'), { target: { value: 'finish' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Technical' } });
    fireEvent.change(screen.getByLabelText(/^Skill level$/i), { target: { value: 'Advanced' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(teamDrillsServiceMocks.loadTeamDrillLibraryPage).toHaveBeenLastCalledWith('team-1', auth.user, {
      searchText: 'finish',
      type: 'Technical',
      level: 'Advanced'
    }));
  });

  it('opens drill detail and toggles a team favorite that syncs with the website store', async () => {
    renderTeamDrills();

    expect(await screen.findByText('Rondo 4v2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rondo 4v2' }));

    expect(await screen.findByText('Setup & instructions')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }));

    await waitFor(() => expect(teamDrillsServiceMocks.setTeamDrillFavorite).toHaveBeenCalledWith('team-1', auth.user, 'drill-1', true));
  });

  it('loads favorites lazily and applies client-side search/filtering there too', async () => {
    renderTeamDrills();

    expect(await screen.findByText('Rondo 4v2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Favorites (1)' }));

    await waitFor(() => expect(teamDrillsServiceMocks.loadFavoriteDrills).toHaveBeenCalledWith('team-1', auth.user));
    expect(await screen.findByText('Finishing ladder')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search drills'), { target: { value: 'rondo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('No team favorites match the current search and filter combination.')).toBeTruthy();
  });

  it('generates an editable AI coach proposal and waits for acceptance before saving the timeline', async () => {
    renderTeamDrills();

    expect(await screen.findByRole('heading', { name: 'Bears drills' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Practice event ID'), { target: { value: 'practice-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load practice' }));

    await waitFor(() => expect(practiceTimelineServiceMocks.loadPracticeTimelineModel).toHaveBeenCalledWith('team-1', 'practice-1', auth.user));
    expect(await screen.findByText('Current timeline: 1 block · 10 min')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Practice focus'), { target: { value: '60 minute shooting plan' } });
    fireEvent.change(screen.getByLabelText('Coach skill level'), { target: { value: 'Intermediate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate proposal' }));

    await waitFor(() => expect(practiceAiCoachServiceMocks.generatePracticeAiCoachPlan).toHaveBeenCalledWith(expect.objectContaining({
      teamName: 'Bears',
      sport: 'Soccer',
      skillLevel: 'Intermediate',
      targetMinutes: '10',
      coachRequest: '60 minute shooting plan',
      planScope: 'append'
    })));
    expect(practiceTimelineServiceMocks.savePracticeTimelineForApp).not.toHaveBeenCalled();

    expect(await screen.findByDisplayValue('Finishing ladder')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Proposal block 1 minutes'), { target: { value: '18' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept timeline' }));

    await waitFor(() => expect(practiceTimelineServiceMocks.savePracticeTimelineForApp).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      eventId: 'practice-1',
      sessionId: 'session-1',
      user: auth.user,
      date: new Date('2026-06-11T18:00:00Z'),
      location: 'Main Field',
      blocks: [
        expect.objectContaining({ order: 0, drillTitle: 'Warm-up lanes', duration: 10 }),
        expect.objectContaining({ order: 1, drillTitle: 'Finishing ladder', duration: 18 })
      ]
    })));
    expect(window.confirm).toHaveBeenCalledWith('Accept this AI proposal and append these AI blocks to the practice timeline?');
    expect(await screen.findByText('Practice timeline updated.')).toBeTruthy();
  });

  it('shows the access guard when the user cannot manage team drills', async () => {
    teamDrillsServiceMocks.loadTeamDrillLibraryPage.mockResolvedValue(createPage({ canManageDrills: false, drills: [], favoriteIds: [] }));

    renderTeamDrills();

    expect(await screen.findByText('Coach/admin access required')).toBeTruthy();
    expect(screen.getByText('Only team owners, team admins, and global admins can browse and favorite drills for a team.')).toBeTruthy();
  });

  it('retries a retryable community drill load failure from the shared error state', async () => {
    teamDrillsServiceMocks.loadTeamDrillLibraryPage
      .mockRejectedValueOnce(new Error('Drill library temporarily unavailable.'))
      .mockResolvedValueOnce(createPage({ drills: [createDrill({ title: 'Recovery rondo' })], favoriteIds: [] }));

    renderTeamDrills();

    expect(await screen.findByText('Drill library temporarily unavailable.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Bears drills' })).toBeTruthy();
    expect(await screen.findByText('Recovery rondo')).toBeTruthy();
    expect(teamDrillsServiceMocks.loadTeamDrillLibraryPage).toHaveBeenCalledTimes(2);
  });

  it('deduplicates repeated drill ids when load more returns an already rendered drill', async () => {
    teamDrillsServiceMocks.loadTeamDrillLibraryPage
      .mockResolvedValueOnce(createPage({
        drills: [
          createDrill({ id: 'published-1', title: 'Published finishing' }),
          createDrill({ id: 'community-1', title: 'Rondo 4v2' })
        ],
        favoriteIds: ['published-1'],
        nextCursor: { id: 'cursor-1' }
      }))
      .mockResolvedValueOnce(createPage({
        drills: [
          createDrill({ id: 'published-1', title: 'Published finishing' }),
          createDrill({ id: 'community-2', title: 'Third-man run pattern' })
        ],
        favoriteIds: ['published-1'],
        nextCursor: null
      }));

    renderTeamDrills();

    expect(await screen.findByText('Published finishing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more drills' }));

    await waitFor(() => expect(teamDrillsServiceMocks.loadTeamDrillLibraryPage).toHaveBeenNthCalledWith(2, 'team-1', auth.user, {
      searchText: '',
      type: '',
      level: '',
      cursor: { id: 'cursor-1' }
    }));

    expect(await screen.findByText('Third-man run pattern')).toBeTruthy();
    expect(screen.getAllByText('Published finishing')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Favorites (1)' })).toBeTruthy();
  });
});
