// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schedule, getGenericEventDetailPath } from './Schedule';
import type { ParentScheduleEvent } from '../lib/scheduleLogic';
import type { AuthState } from '../lib/types';

const scheduleServiceMocks = vi.hoisted(() => ({
  addTeamCalendarUrl: vi.fn(),
  createScheduledGameForApp: vi.fn(),
  createScheduledPracticeForApp: vi.fn(),
  createScheduledTournamentBlockForApp: vi.fn(),
  createScheduleImportGame: vi.fn(),
  createScheduleImportPractice: vi.fn(),
  finalizeScheduleImportBatch: vi.fn(),
  hydrateParentScheduleRsvps: vi.fn(async (schedule: unknown, _user?: unknown, _options?: unknown) => schedule),
  loadParentSchedule: vi.fn(),
  loadScheduleStatTrackerConfigsForApp: vi.fn().mockResolvedValue([]),
  removeTeamCalendarUrl: vi.fn(),
  submitParentScheduleRsvp: vi.fn(),
  submitParentScheduleRsvpForChildren: vi.fn()
}));

const appDataCacheMocks = vi.hoisted(() => ({
  getCachedAppData: vi.fn(() => null),
  getParentScheduleSummaryCacheKey: vi.fn(() => 'parent-schedule:test-user'),
  loadCachedAppData: vi.fn(async (
    _key: string,
    loader: () => Promise<unknown>,
    _options?: { shouldCache?: (value: { isPartial?: boolean }) => boolean }
  ) => loader())
}));

const uxTimingMocks = vi.hoisted(() => ({
  end: vi.fn(),
  recordFirstMeaningfulRender: vi.fn()
}));

const initialLoadTelemetryMocks = vi.hoisted(() => ({
  end: vi.fn()
}));

const shellLayoutMocks = vi.hoisted(() => ({
  isDesktopWeb: false
}));

const staffToolsLoaderMocks = vi.hoisted(() => ({
  load: vi.fn(() => import('../components/schedule/ScheduleStaffTools'))
}));

vi.mock('../lib/scheduleService', () => scheduleServiceMocks);
vi.mock('../lib/appDataCache', () => appDataCacheMocks);
vi.mock('../lib/telemetry', () => ({
  recordAppWorkflowTiming: vi.fn(),
  startAppInitialLoadTimer: vi.fn(() => initialLoadTelemetryMocks)
}));
vi.mock('../lib/performanceInstrumentation', () => ({
  now: vi.fn(() => 0),
  startPerformanceSpan: vi.fn(() => ({ startedAt: 0, end: vi.fn() })),
  recordCompletedPerformanceSpan: vi.fn()
}));
vi.mock('../lib/uxTiming', () => ({
  recordFirstMeaningfulRender: uxTimingMocks.recordFirstMeaningfulRender,
  startScreenMountTimer: vi.fn(() => ({ end: uxTimingMocks.end })),
  startUxTimer: vi.fn(() => ({ end: vi.fn(), cancel: vi.fn() }))
}));
vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktopWeb: shellLayoutMocks.isDesktopWeb })
}));
vi.mock('../components/schedule/loadScheduleStaffTools', () => ({
  loadScheduleStaffTools: staffToolsLoaderMocks.load
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

function renderSchedule(initialEntry = '/schedule') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/schedule" element={<Schedule auth={auth} />} />
      </Routes>
    </MemoryRouter>
  );
}

function ScheduleNavigationHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/schedule')}>Go root schedule</button>
      <Schedule auth={auth} />
    </>
  );
}

function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route-probe">{location.pathname}{location.search}</div>;
}

function buildScheduleEvent(index: number, overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  const event: ParentScheduleEvent = {
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
    isLinkedParentChild: true,
    myRsvp: 'not_responded' as const,
    myRsvpNoteHydrated: true,
    assignments: [],
    openAssignmentCount: 0,
    ...overrides
  };

  const assignments = Array.isArray(event.assignments) ? event.assignments : [];
  return {
    ...event,
    openAssignmentCount: typeof overrides.openAssignmentCount === 'number'
      ? overrides.openAssignmentCount
      : assignments.filter((assignment: any) => assignment?.claimable && !assignment?.claim && !assignment?.value).length
  };
}

function buildPracticePacketEvent(index: number, overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  const date = new Date(Date.UTC(2100, 5, index, 18, 0, 0));
  return buildScheduleEvent(index, {
    eventKey: `team-1::practice-${index}::player-1::${date.toISOString()}::practice`,
    id: `practice-${index}`,
    type: 'practice',
    isDbGame: false,
    date,
    opponent: null,
    title: `Practice Packet ${index}`,
    practiceHomePacketSummary: `${index} drills`,
    practicePacketCompletions: [],
    ...overrides
  });
}

