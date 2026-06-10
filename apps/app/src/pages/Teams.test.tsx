// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Teams } from './Teams';
import type { AuthState } from '../lib/types';

const homeServiceMocks = vi.hoisted(() => ({
  loadParentHomeSummary: vi.fn(),
  loadParentTeamsSummary: vi.fn()
}));

const publicActionMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn()
}));

vi.mock('../lib/homeService', () => homeServiceMocks);
vi.mock('../lib/publicActions', () => ({
  openPublicUrl: publicActionMocks.openPublicUrl
}));
vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktopWeb: false })
}));
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return new Proxy({}, {
    get: () => Icon
  });
});

const auth: AuthState = {
  user: {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    roles: ['parent'],
    parentOf: []
  } as AuthState['user'],
  profile: null,
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

const emptyHome = {
  players: [],
  teams: [],
  upcomingEvents: [],
  actionItems: [],
  fees: [],
  metrics: {
    players: 0,
    teams: 0,
    rsvpNeeded: 0,
    unreadMessages: 0,
    packetsReady: 0
  }
};

function renderTeams() {
  return render(
    <MemoryRouter initialEntries={["/teams"]}>
      <Routes>
        <Route path="/teams" element={<Teams auth={auth} />} />
        <Route path="/accept-invite" element={<div>Accept invite route</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Teams empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    homeServiceMocks.loadParentTeamsSummary.mockResolvedValue(emptyHome);
    homeServiceMocks.loadParentHomeSummary.mockResolvedValue(emptyHome);
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the public browse teams page from the empty state recovery action', async () => {
    renderTeams();

    await screen.findByRole('heading', { name: 'No teams linked yet' });
    fireEvent.click(screen.getByRole('button', { name: 'Browse teams' }));

    expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/teams.html');
  });
});
