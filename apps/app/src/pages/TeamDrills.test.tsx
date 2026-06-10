// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamDrills } from './TeamDrills';
import type { AuthState } from '../lib/types';

const teamDrillsServiceMocks = vi.hoisted(() => ({
  deleteTeamDrillForApp: vi.fn(),
  loadTeamDrillsManagementModel: vi.fn(),
  saveTeamDrillForApp: vi.fn()
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

function createModel(overrides: Record<string, any> = {}) {
  return {
    team: { id: 'team-1', name: 'Bears', sport: 'Soccer' },
    canManageDrills: true,
    drills: [
      {
        id: 'drill-1',
        title: 'Rondo 4v2',
        sport: 'Soccer',
        type: 'Technical',
        level: 'Intermediate',
        skills: ['passing', 'support'],
        description: 'Fast keep-away drill.',
        instructions: 'Two-touch max.',
        youtubeUrl: 'https://video.example.test/rondo',
        publishedToCommunity: false,
        diagramUrls: ['https://img.example.test/rondo.png'],
        setup: { duration: 15, players: '8-10', cones: 6 }
      }
    ],
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
    vi.stubGlobal('confirm', vi.fn(() => true));
    teamDrillsServiceMocks.loadTeamDrillsManagementModel.mockResolvedValue(createModel());
    teamDrillsServiceMocks.saveTeamDrillForApp.mockResolvedValue('drill-2');
    teamDrillsServiceMocks.deleteTeamDrillForApp.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('creates a team drill from the native editor and refreshes the list', async () => {
    teamDrillsServiceMocks.loadTeamDrillsManagementModel
      .mockResolvedValueOnce(createModel({ drills: [] }))
      .mockResolvedValueOnce(createModel({ drills: [{
        id: 'drill-2',
        title: 'Pressing box',
        sport: 'Soccer',
        type: 'Tactical',
        level: 'All',
        skills: ['pressing'],
        description: 'Defensive shape',
        instructions: 'Force play wide.',
        youtubeUrl: '',
        publishedToCommunity: false,
        diagramUrls: [],
        setup: { duration: 12, players: '8', cones: 4 }
      }] }));

    renderTeamDrills();

    expect(await screen.findByText('No custom team drills yet. Create one here and it will appear in the website practice command center.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New drill' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pressing box' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Tactical' } });
    fireEvent.change(screen.getByLabelText('Skills'), { target: { value: 'pressing' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Cones'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Defensive shape' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Force play wide.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create drill' }));

    await waitFor(() => expect(teamDrillsServiceMocks.saveTeamDrillForApp).toHaveBeenCalledWith('team-1', auth.user, 'Soccer', expect.objectContaining({
      title: 'Pressing box',
      type: 'Tactical',
      skills: 'pressing',
      duration: '12'
    })));
    expect(await screen.findByText('Pressing box created.')).toBeTruthy();
    expect(await screen.findByText('Pressing box')).toBeTruthy();
  });

  it('lets a manager edit and delete an existing drill', async () => {
    teamDrillsServiceMocks.loadTeamDrillsManagementModel
      .mockResolvedValueOnce(createModel())
      .mockResolvedValueOnce(createModel({ drills: [{
        ...createModel().drills[0],
        title: 'Rondo 5v2',
        setup: { duration: 18, players: '9-11', cones: 7 }
      }] }))
      .mockResolvedValueOnce(createModel({ drills: [] }));

    renderTeamDrills();

    expect(await screen.findByText('Rondo 4v2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Rondo 5v2' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '9-11' } });
    fireEvent.change(screen.getByLabelText('Cones'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save drill' }));

    await waitFor(() => expect(teamDrillsServiceMocks.saveTeamDrillForApp).toHaveBeenCalledWith('team-1', auth.user, 'Soccer', expect.objectContaining({
      id: 'drill-1',
      title: 'Rondo 5v2',
      duration: '18',
      players: '9-11',
      cones: '7'
    })));
    expect(await screen.findByText('Rondo 5v2 updated.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(teamDrillsServiceMocks.deleteTeamDrillForApp).toHaveBeenCalledWith('team-1', auth.user, 'drill-1'));
    expect(await screen.findByText('Rondo 5v2 deleted.')).toBeTruthy();
  });

  it('shows the access guard when the user cannot manage drills', async () => {
    teamDrillsServiceMocks.loadTeamDrillsManagementModel.mockResolvedValue(createModel({ canManageDrills: false, drills: [] }));

    renderTeamDrills();

    expect(await screen.findByText('Coach/admin access required')).toBeTruthy();
    expect(screen.getByText('Only team owners, team admins, and global admins can create, edit, or delete team drills.')).toBeTruthy();
  });
});