function buildStaffScheduleResult() {
  return {
    children: [
      { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
    ],
    events: [
      buildScheduleEvent(1, {
        isTeamStaff: true
      })
    ]
  };
}

function buildMultiTeamStaffScheduleResult() {
  return {
    children: [
      { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
      { playerId: 'player-2', playerName: 'Sam', teamId: 'team-2', teamName: 'Wolves' }
    ],
    events: [
      buildScheduleEvent(1, {
        isTeamStaff: true
      }),
      buildScheduleEvent(2, {
        eventKey: 'team-2::event-2::player-2::2100-06-02T18:00:00.000Z::practice',
        id: 'event-2',
        teamId: 'team-2',
        teamName: 'Wolves',
        type: 'practice',
        childId: 'player-2',
        childName: 'Sam',
        isDbGame: false,
        isTeamStaff: true,
        title: 'Practice'
      })
    ]
  };
}

function buildMixedTeamScheduleResult() {
  return {
    children: [
      { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
      { playerId: 'player-2', playerName: 'Sam', teamId: 'team-2', teamName: 'Wolves' },
      { playerId: 'player-3', playerName: 'Jordan', teamId: 'team-3', teamName: 'Hawks' }
    ],
    events: [
      buildScheduleEvent(1, {
        isTeamStaff: true
      }),
      buildScheduleEvent(2, {
        eventKey: 'team-2::event-2::player-2::2100-06-02T18:00:00.000Z::practice',
        id: 'event-2',
        teamId: 'team-2',
        teamName: 'Wolves',
        type: 'practice',
        childId: 'player-2',
        childName: 'Sam',
        isDbGame: false,
        isTeamStaff: true,
        title: 'Practice'
      }),
      buildScheduleEvent(3, {
        eventKey: 'team-3::event-3::player-3::2100-06-03T18:00:00.000Z::game',
        id: 'event-3',
        teamId: 'team-3',
        teamName: 'Hawks',
        childId: 'player-3',
        childName: 'Jordan',
        isTeamStaff: false,
        opponent: 'Comets'
      })
    ]
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
    shellLayoutMocks.isDesktopWeb = false;
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

  it('passes the full schedule cache contract into the summary loader', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [],
      isPartial: true
    });

    renderSchedule();

    expect(await screen.findByText('No events in this filter')).toBeTruthy();
    expect(appDataCacheMocks.loadCachedAppData).toHaveBeenCalledWith(
      'parent-schedule:test-user',
      expect.any(Function),
      expect.objectContaining({
        ttlMs: 60 * 1000 * 5,
        force: false,
        shouldCache: expect.any(Function)
      })
    );
    const options = appDataCacheMocks.loadCachedAppData.mock.calls[0]?.[2] as {
      ttlMs: number;
      force: boolean;
      shouldCache: (value: { isPartial?: boolean }) => boolean;
    };
    expect(options.ttlMs).toBe(60 * 1000 * 5);
    expect(options.force).toBe(false);
    expect(options.shouldCache({ isPartial: true })).toBe(false);
    expect(options.shouldCache({ isPartial: false })).toBe(true);
  });

  it('progressively applies RSVP hydration after the fast schedule shell loads', async () => {
    const hydratedEvent = buildScheduleEvent(1);
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [{ playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }],
      events: [hydratedEvent]
    });
    scheduleServiceMocks.hydrateParentScheduleRsvps.mockImplementationOnce(async (schedule: any, _user: unknown, options: any) => {
      schedule.events[0].myRsvp = 'going';
      options.onProgress([...schedule.events]);
      return schedule;
    });

    renderSchedule();

    expect((await screen.findAllByText('Going')).length).toBeGreaterThan(0);
    expect(scheduleServiceMocks.hydrateParentScheduleRsvps).toHaveBeenCalledWith(
      expect.objectContaining({ events: [expect.objectContaining({ id: 'event-1' })] }),
      auth.user,
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
  });

  it('hydrates RSVP rows again when a team filter moves beyond the global bulk limit', async () => {
    const teamOneEvents = Array.from({ length: 50 }, (_, index) => buildScheduleEvent((index % 28) + 1, {
      id: `team-1-event-${index + 1}`,
      eventKey: `team-1::event-${index + 1}::player-1`,
      date: new Date(Date.UTC(2100, 5, 1, 18, index)),
      myRsvpNoteHydrated: false
    }));
    const teamTwoEvents = [1, 2].map((index) => buildScheduleEvent(index, {
      id: `team-2-event-${index}`,
      eventKey: `team-2::event-${index}::player-2`,
      teamId: 'team-2',
      teamName: 'Hawks',
      childId: 'player-2',
      childName: 'Sam',
      date: new Date(Date.UTC(2100, 6, 1, 18, index)),
      myRsvpNoteHydrated: false
    }));
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
        { playerId: 'player-2', playerName: 'Sam', teamId: 'team-2', teamName: 'Hawks' }
      ],
      events: [...teamOneEvents, ...teamTwoEvents]
    });

    renderSchedule();

    await waitFor(() => expect(scheduleServiceMocks.hydrateParentScheduleRsvps).toHaveBeenCalledTimes(1));
    expect((scheduleServiceMocks.hydrateParentScheduleRsvps.mock.calls[0]?.[0] as any).events).toHaveLength(50);
    expect((scheduleServiceMocks.hydrateParentScheduleRsvps.mock.calls[0]?.[0] as any).events.every(
      (event: ParentScheduleEvent) => event.teamId === 'team-1'
    )).toBe(true);

    fireEvent.change(screen.getByLabelText('Team filter'), { target: { value: 'team-2' } });

    await waitFor(() => expect(scheduleServiceMocks.hydrateParentScheduleRsvps).toHaveBeenCalledTimes(2));
    const scopedEvents = (scheduleServiceMocks.hydrateParentScheduleRsvps.mock.calls[1]?.[0] as any).events;
    expect(scopedEvents).toHaveLength(2);
    expect(scopedEvents.every((event: ParentScheduleEvent) => event.teamId === 'team-2')).toBe(true);
  });

  it('waits for RSVP hydration before preselecting only unanswered bulk events', async () => {
    const schedule = {
      children: [{ playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }],
      events: [buildScheduleEvent(1), buildScheduleEvent(2)]
    };
    let finishHydration!: (value: typeof schedule) => void;
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(schedule);
    scheduleServiceMocks.hydrateParentScheduleRsvps.mockImplementationOnce(() => new Promise((resolve) => {
      finishHydration = resolve;
    }));

    renderSchedule();

    const checkingButton = await screen.findByRole('button', { name: 'Checking…' });
    expect(checkingButton).toBeDisabled();
    expect(screen.getByText('Checking your current responses before selecting events.')).toBeTruthy();

    schedule.events[0].myRsvp = 'going';
    finishHydration(schedule);
    const reviewButton = await screen.findByRole('button', { name: 'Review RSVPs' });
    await waitFor(() => expect(reviewButton).toBeEnabled());
    fireEvent.click(reviewButton);
    expect(within(await screen.findByRole('dialog', { name: 'Respond to multiple events' })).getByText('1 selected')).toBeTruthy();
  });

  it('submits one response across multiple upcoming games and practices', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [{ playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }],
      events: [
        buildScheduleEvent(1, { myRsvpNote: 'Arriving late' }),
        buildScheduleEvent(2, { type: 'practice', title: 'Team practice', opponent: null, myRsvpNote: 'Needs a ride' }),
        buildScheduleEvent(3, { myRsvp: 'maybe' })
      ]
    });
    scheduleServiceMocks.submitParentScheduleRsvp.mockResolvedValue(null);

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: 'Review RSVPs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Respond to multiple events' });
    expect(within(dialog).getByText('2 selected')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Going' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.submitParentScheduleRsvp).toHaveBeenCalledTimes(2);
    });
    expect(scheduleServiceMocks.submitParentScheduleRsvp).toHaveBeenCalledWith(expect.objectContaining({ id: 'event-1' }), auth.user, 'going', 'Arriving late');
    expect(scheduleServiceMocks.submitParentScheduleRsvp).toHaveBeenCalledWith(expect.objectContaining({ id: 'event-2' }), auth.user, 'going', 'Needs a ride');
    expect(await screen.findByText('2 RSVPs saved as going.')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Respond to multiple events' })).toBeNull();
  });

  it('excludes an RSVP whose private note did not hydrate from the bulk update', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [{ playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }],
      events: [
        buildScheduleEvent(1),
        buildScheduleEvent(2, { type: 'practice', title: 'Team practice', opponent: null }),
        buildScheduleEvent(3, { myRsvpNote: null, myRsvpNoteHydrated: false })
      ]
    });
    scheduleServiceMocks.submitParentScheduleRsvp.mockResolvedValue(null);

    renderSchedule();

    expect(await screen.findByText('1 RSVP is waiting for private note data. Refresh before updating it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review RSVPs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Respond to multiple events' });
    expect(within(dialog).getByText('2 selected')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Going' }));

    await waitFor(() => expect(scheduleServiceMocks.submitParentScheduleRsvp).toHaveBeenCalledTimes(2));
    expect(scheduleServiceMocks.submitParentScheduleRsvp).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'event-3' }),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('uses one family RSVP write for siblings selected on the same event', async () => {
    const firstChild = buildScheduleEvent(1, { myRsvpNote: 'Both need a ride' });
    const secondChild = buildScheduleEvent(1, {
      eventKey: 'team-1::event-1::player-2::2100-06-01T18:00:00.000Z::game',
      childId: 'player-2',
      childName: 'Sam',
      myRsvpNote: 'Both need a ride'
    });
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
        { playerId: 'player-2', playerName: 'Sam', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [firstChild, secondChild]
    });
    scheduleServiceMocks.submitParentScheduleRsvpForChildren.mockResolvedValue(null);

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: 'Review RSVPs' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Respond to multiple events' })).getByRole('button', { name: 'Maybe' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.submitParentScheduleRsvpForChildren).toHaveBeenCalledWith(
        [expect.objectContaining({ childId: 'player-1' }), expect.objectContaining({ childId: 'player-2' })],
        auth.user,
        'maybe',
        'Both need a ride'
      );
    });
    expect(scheduleServiceMocks.submitParentScheduleRsvp).not.toHaveBeenCalled();
  });

  it('uses per-child RSVP writes when only some siblings are selected', async () => {
    const firstChild = buildScheduleEvent(1);
    const secondChild = buildScheduleEvent(1, {
      eventKey: 'team-1::event-1::player-2::2100-06-01T18:00:00.000Z::game',
      childId: 'player-2',
      childName: 'Sam'
    });
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
        { playerId: 'player-2', playerName: 'Sam', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [firstChild, secondChild]
    });
    scheduleServiceMocks.submitParentScheduleRsvp.mockResolvedValue(null);

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: 'Review RSVPs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Respond to multiple events' });
    fireEvent.click(within(dialog).getByLabelText(/^Select Sam /));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Maybe' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.submitParentScheduleRsvp).toHaveBeenCalledWith(
        expect.objectContaining({ childId: 'player-1' }),
        auth.user,
        'maybe',
        ''
      );
    });
    expect(scheduleServiceMocks.submitParentScheduleRsvpForChildren).not.toHaveBeenCalled();
  });

  it('preserves an existing single-child RSVP note during a bulk status change', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [{ playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }],
      events: [
        buildScheduleEvent(1, { myRsvp: 'maybe', myRsvpNote: 'Arriving after halftime' }),
        buildScheduleEvent(2)
      ]
    });
    scheduleServiceMocks.submitParentScheduleRsvp.mockResolvedValue(null);

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: 'Review RSVPs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Respond to multiple events' });
    fireEvent.click(within(dialog).getAllByLabelText(/^Select Pat /)[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Going' }));

    await waitFor(() => expect(scheduleServiceMocks.submitParentScheduleRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ childId: 'player-1' }),
      auth.user,
      'going',
      'Arriving after halftime'
    ));
  });

  it('uses per-child writes to preserve different sibling RSVP notes', async () => {
    const firstChild = buildScheduleEvent(1, { myRsvp: 'maybe', myRsvpNote: 'Arriving late' });
    const secondChild = buildScheduleEvent(1, {
      eventKey: 'team-1::event-1::player-2::2100-06-01T18:00:00.000Z::game',
      childId: 'player-2',
      childName: 'Sam',
      myRsvp: 'maybe',
      myRsvpNote: 'Needs a ride'
    });
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
        { playerId: 'player-2', playerName: 'Sam', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [firstChild, secondChild]
    });
    scheduleServiceMocks.submitParentScheduleRsvp.mockResolvedValue(null);

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: 'Review RSVPs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Respond to multiple events' });
    fireEvent.click(within(dialog).getByLabelText(/^Select Pat /));
    fireEvent.click(within(dialog).getByLabelText(/^Select Sam /));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Going' }));

    await waitFor(() => expect(scheduleServiceMocks.submitParentScheduleRsvp).toHaveBeenCalledTimes(2));
    expect(scheduleServiceMocks.submitParentScheduleRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ childId: 'player-1' }),
      auth.user,
      'going',
      'Arriving late'
    );
    expect(scheduleServiceMocks.submitParentScheduleRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ childId: 'player-2' }),
      auth.user,
      'going',
      'Needs a ride'
    );
    expect(scheduleServiceMocks.submitParentScheduleRsvpForChildren).not.toHaveBeenCalled();
  });

  it('rolls back only failed bulk RSVP rows and keeps them selected for retry', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [{ playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }],
      events: [buildScheduleEvent(1), buildScheduleEvent(2)]
    });
    scheduleServiceMocks.submitParentScheduleRsvp
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('offline'));

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: 'Review RSVPs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Respond to multiple events' });
    fireEvent.click(within(dialog).getByRole('button', { name: "Can't go" }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('1 RSVP was not saved');
    expect(within(dialog).getByText('1 selected')).toBeTruthy();
    expect(await screen.findByText('1 saved; 1 RSVP needs another try.')).toBeTruthy();
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

  it('clears zero-event staff teams when the schedule is replaced without staff team data', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [],
      events: [],
      staffTeams: [{ teamId: 'team-empty', teamName: 'Empty FC' }]
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={['/schedule']}>
        <Routes>
          <Route path="/schedule" element={<Schedule auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('button', { name: /manage schedule/i })).toBeTruthy();

    rerender(
      <MemoryRouter initialEntries={['/schedule']}>
        <Routes>
          <Route
            path="/schedule"
            element={<Schedule auth={{
              ...auth,
              user: null,
              isParent: false,
              roles: []
            }} />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /manage schedule/i })).toBeNull();
    });
  });

  it('routes generic staff card opens to the game hub helper on mobile', () => {
    expect(getGenericEventDetailPath(buildScheduleEvent(1, {
      isTeamStaff: true,
      myRsvp: 'not_responded'
    }) as any, true)).toBe('/schedule/team-1/event-1?childId=player-1&section=game');
    expect(getGenericEventDetailPath(buildScheduleEvent(1, {
      isTeamStaff: false,
      myRsvp: 'not_responded'
    }) as any, true)).toBe('/schedule/team-1/event-1?childId=player-1&section=availability');
    expect(getGenericEventDetailPath(buildScheduleEvent(1, {
      isTeamStaff: false,
      myRsvp: 'going',
      assignments: [{ role: 'Snack bar', value: '', claimable: true }]
    }) as any, true)).toBe('/schedule/team-1/event-1?childId=player-1&section=assignments');
    expect(getGenericEventDetailPath(buildScheduleEvent(1, {
      isTeamStaff: false,
      myRsvp: 'going',
      assignments: [],
      rideshareSummary: { requests: 1, offerCount: 0, pending: 0, confirmed: 0, seatsLeft: 0, isFull: false }
    }) as any, true)).toBe('/schedule/team-1/event-1?childId=player-1&section=rideshare');
    expect(getGenericEventDetailPath(buildScheduleEvent(1, {
      id: 'practice-1',
      type: 'practice',
      isDbGame: false,
      practiceHomePacketSummary: '2 drills',
      isTeamStaff: true
    }) as any, true)).toBe('/schedule/team-1/practice-1?childId=player-1&section=game');
  });

  it('opens the game hub from mobile staff schedule cards', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildStaffScheduleResult());

    const { container } = render(
      <MemoryRouter initialEntries={['/schedule']}>
        <Routes>
          <Route path="/schedule" element={<Schedule auth={auth} />} />
          <Route path="/schedule/:teamId/:eventId" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Next up');

    const nextUpLink = container.querySelector('.schedule-next-card');
    expect(nextUpLink?.getAttribute('href')).toBe('/schedule/team-1/event-1?childId=player-1&section=game');

    fireEvent.click(nextUpLink as HTMLAnchorElement);

    await waitFor(() => {
      expect(screen.getByTestId('route-probe').textContent).toBe('/schedule/team-1/event-1?childId=player-1&section=game');
    });
  });

  it('routes desktop parent queue links through generic assignment and rideshare detail paths', async () => {
    shellLayoutMocks.isDesktopWeb = true;
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1, {
          myRsvp: 'going',
          assignments: [{ role: 'Snack bar', value: '', claimable: true }]
        }),
        buildScheduleEvent(2, {
          eventKey: 'team-1::event-2::player-1::2100-06-02T18:00:00.000Z::game',
          id: 'event-2',
          date: new Date('2100-06-02T18:00:00.000Z'),
          myRsvp: 'going',
          assignments: [],
          rideshareSummary: { requests: 1, offerCount: 0, pending: 0, confirmed: 0, seatsLeft: 0, isFull: false }
        })
      ]
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/schedule']}>
        <Routes>
          <Route path="/schedule" element={<Schedule auth={auth} />} />
          <Route path="/schedule/:teamId/:eventId" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Parent queue');

    const queueLinks = Array.from(container.querySelectorAll('.schedule-action-queue a')).map((link) => link.getAttribute('href'));

    expect(queueLinks).toContain('/schedule/team-1/event-1?childId=player-1&section=assignments');
    expect(queueLinks).toContain('/schedule/team-1/event-2?childId=player-1&section=rideshare');
  });

  it('shows a five-item mobile action queue with task-specific child links', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1),
        buildPracticePacketEvent(2, { myRsvp: 'going' }),
        buildScheduleEvent(3, {
          myRsvp: 'going',
          isTeamStaff: true,
          assignments: [{ role: 'Snack bar', value: '', claimable: true }]
        }),
        buildScheduleEvent(4, {
          myRsvp: 'going',
          rideshareSummary: { requests: 1, offerCount: 0, pending: 0, confirmed: 0, seatsLeft: 0, isFull: false }
        }),
        buildScheduleEvent(5),
        buildScheduleEvent(6, {
          myRsvp: 'going',
          assignments: [{ role: 'Drinks', value: '', claimable: true }]
        })
      ]
    });

    const { container } = renderSchedule();

    expect(await screen.findByText('Needs attention')).toBeTruthy();
    const queueLinks = Array.from(container.querySelectorAll('.schedule-action-queue-mobile a'));
    expect(queueLinks).toHaveLength(5);
    expect(queueLinks.map((link) => link.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('RSVP needed for Pat'),
      expect.stringContaining('Packet ready: 2 drills'),
      expect.stringContaining('1 open assignment'),
      expect.stringContaining('1 ride request')
    ]));
    expect(queueLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/schedule/team-1/event-1?childId=player-1&section=availability',
      '/schedule/team-1/practice-2?childId=player-1&section=game',
      '/schedule/team-1/event-3?childId=player-1&section=game',
      '/schedule/team-1/event-4?childId=player-1&section=rideshare',
      '/schedule/team-1/event-5?childId=player-1&section=availability'
    ]);
  });

  it('omits the mobile action queue when the active filter has no actions', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [buildScheduleEvent(1, { myRsvp: 'going' })]
    });

    const { container } = renderSchedule();

    expect((await screen.findAllByText('vs. Rivals')).length).toBeGreaterThan(0);
    expect(container.querySelector('.schedule-action-queue-mobile')).toBeNull();
    expect(screen.queryByText('Needs attention')).toBeNull();
  });

  it('keeps the desktop parent queue backed by actions beyond the current list window', async () => {
    shellLayoutMocks.isDesktopWeb = true;
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: Array.from({ length: 22 }, (_, index) => buildScheduleEvent(index + 1, {
        myRsvp: 'going',
        assignments: index === 21 ? [{ role: 'Snack bar', value: '', claimable: true }] : []
      }))
    });

    renderSchedule();

    expect(await screen.findByText('Showing 20 of 22 events')).toBeTruthy();
    expect(screen.getByText('1 open assignment')).toBeTruthy();
  });

  it('keeps the mobile action queue backed by actions beyond the current list window', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: Array.from({ length: 22 }, (_, index) => buildScheduleEvent(index + 1, {
        myRsvp: 'going',
        assignments: index === 21 ? [{ role: 'Snack bar', value: '', claimable: true }] : []
      }))
    });

    const { container } = renderSchedule();

    expect(await screen.findByText('Showing 20 of 22 events')).toBeTruthy();
    expect(container.querySelector('.schedule-action-queue-mobile')?.textContent).toContain('1 open assignment');
  });

  it('counts only actionable packets in non-packet schedule summaries', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildPracticePacketEvent(1, {
          practicePacketCompletions: [{ childId: 'player-1', status: 'completed' }]
        })
      ]
    });

    renderSchedule();

    expect(await screen.findByText('1 event · 0 RSVP · 0 packets')).toBeTruthy();
  });

  it('counts staff team schedule availability in the RSVP summary when the card needs action', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1, {
          eventKey: 'team-1::event-1::staff-team-team-1::2100-06-01T18:00:00.000Z::game',
          childId: 'staff-team-team-1',
          childName: 'Team schedule',
          isLinkedParentChild: false,
          isTeamStaff: true,
          myRsvp: 'not_responded'
        })
      ]
    });

    renderSchedule();

    expect(await screen.findByText('1 event · 1 RSVP · 0 packets')).toBeTruthy();
    expect(screen.getAllByText('Availability needed').length).toBeGreaterThan(0);
  });

  it('excludes locked staff team schedule availability from the RSVP summary', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1, {
          eventKey: 'team-1::event-1::staff-team-team-1::2100-06-01T18:00:00.000Z::game',
          childId: 'staff-team-team-1',
          childName: 'Team schedule',
          isLinkedParentChild: false,
          isTeamStaff: true,
          myRsvp: 'not_responded',
          availabilityLocked: true
        })
      ]
    });

    renderSchedule();

    expect(await screen.findByText('1 event · 0 RSVP · 0 packets')).toBeTruthy();
    expect(screen.queryByText('Availability needed')).toBeNull();
  });

  it('reuses cached open assignment counts across schedule summaries and view changes', async () => {
    shellLayoutMocks.isDesktopWeb = true;
    const assignments = [
      { role: 'Snack bar', claimable: true, value: '' },
      { role: 'Bench help', claimable: true, claim: { claimedByUserId: 'parent-2' } },
      { role: 'Water', claimable: true, value: 'Filled' }
    ];
    const assignmentFilterSpy = vi.spyOn(assignments, 'filter');

    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1, {
          myRsvp: 'going',
          assignments,
          openAssignmentCount: 1,
          rideshareSummary: { requests: 2, offerCount: 0, pending: 0, confirmed: 0, seatsLeft: 0, isFull: false }
        })
      ]
    });

    const { container } = renderSchedule();

    await waitFor(() => {
      expect(screen.getAllByText('1 task open').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('1 open assignment')).toBeTruthy();
    expect(screen.getAllByText('2 ride requests').length).toBeGreaterThan(0);
    expect(assignmentFilterSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Filters and views' }));
    expect(container.querySelector('.schedule-control-panel')?.textContent || '').toContain('1Tasks');

    fireEvent.click(screen.getAllByRole('button', { name: 'Calendar' })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'List' })[0]!);

    await waitFor(() => {
      expect(screen.getAllByText('1 task open').length).toBeGreaterThan(0);
    });
    expect(assignmentFilterSpy).not.toHaveBeenCalled();
  });

  it('shows assignment and rideshare indicators on mobile schedule rows', async () => {
    shellLayoutMocks.isDesktopWeb = false;
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1, {
          myRsvp: 'going',
          openAssignmentCount: 1,
          rideshareSummary: { requests: 0, offerCount: 1, pending: 0, confirmed: 0, seatsLeft: 4, isFull: false }
        })
      ]
    });

    const { container } = renderSchedule();

    const mobileRow = await waitFor(() => {
      const row = container.querySelector('.schedule-list > a');
      expect(row).toBeTruthy();
      return row as HTMLAnchorElement;
    });

    expect(mobileRow.textContent).toContain('1 task open');
    expect(mobileRow.textContent).toContain('4 seats open');
  });

  it('shows the remaining event count when only one more event is hidden', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: Array.from({ length: 21 }, (_, index) => buildScheduleEvent(index + 1, {
        opponent: `Rivals ${index + 1}`
      }))
    });

    renderSchedule();

    expect(await screen.findByText('Showing 20 of 21 events')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show 1 more' })).toBeTruthy();
    expect(screen.getAllByText('vs. Rivals 20').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('vs. Rivals 21')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }));

    expect((await screen.findAllByText('vs. Rivals 21')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Show 1 more' })).toBeNull();
  });

  it('paginates practice packet rows while keeping the all-packet summary count', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: Array.from({ length: 21 }, (_, index) => buildPracticePacketEvent(index + 1))
    });

    renderSchedule('/schedule?view=packets');

    expect(await screen.findByText('21 practice packets need review')).toBeTruthy();
    expect(screen.getByText('Showing 20 of 21 packets')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show 1 more' })).toBeTruthy();
    expect(screen.getByText('Practice Packet 20')).toBeTruthy();
    expect(screen.queryByText('Practice Packet 21')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }));

    expect(await screen.findByText('Practice Packet 21')).toBeTruthy();
    expect(screen.getByText('21 practice packets need review')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show 1 more' })).toBeNull();
  });

  it('does not show packet pagination when only non-packet past events are hidden', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        ...Array.from({ length: 5 }, (_, index) => buildPracticePacketEvent(index + 1, {
          date: new Date(Date.UTC(2025, 5, index + 1, 18, 0, 0))
        })),
        ...Array.from({ length: 25 }, (_, index) => buildScheduleEvent(index + 6, {
          date: new Date(Date.UTC(2025, 5, index + 6, 18, 0, 0))
        }))
      ]
    });

    renderSchedule('/schedule?filter=past-all&view=packets');

    expect(await screen.findByText('Practice Packet 5')).toBeTruthy();
    expect(screen.getByText('All visible packets are handled')).toBeTruthy();
    expect(screen.queryByText('Showing 5 of 5 packets')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show 10 more' })).toBeNull();
  });

  it('applies schedule team and view query params on direct links', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
        { playerId: 'player-2', playerName: 'Sam', teamId: 'team-2', teamName: 'Wolves' }
      ],
      events: [
        buildScheduleEvent(1, {
          eventKey: 'team-1::event-1::player-1::2100-06-01T18:00:00.000Z::game',
          teamId: 'team-1',
          teamName: 'Bears',
          opponent: 'Bears Opponent'
        }),
        buildScheduleEvent(2, {
          eventKey: 'team-2::event-2::player-2::2100-06-02T18:00:00.000Z::game',
          teamId: 'team-2',
          teamName: 'Wolves',
          childId: 'player-2',
          childName: 'Sam',
          opponent: 'Wolves Opponent'
        })
      ]
    });

    renderSchedule('/schedule?teamId=team-2&view=packets');

    await screen.findByText('No practice packets in this filter');
    expect((screen.getByLabelText('Team filter') as HTMLSelectElement).value).toBe('team-2');
    expect(screen.getAllByRole('button', { name: 'Packets' }).some((button) => button.getAttribute('aria-pressed') === 'true')).toBe(true);
  });

  it('clears URL-scoped team and player filters when schedule query params disappear', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
        { playerId: 'player-2', playerName: 'Sam', teamId: 'team-2', teamName: 'Wolves' }
      ],
      events: [
        buildScheduleEvent(1, {
          eventKey: 'team-1::event-1::player-1::2100-06-01T18:00:00.000Z::game',
          teamId: 'team-1',
          teamName: 'Bears'
        }),
        buildScheduleEvent(2, {
          eventKey: 'team-2::event-2::player-2::2100-06-02T18:00:00.000Z::game',
          teamId: 'team-2',
          teamName: 'Wolves',
          childId: 'player-2',
          childName: 'Sam'
        })
      ]
    });

    render(
      <MemoryRouter initialEntries={['/schedule?teamId=team-2&playerId=player-2']}>
        <Routes>
          <Route path="/schedule" element={<ScheduleNavigationHarness />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect((screen.getByLabelText('Team filter') as HTMLSelectElement).value).toBe('team-2');
      expect((screen.getByLabelText('Player filter') as HTMLSelectElement).value).toBe('player-2');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Go root schedule' }));

    await waitFor(() => {
      expect((screen.getByLabelText('Team filter') as HTMLSelectElement).value).toBe('');
      expect((screen.getByLabelText('Player filter') as HTMLSelectElement).value).toBe('');
    });
  });

  it('renders web-created tournament game metadata and the create tournament flow', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1, {
          isTeamStaff: true,
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

    fireEvent.click(screen.getByRole('button', { name: /manage schedule/i }));

    expect(await screen.findByRole('heading', { name: 'Start a new tournament block' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New tournament block' }));
    expect(await screen.findByRole('heading', { name: 'Add tournament for Bears' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /create tournament/i })).toBeTruthy();
  });

  it('adds and removes tournament game rows while preserving the remaining row', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildStaffScheduleResult());

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: /manage schedule/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'New tournament block' }));
    expect(await screen.findByRole('heading', { name: 'Add tournament for Bears' })).toBeTruthy();

    expect(screen.getByText('Game 1')).toBeTruthy();
    expect(screen.queryByText('Game 2')).toBeNull();
    expect(screen.getByRole('button', { name: /add another game/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /add another game/i }));
    expect(screen.getByText('Game 2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Game 2 opponent'), { target: { value: 'Lions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove game 1' }));

    expect(screen.queryByText('Game 2')).toBeNull();
    expect((screen.getByLabelText('Game 1 opponent') as HTMLInputElement).value).toBe('Lions');
    expect(screen.queryByRole('button', { name: /remove game/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^create tournament$/i }));

    expect((await screen.findAllByText('Tournament division is required.')).length).toBeGreaterThan(0);
    expect(scheduleServiceMocks.createScheduledTournamentBlockForApp).not.toHaveBeenCalled();
  });

  it('shows tournament game field errors without losing entered values', async () => {
    scheduleServiceMocks.loadParentSchedule
      .mockResolvedValueOnce(buildStaffScheduleResult())
      .mockResolvedValueOnce(buildStaffScheduleResult());
    scheduleServiceMocks.createScheduledTournamentBlockForApp.mockResolvedValueOnce(['game-1']);

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: /manage schedule/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'New tournament block' }));
    expect(await screen.findByRole('heading', { name: 'Add tournament for Bears' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tournament division'), { target: { value: '10U Gold' } });
    fireEvent.change(screen.getByLabelText('Tournament bracket'), { target: { value: 'Gold Bracket' } });
    fireEvent.change(screen.getByLabelText('Tournament round'), { target: { value: 'Semifinal' } });
    fireEvent.change(screen.getByLabelText('Tournament pool'), { target: { value: 'Pool A' } });
    fireEvent.change(screen.getByLabelText('Game 1 location'), { target: { value: 'Main Gym' } });
    fireEvent.change(screen.getByLabelText('Game 1 notes'), { target: { value: 'Bring dark jerseys' } });
    fireEvent.change(screen.getByLabelText('Game 1 opponent'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Game 1 starts'), { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /^create tournament$/i }));

    expect((await screen.findAllByText('Game opponent is required.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Game start time is required.')).toBeTruthy();
    expect(screen.getByDisplayValue('10U Gold')).toBeTruthy();
    expect(screen.getByDisplayValue('Pool A')).toBeTruthy();
    expect(screen.getByDisplayValue('Main Gym')).toBeTruthy();
    expect(screen.getByDisplayValue('Bring dark jerseys')).toBeTruthy();
    expect(scheduleServiceMocks.createScheduledTournamentBlockForApp).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Game 1 opponent'), { target: { value: 'Tigers' } });
    fireEvent.change(screen.getByLabelText('Game 1 starts'), { target: { value: '2026-06-24T18:30' } });
    fireEvent.change(screen.getByLabelText('Game 1 ends'), { target: { value: '2026-06-24T20:00' } });
    fireEvent.click(screen.getByRole('button', { name: /^create tournament$/i }));

    await waitFor(() => {
      expect(scheduleServiceMocks.createScheduledTournamentBlockForApp).toHaveBeenCalledTimes(1);
      expect(scheduleServiceMocks.createScheduledTournamentBlockForApp).toHaveBeenCalledWith('team-1', expect.objectContaining({
        divisionName: '10U Gold',
        poolName: 'Pool A',
        games: [expect.objectContaining({
          opponent: 'Tigers',
          location: 'Main Gym',
          notes: 'Bring dark jerseys'
        })]
      }), auth.user);
    });
  });

  it('validates, submits, and reloads every game in a multi-game tournament block', async () => {
    scheduleServiceMocks.loadParentSchedule
      .mockResolvedValueOnce(buildStaffScheduleResult())
      .mockResolvedValueOnce({
        children: buildStaffScheduleResult().children,
        events: [
          buildScheduleEvent(2, {
            isTeamStaff: true,
            opponent: 'Tigers',
            competitionType: 'tournament',
            tournament: { divisionName: '10U Gold', bracketName: 'Gold Bracket', roundName: 'Semifinal', poolName: 'Pool A' }
          }),
          buildScheduleEvent(3, {
            isTeamStaff: true,
            opponent: 'Lions',
            competitionType: 'tournament',
            tournament: { divisionName: '10U Gold', bracketName: 'Gold Bracket', roundName: 'Semifinal', poolName: 'Pool A' }
          })
        ]
      });
    scheduleServiceMocks.createScheduledTournamentBlockForApp.mockResolvedValueOnce(['game-1', 'game-2']);

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: /manage schedule/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'New tournament block' }));
    expect(await screen.findByRole('heading', { name: 'Add tournament for Bears' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tournament division'), { target: { value: '10U Gold' } });
    fireEvent.change(screen.getByLabelText('Tournament bracket'), { target: { value: 'Gold Bracket' } });
    fireEvent.change(screen.getByLabelText('Tournament round'), { target: { value: 'Semifinal' } });
    fireEvent.change(screen.getByLabelText('Tournament pool'), { target: { value: 'Pool A' } });
    fireEvent.change(screen.getByLabelText('Game 1 opponent'), { target: { value: 'Tigers' } });
    fireEvent.change(screen.getByLabelText('Game 1 location'), { target: { value: 'Main Gym' } });
    fireEvent.change(screen.getByLabelText('Game 1 starts'), { target: { value: '2026-06-24T18:30' } });
    fireEvent.change(screen.getByLabelText('Game 1 ends'), { target: { value: '2026-06-24T20:00' } });
    fireEvent.click(screen.getByRole('button', { name: /add another game/i }));

    fireEvent.click(screen.getByRole('button', { name: /^create tournament$/i }));
    expect((await screen.findAllByText('Game opponent is required.')).length).toBeGreaterThan(0);
    expect(scheduleServiceMocks.createScheduledTournamentBlockForApp).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Game 1 opponent') as HTMLInputElement).value).toBe('Tigers');

    fireEvent.change(screen.getByLabelText('Game 2 opponent'), { target: { value: 'Lions' } });
    fireEvent.change(screen.getByLabelText('Game 2 location'), { target: { value: 'Field 2' } });
    fireEvent.change(screen.getByLabelText('Game 2 starts'), { target: { value: '2026-06-25T18:30' } });
    fireEvent.change(screen.getByLabelText('Game 2 ends'), { target: { value: '2026-06-25T20:00' } });

    fireEvent.click(screen.getByRole('button', { name: /^create tournament$/i }));

    await waitFor(() => {
      expect(scheduleServiceMocks.createScheduledTournamentBlockForApp).toHaveBeenCalledTimes(1);
      expect(scheduleServiceMocks.createScheduledTournamentBlockForApp).toHaveBeenCalledWith('team-1', expect.objectContaining({
        divisionName: '10U Gold',
        bracketName: 'Gold Bracket',
        roundName: 'Semifinal',
        poolName: 'Pool A',
        games: [
          expect.objectContaining({ opponent: 'Tigers', location: 'Main Gym' }),
          expect.objectContaining({ opponent: 'Lions', location: 'Field 2' })
        ]
      }), auth.user);
    });

    await waitFor(() => {
      expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
    });
    expect((await screen.findAllByText('10U Gold / Gold Bracket / Semifinal')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Tournament created and schedule refreshed.')).toBeTruthy();
    expect((await screen.findAllByText('vs. Tigers')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('vs. Lions')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Add tournament for Bears' })).toBeNull();
  });

  it('shows tournament save errors without refreshing or clearing the attempted block', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildStaffScheduleResult());
    scheduleServiceMocks.createScheduledTournamentBlockForApp.mockRejectedValueOnce(new Error('Tournament save denied.'));

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: /manage schedule/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'New tournament block' }));
    expect(await screen.findByRole('heading', { name: 'Add tournament for Bears' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tournament division'), { target: { value: '10U Gold' } });
    fireEvent.change(screen.getByLabelText('Tournament bracket'), { target: { value: 'Gold Bracket' } });
    fireEvent.change(screen.getByLabelText('Tournament round'), { target: { value: 'Semifinal' } });
    fireEvent.change(screen.getByLabelText('Tournament pool'), { target: { value: 'Pool A' } });
    fireEvent.change(screen.getByLabelText('Game 1 opponent'), { target: { value: 'Tigers' } });
    fireEvent.change(screen.getByLabelText('Game 1 location'), { target: { value: 'Main Gym' } });
    fireEvent.change(screen.getByLabelText('Game 1 starts'), { target: { value: '2026-06-24T18:30' } });
    fireEvent.click(screen.getByRole('button', { name: /^create tournament$/i }));

    expect(await screen.findByText('Tournament save denied.')).toBeTruthy();
    expect(screen.getByDisplayValue('10U Gold')).toBeTruthy();
    expect(screen.getByDisplayValue('Gold Bracket')).toBeTruthy();
    expect(screen.getByDisplayValue('Semifinal')).toBeTruthy();
    expect(screen.getByDisplayValue('Pool A')).toBeTruthy();
    expect(screen.getByDisplayValue('Tigers')).toBeTruthy();
    expect(screen.getByDisplayValue('Main Gym')).toBeTruthy();
    expect(scheduleServiceMocks.createScheduledTournamentBlockForApp).toHaveBeenCalledTimes(1);
    expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(1);
  });

  it.each(['list', 'compact', 'calendar', 'packets'])('renders the %s view for a read-only parent without loading staff tools', async (view) => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1, {
          isTeamStaff: false
        })
      ]
    });

    renderSchedule(`/schedule?view=${view}`);

    await waitFor(() => {
      expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('status', { name: 'Loading schedule' })).toBeNull();
    });
    expect(screen.queryByRole('button', { name: /manage schedule/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New tournament block' })).toBeNull();
    expect(staffToolsLoaderMocks.load).not.toHaveBeenCalled();
  });

  it('opens the tournament shell from a staff action and cancels without creating data', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildStaffScheduleResult());

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: /manage schedule/i }));
    expect(await screen.findByRole('heading', { name: 'Start a new tournament block' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add tournament for Bears' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'New tournament block' }));

    expect(await screen.findByRole('heading', { name: 'Add tournament for Bears' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Tournament division'), { target: { value: '10U Gold' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('heading', { name: 'Start a new tournament block' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add tournament for Bears' })).toBeNull();
    expect(screen.queryByDisplayValue('10U Gold')).toBeNull();
    expect(scheduleServiceMocks.createScheduledTournamentBlockForApp).not.toHaveBeenCalled();
  });

  it('does not label scheduled games with default 0-0 scores as final results', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1, {
          status: 'scheduled',
          liveStatus: 'scheduled',
          homeScore: 0,
          awayScore: 0
        })
      ]
    });

    renderSchedule();

    await waitFor(() => {
      expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('status', { name: 'Loading schedule' })).toBeNull();
    });
    expect(screen.queryByText('Final 0-0')).toBeNull();
    expect(screen.queryByText('0-0')).toBeNull();
  });

  it('shows saved scores for past games even before status flips to completed', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce({
      children: [
        { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
      ],
      events: [
        buildScheduleEvent(1, {
          date: new Date(Date.now() - (4 * 60 * 60 * 1000)),
          status: 'scheduled',
          liveStatus: 'scheduled',
          homeScore: 21,
          awayScore: 14
        })
      ]
    });

    renderSchedule('/schedule?filter=recent-results');

    await waitFor(() => {
      expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('status', { name: 'Loading schedule' })).toBeNull();
    });
    expect(screen.getByText('21-14')).toBeTruthy();
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

    expect(source).toContain('function ScheduleList({ events, totalCount, visibleCount, pageSize, canShowMore, loadingMore, preferGameHubForStaff, onShowMore }');
    expect(source).toContain('function CompactScheduleList({ events, totalCount, visibleCount, pageSize, canShowMore, loadingMore, preferGameHubForStaff, onShowMore }');
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

  it('keeps staff management implementation behind the deferred component boundary', () => {
    const scheduleSource = readFileSync(resolveAppSourcePath('src/pages/Schedule.tsx'), 'utf8');
    const staffToolsSource = readFileSync(resolveAppSourcePath('src/components/schedule/ScheduleStaffTools.tsx'), 'utf8');

    expect(scheduleSource).toContain('void loadScheduleStaffTools()');
    expect(scheduleSource).toContain('.catch(() =>');
    expect(scheduleSource).not.toContain("from '../components/schedule/ScheduleStaffTools'");
    expect(scheduleSource).not.toContain('createScheduledGameForApp');
    expect(scheduleSource).not.toContain('createScheduledPracticeForApp');
    expect(scheduleSource).not.toContain('function ScheduleGameCreatePanel');
    expect(scheduleSource).not.toContain('function ScheduleTournamentCreatePanel');
    expect(scheduleSource).not.toContain('function SchedulePracticeCreatePanel');
    expect(scheduleSource).not.toContain('function ScheduleAiImportPanel');
    expect(scheduleSource).not.toContain('function ScheduleCsvImportPanel');
    expect(scheduleSource).not.toContain('function CalendarSourcePanel');
    expect(staffToolsSource).toContain('function ScheduleGameCreatePanel');
    expect(staffToolsSource).toContain('function CalendarSourcePanel');
  });

  it('shows a graceful fallback when schedule staff tools fail to load', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildStaffScheduleResult());
    staffToolsLoaderMocks.load.mockRejectedValueOnce(new Error('Chunk load failed'));

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: /manage schedule/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load schedule tools');
    expect(screen.queryByText('Loading schedule tools…')).toBeNull();
  });

  it('defers tracker config loading on mobile until staff tools are opened and caches the result', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildStaffScheduleResult());
    scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp.mockResolvedValueOnce([
      { id: 'config-1', name: 'Varsity Tracker' }
    ]);

    renderSchedule();

    expect(await screen.findByRole('button', { name: /manage schedule/i })).toBeTruthy();
    expect(scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp).not.toHaveBeenCalled();
    expect(staffToolsLoaderMocks.load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /manage schedule/i }));

    await waitFor(() => {
      expect(staffToolsLoaderMocks.load).toHaveBeenCalledTimes(1);
      expect(scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp).toHaveBeenCalledTimes(1);
      expect(scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp).toHaveBeenCalledWith('team-1', auth.user);
    });
    expect((await screen.findAllByRole('option', { name: 'Varsity Tracker' })).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /manage schedule/i }));
    fireEvent.click(screen.getByRole('button', { name: /manage schedule/i }));

    await waitFor(() => {
      expect(screen.getAllByRole('option', { name: 'Varsity Tracker' }).length).toBeGreaterThan(0);
    });
    expect(staffToolsLoaderMocks.load).toHaveBeenCalledTimes(1);
    expect(scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp).toHaveBeenCalledTimes(1);
  });

  it('shows Manage schedule for multi-team staff and opens to a team selector before tools', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildMultiTeamStaffScheduleResult());

    renderSchedule();

    expect(await screen.findByRole('button', { name: /manage schedule/i })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add game for Bears' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /manage schedule/i }));

    expect(await screen.findByRole('heading', { name: 'Choose the team to manage' })).toBeTruthy();
    expect(screen.getByLabelText('Team to manage')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add game for Bears' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Add practice for Bears' })).toBeNull();
  });

  it('uses the Manage schedule team selector to reveal and submit team-specific staff tools', async () => {
    scheduleServiceMocks.loadParentSchedule
      .mockResolvedValueOnce(buildMultiTeamStaffScheduleResult())
      .mockResolvedValueOnce(buildMultiTeamStaffScheduleResult());
    scheduleServiceMocks.createScheduledGameForApp.mockResolvedValueOnce('game-2');

    renderSchedule();

    fireEvent.click(await screen.findByRole('button', { name: /manage schedule/i }));
    expect(await screen.findByRole('heading', { name: 'Choose the team to manage' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Team to manage'), { target: { value: 'team-2' } });

    expect(await screen.findByRole('heading', { name: 'Add game for Wolves' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New tournament block' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Add external calendar' })).toBeTruthy();

    fireEvent.change(screen.getAllByLabelText('Opponent')[0], { target: { value: 'Falcons' } });
    fireEvent.change(screen.getAllByLabelText('Location')[0], { target: { value: 'West Gym' } });
    fireEvent.click(screen.getByRole('button', { name: /^create game$/i }));

    await waitFor(() => {
      expect(scheduleServiceMocks.createScheduledGameForApp).toHaveBeenCalledTimes(1);
      expect(scheduleServiceMocks.createScheduledGameForApp).toHaveBeenCalledWith('team-2', expect.objectContaining({
        opponent: 'Falcons',
        location: 'West Gym'
      }), auth.user);
    });
  });

  it('ignores stale tracker configs when staff switch teams before loading finishes', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildMultiTeamStaffScheduleResult());
    const configResolvers = new Map<string, (configs: Array<{ id: string; name: string }>) => void>();
    scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp.mockImplementation((teamId: string) => new Promise((resolve) => {
      configResolvers.set(teamId, resolve);
    }));

    renderSchedule();

    await screen.findByRole('button', { name: /manage schedule/i });
    fireEvent.change(screen.getByLabelText('Team filter'), { target: { value: 'team-1' } });
    fireEvent.click(screen.getByRole('button', { name: /manage schedule/i }));
    await waitFor(() => expect(configResolvers.has('team-1')).toBe(true));

    fireEvent.change(screen.getByLabelText('Team filter'), { target: { value: 'team-2' } });
    await waitFor(() => expect(configResolvers.has('team-2')).toBe(true));

    configResolvers.get('team-2')?.([{ id: 'config-2', name: 'Wolves Tracker' }]);
    expect((await screen.findAllByRole('option', { name: 'Wolves Tracker' })).length).toBeGreaterThan(0);

    configResolvers.get('team-1')?.([{ id: 'config-1', name: 'Bears Tracker' }]);
    await waitFor(() => expect(screen.queryAllByRole('option', { name: 'Bears Tracker' })).toHaveLength(0));
    expect(screen.getAllByRole('option', { name: 'Wolves Tracker' }).length).toBeGreaterThan(0);
  });

  it('lets staff team selection override a non-manageable page team filter', async () => {
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildMixedTeamScheduleResult());

    renderSchedule('/schedule?teamId=team-3');

    fireEvent.click(await screen.findByRole('button', { name: /manage schedule/i }));
    expect(await screen.findByRole('heading', { name: 'Choose the team to manage' })).toBeTruthy();
    expect((screen.getByLabelText('Team filter') as HTMLSelectElement).value).toBe('team-3');

    fireEvent.change(screen.getByLabelText('Team to manage'), { target: { value: 'team-2' } });

    expect(await screen.findByRole('heading', { name: 'Add game for Wolves' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Add external calendar' })).toBeTruthy();
  });

  it('hides desktop staff schedule tools until Manage schedule is opened', async () => {
    shellLayoutMocks.isDesktopWeb = true;
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildStaffScheduleResult());

    renderSchedule();

    expect(await screen.findByRole('button', { name: /manage schedule/i })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add game for Bears' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Add external calendar' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /manage schedule/i }));

    expect(await screen.findByRole('heading', { name: 'Add game for Bears' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Add external calendar' })).toBeTruthy();
  });

  it('loads desktop tracker configs when Manage schedule exposes inline game creation', async () => {
    shellLayoutMocks.isDesktopWeb = true;
    scheduleServiceMocks.loadParentSchedule.mockResolvedValueOnce(buildStaffScheduleResult());
    let resolveConfigLoad: ((configs: Array<{ id: string; name: string }>) => void) | null = null;
    scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp.mockImplementationOnce(() => new Promise((resolve) => {
      resolveConfigLoad = resolve;
    }));

    renderSchedule();

    expect(await screen.findByRole('button', { name: /manage schedule/i })).toBeTruthy();
    expect(scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /manage schedule/i }));

    expect(await screen.findByRole('heading', { name: 'Add game for Bears' })).toBeTruthy();

    await waitFor(() => {
      expect(scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp).toHaveBeenCalledTimes(1);
      expect(scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp).toHaveBeenCalledWith('team-1', auth.user);
    });
    expect(screen.getByLabelText('Tracker config')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Loading tracker configs' })).toBeTruthy();

    if (!resolveConfigLoad) {
      throw new Error('Expected the tracker config request to start when Manage schedule opened.');
    }
    (resolveConfigLoad as (configs: Array<{ id: string; name: string }>) => void)([
      { id: 'config-1', name: 'Basketball Standard' }
    ]);

    expect((await screen.findAllByRole('option', { name: 'Basketball Standard' })).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Tracker config')).not.toBeDisabled();
  });
});
