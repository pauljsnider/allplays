// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schedule } from './Schedule';
import type { AuthState } from '../lib/types';

const scheduleServiceMocks = vi.hoisted(() => ({
  addTeamCalendarUrl: vi.fn(),
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

  it('shows the service error after the initial load fails and clears the loading skeleton', async () => {
    scheduleServiceMocks.loadParentSchedule.mockRejectedValue(new Error('Schedule unavailable.'));

    renderSchedule();

    expect(screen.getByRole('status', { name: 'Loading schedule' })).toBeTruthy();
    expect(await screen.findByText('Schedule unavailable.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: 'Loading schedule' })).toBeNull();
    });
    expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledWith(auth.user, {
      hydrateDetails: false,
      expandStaffPlayers: false
    });
  });
});
