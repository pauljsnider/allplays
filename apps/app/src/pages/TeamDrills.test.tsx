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

const publicActionsMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn()
}));

vi.mock('../lib/teamDrillsService', () => teamDrillsServiceMocks);
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
  });

  afterEach(() => {
    cleanup();
  });

  it('passes search and filter selections into the bounded community drill query', async () => {
    renderTeamDrills();

    expect(await screen.findByRole('heading', { name: 'Bears drills' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search drills'), { target: { value: 'finish' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Technical' } });
    fireEvent.change(screen.getByLabelText('Skill level'), { target: { value: 'Advanced' } });
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

  it('shows the access guard when the user cannot manage team drills', async () => {
    teamDrillsServiceMocks.loadTeamDrillLibraryPage.mockResolvedValue(createPage({ canManageDrills: false, drills: [], favoriteIds: [] }));

    renderTeamDrills();

    expect(await screen.findByText('Coach/admin access required')).toBeTruthy();
    expect(screen.getByText('Only team owners, team admins, and global admins can browse and favorite drills for a team.')).toBeTruthy();
  });
});
