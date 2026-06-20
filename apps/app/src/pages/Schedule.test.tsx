// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schedule } from './Schedule';
import type { AuthState } from '../lib/types';

const scheduleServiceMocks = vi.hoisted(() => ({
  addTeamCalendarUrl: vi.fn(),
  createScheduledPracticeForApp: vi.fn(),
  createScheduleImportGame: vi.fn(),
  createScheduleImportPractice: vi.fn(),
  loadParentSchedule: vi.fn(),
  removeTeamCalendarUrl: vi.fn()
}));

const appDataCacheMocks = vi.hoisted(() => ({
  getCachedAppData: vi.fn(() => null),
  getParentScheduleSummaryCacheKey: vi.fn(() => 'parent-schedule:test-user'),
  loadCachedAppData: vi.fn(async (_key: string, loader: () => Promise<unknown>) => loader())
}));

const uxTimingMocks = vi.hoisted(() => ({
  end: vi.fn()
}));

vi.mock('../lib/scheduleService', () => scheduleServiceMocks);
vi.mock('../lib/appDataCache', () => appDataCacheMocks);
vi.mock('../lib/uxTiming', () => ({
  startUxTimer: vi.fn(() => uxTimingMocks)
}));
vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktopWeb: false })
}));

const auth: AuthState = {
  user: {
    uid: 'test-user',
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

function renderSchedule() {
  return render(
    <MemoryRouter initialEntries={['/schedule']}>
      <Routes>
        <Route path="/schedule" element={<Schedule auth={auth} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    new TypeError('Failed to fetch'),
    new Error('Schedule unavailable.')
  ])('shows network-specific schedule copy after the initial load fails', async (loadError) => {
    scheduleServiceMocks.loadParentSchedule.mockRejectedValue(loadError);

    renderSchedule();

    expect(screen.getByRole('status', { name: 'Loading schedule' })).toBeTruthy();
    expect(screen.queryByText('No events in this filter')).toBeNull();
    expect(await screen.findByText('Unable to load schedule while offline. Check your connection and try again.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: 'Loading schedule' })).toBeNull();
    });
    expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledWith(auth.user, {
      hydrateDetails: false,
      expandStaffPlayers: false
    });
  });

  it('keeps team and player filters after an empty schedule refresh fails', async () => {
    scheduleServiceMocks.loadParentSchedule
      .mockResolvedValueOnce({
        children: [
          { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
        ],
        events: []
      })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    renderSchedule();

    expect(await screen.findByText('No events in this filter')).toBeTruthy();
    const teamFilter = screen.getByLabelText('Team filter') as HTMLSelectElement;
    const playerFilter = screen.getByLabelText('Player filter') as HTMLSelectElement;
    expect(teamFilter.innerHTML).toContain('Bears');
    expect(playerFilter.innerHTML).toContain('Pat');

    screen.getByRole('button', { name: 'Refresh schedule' }).click();

    expect(await screen.findByText('Unable to refresh schedule while offline. Showing the last loaded schedule.')).toBeTruthy();
    expect(teamFilter.innerHTML).toContain('Bears');
    expect(playerFilter.innerHTML).toContain('Pat');
  });

  it('shows permission-specific copy when a loaded schedule refresh is denied', async () => {
    scheduleServiceMocks.loadParentSchedule
      .mockResolvedValueOnce({
        children: [
          { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
        ],
        events: []
      })
      .mockRejectedValueOnce(new Error('Permission denied for schedule refresh'));

    renderSchedule();

    expect(await screen.findByText('No events in this filter')).toBeTruthy();
    screen.getByRole('button', { name: 'Refresh schedule' }).click();

    expect(await screen.findByText('Unable to refresh schedule because access was denied. Showing the last loaded schedule.')).toBeTruthy();
  });

  it('keeps a dedicated labeled close control alongside the text close action in the calendar picker', () => {
    const source = readFileSync(new URL('./Schedule.tsx', import.meta.url), 'utf8');

    expect(source).toContain('aria-label="Close calendar events"');
    expect(source).toContain('>\n              Close\n            </button>');
  });
});
