// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schedule } from './Schedule';
import type { AuthState } from '../lib/types';

const scheduleServiceMocks = vi.hoisted(() => ({
  addTeamCalendarUrl: vi.fn(),
  createScheduledGameForApp: vi.fn(),
  createScheduledPracticeForApp: vi.fn(),
  createScheduleImportGame: vi.fn(),
  createScheduleImportPractice: vi.fn(),
  finalizeScheduleImportBatch: vi.fn(),
  loadParentSchedule: vi.fn(),
  loadScheduleStatTrackerConfigsForApp: vi.fn().mockResolvedValue([]),
  removeTeamCalendarUrl: vi.fn()
}));

const appDataCacheMocks = vi.hoisted(() => ({
  getCachedAppData: vi.fn(() => null),
  getParentScheduleSummaryCacheKey: vi.fn(() => 'parent-schedule:test-user'),
  loadCachedAppData: vi.fn(async (_key: string, loader: () => Promise<unknown>) => loader())
}));

const uxTimingMocks = vi.hoisted(() => ({
  end: vi.fn(),
  recordFirstMeaningfulRender: vi.fn()
}));

const initialLoadTelemetryMocks = vi.hoisted(() => ({
  end: vi.fn()
}));

vi.mock('../lib/scheduleService', () => scheduleServiceMocks);
vi.mock('../lib/appDataCache', () => appDataCacheMocks);
vi.mock('../lib/telemetry', () => ({
  startAppInitialLoadTimer: vi.fn(() => initialLoadTelemetryMocks)
}));
vi.mock('../lib/uxTiming', () => ({
  recordFirstMeaningfulRender: uxTimingMocks.recordFirstMeaningfulRender,
  startScreenMountTimer: vi.fn(() => ({ end: uxTimingMocks.end }))
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

function buildScheduleEvent(index: number, overrides: Record<string, unknown> = {}) {
  return {
    eventKey: `team-1::event-${index}::player-1::2100-06-${String(index).padStart(2, '0')}T18:00:00.000Z::game`,
    id: `event-${index}`,
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game' as const,
    date: new Date(`2100-06-${String(index).padStart(2, '0')}T18:00:00.000Z`),
    location: 'Main Gym',
    opponent: 'Rivals',
    title: null,
    childId: 'player-1',
    childName: 'Pat',
    isDbGame: true,
    isCancelled: false,
    myRsvp: 'not_responded' as const,
    assignments: [],
    ...overrides
  };
}

function resolveAppSourcePath(relativePath: string) {
  const cwd = process.cwd();
  const appRoot = cwd.endsWith('/apps/app') || cwd.endsWith('\\apps\\app')
    ? cwd
    : resolve(cwd, 'apps/app');
  return resolve(appRoot, relativePath);
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

  it('waits for the first schedule load to finish before recording first meaningful render', async () => {
    let resolveSchedule!: (value: { children: Array<{ playerId: string; playerName: string; teamId: string; teamName: string }>; events: [] }) => void;
    scheduleServiceMocks.loadParentSchedule.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSchedule = resolve;
    }));

    renderSchedule();

    expect(uxTimingMocks.recordFirstMeaningfulRender).not.toHaveBeenCalled();

    resolveSchedule({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: []
    });

    expect(await screen.findByText('No events in this filter')).toBeTruthy();
    await waitFor(() => {
      expect(uxTimingMocks.recordFirstMeaningfulRender).toHaveBeenCalledWith('schedule');
    });
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

    fireEvent.click(screen.getByRole('button', { name: 'Refresh schedule' }));

    expect(await screen.findByText('Unable to refresh schedule while offline. Showing the last loaded schedule.')).toBeTruthy();
    expect(teamFilter.innerHTML).toContain('Bears');
    expect(playerFilter.innerHTML).toContain('Pat');
  });

  it('emits initial schedule load telemetry for success and failure paths', async () => {
    scheduleServiceMocks.loadParentSchedule
      .mockResolvedValueOnce({
        children: [
          { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
        ],
        events: []
      })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { rerender } = render(
      <MemoryRouter initialEntries={['/schedule']}>
        <Routes>
          <Route path="/schedule" element={<Schedule auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('No events in this filter')).toBeTruthy();
    await waitFor(() => {
      expect(initialLoadTelemetryMocks.end).toHaveBeenCalledWith(expect.objectContaining({
        children: 1,
        eventRows: 0,
        groupedEvents: 0
      }));
    });

    initialLoadTelemetryMocks.end.mockClear();
    rerender(
      <MemoryRouter initialEntries={['/schedule']}>
        <Routes>
          <Route
            path="/schedule"
            element={<Schedule auth={{
              ...auth,
              user: { ...auth.user!, uid: 'next-user' } as AuthState['user']
            }} />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Unable to load schedule while offline. Check your connection and try again.')).toBeTruthy();
    await waitFor(() => {
      expect(initialLoadTelemetryMocks.end).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({
          name: 'AppServiceError',
          type: 'network'
        })
      }));
    });
  });

  it('shows the remaining event count when only one more event is hidden', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: Array.from({ length: 21 }, (_, index) => buildScheduleEvent(index + 1))
    });

    renderSchedule();

    expect(await screen.findByText('Showing 20 of 21 events')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show 1 more' })).toBeTruthy();
  });

  it('renders web-created tournament game metadata read-only in the schedule list', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1, {
          competitionType: 'tournament',
          tournament: {
            divisionName: '10U Gold',
            bracketName: 'Gold Bracket',
            roundName: 'Semifinal',
            poolName: 'Pool A',
            slotAssignments: {
              home: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 1 },
              away: { sourceType: 'game_result', gameId: 'R1G2', outcome: 'winner' }
            },
            standings: {
              poolName: '10U Gold / Pool A',
              rows: [
                { rank: 1, teamName: 'Tigers', wins: 2, losses: 0, points: 6 },
                { rank: 2, teamName: 'Lions', record: '1-1', points: 3 }
              ],
              isOverridden: true
            }
          }
        })
      ]
    });

    renderSchedule();

    expect((await screen.findAllByText('10U Gold / Gold Bracket / Semifinal')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pool: Pool A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('10U Gold / Pool A standings').length).toBeGreaterThan(0);
    expect(screen.getAllByText('#1 Tigers (2-0, 6 pts)').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /create tournament/i })).toBeNull();
  });

  it('requests older past-event pages for every linked team, even without events in the default window', async () => {
    const seededPastEvent = buildScheduleEvent(1, {
      eventKey: 'team-1::event-1::player-1::past::game',
      date: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000))
    });
    scheduleServiceMocks.loadParentSchedule
      .mockResolvedValueOnce({
        children: [
          { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
          { playerId: 'player-2', playerName: 'Sam', teamId: 'team-2', teamName: 'Wolves' }
        ],
        events: [seededPastEvent]
      })
      .mockResolvedValueOnce({
        children: [],
        events: []
      });

    renderSchedule();

    expect(await screen.findByText('No events in this filter')).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText('Schedule filter')[0], { target: { value: 'past-all' } });

    await waitFor(() => {
      expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
    });

    const secondCall = scheduleServiceMocks.loadParentSchedule.mock.calls[1];
    const scheduleRangeByTeam = secondCall[1]?.scheduleRangeByTeam;
    expect(scheduleRangeByTeam).toBeTruthy();
    expect(Object.keys(scheduleRangeByTeam).sort()).toEqual(['team-1', 'team-2']);
    expect(scheduleRangeByTeam['team-1'].endDate.getTime()).toBe(seededPastEvent.date.getTime() - 1);
    expect(scheduleRangeByTeam['team-2'].endDate.getTime()).toBeGreaterThan(Date.now() - (410 * 24 * 60 * 60 * 1000));
    expect(scheduleRangeByTeam['team-2'].endDate.getTime()).toBeLessThan(Date.now() - (390 * 24 * 60 * 60 * 1000));
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
    fireEvent.click(screen.getByRole('button', { name: 'Refresh schedule' }));

    expect(await screen.findByText('Unable to refresh schedule because access was denied. Showing the last loaded schedule.')).toBeTruthy();
  });

  it('keeps a dedicated labeled close control alongside the text close action in the calendar picker', () => {
    const source = readFileSync(resolveAppSourcePath('src/pages/Schedule.tsx'), 'utf8');

    expect(source).toContain('aria-label="Close calendar events"');
    expect(source).toContain('>\n              Close\n            </button>');
  });

  it('keeps list pagination props in sync with the parent schedule view', () => {
    const source = readFileSync(resolveAppSourcePath('src/pages/Schedule.tsx'), 'utf8');

    expect(source).toContain('function ScheduleList({ events, visibleCount, pageSize, canShowMore, loadingMore, onShowMore }');
    expect(source).toContain('function CompactScheduleList({ events, visibleCount, pageSize, canShowMore, loadingMore, onShowMore }');
    expect(source).toContain("{loadingMore ? 'Loading more…' : `Show ${Math.min(pageSize, remainingCount || pageSize)} more`}");
  });

  it('keeps Schedule read loading paths on the shared async operation helper', () => {
    const source = readFileSync(resolveAppSourcePath('src/pages/Schedule.tsx'), 'utf8');

    expect(source).toContain('loading: scheduleReadLoading');
    expect(source).toContain('run: runScheduleRead');
    expect(source).toContain('loading: loadingPastHistory');
    expect(source).toContain('run: runPastHistoryRead');
    expect(source).toContain('return runScheduleRead(');
    expect(source).toContain('const loaded = await runPastHistoryRead(');
    expect(source).not.toContain('const [loadingPastHistory, setLoadingPastHistory]');
  });
});
