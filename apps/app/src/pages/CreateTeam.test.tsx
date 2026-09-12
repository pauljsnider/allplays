// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateTeam } from './CreateTeam';
import type { AuthState } from '../lib/types';

const teamCreationMocks = vi.hoisted(() => ({
  configureCreatedTeamDiamondForApp: vi.fn(),
  createTeamForApp: vi.fn(),
  getCreateTeamDiamondProfileOptions: vi.fn(),
  getCreateTeamSportOptions: vi.fn(({ includeDiamondSports = false } = {}) => [
    'Basketball',
    'Soccer',
    'Baseball',
    ...(includeDiamondSports ? ['Fastpitch'] : [])
  ])
}));

vi.mock('../lib/teamCreationService', () => teamCreationMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    ArrowLeft: Icon,
    CheckCircle2: Icon,
    Loader2: Icon,
    Save: Icon,
    Shield: Icon,
    Users: Icon
  };
});

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

function TeamDetailRoute() {
  const { teamId } = useParams<{ teamId: string }>();
  return <div>Team detail: {teamId}</div>;
}

function renderCreateTeam(authOverride = auth) {
  return render(
    <MemoryRouter initialEntries={['/teams/new']}>
      <Routes>
        <Route path="/teams/new" element={<CreateTeam auth={authOverride} />} />
        <Route path="/teams/:teamId" element={<TeamDetailRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CreateTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete window.__ALLPLAYS_CONFIG__;
    teamCreationMocks.createTeamForApp.mockResolvedValue({
      teamId: 'team-new',
      defaultStatConfigCreated: true,
      defaultStatConfigError: null,
      diamondScorebookConfigured: false,
      diamondScorebookError: null
    });
    teamCreationMocks.configureCreatedTeamDiamondForApp.mockResolvedValue(undefined);
    teamCreationMocks.getCreateTeamDiamondProfileOptions.mockImplementation((sport: string) =>
      sport === 'Baseball'
        ? [
            { id: 'baseball-youth', version: 1, label: 'Baseball — configurable youth', sport: 'baseball' },
            { id: 'baseball-nfhs', version: 1, label: 'Baseball — NFHS style', sport: 'baseball' }
          ]
        : []
    );
    teamCreationMocks.getCreateTeamSportOptions.mockImplementation(({ includeDiamondSports = false } = {}) => [
      'Basketball',
      'Soccer',
      'Baseball',
      ...(includeDiamondSports ? ['Fastpitch'] : [])
    ]);
  });

  afterEach(() => {
    cleanup();
    delete window.__ALLPLAYS_CONFIG__;
  });

  it('validates required fields and creates a team from the app form', async () => {
    renderCreateTeam();

    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));
    expect(await screen.findByText('Team name is required.')).toBeTruthy();
    expect(teamCreationMocks.createTeamForApp).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'KC Current U12' } });
    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'Soccer' } });
    fireEvent.change(screen.getByPlaceholderText('66210'), { target: { value: '66210-1234' } });
    fireEvent.click(screen.getByLabelText('Public team'));
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => expect(teamCreationMocks.createTeamForApp).toHaveBeenCalledWith(auth.user, {
      name: 'KC Current U12',
      sport: 'Soccer',
      zip: '66210-1234',
      isPublic: false
    }));
    expect(await screen.findByText('Team detail: team-new')).toBeTruthy();
  });

  it('keeps the created team reachable when default stat config creation returns a warning', async () => {
    teamCreationMocks.createTeamForApp.mockResolvedValueOnce({
      teamId: 'team-new',
      defaultStatConfigCreated: false,
      defaultStatConfigError: 'permission denied',
      diamondScorebookConfigured: false,
      diamondScorebookError: null
    });
    renderCreateTeam();

    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Warn Team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    expect(await screen.findByText(/Team created, but the default stat config could not be added/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open team' })).toHaveAttribute('href', '/teams/team-new');
    const openTeamButton = await screen.findByRole('button', { name: 'Open team' });
    expect(openTeamButton).not.toBeDisabled();

    fireEvent.click(openTeamButton);

    expect(teamCreationMocks.createTeamForApp).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Team detail: team-new')).toBeTruthy();
  });

  it('starts only one team write for duplicate submissions in the same render turn', async () => {
    let finishCreation!: (result: {
      teamId: string;
      defaultStatConfigCreated: boolean;
      defaultStatConfigError: null;
      diamondScorebookConfigured: boolean;
      diamondScorebookError: null;
    }) => void;
    teamCreationMocks.createTeamForApp.mockReturnValueOnce(new Promise((resolve) => {
      finishCreation = resolve;
    }));
    const { container } = renderCreateTeam();

    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'One Team' } });
    const form = container.querySelector('form');
    expect(form).not.toBeNull();

    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(teamCreationMocks.createTeamForApp).toHaveBeenCalledTimes(1);

    finishCreation({
      teamId: 'team-new',
      defaultStatConfigCreated: true,
      defaultStatConfigError: null,
      diamondScorebookConfigured: false,
      diamondScorebookError: null
    });

    expect(await screen.findByText('Team detail: team-new')).toBeTruthy();
  });

  it('blocks direct rendering without a signed-in user', () => {
    renderCreateTeam({ ...auth, user: null, roles: [] });

    expect(screen.getByText('Sign in to create a team')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create team' })).toBeNull();
  });

  it('keeps Diamond setup absent when the launch config is missing or false', async () => {
    renderCreateTeam();

    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'Baseball' } });
    expect(screen.queryByRole('group', { name: 'Diamond Scorebook v2' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Fastpitch' })).toBeNull();
    expect(teamCreationMocks.getCreateTeamDiamondProfileOptions).not.toHaveBeenCalled();

    cleanup();
    window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: false } as any;
    renderCreateTeam();
    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'Baseball' } });

    expect(screen.queryByRole('group', { name: 'Diamond Scorebook v2' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Fastpitch' })).toBeNull();
    expect(teamCreationMocks.getCreateTeamSportOptions).toHaveBeenCalledWith({ includeDiamondSports: false });

    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Classic Baseball' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));
    await waitFor(() => expect(teamCreationMocks.createTeamForApp).toHaveBeenCalledWith(auth.user, {
      name: 'Classic Baseball',
      sport: 'Baseball',
      zip: '',
      isPublic: true
    }));
  });

  it('offers Diamond only for supported sports when the launch config is explicitly true', () => {
    window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: true } as any;
    renderCreateTeam();

    expect(screen.queryByRole('group', { name: 'Diamond Scorebook v2' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'Baseball' } });

    const fieldset = screen.getByRole('group', { name: 'Diamond Scorebook v2' });
    expect(fieldset).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Fastpitch' })).toBeTruthy();
    expect(teamCreationMocks.getCreateTeamSportOptions).toHaveBeenCalledWith({ includeDiamondSports: true });
    expect(screen.getByRole('checkbox', { name: 'Enable for new games' })).not.toBeChecked();
    expect(screen.queryByLabelText('Diamond rules profile')).toBeNull();
  });

  it('submits the explicitly selected Diamond profile and capture mode', async () => {
    window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: true } as any;
    renderCreateTeam();

    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Diamond Club' } });
    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'Baseball' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable for new games' }));
    fireEvent.change(screen.getByLabelText('Diamond rules profile'), { target: { value: 'baseball-nfhs' } });
    fireEvent.change(screen.getByLabelText('Diamond capture mode'), { target: { value: 'full' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => expect(teamCreationMocks.createTeamForApp).toHaveBeenCalledWith(auth.user, {
      name: 'Diamond Club',
      sport: 'Baseball',
      zip: '',
      isPublic: true,
      diamondScorebook: {
        enabled: true,
        rulesProfileId: 'baseball-nfhs',
        rulesProfileVersion: 1,
        captureMode: 'full'
      }
    }));
  });

  it('retries a failed Diamond setup against the same created team until it succeeds', async () => {
    window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: true } as any;
    teamCreationMocks.createTeamForApp.mockResolvedValueOnce({
      teamId: 'team-new',
      defaultStatConfigCreated: false,
      defaultStatConfigError: 'stat config unavailable',
      diamondScorebookConfigured: false,
      diamondScorebookError: 'temporary policy read failure'
    });
    teamCreationMocks.configureCreatedTeamDiamondForApp
      .mockRejectedValueOnce(new Error('still unavailable'))
      .mockResolvedValueOnce(undefined);
    renderCreateTeam();

    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Diamond Club' } });
    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'Baseball' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable for new games' }));
    fireEvent.change(screen.getByLabelText('Diamond rules profile'), { target: { value: 'baseball-nfhs' } });
    fireEvent.change(screen.getByLabelText('Diamond capture mode'), { target: { value: 'full' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    expect(await screen.findByText(/temporary policy read failure/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Diamond setup' }));

    expect(await screen.findByText(/still unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Diamond setup' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Diamond setup' }));

    expect(await screen.findByText('Diamond Scorebook v2 is enabled for this team.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry Diamond setup' })).not.toBeInTheDocument();
    expect(screen.getByText(/default stat config could not be added: stat config unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open team' })).toBeEnabled();
    expect(teamCreationMocks.createTeamForApp).toHaveBeenCalledTimes(1);
    expect(teamCreationMocks.configureCreatedTeamDiamondForApp).toHaveBeenCalledTimes(2);
    expect(teamCreationMocks.configureCreatedTeamDiamondForApp).toHaveBeenNthCalledWith(1, 'team-new', 'Baseball', {
      enabled: true,
      rulesProfileId: 'baseball-nfhs',
      rulesProfileVersion: 1,
      captureMode: 'full'
    });
    expect(teamCreationMocks.configureCreatedTeamDiamondForApp).toHaveBeenNthCalledWith(2, 'team-new', 'Baseball', {
      enabled: true,
      rulesProfileId: 'baseball-nfhs',
      rulesProfileVersion: 1,
      captureMode: 'full'
    });
  });
});
