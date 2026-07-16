// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleServiceMocks = vi.hoisted(() => ({
  cancelParentScheduleRideRequest: vi.fn(),
  cancelPracticeOccurrenceForApp: vi.fn(),
  cancelScheduledGameForApp: vi.fn(),
  claimParentScheduleAssignmentSlot: vi.fn(),
  createScheduleAssignment: vi.fn(),
  createParentScheduleRideOffer: vi.fn(),
  loadScheduleStatTrackerConfigsForApp: vi.fn<(...args: any[]) => Promise<any[]>>(() => Promise.resolve([{ id: 'cfg-basketball', name: 'Basketball' }])),
  loadParentPracticePacket: vi.fn(),
  loadStaffPracticePacket: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({
    sessionId: 'session-1',
    teamId: 'team-1',
    eventId: 'practice-1',
    title: 'Practice',
    date: new Date('2026-06-04T18:00:00Z'),
    location: 'Main Gym',
    packetTitle: 'Practice home packet',
    dueDate: null,
    totalMinutes: 0,
    homePacket: { blocks: [], totalMinutes: 0 },
    completions: [],
    children: [{ id: 'player-1', name: 'Avery Smith' }]
  })),
  loadStaffPracticeAttendance: vi.fn(),
  loadParentScheduleAssignments: vi.fn(),
  loadParentScheduleEventDetail: vi.fn(),
  resolveCachedParentScheduleEvents: vi.fn<(...args: any[]) => any[]>(() => [] as any[]),
  loadParentScheduleRideOffers: vi.fn(),
  loadStaffScheduleRsvpBreakdown: vi.fn(),
  loadStaffRsvpReminderPreview: vi.fn(),
  invalidateStaffRsvpAvailabilityEvent: vi.fn(),
  createStaffRsvpAvailabilityLoader: vi.fn(() => ({
    loadBreakdown: (...args: any[]) => scheduleServiceMocks.loadStaffScheduleRsvpBreakdown(...args),
    loadReminderPreview: (...args: any[]) => scheduleServiceMocks.loadStaffRsvpReminderPreview(...args),
    invalidateEvent: (...args: any[]) => scheduleServiceMocks.invalidateStaffRsvpAvailabilityEvent(...args)
  })),
  loadAutoFilledLineupDraftPreviewForApp: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({ availablePlayers: [] as any[], goingPlayers: [] as any[], gamePlan: null as any })),
  markParentPracticePacketComplete: vi.fn(),
  publishGamePlanForApp: vi.fn(),
  releaseParentScheduleAssignmentClaim: vi.fn(),
  removeScheduleAssignment: vi.fn(),
  requestParentScheduleRideSpot: vi.fn(),
  sendStaffRsvpReminder: vi.fn(),
  setParentScheduleRideOfferStatus: vi.fn(),
  submitParentScheduleRsvp: vi.fn(),
  submitParentScheduleRsvpForChildren: vi.fn(),
  submitStaffScheduleRsvpOverride: vi.fn(),
  summarizeParentScheduleRideOffers: vi.fn(() => ({ offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false })),
  updateScheduleAssignment: vi.fn(),
  loadHomeScoringPlayers: vi.fn(),
  publishLiveScoreUpdateEvent: vi.fn(),
  recordPlayerGameStat: vi.fn(),
  recordPlayerScoringStat: vi.fn(),
  undoRecordedPlayerGameStat: vi.fn(),
  saveScheduledGameLineupDraftForApp: vi.fn(),
  saveStaffPracticeAttendance: vi.fn(),
  saveStaffPracticePacket: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({
    sessionId: 'session-1',
    teamId: 'team-1',
    eventId: 'practice-1',
    title: 'Practice',
    date: new Date('2026-06-04T18:00:00Z'),
    location: 'Main Gym',
    packetTitle: 'Practice home packet',
    dueDate: null,
    totalMinutes: 10,
    homePacket: { blocks: [{ drillTitle: 'Home Drill 1', duration: 10 }], totalMinutes: 10 },
    completions: [],
    children: [{ id: 'player-1', name: 'Avery Smith' }]
  })),
  completeGameWrapupForApp: vi.fn(),
  loadGameDayLiveEventsForApp: vi.fn<(...args: any[]) => Promise<any[]>>(() => Promise.resolve([] as any[])),
  saveGameDaySubstitutionForApp: vi.fn((_teamId, _gameId, _user, payload) => Promise.resolve(payload)),
  updateGameScore: vi.fn(),
  updateScheduledGameForApp: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({ updated: true, eventId: 'game-1' })),
  updateLiveGameClockState: vi.fn(),
  buildLiveGameClockPeriods: vi.fn((game: any) => game?.gamePlan?.numPeriods === 4 ? ['Q1', 'Q2', 'Q3', 'Q4'] : ['H1', 'H2']),
  resolveLiveGameClockSnapshot: vi.fn((game: any, now = new Date()) => {
    const persistedClockMs = Math.max(0, Number(game?.liveClockMs || 0));
    const updatedAt = game?.liveClockUpdatedAt ? new Date(game.liveClockUpdatedAt) : now;
    const running = game?.liveClockRunning === true;
    return {
      persistedClockMs,
      effectiveClockMs: persistedClockMs + (running ? Math.max(0, now.getTime() - updatedAt.getTime()) : 0),
      running,
      period: game?.liveClockPeriod || game?.period || 'H1',
      updatedAt
    };
  }),
  updateParentScheduleRideRequestStatus: vi.fn()
}));

vi.mock('../lib/scheduleService', () => scheduleServiceMocks);
vi.mock('../lib/scheduleGameDayService', () => ({
  loadAutoFilledLineupDraftPreviewForApp: scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp,
  publishGamePlanForApp: scheduleServiceMocks.publishGamePlanForApp,
  publishLiveScoreUpdateEvent: scheduleServiceMocks.publishLiveScoreUpdateEvent,
  recordPlayerGameStat: scheduleServiceMocks.recordPlayerGameStat,
  recordPlayerScoringStat: scheduleServiceMocks.recordPlayerScoringStat,
  undoRecordedPlayerGameStat: scheduleServiceMocks.undoRecordedPlayerGameStat,
  saveScheduledGameLineupDraftForApp: scheduleServiceMocks.saveScheduledGameLineupDraftForApp,
  completeGameWrapupForApp: scheduleServiceMocks.completeGameWrapupForApp,
  loadGameDayLiveEventsForApp: scheduleServiceMocks.loadGameDayLiveEventsForApp,
  saveGameDaySubstitutionForApp: scheduleServiceMocks.saveGameDaySubstitutionForApp,
  updateLiveGameClockState: scheduleServiceMocks.updateLiveGameClockState,
  buildLiveGameClockPeriods: scheduleServiceMocks.buildLiveGameClockPeriods,
  resolveLiveGameClockSnapshot: scheduleServiceMocks.resolveLiveGameClockSnapshot,
  LINEUP_FORMATIONS: {
    'basketball-5v5': {
      id: 'basketball-5v5',
      name: 'Basketball 5v5',
      numPeriods: 4,
      positions: [
        { id: 'pg', name: 'PG' },
        { id: 'sg', name: 'SG' },
        { id: 'sf', name: 'SF' },
        { id: 'pf', name: 'PF' },
        { id: 'c', name: 'C' }
      ]
    }
  },
  getLineupPublishStatus: vi.fn((gamePlan: any) => gamePlan?.isPublished ? 'Published lineup is current.' : 'Lineup draft is not published.'),
  hasLineupDraft: vi.fn((gamePlan: any) => Boolean(gamePlan?.lineups && Object.keys(gamePlan.lineups).length))
}));
const publicActionMocks = vi.hoisted(() => ({
  exportCalendarIcsFile: vi.fn(),
  openPublicUrl: vi.fn(),
  sharePublicUrl: vi.fn()
}));

const gameReportServiceMocks = vi.hoisted(() => ({
  loadGameReportSections: vi.fn()
}));
vi.mock('../lib/gameReportService', () => gameReportServiceMocks);
const gameWrapupServiceMocks = vi.hoisted(() => ({
  buildAppWrapupCompletionPayload: vi.fn(({ homeScore, awayScore, postGameNotes }) => ({
    homeScore,
    awayScore,
    postGameNotes,
    status: 'completed',
    liveStatus: 'completed'
  })),
  buildGameWrapupEmailDraft: vi.fn(() => null),
  generateGameWrapupArtifactsForApp: vi.fn()
}));
vi.mock('../lib/gameWrapupService', () => gameWrapupServiceMocks);
const chatServiceMocks = vi.hoisted(() => ({
  sendTeamChatMessage: vi.fn()
}));
vi.mock('../lib/chatService', () => chatServiceMocks);
vi.mock('../lib/publicActions', () => publicActionMocks);
const liveGameAnnouncerMocks = vi.hoisted(() => ({
  useLiveGameAnnouncer: vi.fn(() => ({
    supported: true,
    enabled: false,
    paused: false,
    toggleEnabled: vi.fn()
  }))
}));
vi.mock('../lib/liveGameAnnouncer', () => liveGameAnnouncerMocks);
const liveGameChatServiceMocks = vi.hoisted(() => ({
  canUseLiveGameChat: vi.fn<(game: unknown, options?: unknown) => boolean>(() => true),
  getLiveGameChatNotice: vi.fn<(game: unknown, options?: unknown) => string | null>(() => null),
  sendLiveGameChatMessage: vi.fn<(teamId: string, gameId: string, input: unknown) => Promise<unknown>>(),
  subscribeToLiveGameChat: vi.fn<(
    teamId: string,
    gameId: string,
    callback: (messages: Array<{ id: string; text?: string | null; senderName?: string | null; createdAt?: unknown }>) => void,
    onError?: (error: unknown) => void
  ) => () => void>(() => vi.fn())
}));
vi.mock('../lib/liveGameChatService', () => liveGameChatServiceMocks);
const liveGameReactionsServiceMocks = vi.hoisted(() => ({
  canUseLiveGameReactions: vi.fn<(game: unknown, options?: unknown) => boolean>(() => true),
  getLiveGameReactionNotice: vi.fn<(game: unknown, options?: unknown) => string | null>(() => null),
  sendLiveGameReaction: vi.fn<(teamId: string, gameId: string, input: unknown) => Promise<unknown>>(),
  subscribeToLiveGameReactions: vi.fn<(
    teamId: string,
    gameId: string,
    callback: (reaction: { id: string; type: 'heart' | 'fire' | 'clap' | 'wow' | 'hundred' }) => void,
    onError?: (error: unknown) => void
  ) => () => void>(() => vi.fn()),
  liveGameReactionOptions: [
    { key: 'fire', emoji: '🔥', label: 'Fire' },
    { key: 'clap', emoji: '👏', label: 'Clap' },
    { key: 'wow', emoji: '😲', label: 'Wow' },
    { key: 'heart', emoji: '❤️', label: 'Heart' },
    { key: 'hundred', emoji: '💯', label: 'Hundred' }
  ]
}));
vi.mock('../lib/liveGameReactionsService', () => liveGameReactionsServiceMocks);
vi.mock('../lib/parentToolsService', () => ({ buildParentScheduleEventIcs: vi.fn(() => 'BEGIN:VCALENDAR') }));
const scheduleHubMocks = vi.hoisted(() => ({
  buildGameHubDestinations: vi.fn<() => any[]>(() => []),
  buildPracticeHubDestinations: vi.fn<() => any[]>(() => []),
  getPublicPlayerHref: vi.fn(() => '#')
}));
vi.mock('../lib/scheduleHub', () => scheduleHubMocks);
const practiceTimelineServiceMocks = vi.hoisted(() => ({
  loadPracticeTimelineModel: vi.fn(),
  savePracticeTimelineForApp: vi.fn(),
  appendPracticeTimelineLiveNoteForApp: vi.fn(),
  getPracticeTimelineTotalMinutes: vi.fn((blocks) => (Array.isArray(blocks) ? blocks.reduce((sum, block) => sum + (Number(block?.duration) || 0), 0) : 0)),
  createPracticeTimelineBlockFromOption: vi.fn((option, index) => ({
    order: index,
    drillId: option.id,
    drillTitle: option.title,
    type: option.type,
    duration: option.duration,
    description: option.description,
    notes: '',
    notesLog: []
  }))
}));

vi.mock('../lib/practiceTimelineService', () => practiceTimelineServiceMocks);

const statsheetImportServiceMocks = vi.hoisted(() => ({
  acquireTrackStatsheetPhoto: vi.fn(),
  analyzeTrackStatsheetPhoto: vi.fn(),
  applyTrackStatsheetImportForApp: vi.fn(),
  loadTrackStatsheetContextForApp: vi.fn()
}));

vi.mock('../lib/statsheetImportService', () => statsheetImportServiceMocks);

import {
  ScheduleEventDetail,
  createLiveGameChatScrollScheduler,
  isLiveGameChatNearBottom,
  loadGameDayLineupBuilderModule,
  loadGameReportSectionsModule,
  loadGameWrapupServiceModule,
  loadLegacyScheduleHelpersModule,
  loadPracticeTimelineServiceModule,
  loadScheduleGameDayService,
  loadStatsheetImportServiceModule,
  parseGameHubPanel,
  setScheduleGameDayServiceImporterForTest,
  shouldAutosaveGeneratedLineupDraft,
  shouldAutosaveLineupDraft,
  shouldShowLiveScoreControls,
  shouldPersistLineupDraft
} from './ScheduleEventDetail';
import { AssignmentsSection } from '../components/schedule/AssignmentsSection';
import { ScheduleEventDetailProvider } from './schedule/ScheduleEventDetailContext';
import type { PracticeTimelineBlock } from '../lib/practiceTimelineService';
import type { AuthState } from '../lib/types';

const auth: AuthState = {
  user: {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach Carter'
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

function buildEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'team-1::game-1::player-1::2026-06-04T18:00:00.000Z::game',
    id: 'game-1',
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    date: new Date('2026-06-04T18:00:00.000Z'),
    location: 'Main Gym',
    opponent: 'Wolves',
    childId: 'player-1',
    childName: 'Avery Smith',
    isLinkedParentChild: true,
    isDbGame: true,
    isCancelled: false,
    status: 'scheduled',
    assignments: [],
    myRsvp: 'not_responded',
    myRsvpNote: '',
    rsvpSummary: { going: 1, maybe: 1, notGoing: 1, notResponded: 1, total: 4 },
    rideshareSummary: { offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false },
    availabilityLocked: false,
    availabilityNotesVisible: false,
    availabilityNotes: [],
    isTeamAdmin: false,
    isTeamStaff: true,
    isTeamRsvpReminderManager: false,
    canUpdateScore: false,
    calendarUrls: [],
    ...overrides
  } as any;
}

function buildPracticePacket(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    teamId: 'team-1',
    eventId: 'practice-1',
    title: 'Thursday Practice Packet',
    date: new Date('2026-06-12T18:00:00.000Z'),
    location: 'Home court',
    homePacket: {
      totalMinutes: 12,
      blocks: [
        {
          title: 'Ball mastery',
          type: 'Technical',
          duration: 12,
          description: '50 touches before dinner'
        }
      ]
    },
    completions: [],
    children: [{ id: 'player-1', name: 'Avery Smith' }],
    ...overrides
  } as any;
}

function renderScheduleEventDetail(authOverride: AuthState = auth) {
  return render(
    <MemoryRouter initialEntries={['/schedule/team-1/game-1?childId=player-1']}>
      <Routes>
        <Route path="/schedule/:teamId/:eventId" element={<ScheduleEventDetail auth={authOverride} />} />
        <Route path="/schedule" element={<div>Schedule</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderScheduleEventDetailWithRouteControls(initialEntry = '/schedule/team-1/game-1?childId=player-1&section=game') {
  function TestHarness() {
    const navigate = useNavigate();
    return (
      <>
        <button type="button" onClick={() => navigate('/schedule/team-1/game-2?childId=player-1&section=game')}>Switch game</button>
        <ScheduleEventDetail auth={auth} />
      </>
    );
  }

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/schedule/:teamId/:eventId" element={<TestHarness />} />
        <Route path="/schedule" element={<div>Schedule</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="event-route">{`${location.pathname}${location.search}`}</output>;
}

function renderScheduleEventDetailWithLocation(initialEntry = '/schedule/team-1/game-1?childId=player-1') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/schedule/:teamId/:eventId" element={<ScheduleEventDetail auth={auth} />} />
        <Route path="/schedule" element={<div>Schedule</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function installScrollMetrics(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number }
) {
  let scrollTop = element.scrollTop;
  const setScrollTop = vi.fn((value: number) => {
    scrollTop = value;
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: setScrollTop
  });
  return Object.assign(metrics, { setScrollTop });
}

function buildLiveChatMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    text: `Message ${index + 1}`,
    senderName: `Parent ${index + 1}`,
    createdAt: `2026-06-04T18:${String(index + 1).padStart(2, '0')}:00.000Z`
  }));
}

describe('ScheduleEventDetail deferred game hub loaders', () => {
  it('keeps closed game hub implementation modules out of the route static imports', () => {
    let source = '';
    try {
      source = readFileSync('src/pages/ScheduleEventDetail.tsx', 'utf8');
    } catch {
      source = readFileSync('apps/app/src/pages/ScheduleEventDetail.tsx', 'utf8');
    }

    [
      '../lib/gameDayLineupBuilder',
      '../lib/gameWrapupService',
      '../lib/practiceTimelineService',
      '../lib/statsheetImportService',
      '../lib/adapters/legacyScheduleHelpers',
      '../components/schedule/GameReportSections',
      '../lib/scheduleGameDayService',
      '../lib/gameDayLineupPublish'
    ].forEach((modulePath) => {
      expect(source).not.toMatch(new RegExp(`import\\s+(?!type\\b)[^;]+from ['"]${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`));
    });
  });

  it('keeps game-day panel reload scope bounded to event fields that change lineup data', () => {
    let source = '';
    try {
      source = readFileSync('src/pages/ScheduleEventDetail.tsx', 'utf8');
    } catch {
      source = readFileSync('apps/app/src/pages/ScheduleEventDetail.tsx', 'utf8');
    }

    expect(source).toMatch(/eventRef\.current = event;/);
    expect(source).toMatch(/loadAutoFilledLineupDraftPreviewForApp\(currentEvent, auth\.user, formationId\)/);
    expect(source).toMatch(/\[auth\.user, event\.teamId, event\.id, event\.eventKey, event\.gamePlan, event\.isCancelled, event\.isDbGame, event\.isTeamStaff, event\.type, formationId\]/);
  });

  it('caches deferred game hub module loaders and resolves expected modules', async () => {
    const loaders = [
      { load: loadGameDayLineupBuilderModule, exportName: 'buildLineupEditorPlayers' },
      { load: loadGameWrapupServiceModule, exportName: 'generateGameWrapupArtifactsForApp' },
      { load: loadPracticeTimelineServiceModule, exportName: 'loadPracticeTimelineModel' },
      { load: loadStatsheetImportServiceModule, exportName: 'loadTrackStatsheetContextForApp' },
      { load: loadLegacyScheduleHelpersModule, exportName: 'getSubstitutionOptions' },
      { load: loadGameReportSectionsModule, exportName: 'GameReportSections' },
      { load: loadScheduleGameDayService, exportName: 'loadAutoFilledLineupDraftPreviewForApp' }
    ];

    for (const { load, exportName } of loaders) {
      const firstLoad = load();
      const secondLoad = load();
      expect(secondLoad).toBe(firstLoad);
      await expect(firstLoad).resolves.toHaveProperty(exportName);
    }
  });

  it('caches the lazy game-day schedule service import across panels', async () => {
    const importer = vi.fn(async () => ({
      loadAutoFilledLineupDraftPreviewForApp: vi.fn(),
      publishGamePlanForApp: vi.fn(),
      publishLiveScoreUpdateEvent: vi.fn(),
      recordPlayerGameStat: vi.fn(),
      recordPlayerScoringStat: vi.fn(),
      undoRecordedPlayerGameStat: vi.fn(),
      saveScheduledGameLineupDraftForApp: vi.fn(),
      completeGameWrapupForApp: vi.fn(),
      loadGameDayLiveEventsForApp: vi.fn(),
      saveGameDaySubstitutionForApp: vi.fn(),
      updateLiveGameClockState: vi.fn(),
      buildLiveGameClockPeriods: vi.fn(),
      resolveLiveGameClockSnapshot: vi.fn(),
      LINEUP_FORMATIONS: {},
      getLineupPublishStatus: vi.fn(),
      hasLineupDraft: vi.fn()
    }) as any);
    setScheduleGameDayServiceImporterForTest(importer);

    const firstLoad = loadScheduleGameDayService();
    const secondLoad = loadScheduleGameDayService();

    expect(secondLoad).toBe(firstLoad);
    await firstLoad;
    expect(importer).toHaveBeenCalledTimes(1);
    setScheduleGameDayServiceImporterForTest();
  });
});

describe('ScheduleEventDetail live chat scroll helpers', () => {
  it('coalesces repeated scroll requests into one animation-frame adjustment', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const adjustScroll = vi.fn();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const frameId = callbacks.size + 1;
      callbacks.set(frameId, callback);
      return frameId;
    });
    const cancelFrame = vi.fn((frameId: number) => callbacks.delete(frameId));
    const scheduler = createLiveGameChatScrollScheduler(adjustScroll, requestFrame, cancelFrame);

    scheduler.schedule();
    scheduler.schedule();

    expect(callbacks.size).toBe(1);
    callbacks.values().next().value?.(0);
    expect(adjustScroll).toHaveBeenCalledTimes(1);
  });

  it('cancels pending live-chat scroll work during cleanup', () => {
    const adjustScroll = vi.fn();
    const requestFrame = vi.fn(() => 42);
    const cancelFrame = vi.fn();
    const scheduler = createLiveGameChatScrollScheduler(adjustScroll, requestFrame, cancelFrame);

    scheduler.schedule();
    scheduler.cancel();

    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(adjustScroll).not.toHaveBeenCalled();
  });

  it('treats live chat positions within 96 pixels of the bottom as near bottom', () => {
    expect(isLiveGameChatNearBottom(null)).toBe(true);
    expect(isLiveGameChatNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 504 })).toBe(true);
    expect(isLiveGameChatNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 503 })).toBe(false);
  });
});

describe('ScheduleEventDetail loading states', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    scheduleServiceMocks.resolveCachedParentScheduleEvents.mockReturnValue([]);
  });

  it('shows the shared event skeleton while event details are loading', () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={['/schedule/team-1/game-1']}>
        <Routes>
          <Route path="/schedule/:teamId/:eventId" element={<ScheduleEventDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('status', { name: 'Loading event' })).toBeTruthy();
    expect(screen.queryByText('This event is not available for your account.')).toBeNull();
    expect(screen.queryByText('Pulling parent actions and game-day details.')).toBeNull();
  });

  it('warm-starts from cached schedule events without a full-page skeleton (#2649)', () => {
    scheduleServiceMocks.resolveCachedParentScheduleEvents.mockReturnValue([
      buildEvent({ childId: 'player-1', childName: 'Avery Smith' })
    ]);
    scheduleServiceMocks.loadParentScheduleEventDetail.mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={['/schedule/team-1/game-1']}>
        <Routes>
          <Route path="/schedule/:teamId/:eventId" element={<ScheduleEventDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByRole('status', { name: 'Loading event' })).toBeNull();
    expect(screen.getAllByText(/Avery Smith/).length).toBeGreaterThan(0);
  });

  it('clears a cached previous event while cold-loading a new route (#2649)', async () => {
    scheduleServiceMocks.resolveCachedParentScheduleEvents.mockImplementation((_userId, _teamId, eventId) => (
      eventId === 'game-1'
        ? [buildEvent({ id: 'game-1', childId: 'player-1', childName: 'Cached Smith' })]
        : []
    ));
    scheduleServiceMocks.loadParentScheduleEventDetail.mockReturnValue(new Promise(() => {}));

    renderScheduleEventDetailWithRouteControls();

    expect(screen.queryByRole('status', { name: 'Loading event' })).toBeNull();
    expect(screen.getAllByText(/Cached Smith/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Switch game'));

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Loading event' })).toBeTruthy();
    });
    expect(screen.queryByText(/Cached Smith/)).toBeNull();
  });

  it('reconciles a cached seed with the refreshed event details (#2649)', async () => {
    scheduleServiceMocks.resolveCachedParentScheduleEvents.mockReturnValue([
      buildEvent({ childId: 'player-1', childName: 'Avery Smith' })
    ]);
    scheduleServiceMocks.loadParentScheduleRideOffers.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleAssignments.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ childId: 'player-1', childName: 'Refreshed Smith' })],
      children: []
    });

    render(
      <MemoryRouter initialEntries={['/schedule/team-1/game-1']}>
        <Routes>
          <Route path="/schedule/:teamId/:eventId" element={<ScheduleEventDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getAllByText(/Avery Smith/).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getAllByText(/Refreshed Smith/).length).toBeGreaterThan(0);
    });
  });

  it('shows a consistent fetch error and retries the primary event load', async () => {
    scheduleServiceMocks.loadParentScheduleRideOffers.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleAssignments.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleEventDetail
      .mockRejectedValueOnce(Object.assign(new Error('Event missing.'), { status: 404 }))
      .mockResolvedValueOnce({
        events: [buildEvent({ childId: 'player-1', childName: 'Avery Smith' })],
        children: []
      });

    render(
      <MemoryRouter initialEntries={['/schedule/team-1/game-1']}>
        <Routes>
          <Route path="/schedule/:teamId/:eventId" element={<ScheduleEventDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('This event is not available for your account.')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.loadParentScheduleEventDetail).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getAllByText(/Avery Smith/).length).toBeGreaterThan(0);
    });
  });

  it('does not label future scheduled games with a final 0-0 score', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        date: new Date('2099-11-15T18:00:00.000Z'),
        homeScore: 0,
        awayScore: 0,
        status: 'scheduled',
        liveStatus: 'scheduled'
      })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'vs. Wolves' })).toBeTruthy();
    });

    expect(screen.queryByText('Final 0-0')).toBeNull();
    expect(screen.queryByText(/^0-0$/)).toBeNull();
  });

  it('shows the live score label for games that are currently live', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        date: new Date('2099-11-15T18:00:00.000Z'),
        homeScore: 3,
        awayScore: 2,
        status: 'live',
        liveStatus: 'live'
      })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'vs. Wolves' })).toBeTruthy();
    });

    expect(screen.getByText('3-2')).toBeTruthy();
  });

  it('renders tournament context and legacy standings on the event detail screen', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
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
      })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'vs. Wolves' })).toBeTruthy();
    });

    expect(screen.getAllByText('10U Gold / Gold Bracket / Semifinal').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pool: Pool A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('10U Gold / Pool A standings').length).toBeGreaterThan(0);
    expect(screen.getAllByText('#1 Tigers (2-0, 6 pts)').length).toBeGreaterThan(0);
  });
});

describe('ScheduleEventDetail lineup draft guards', () => {
  it('allows empty lineup drafts to persist when a coach and formation are present', () => {
    expect(shouldPersistLineupDraft(auth.user, 'basketball-5v5', {})).toBe(true);
  });

  it('allows autosave scheduling for cleared drafts after the user edits the lineup', () => {
    expect(shouldAutosaveLineupDraft(true, 'basketball-5v5', {})).toBe(true);
  });

  it('autosaves a generated lineup draft when the saved game has no existing draft', () => {
    expect(shouldAutosaveGeneratedLineupDraft(
      { lineups: {}, publishedLineups: {}, publishedVersion: 0 },
      { formationId: 'basketball-5v5', lineups: { 'Q1-pg': 'p1', 'Q1-sg': 'p2' } }
    )).toBe(true);

    expect(shouldAutosaveGeneratedLineupDraft(
      { formationId: 'basketball-5v5', lineups: { 'Q1-pg': 'p1' } },
      { formationId: 'basketball-5v5', lineups: { 'Q1-pg': 'p1', 'Q1-sg': 'p2' } }
    )).toBe(false);
  });
});

describe('ScheduleEventDetail route state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    });
    scheduleServiceMocks.loadParentScheduleRideOffers.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleAssignments.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [
        buildEvent({ childId: 'player-1', childName: 'Avery Smith' }),
        buildEvent({
          eventKey: 'team-1::game-1::player-2::2026-06-04T18:00:00.000Z::game',
          childId: 'player-2',
          childName: 'Sam Lee'
        })
      ],
      children: []
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('writes selected tab and child context back to the event route', async () => {
    renderScheduleEventDetailWithLocation();

    await waitFor(() => {
      expect(screen.getAllByText(/Avery Smith/).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Rideshare' })[0]);

    await waitFor(() => {
      expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-1&section=rideshare');
    });

    fireEvent.click(within(screen.getByTestId('event-player-switcher')).getByRole('button', { name: 'Sam Lee' }));

    await waitFor(() => {
      expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-2&section=rideshare');
    });
  });

  it('rehydrates the selected tab and child from the route query', async () => {
    renderScheduleEventDetailWithLocation('/schedule/team-1/game-1?childId=player-2&section=assignments');

    await waitFor(() => {
      expect(screen.getAllByText(/Sam Lee/).length).toBeGreaterThan(0);
    });

    const switcher = screen.getByTestId('event-player-switcher');
    expect(within(switcher).getByRole('button', { name: 'Sam Lee' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('button', { name: 'Assignments' })[0].className).toContain('bg-primary-600');
    expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-2&section=assignments');
  });

  it.each([
    ['foul', 'foul'],
    ['chat', 'chat'],
    [' ReAcTiOnS ', 'reactions'],
    ['wrapup', 'wrapup'],
    ['statsheet', 'statsheet'],
    ['lineup', 'lineup'],
    ['substitutions', 'substitutions'],
    ['report', 'report'],
    ['unknown', null],
    ['', null],
    [null, null]
  ])('guards the Game hub panel route value %s', (input, expected) => {
    expect(parseGameHubPanel(input)).toBe(expected);
  });

  it('opens and subscribes to route-requested Live chat without an accordion tap', async () => {
    renderScheduleEventDetailWithLocation('/schedule/team-1/game-1?childId=player-1&section=game&panel=chat');

    await waitFor(() => {
      expect(screen.getByTestId('live-game-chat-panel')).toBeTruthy();
      expect(liveGameChatServiceMocks.subscribeToLiveGameChat).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole('button', { name: 'Live chat' }).getAttribute('aria-expanded')).toBe('true');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-1&section=game&panel=chat');
  });

  it('keeps child context while focusing tools and removes panel state outside Game', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [
        buildEvent({ childId: 'player-1', childName: 'Avery Smith', canUpdateScore: true, isTeamStaff: true }),
        buildEvent({
          eventKey: 'team-1::game-1::player-2::2026-06-04T18:00:00.000Z::game',
          childId: 'player-2',
          childName: 'Sam Lee',
          canUpdateScore: true,
          isTeamStaff: true
        })
      ],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([]);
    statsheetImportServiceMocks.loadTrackStatsheetContextForApp.mockResolvedValue({ roster: [], config: { columns: [] } });

    renderScheduleEventDetailWithLocation('/schedule/team-1/game-1?childId=player-1&section=game');

    await waitFor(() => {
      expect(screen.getByTestId('game-hub-mobile-tools')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open Live substitutions tool' }));

    await waitFor(() => {
      expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-1&section=game&panel=substitutions');
      expect(screen.getByTestId('game-day-substitution-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open Statsheet import tool' }));
    await waitFor(() => {
      expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-1&section=game&panel=statsheet');
      expect(screen.getByTestId('statsheet-import-panel')).toBeTruthy();
    });

    fireEvent.click(within(screen.getByTestId('event-player-switcher')).getByRole('button', { name: 'Sam Lee' }));
    await waitFor(() => {
      expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-2&section=game&panel=statsheet');
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Availability' })[0]);
    await waitFor(() => {
      expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-2&section=availability');
    });
  });

  it.each([
    ['invalid', { isTeamStaff: true }],
    ['lineup', { isTeamStaff: false }]
  ])('ignores invalid or unavailable panel value %s', async (panel, eventOverrides) => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent(eventOverrides)],
      children: []
    });

    renderScheduleEventDetailWithLocation(`/schedule/team-1/game-1?childId=player-1&section=game&panel=${panel}`);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Game hub' })).toBeTruthy();
    });
    if (panel === 'lineup') {
      expect(screen.queryByRole('button', { name: 'Lineup builder' })).toBeNull();
    } else {
      expect(screen.queryByTestId('live-game-chat-panel')).toBeNull();
      expect(screen.queryByTestId('live-game-reactions-panel')).toBeNull();
      expect(screen.queryByTestId('statsheet-import-panel')).toBeNull();
    }
    expect(liveGameChatServiceMocks.subscribeToLiveGameChat).not.toHaveBeenCalled();
  });

});

describe('ScheduleEventDetail family RSVP path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    scheduleServiceMocks.loadParentScheduleRideOffers.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleAssignments.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('syncs the selected child availability note before paint', () => {
    let source = '';
    try {
      source = readFileSync('src/pages/ScheduleEventDetail.tsx', 'utf8');
    } catch {
      source = readFileSync('apps/app/src/pages/ScheduleEventDetail.tsx', 'utf8');
    }

    expect(source).toMatch(/useLayoutEffect\(\(\) => \{\s*setAvailabilityNote\(selectedEvent\?\.myRsvpNote \|\| ''\);\s*\}, \[selectedEvent\?\.eventKey, selectedEvent\?\.myRsvpNote\]\);/);
    expect(source).not.toMatch(/useEffect\(\(\) => \{\s*setAvailabilityNote\(selectedEvent\?\.myRsvpNote \|\| ''\);/);
  });

  it('shows the family response first when linked children have no saved notes', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [
        buildEvent({ childId: 'player-1', childName: 'Avery Smith' }),
        buildEvent({
          eventKey: 'team-1::game-1::player-2::2026-06-04T18:00:00.000Z::game',
          childId: 'player-2',
          childName: 'Sam Lee'
        })
      ],
      children: []
    });

    renderScheduleEventDetail();

    expect(await screen.findByText('Family response')).toBeTruthy();
    expect(screen.getByText('One choice updates Avery Smith and Sam Lee.')).toBeTruthy();
    expect(screen.getByText('Are Avery Smith and Sam Lee going?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Set individually' }));

    expect(screen.getByText('Responding for Avery Smith')).toBeTruthy();
    expect(screen.getByText('Is Avery Smith going?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Respond together' })).toBeTruthy();

    fireEvent.click(within(screen.getByTestId('event-player-switcher')).getByRole('button', { name: 'Sam Lee' }));
    await waitFor(() => expect(screen.getByText('Is Sam Lee going?')).toBeTruthy());
  });

  it('shows the family response first when linked children have matching saved notes', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [
        buildEvent({ childId: 'player-1', childName: 'Avery Smith', myRsvpNote: 'Both need a ride' }),
        buildEvent({
          eventKey: 'team-1::game-1::player-2::2026-06-04T18:00:00.000Z::game',
          childId: 'player-2',
          childName: 'Sam Lee',
          myRsvpNote: 'Both need a ride'
        })
      ],
      children: []
    });

    renderScheduleEventDetail();

    expect(await screen.findByText('Family response')).toBeTruthy();
    expect(screen.getByText('One choice updates Avery Smith and Sam Lee.')).toBeTruthy();
    expect(screen.getByDisplayValue('Both need a ride')).toBeTruthy();
  });

  it('defaults to the selected child when linked children have different saved notes', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [
        buildEvent({ childId: 'player-1', childName: 'Avery Smith', myRsvpNote: 'Arriving late' }),
        buildEvent({
          eventKey: 'team-1::game-1::player-2::2026-06-04T18:00:00.000Z::game',
          childId: 'player-2',
          childName: 'Sam Lee',
          myRsvpNote: 'Needs a ride'
        })
      ],
      children: []
    });

    renderScheduleEventDetail();

    expect(await screen.findByText('Responding for Avery Smith')).toBeTruthy();
    expect(screen.getByText(/Saved notes differ, so responses start separately/)).toBeTruthy();
    expect(await screen.findByDisplayValue('Arriving late')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Respond together' }));
    expect(screen.getByText('Choose one shared note before responding together.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Going' })).toBeDisabled();
    expect(screen.queryByDisplayValue('Arriving late')).toBeNull();

    const sharedNote = screen.getByRole('textbox', { name: 'Availability note' });
    expect(sharedNote).not.toBeDisabled();
    fireEvent.change(sharedNote, { target: { value: 'Both need a ride' } });
    expect(screen.getByRole('button', { name: 'Going' })).not.toBeDisabled();
  });

  it('keeps the existing child-specific path for a single child', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ childId: 'player-1', childName: 'Avery Smith' })],
      children: []
    });

    renderScheduleEventDetail();

    expect(await screen.findByText('Is Avery Smith going?')).toBeTruthy();
    expect(screen.queryByTestId('family-rsvp-controls')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set individually' })).toBeNull();
  });

  it('does not offer family response controls for staff-expanded roster rows', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [
        buildEvent({ childId: 'player-1', childName: 'Avery Smith' }),
        buildEvent({
          eventKey: 'team-1::game-1::player-2::2026-06-04T18:00:00.000Z::game',
          childId: 'player-2',
          childName: 'Roster Player',
          isLinkedParentChild: false
        })
      ],
      children: []
    });

    renderScheduleEventDetail();

    expect(await screen.findByText('Is Avery Smith going?')).toBeTruthy();
    expect(screen.queryByTestId('family-rsvp-controls')).toBeNull();
    expect(screen.queryByText('Family response')).toBeNull();
  });
});

describe('ScheduleEventDetail availability attention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    scheduleServiceMocks.loadParentScheduleRideOffers.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleAssignments.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('hides the caught-up attention state when RSVP is still missing with no other actions', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ myRsvp: 'not_responded', assignments: [] })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByText('Availability needed')).toBeTruthy();
    });

    expect(screen.queryByText('All caught up')).toBeNull();
    expect(screen.queryByText('No parent actions need attention right now.')).toBeNull();
  });

  it('keeps other attention items visible when RSVP is missing', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        myRsvp: 'not_responded',
        assignments: [{ role: 'Snacks', value: '', claimable: true, claim: null }]
      })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByText('Availability needed')).toBeTruthy();
    });

    expect(screen.getByText('Review assignments')).toBeTruthy();
    expect(screen.queryByText('Set availability')).toBeNull();
    expect(screen.queryByText('All caught up')).toBeNull();
  });

  it('shows the caught-up attention state after RSVP is saved with no other actions', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ myRsvp: 'going', assignments: [] })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByText('Availability saved')).toBeTruthy();
    });

    expect(screen.getByText('All caught up')).toBeTruthy();
    expect(screen.getByText('No parent actions need attention right now.')).toBeTruthy();
  });
});

describe('ScheduleEventDetail nav visibility', () => {
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

  it('defaults inactive events to the Game hub and hides empty rideshare and assignments tabs', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isDbGame: false,
        isCancelled: false,
        rideshareSummary: { offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false },
        assignments: []
      })],
      children: []
    });

    renderScheduleEventDetailWithLocation();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Game hub' })).toBeTruthy();
    });

    expect(screen.queryByRole('heading', { name: 'Availability' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rideshare' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assignments' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Availability' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
  });

  it('keeps related tabs but still defaults inactive events to the read-only Game hub', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isDbGame: false,
        isCancelled: true,
        rideshareSummary: { offerCount: 1, seatsLeft: 0, requests: 0, pending: 0, confirmed: 1, isFull: true },
        assignments: [{ role: 'Snacks', value: '', claimable: true, claim: null }]
      })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Game hub' })).toBeTruthy();
    });

    expect(screen.getAllByRole('button', { name: 'Rideshare' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Assignments' }).length).toBeGreaterThan(0);
  });

  it('renders an explicitly requested closed Availability section as read-only saved context', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isCancelled: true,
        myRsvp: 'maybe',
        myRsvpNote: 'Arriving after halftime'
      })],
      children: []
    });

    renderScheduleEventDetailWithLocation('/schedule/team-1/game-1?childId=player-1&section=availability');

    await waitFor(() => {
      expect(screen.getByText('Availability unavailable')).toBeTruthy();
    });

    expect(screen.getByText('This event was cancelled, so availability can no longer be changed.')).toBeTruthy();
    expect(screen.getByText('Current response for Avery Smith')).toBeTruthy();
    expect(screen.getByText('Arriving after halftime')).toBeTruthy();
    expect(screen.queryByText('Is Avery Smith going?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Going' })).toBeNull();
    expect(screen.queryByLabelText('Availability note')).toBeNull();
    expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-1&section=availability');
  });

  it.each([
    ['cancelled', { isCancelled: true }],
    ['availability-locked', { availabilityLocked: true, availabilityCutoffLabel: '2 hours before the event' }]
  ])('defaults %s events away from Availability', async (_state, eventOverrides) => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent(eventOverrides)],
      children: []
    });

    renderScheduleEventDetailWithLocation();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Game hub' })).toBeTruthy();
    });
    expect(screen.queryByRole('heading', { name: 'Availability' })).toBeNull();
  });

  it('defaults score-capable tracked games to the Game tab when the route omits section', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        canUpdateScore: true,
        statTrackerConfigId: 'cfg-soccer'
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([]);
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([]);

    renderScheduleEventDetailWithLocation();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Game hub' })).toBeTruthy();
    });

    expect(screen.getByTestId('standard-tracker-launch')).toBeTruthy();
    expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-1');
  });

  it('keeps non-score-capable viewers on Availability when the route omits section', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        canUpdateScore: false,
        statTrackerConfigId: 'cfg-soccer'
      })],
      children: []
    });

    renderScheduleEventDetailWithLocation();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Availability' })).toBeTruthy();
    });

    expect(screen.queryByRole('heading', { name: 'Game hub' })).toBeNull();
    expect(screen.queryByTestId('standard-tracker-launch')).toBeNull();
  });

  it('preserves an explicit section query even for score-capable viewers', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        canUpdateScore: true,
        statTrackerConfigId: 'cfg-soccer'
      })],
      children: []
    });

    renderScheduleEventDetailWithLocation('/schedule/team-1/game-1?childId=player-1&section=availability');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Availability' })).toBeTruthy();
    });

    expect(screen.queryByRole('heading', { name: 'Game hub' })).toBeNull();
    expect(screen.getByTestId('event-route').textContent).toBe('/schedule/team-1/game-1?childId=player-1&section=availability');
  });

  it('does not import game-day service for availability or rideshare initial renders', async () => {
    const importer = vi.fn(async () => ({}) as any);
    setScheduleGameDayServiceImporterForTest(importer);
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        canUpdateScore: true,
        rideshareSummary: { offerCount: 1, seatsLeft: 2, requests: 0, pending: 0, confirmed: 0, isFull: false }
      })],
      children: []
    });

    const availabilityRender = renderScheduleEventDetailWithLocation('/schedule/team-1/game-1?childId=player-1&section=availability');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Availability' })).toBeTruthy();
    });
    expect(importer).not.toHaveBeenCalled();
    availabilityRender.unmount();

    renderScheduleEventDetailWithLocation('/schedule/team-1/game-1?childId=player-1&section=rideshare');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Rideshare' })).toBeTruthy();
    });
    expect(importer).not.toHaveBeenCalled();
    setScheduleGameDayServiceImporterForTest();
  });
});

describe('ScheduleEventDetail live score control visibility', () => {
  it('only enables score controls for authenticated non-cancelled DB games with score permission', () => {
    const scoreCapableGame = buildEvent({ canUpdateScore: true });

    expect(shouldShowLiveScoreControls(scoreCapableGame, auth.user)).toBe(true);
    expect(shouldShowLiveScoreControls({ ...scoreCapableGame, canUpdateScore: false }, auth.user)).toBe(false);
    expect(shouldShowLiveScoreControls({ ...scoreCapableGame, isDbGame: false }, auth.user)).toBe(false);
    expect(shouldShowLiveScoreControls({ ...scoreCapableGame, isCancelled: true }, auth.user)).toBe(false);
    expect(shouldShowLiveScoreControls({ ...scoreCapableGame, type: 'practice' }, auth.user)).toBe(false);
    expect(shouldShowLiveScoreControls(scoreCapableGame, null)).toBe(false);
  });
});

describe('ScheduleEventDetail rideshare permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isTeamAdmin: true,
        rideshareSummary: { offerCount: 1, seatsLeft: 2, requests: 1, pending: 1, confirmed: 0, isFull: false }
      })],
      children: []
    });
    scheduleServiceMocks.loadParentScheduleRideOffers.mockResolvedValue([
      {
        id: 'offer-away',
        sourceGameId: 'game-1',
        driverUserId: 'driver-2',
        driverName: 'Dana Driver',
        seatCapacity: 3,
        seatCountConfirmed: 1,
        direction: 'to',
        note: 'Leaving from the school lot',
        status: 'open',
        requests: [
          { id: 'request-1', parentUserId: 'user-2', childId: 'player-2', childName: 'Sam', status: 'pending' }
        ]
      }
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it('lets team admins manage non-owned rideshare requests from the rideshare tab', async () => {
    renderScheduleEventDetail({
      ...auth,
      user: {
        ...(auth.user as any),
        uid: 'admin-1',
        email: 'admin@example.com',
        displayName: 'Alex Admin'
      } as any,
      roles: ['admin'],
      isCoach: false,
      isAdmin: false
    });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Rideshare' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Rideshare' })[0]);

    expect(await screen.findByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Waitlist' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
  });

  it('shows a parent request action for an open rideshare offer', async () => {
    renderScheduleEventDetail({
      ...auth,
      user: {
        ...(auth.user as any),
        uid: 'parent-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent'
      } as any,
      roles: ['parent'],
      isParent: true,
      isCoach: false,
      isAdmin: false
    });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Rideshare' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Rideshare' })[0]);

    expect(await screen.findByRole('button', { name: 'Request spot' })).toBeTruthy();
  });

  it('shows a rideshare retry state instead of the empty-state copy after load failures', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent()],
      children: []
    });
    scheduleServiceMocks.loadParentScheduleRideOffers.mockRejectedValue(new Error('Unable to load rideshare offers.'));

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Rideshare' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Rideshare' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Rideshare could not be loaded for this event.')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Retry rideshare' })).toBeTruthy();
    expect(screen.queryByText('No ride offers yet for this event.')).toBeNull();
  });
});

describe('ScheduleEventDetail assignments', () => {
  it('ignores a stale assignment response after the mounted section switches events', async () => {
    let resolveFirstLoad: ((assignments: any[]) => void) | null = null;
    scheduleServiceMocks.loadParentScheduleAssignments.mockImplementation(async (event) => {
      if (event.id === 'game-1') {
        return new Promise<any[]>((resolve) => {
          resolveFirstLoad = resolve;
        });
      }
      return [{ role: 'Second game task', value: 'Taylor', claimable: false, claim: null }];
    });

    const updateEvents = vi.fn();
    const firstEvent = buildEvent({ id: 'game-1', assignments: [] });
    const secondEvent = buildEvent({
      eventKey: 'team-1::game-2::player-1::2026-06-05T18:00:00.000Z::game',
      id: 'game-2',
      assignments: []
    });
    const providerValue = (event: any) => ({
      auth,
      event,
      childEvents: [event],
      refreshEvent: vi.fn(),
      updateEvents
    });

    const rendered = render(
      <ScheduleEventDetailProvider value={providerValue(firstEvent)}>
        <AssignmentsSection />
      </ScheduleEventDetailProvider>
    );

    await waitFor(() => {
      expect(scheduleServiceMocks.loadParentScheduleAssignments).toHaveBeenCalledWith(firstEvent);
    });

    rendered.rerender(
      <ScheduleEventDetailProvider value={providerValue(secondEvent)}>
        <AssignmentsSection />
      </ScheduleEventDetailProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Second game task: Taylor')).toBeTruthy();
    });

    await act(async () => {
      resolveFirstLoad?.([{ role: 'Stale first game task', value: 'Jordan', claimable: false, claim: null }]);
      await Promise.resolve();
    });

    expect(screen.queryByText('Stale first game task: Jordan')).toBeNull();
    expect(screen.getByText('Second game task: Taylor')).toBeTruthy();
  });

  it('ignores a completed management action after the mounted section switches events', async () => {
    let resolveCreate: ((assignments: any[]) => void) | null = null;
    scheduleServiceMocks.loadParentScheduleAssignments.mockImplementation(async (event) => (
      event.id === 'game-1'
        ? []
        : [{ role: 'Second game task', value: 'Taylor', claimable: false, claim: null }]
    ));
    scheduleServiceMocks.createScheduleAssignment.mockImplementation(() => (
      new Promise<any[]>((resolve) => {
        resolveCreate = resolve;
      })
    ));

    const updateEvents = vi.fn();
    const firstEvent = buildEvent({ id: 'game-1', isTeamAdmin: true, assignments: [] });
    const secondEvent = buildEvent({
      eventKey: 'team-1::game-2::player-1::2026-06-05T18:00:00.000Z::game',
      id: 'game-2',
      isTeamAdmin: true,
      assignments: []
    });
    const providerValue = (event: any) => ({
      auth,
      event,
      childEvents: [event],
      refreshEvent: vi.fn(),
      updateEvents
    });

    const rendered = render(
      <ScheduleEventDetailProvider value={providerValue(firstEvent)}>
        <AssignmentsSection />
      </ScheduleEventDetailProvider>
    );

    await waitFor(() => expect(screen.getByText('No assignments yet')).toBeTruthy());
    const addButtons = screen.getAllByRole('button', { name: 'Add assignment' });
    fireEvent.click(addButtons[addButtons.length - 1]);
    const form = screen.getByRole('form', { name: 'Add assignment' });
    fireEvent.change(within(form).getByLabelText('Task'), { target: { value: 'First game task' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add assignment' }));

    await waitFor(() => expect(scheduleServiceMocks.createScheduleAssignment).toHaveBeenCalled());
    rendered.rerender(
      <ScheduleEventDetailProvider value={providerValue(secondEvent)}>
        <AssignmentsSection />
      </ScheduleEventDetailProvider>
    );
    await waitFor(() => expect(screen.getByText('Second game task: Taylor')).toBeTruthy());

    await act(async () => {
      resolveCreate?.([{ role: 'First game task', value: '', claimable: true, claim: null }]);
      await Promise.resolve();
    });

    expect(screen.queryByText('First game task')).toBeNull();
    expect(screen.queryByText('First game task added.')).toBeNull();
    expect(screen.getByText('Second game task: Taylor')).toBeTruthy();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    liveGameReactionsServiceMocks.canUseLiveGameReactions.mockReturnValue(true);
    liveGameReactionsServiceMocks.getLiveGameReactionNotice.mockReturnValue(null);
    liveGameReactionsServiceMocks.subscribeToLiveGameReactions.mockReturnValue(vi.fn());
    liveGameChatServiceMocks.canUseLiveGameChat.mockReturnValue(true);
    liveGameChatServiceMocks.getLiveGameChatNotice.mockReturnValue(null);
    liveGameChatServiceMocks.subscribeToLiveGameChat.mockReturnValue(vi.fn());
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([]);
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps mobile sticky score controls synchronized with the existing autosave path', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ liveStatus: 'live', status: 'live', canUpdateScore: true, homeScore: 41, awayScore: 38 })],
      children: []
    });
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 42, awayScore: 38 });
    scheduleServiceMocks.publishLiveScoreUpdateEvent.mockResolvedValue({});

    renderScheduleEventDetailWithRouteControls();

    const tray = await screen.findByRole('region', { name: 'Mobile live score controls' });
    expect(tray.className).toContain('mobile-live-score-tray');
    expect(tray.querySelector('.mobile-live-score-tray__surface')).toBeTruthy();
    expect(within(tray).getByText('41-38')).toBeTruthy();

    fireEvent.click(within(tray).getByRole('button', { name: 'Sticky home score up' }));

    expect(within(tray).getByText('42-38')).toBeTruthy();
    expect(within(tray).getByText('Autosaving manual score change…')).toBeTruthy();
    await waitFor(() => {
      expect(scheduleServiceMocks.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 42, awayScore: 38 }, auth.user);
    }, { timeout: 2000 });
    expect(scheduleServiceMocks.publishLiveScoreUpdateEvent).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 42, awayScore: 38 }, auth.user, { homeScore: 41, awayScore: 38 });
    await waitFor(() => {
      expect(within(tray).getByText('Score autosaved and posted to live play-by-play.')).toBeTruthy();
    });
  });

  it('warns when a score autosaves but the live play-by-play post fails', async () => {
    const publishError = new Error('Live post unavailable');
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ liveStatus: 'live', status: 'live', canUpdateScore: true, homeScore: 41, awayScore: 38 })],
      children: []
    });
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 42, awayScore: 38 });
    scheduleServiceMocks.publishLiveScoreUpdateEvent.mockRejectedValue(publishError);

    renderScheduleEventDetailWithRouteControls();

    const tray = await screen.findByRole('region', { name: 'Mobile live score controls' });
    fireEvent.click(within(tray).getByRole('button', { name: 'Sticky home score up' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 42, awayScore: 38 }, auth.user);
      expect(scheduleServiceMocks.publishLiveScoreUpdateEvent).toHaveBeenCalled();
    }, { timeout: 2000 });
    const warning = await within(tray).findByText('Score autosaved. Live play-by-play post failed.');
    expect(warning.className).toContain('text-amber-700');
    expect(warning.className).not.toContain('text-rose-700');
    expect(consoleWarn).toHaveBeenCalledWith(
      '[schedule-event-detail] Score saved but live play-by-play posting failed:',
      publishError
    );
    consoleWarn.mockRestore();
  });

  it('keeps the empty Tasks tab visible for team admins before assignments exist', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isDbGame: false,
        isTeamAdmin: true,
        assignments: []
      })],
      children: []
    });
    scheduleServiceMocks.loadParentScheduleAssignments.mockResolvedValue([]);

    renderScheduleEventDetailWithLocation();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Assignments' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Assignments' })[0]);

    await waitFor(() => {
      expect(screen.getByText('No assignments yet')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Add assignment' })).toBeNull();
  });

  it('lets team admins add and edit assignments from the empty state', async () => {
    const createdAssignments = [{ role: 'Snacks', value: '', claimable: true, claim: null }];
    const updatedAssignments = [{ role: 'Scorebook', value: 'Jamie', claimable: false, claim: null }];

    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamAdmin: true, assignments: [] })],
      children: []
    });
    scheduleServiceMocks.loadParentScheduleAssignments.mockResolvedValue([]);
    scheduleServiceMocks.createScheduleAssignment.mockResolvedValue(createdAssignments);
    scheduleServiceMocks.updateScheduleAssignment.mockResolvedValue(updatedAssignments);
    scheduleServiceMocks.removeScheduleAssignment.mockResolvedValue([]);

    renderScheduleEventDetailWithLocation('/schedule/team-1/game-1?childId=player-1&section=assignments');

    await waitFor(() => {
      expect(screen.getByText('No assignments yet')).toBeTruthy();
    });

    const addButtons = screen.getAllByRole('button', { name: 'Add assignment' });
    fireEvent.click(addButtons[addButtons.length - 1]);

    const addForm = screen.getByRole('form', { name: 'Add assignment' });
    fireEvent.change(within(addForm).getByLabelText('Task'), { target: { value: 'Snacks' } });
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add assignment' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.createScheduleAssignment).toHaveBeenCalled();
    });
    expect(scheduleServiceMocks.createScheduleAssignment.mock.calls[0][1]).toBe(auth.user);
    expect(scheduleServiceMocks.createScheduleAssignment.mock.calls[0][2]).toEqual({
      role: 'Snacks',
      value: '',
      claimable: true
    });
    expect(screen.getByText('Snacks added.')).toBeTruthy();
    expect(screen.getByText('Snacks')).toBeTruthy();

    const snacksCard = screen.getByText('Snacks').closest('article') as HTMLElement;
    fireEvent.click(within(snacksCard).getByRole('button', { name: 'Edit' }));

    const editForm = screen.getByRole('form', { name: 'Edit assignment Snacks' });
    fireEvent.change(within(editForm).getByLabelText('Task'), { target: { value: 'Scorebook' } });
    fireEvent.click(within(editForm).getByLabelText('Let parents sign up'));
    fireEvent.change(within(editForm).getByLabelText('Assigned to'), { target: { value: 'Jamie' } });
    fireEvent.click(within(editForm).getByRole('button', { name: 'Save assignment' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateScheduleAssignment).toHaveBeenCalled();
    });
    expect(scheduleServiceMocks.updateScheduleAssignment.mock.calls[0][1]).toBe(auth.user);
    expect(scheduleServiceMocks.updateScheduleAssignment.mock.calls[0][2]).toBe('Snacks');
    expect(scheduleServiceMocks.updateScheduleAssignment.mock.calls[0][3]).toEqual({
      role: 'Scorebook',
      value: 'Jamie',
      claimable: false
    });
    expect(screen.getByText('Scorebook updated.')).toBeTruthy();
    expect(screen.getByText('Scorebook: Jamie')).toBeTruthy();

    const scorebookCard = screen.getByText('Scorebook: Jamie').closest('article') as HTMLElement;
    fireEvent.click(within(scorebookCard).getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.removeScheduleAssignment).toHaveBeenCalled();
    });
    expect(scheduleServiceMocks.removeScheduleAssignment.mock.calls[0][1]).toBe(auth.user);
    expect(scheduleServiceMocks.removeScheduleAssignment.mock.calls[0][2]).toBe('Scorebook');
    expect(screen.getByText('Scorebook removed.')).toBeTruthy();
    expect(screen.getByText('No assignments yet')).toBeTruthy();
  });

  it('hides assignment management controls for non-admin viewers', async () => {
    const assignments = [{ role: 'Snacks', value: '', claimable: true, claim: null }];
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamAdmin: false, assignments })],
      children: []
    });
    scheduleServiceMocks.loadParentScheduleAssignments.mockResolvedValue(assignments);

    renderScheduleEventDetailWithLocation('/schedule/team-1/game-1?childId=player-1&section=assignments');

    await waitFor(() => {
      expect(screen.getByText('1 posted · 1 open')).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: 'Add assignment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeTruthy();
  });

  it('surfaces sticky autosave failures and retries through the existing manual save path', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ liveStatus: 'live', status: 'live', canUpdateScore: true, homeScore: 12, awayScore: 9 })],
      children: []
    });
    scheduleServiceMocks.updateGameScore
      .mockRejectedValueOnce(new Error('Score service unavailable'))
      .mockResolvedValueOnce({ homeScore: 12, awayScore: 10 });
    scheduleServiceMocks.publishLiveScoreUpdateEvent.mockResolvedValue({});

    renderScheduleEventDetailWithRouteControls();

    const tray = await screen.findByRole('region', { name: 'Mobile live score controls' });
    fireEvent.click(within(tray).getByRole('button', { name: 'Sticky away score up' }));

    await waitFor(() => {
      expect(within(tray).getByText('Score service unavailable')).toBeTruthy();
    }, { timeout: 2000 });
    const retryButton = within(tray).getByRole('button', { name: 'Retry save from sticky controls' });
    expect(retryButton).toHaveProperty('disabled', false);
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(scheduleServiceMocks.updateGameScore).toHaveBeenCalledTimes(2);
      expect(within(tray).getByText('Score saved and posted to live play-by-play.')).toBeTruthy();
    });
  });

  it('streams and sends live game reactions from the game hub', async () => {
    let reactionCallback: (reaction: { id: string; type: 'heart' | 'fire' | 'clap' | 'wow' | 'hundred' }) => void = () => {};
    liveGameReactionsServiceMocks.subscribeToLiveGameReactions.mockImplementation((_teamId, _gameId, callback) => {
      reactionCallback = callback;
      return vi.fn();
    });
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ liveStatus: 'live', status: 'live' })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Live reactions' }));

    await waitFor(() => {
      expect(screen.getByTestId('live-game-reactions-panel')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Heart' })).toBeTruthy();
    });

    reactionCallback({ id: 'reaction-1', type: 'heart' });

    await waitFor(() => {
      expect(screen.getByLabelText('Live reaction heart')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Heart' }));

    await waitFor(() => {
      expect(liveGameReactionsServiceMocks.sendLiveGameReaction).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({ type: 'heart', user: auth.user }));
    });
  });

  it('shows reaction loading placeholders before the deferred controls finish loading', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ liveStatus: 'live', status: 'live' })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Live reactions' }));

    expect(screen.getByText('Loading reaction controls…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Heart' })).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Heart' })).toBeTruthy();
    });
  });

  it('shows the legacy gate notice and disables reaction sends outside the live window', async () => {
    liveGameReactionsServiceMocks.canUseLiveGameReactions.mockReturnValue(false);
    liveGameReactionsServiceMocks.getLiveGameReactionNotice.mockReturnValue('Live reactions are closed during replay.');
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ liveStatus: 'completed', status: 'completed' })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Live reactions' }));

    await waitFor(() => {
      expect(screen.getByText('Live reactions are closed during replay.')).toBeTruthy();
    });

    expect((screen.getByRole('button', { name: 'Heart' }) as HTMLButtonElement).disabled).toBe(true);
    expect(liveGameReactionsServiceMocks.sendLiveGameReaction).not.toHaveBeenCalled();
  });

  it('uses a single live clock ticker while sibling game-day panels stay stable', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const updatedAt = new Date(Date.now() - 60_000);
    const readClockSeconds = (value: string | null | undefined) => {
      const match = String(value || '').match(/(\d{2}):(\d{2})/);
      if (!match) return null;
      return Number(match[1]) * 60 + Number(match[2]);
    };

    try {
      scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
        events: [buildEvent({
          liveStatus: 'live',
          canUpdateScore: true,
          liveClockMs: 60_000,
          liveClockRunning: true,
          liveClockPeriod: 'Q1',
          liveClockUpdatedAt: updatedAt,
          gamePlan: { numPeriods: 4 }
        })],
        children: []
      });
      scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([
        { id: 'p1', name: 'Avery Smith', number: '12', points: 10, fouls: 1 }
      ]);
      scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
      scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);

      renderScheduleEventDetailWithRouteControls();

      await waitFor(() => {
        expect(screen.getByTestId('live-game-clock-panel')).toBeTruthy();
      });

      await waitFor(() => {
        expect(setIntervalSpy.mock.calls.filter(([, delay]) => delay === 1000)).toHaveLength(1);
      });
      const initialHeaderClock = readClockSeconds(screen.getByLabelText('Live game clock').textContent);
      const initialPanelClock = readClockSeconds(screen.getByTestId('live-game-clock-panel').textContent);
      expect(initialHeaderClock).not.toBeNull();
      expect(initialHeaderClock).toBe(initialPanelClock);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '#12 Avery Smith plus 2 points' })).toBeTruthy();
      });
      expect(screen.getByRole('button', { name: 'Foul tracker' }).getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('game-day-foul-panel')).toBeNull();
      expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).not.toHaveBeenCalled();

      const liveScoreEditor = screen.getByTestId('live-score-editor');
      const scoreEditorMarkup = liveScoreEditor.innerHTML;

      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 2_100));
      });

      const updatedHeaderClock = readClockSeconds(screen.getByLabelText('Live game clock').textContent);
      const updatedPanelClock = readClockSeconds(screen.getByTestId('live-game-clock-panel').textContent);
      expect(updatedHeaderClock).not.toBeNull();
      expect(updatedHeaderClock).toBe(updatedPanelClock);
      expect(updatedHeaderClock).toBeGreaterThanOrEqual((initialHeaderClock ?? 0) + 1);
      expect(screen.getByTestId('live-score-editor').innerHTML).toBe(scoreEditorMarkup);
      expect(screen.queryByTestId('game-day-foul-panel')).toBeNull();
      expect(scheduleServiceMocks.loadHomeScoringPlayers).toHaveBeenCalledTimes(1);
      expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
    }
  }, 15000);

  it('shares one loaded scoring roster between score and foul game hub panels', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'live',
        canUpdateScore: true,
        liveClockPeriod: 'Q1',
        gamePlan: { numPeriods: 4 }
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([
      { id: 'p1', name: 'Avery Smith', number: '12', points: 10, fouls: 1 }
    ]);
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([
      { id: 'f1', eventId: 'f1', type: 'stat', statKey: 'fouls', value: 6, period: 'Q1', isOpponent: false }
    ]);
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([]);

    renderScheduleEventDetailWithRouteControls();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '#12 Avery Smith plus 2 points' })).toBeTruthy();
    });
    expect(screen.queryByTestId('game-day-foul-panel')).toBeNull();
    expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Foul tracker' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '#12 Avery Smith add foul' })).toBeTruthy();
      expect(screen.getByText('6 team fouls this period')).toBeTruthy();
    });

    expect(scheduleServiceMocks.loadHomeScoringPlayers).toHaveBeenCalledTimes(1);
    expect(scheduleServiceMocks.loadHomeScoringPlayers).toHaveBeenCalledWith('team-1', 'game-1');
    expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).toHaveBeenCalledTimes(1);
  });

  it('keeps foul entry disabled when foul history fails to load', async () => {
    const historyError = new Error('History unavailable');
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'live',
        canUpdateScore: true,
        liveClockPeriod: 'Q1',
        gamePlan: { numPeriods: 4 }
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([
      { id: 'p1', name: 'Avery Smith', number: '12', points: 10, fouls: 1 }
    ]);
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockRejectedValue(historyError);
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([]);

    renderScheduleEventDetailWithRouteControls();

    fireEvent.click(await screen.findByRole('button', { name: 'Foul tracker' }));

    await waitFor(() => {
      expect(screen.getByText('Foul history could not be loaded. Refresh before recording fouls.')).toBeTruthy();
    });

    const addFoulButton = screen.getByRole('button', { name: '#12 Avery Smith add foul' });
    expect(addFoulButton).toHaveProperty('disabled', true);

    fireEvent.click(addFoulButton);

    expect(scheduleServiceMocks.recordPlayerGameStat).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      '[schedule-event-detail] Unable to load foul tracker state:',
      historyError
    );
    consoleWarn.mockRestore();
  });

  it('invalidates the shared scoring roster once when switching game hub events', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockImplementation(async (_user, { eventId }) => ({
      events: [eventId === 'game-2'
        ? buildEvent({
            eventKey: 'team-1::game-2::player-1::2026-06-05T18:00:00.000Z::game',
            id: 'game-2',
            opponent: 'Lions',
            liveStatus: 'live',
            canUpdateScore: true,
            liveClockPeriod: 'Q1',
            gamePlan: { numPeriods: 4 }
          })
        : buildEvent({
            liveStatus: 'live',
            canUpdateScore: true,
            liveClockPeriod: 'Q1',
            gamePlan: { numPeriods: 4 }
          })],
      children: []
    }));
    scheduleServiceMocks.loadHomeScoringPlayers.mockImplementation(async (_teamId, gameId) => (
      gameId === 'game-2'
        ? [{ id: 'p2', name: 'Jordan Lee', number: '7', points: 4, fouls: 0 }]
        : [{ id: 'p1', name: 'Avery Smith', number: '12', points: 10, fouls: 1 }]
    ));
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([]);

    renderScheduleEventDetailWithRouteControls();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '#12 Avery Smith plus 2 points' })).toBeTruthy();
    });
    expect(screen.queryByTestId('game-day-foul-panel')).toBeNull();
    expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Switch game' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '#7 Jordan Lee plus 2 points' })).toBeTruthy();
    });
    expect(screen.queryByTestId('game-day-foul-panel')).toBeNull();
    expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Foul tracker' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '#7 Jordan Lee add foul' })).toBeTruthy();
    });

    expect(scheduleServiceMocks.loadHomeScoringPlayers).toHaveBeenCalledTimes(2);
    expect(scheduleServiceMocks.loadHomeScoringPlayers).toHaveBeenNthCalledWith(1, 'team-1', 'game-1');
    expect(scheduleServiceMocks.loadHomeScoringPlayers).toHaveBeenNthCalledWith(2, 'team-1', 'game-2');
    expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).toHaveBeenCalledTimes(1);
    expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).toHaveBeenCalledWith('team-1', 'game-2');
  });

  it('preserves dirty game schedule edits when same-event score updates refresh the event object', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isTeamAdmin: true,
        canUpdateScore: true,
        homeScore: 0,
        awayScore: 0,
        liveStatus: 'live'
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([]);
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.updateGameScore.mockResolvedValueOnce({ homeScore: 1, awayScore: 0 });
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([]);

    renderScheduleEventDetailWithRouteControls();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit game' }));
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Aux Gym' } });

    const liveScoreEditor = await screen.findByTestId('live-score-editor');
    fireEvent.click(within(liveScoreEditor).getByRole('button', { name: 'Home score up' }));
    fireEvent.click(within(liveScoreEditor).getByRole('button', { name: 'Save score' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 1, awayScore: 0 }, auth.user);
    });
    expect((screen.getByLabelText('Location') as HTMLInputElement).value).toBe('Aux Gym');

    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateScheduledGameForApp).toHaveBeenCalledWith(
        'team-1',
        'game-1',
        expect.objectContaining({ location: 'Aux Gym' }),
        auth.user
      );
    });
  });

  it('links staff scorekeepers from the app game hub to the standard tracker route', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        canUpdateScore: true,
        statTrackerConfigId: 'cfg-soccer',
        homeScore: 1,
        awayScore: 0
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([]);
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([]);

    renderScheduleEventDetailWithRouteControls();

    const launchLink = await screen.findByTestId('standard-tracker-launch');

    expect(launchLink.textContent).toContain('Standard tracker');
    expect(launchLink.getAttribute('href')).toBe('/schedule/team-1/game-1/track');
  });

  it('starts the live clock and advances the period from the app game hub', async () => {
    scheduleServiceMocks.updateLiveGameClockState
      .mockResolvedValueOnce({
        liveClockMs: 0,
        liveClockRunning: true,
        liveClockPeriod: 'Q1',
        period: 'Q1',
        liveClockUpdatedAt: new Date('2026-06-12T04:00:00.000Z'),
        liveStatus: 'live'
      })
      .mockResolvedValueOnce({
        liveClockMs: 0,
        liveClockRunning: true,
        liveClockPeriod: 'Q2',
        period: 'Q2',
        liveClockUpdatedAt: new Date('2026-06-12T04:00:05.000Z'),
        liveStatus: 'live'
      });
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'scheduled',
        canUpdateScore: true,
        liveClockMs: 0,
        liveClockRunning: false,
        liveClockPeriod: 'Q1',
        gamePlan: { numPeriods: 4 }
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([]);
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);

    renderScheduleEventDetailWithRouteControls();

    await waitFor(() => {
      expect(screen.getByTestId('live-game-clock-panel')).toBeTruthy();
    });
    expect(screen.getByText('Start or pause the clock, then advance the period as the game progresses.')).toBeTruthy();
    expect(screen.getByText('The clock stays accurate if you leave the app and come back.')).toBeTruthy();
    expect(screen.queryByText(/legacy tracker|persisted timestamp/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Start clock' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateLiveGameClockState).toHaveBeenNthCalledWith(1, 'team-1', 'game-1', expect.objectContaining({
        liveClockRunning: true,
        liveClockPeriod: 'Q1'
      }), auth.user);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause clock' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Advance period' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateLiveGameClockState).toHaveBeenNthCalledWith(2, 'team-1', 'game-1', expect.objectContaining({
        liveClockRunning: true,
        liveClockPeriod: 'Q2'
      }), auth.user);
    });

    expect(screen.getAllByText(/LIVE · Q2/i).length).toBeGreaterThan(0);
  });

  it('preserves elapsed running clock time while the game-day service import is loading', async () => {
    const updatedAt = new Date(Date.now() - 30_000).toISOString();
    const updateLiveGameClockState = vi.fn(async (_teamId, _gameId, payload) => ({
      liveClockMs: payload.liveClockMs,
      liveClockRunning: payload.liveClockRunning,
      liveClockPeriod: payload.liveClockPeriod,
      period: payload.liveClockPeriod,
      liveClockUpdatedAt: new Date(),
      liveStatus: 'live'
    }));
    let resolveImporter: (module: any) => void = () => {};
    const importerPromise = new Promise<any>((resolve) => {
      resolveImporter = resolve;
    });
    const importer = vi.fn(() => importerPromise);
    setScheduleGameDayServiceImporterForTest(importer);
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'live',
        canUpdateScore: true,
        liveClockMs: 60_000,
        liveClockRunning: true,
        liveClockPeriod: 'Q1',
        liveClockUpdatedAt: updatedAt,
        gamePlan: { numPeriods: 4 }
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([]);
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([]);

    try {
      renderScheduleEventDetailWithRouteControls();

      await waitFor(() => {
        expect(screen.getByTestId('live-game-clock-panel')).toBeTruthy();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Pause clock' }));

      expect(updateLiveGameClockState).not.toHaveBeenCalled();

      resolveImporter({
        loadAutoFilledLineupDraftPreviewForApp: vi.fn(() => Promise.resolve({ availablePlayers: [], goingPlayers: [], gamePlan: null })),
        publishGamePlanForApp: vi.fn(),
        publishLiveScoreUpdateEvent: vi.fn(),
        recordPlayerGameStat: vi.fn(),
        recordPlayerScoringStat: vi.fn(),
        undoRecordedPlayerGameStat: vi.fn(),
        saveScheduledGameLineupDraftForApp: vi.fn(),
        completeGameWrapupForApp: vi.fn(),
        loadGameDayLiveEventsForApp: vi.fn(() => Promise.resolve([])),
        saveGameDaySubstitutionForApp: vi.fn(),
        updateLiveGameClockState,
        buildLiveGameClockPeriods: vi.fn(() => ['Q1', 'Q2', 'Q3', 'Q4']),
        resolveLiveGameClockSnapshot: vi.fn(),
        LINEUP_FORMATIONS: {},
        getLineupPublishStatus: vi.fn(() => 'Lineup draft is not published.'),
        hasLineupDraft: vi.fn(() => false)
      });

      await waitFor(() => {
        expect(updateLiveGameClockState).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
          liveClockMs: expect.any(Number),
          liveClockRunning: false,
          liveClockPeriod: 'Q1'
        }), auth.user);
      });
      expect(updateLiveGameClockState.mock.calls[0][2].liveClockMs).toBeGreaterThanOrEqual(89_000);
    } finally {
      setScheduleGameDayServiceImporterForTest();
    }
  });

  it('tracks player fouls, shows bonus state, and resets team fouls by period', async () => {
    scheduleServiceMocks.updateLiveGameClockState.mockResolvedValueOnce({
      liveClockMs: 0,
      liveClockRunning: true,
      liveClockPeriod: 'Q2',
      period: 'Q2',
      liveClockUpdatedAt: new Date('2026-06-12T04:00:05.000Z'),
      liveStatus: 'live'
    });
    scheduleServiceMocks.recordPlayerGameStat.mockResolvedValue({
      homeScore: 10,
      awayScore: 8,
      playerId: 'p1',
      playerName: 'Avery Smith',
      playerNumber: '12',
      statKey: 'fouls',
      value: 1,
      playerStatTotal: 4,
      trackerEventId: 'tracker-foul-1',
      liveEventId: 'live-foul-1',
      liveEvent: { eventId: 'live-foul-1', type: 'stat', statKey: 'fouls', value: 1, period: 'Q1', isOpponent: false }
    });
    scheduleServiceMocks.undoRecordedPlayerGameStat.mockResolvedValue({
      homeScore: 10,
      awayScore: 8,
      playerId: 'p1',
      statKey: 'fouls',
      playerStatTotal: 3,
      trackerEventId: 'tracker-foul-undo-1',
      liveEventId: 'live-foul-undo-1',
      liveEvent: {
        eventId: 'live-foul-undo-1',
        type: 'stat',
        statKey: 'fouls',
        value: -1,
        period: 'Q1',
        isOpponent: false,
        description: 'Undo #12 Avery Smith FOULS +1'
      }
    });
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'live',
        canUpdateScore: true,
        homeScore: 10,
        awayScore: 8,
        liveClockMs: 0,
        liveClockRunning: true,
        liveClockPeriod: 'Q1',
        gamePlan: { numPeriods: 4 }
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([
      { id: 'p1', name: 'Avery Smith', number: '12', points: 10, fouls: 3 },
      { id: 'p2', name: 'Blake Jones', number: '7', points: 6, fouls: 1 }
    ]);
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([
      { id: 'f1', eventId: 'f1', type: 'stat', statKey: 'fouls', value: 6, period: 'Q1', isOpponent: false },
      { id: 'f2', eventId: 'f2', type: 'stat', statKey: 'fouls', value: 1, period: 'Q2', isOpponent: false }
    ]);
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([]);

    renderScheduleEventDetailWithRouteControls();

    fireEvent.click(await screen.findByRole('button', { name: 'Foul tracker' }));

    await waitFor(() => {
      expect(screen.getByTestId('game-day-foul-panel')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Team foul bonus state').textContent).toContain('Q1 · No bonus');
      expect(screen.getByText('6 team fouls this period')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '#12 Avery Smith add foul' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.recordPlayerGameStat).toHaveBeenCalledWith('team-1', 'game-1', 'p1', expect.objectContaining({ statKey: 'fouls', value: 1 }), auth.user);
    });
    expect(screen.getByLabelText('Team foul bonus state').textContent).toContain('Q1 · Bonus');
    expect(screen.getByText('7 team fouls this period')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Foul tracker' }));
    expect(screen.getByRole('button', { name: 'Foul tracker' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('game-day-foul-panel').closest('[hidden]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Foul tracker' }));
    expect(screen.getByRole('button', { name: 'Undo last foul' })).toHaveProperty('disabled', false);
    expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Undo last foul' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.undoRecordedPlayerGameStat).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({ trackerEventId: 'tracker-foul-1', liveEventId: 'live-foul-1', statKey: 'fouls' }), auth.user);
    });
    expect(screen.getByLabelText('Team foul bonus state').textContent).toContain('Q1 · No bonus');
    expect(screen.getByText('Last foul undone.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Advance period' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Team foul bonus state').textContent).toContain('Q2 · No bonus');
    });
    expect(screen.getByText('1 team fouls this period')).toBeTruthy();
  });

  it('renders in-route live chat, streams messages, and keeps watch live links external', async () => {
    let chatCallback: (messages: Array<{ id: string; text?: string | null; senderName?: string | null; createdAt?: unknown }>) => void = () => {};
    liveGameChatServiceMocks.subscribeToLiveGameChat.mockImplementation((_teamId, _gameId, callback) => {
      chatCallback = callback;
      return vi.fn();
    });
    liveGameChatServiceMocks.sendLiveGameChatMessage.mockResolvedValue({ id: 'sent-1' });
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([
      {
        id: 'watch-live',
        icon: 'video',
        title: 'Watch live',
        detail: 'Open the live stream.',
        actionLabel: 'Watch live',
        url: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1',
        shareTitle: 'Watch live',
        shareText: 'Watch live',
        shareLabel: 'Watch live',
        actionKind: 'open'
      }
    ]);
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ liveStatus: 'live', status: 'live' })],
      children: []
    });

    const { unmount } = renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Live chat' }));

    await waitFor(() => {
      expect(screen.getByTestId('live-game-chat-panel')).toBeTruthy();
    });
    await waitFor(() => {
      expect(liveGameChatServiceMocks.subscribeToLiveGameChat).toHaveBeenCalledTimes(1);
    });

    chatCallback([
      { id: 'm2', text: 'Second', senderName: 'Parent Two', createdAt: '2026-06-04T18:02:00.000Z' },
      { id: 'm1', text: 'First', senderName: 'Parent One', createdAt: '2026-06-04T18:01:00.000Z' }
    ]);

    await waitFor(() => {
      const messageRows = screen.getAllByTestId(/live-chat-message-/);
      expect(messageRows).toHaveLength(2);
      expect(messageRows[0]?.textContent).toContain('First');
      expect(messageRows[1]?.textContent).toContain('Second');
    });

    fireEvent.change(screen.getByLabelText('Live chat message'), { target: { value: "Let's go Bears" } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(liveGameChatServiceMocks.sendLiveGameChatMessage).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
        text: "Let's go Bears",
        user: auth.user
      }));
    });
    expect((screen.getByLabelText('Live chat message') as HTMLTextAreaElement).value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Watch live' }));
    expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1');

    const unsubscribe = liveGameChatServiceMocks.subscribeToLiveGameChat.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('keeps mobile live chat pinned to latest messages unless the viewer scrolls up', async () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextFrameId++;
      frameCallbacks.set(frameId, callback);
      return frameId;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      frameCallbacks.delete(frameId);
    });
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const flushAnimationFrame = async () => {
      const callbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      await act(async () => callbacks.forEach((callback) => callback(performance.now())));
    };
    let chatCallback: (messages: Array<{ id: string; text?: string | null; senderName?: string | null; createdAt?: unknown }>) => void = () => {};
    liveGameChatServiceMocks.subscribeToLiveGameChat.mockImplementation((_teamId, _gameId, callback) => {
      chatCallback = callback;
      return vi.fn();
    });
    liveGameChatServiceMocks.sendLiveGameChatMessage.mockResolvedValue({ id: 'sent-1' });
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ liveStatus: 'live', status: 'live' })],
      children: []
    });

    const { unmount } = renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Live chat' }));

    await waitFor(() => {
      expect(liveGameChatServiceMocks.subscribeToLiveGameChat).toHaveBeenCalledTimes(1);
    });

    const scroller = screen.getByTestId('live-game-chat-messages') as HTMLDivElement;
    const metrics = installScrollMetrics(scroller, { scrollHeight: 520, clientHeight: 160 });
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });
    frameCallbacks.clear();
    requestFrame.mockClear();
    cancelFrame.mockClear();
    scrollIntoView.mockClear();
    setTimeoutSpy.mockClear();

    await act(async () => {
      chatCallback(buildLiveChatMessages(8));
    });
    expect(requestFrame).toHaveBeenCalledTimes(1);
    await flushAnimationFrame();
    expect(scroller.scrollTop).toBe(360);
    expect(metrics.setScrollTop).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();

    scroller.scrollTop = 330;
    fireEvent.scroll(scroller);
    metrics.setScrollTop.mockClear();
    requestFrame.mockClear();
    metrics.scrollHeight = 600;
    await act(async () => {
      chatCallback(buildLiveChatMessages(9));
    });
    expect(requestFrame).toHaveBeenCalledTimes(1);
    await flushAnimationFrame();
    expect(scroller.scrollTop).toBe(440);
    expect(metrics.setScrollTop).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Live chat message'), { target: { value: "Let's go Bears" } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(liveGameChatServiceMocks.sendLiveGameChatMessage).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
        text: "Let's go Bears",
        user: auth.user
      }));
    });

    const messagesWithSentEcho = [
      ...buildLiveChatMessages(9),
      {
        id: 'sent-1',
        text: "Let's go Bears",
        senderName: 'Coach Carter',
        createdAt: '2026-06-04T18:10:00.000Z'
      }
    ];
    metrics.scrollHeight = 680;
    metrics.setScrollTop.mockClear();
    await act(async () => {
      chatCallback(messagesWithSentEcho);
    });
    await flushAnimationFrame();
    expect(scroller.scrollTop).toBe(520);
    expect(metrics.setScrollTop).toHaveBeenCalledTimes(1);

    scroller.scrollTop = 160;
    fireEvent.scroll(scroller);
    metrics.setScrollTop.mockClear();
    metrics.scrollHeight = 760;
    await act(async () => {
      chatCallback([
        ...messagesWithSentEcho,
        {
          id: 'm11',
          text: 'Inbound while reading older messages',
          senderName: 'Parent 11',
          createdAt: '2026-06-04T18:11:00.000Z'
        }
      ]);
    });
    await waitFor(() => {
      expect(screen.getByTestId('live-chat-message-m11')).toBeTruthy();
    });
    expect(scroller.scrollTop).toBe(160);
    expect(metrics.setScrollTop).not.toHaveBeenCalled();

    scroller.scrollTop = 590;
    fireEvent.scroll(scroller);
    metrics.scrollHeight = 840;
    metrics.setScrollTop.mockClear();
    await act(async () => {
      chatCallback([
        ...messagesWithSentEcho,
        {
          id: 'm11',
          text: 'Inbound while reading older messages',
          senderName: 'Parent 11',
          createdAt: '2026-06-04T18:11:00.000Z'
        },
        {
          id: 'm12',
          text: 'Back at the latest',
          senderName: 'Parent 12',
          createdAt: '2026-06-04T18:12:00.000Z'
        }
      ]);
    });
    await flushAnimationFrame();
    expect(scroller.scrollTop).toBe(680);
    expect(metrics.setScrollTop).toHaveBeenCalledTimes(1);

    metrics.setScrollTop.mockClear();
    await act(async () => {
      chatCallback([...buildLiveChatMessages(12), {
        id: 'm13',
        text: 'Pending during close',
        senderName: 'Parent 13',
        createdAt: '2026-06-04T18:13:00.000Z'
      }]);
    });
    const pendingFrameId = nextFrameId - 1;
    unmount();
    expect(cancelFrame).toHaveBeenCalledWith(pendingFrameId);
    expect(frameCallbacks.size).toBe(0);
    expect(metrics.setScrollTop).not.toHaveBeenCalled();

    requestFrame.mockRestore();
    cancelFrame.mockRestore();
    setTimeoutSpy.mockRestore();
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      delete (Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }).scrollIntoView;
    }
  });

  it('shows the locked live chat notice and disables the composer when chat is unavailable', async () => {
    liveGameChatServiceMocks.canUseLiveGameChat.mockReturnValue(false);
    liveGameChatServiceMocks.getLiveGameChatNotice.mockReturnValue('Live chat is closed during replay.');
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ liveStatus: 'completed', status: 'completed' })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Live chat' }));

    await waitFor(() => {
      expect(screen.getByText('Live chat is closed during replay.')).toBeTruthy();
    });

    expect((screen.getByLabelText('Live chat message') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(liveGameChatServiceMocks.sendLiveGameChatMessage).not.toHaveBeenCalled();
  });

  it('keeps deferred game hub panels idle until staff opens them', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'live',
        status: 'live',
        canUpdateScore: true,
        isTeamStaff: true,
        gamePlan: {
          formationId: 'basketball-5v5',
          lineups: { 'Q1-pg': 'p1' },
          publishedLineups: {},
          publishedVersion: 0
        }
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([]);
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
      formationId: 'basketball-5v5',
      formationName: 'Basketball 5v5',
      numPeriods: 4,
      positions: [],
      availablePlayers: [{ id: 'p1', name: 'Avery Smith', number: '1' }],
      goingPlayers: [{ id: 'p1', name: 'Avery Smith', number: '1' }],
      gamePlan: {
        formationId: 'basketball-5v5',
        lineups: { 'Q1-pg': 'p1' },
        publishedLineups: {},
        publishedVersion: 0
      }
    });
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'completed', status: 'completed', homeScore: 42, awayScore: 38 },
      plays: [],
      summary: 'Loaded on demand.',
      opponentRows: [],
      opponentStatKeys: [],
      teamInsights: [],
      playerInsightRows: [],
      highlightClips: [],
      statSheetPhotoUrl: null,
      teamStatKeys: [],
      teamStats: {},
      statKeys: [],
      playerRows: [],
      statLabels: {},
      hasPlayingTime: false,
      team: { id: 'team-1' }
    });

    renderScheduleEventDetailWithRouteControls();

    await waitFor(() => {
      expect(screen.getByTestId('live-game-clock-panel')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Home score up' })).toBeTruthy();
    expect(liveGameChatServiceMocks.subscribeToLiveGameChat).not.toHaveBeenCalled();
    expect(liveGameReactionsServiceMocks.subscribeToLiveGameReactions).not.toHaveBeenCalled();
    expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).not.toHaveBeenCalled();
    expect(scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp).not.toHaveBeenCalled();
    expect(gameReportServiceMocks.loadGameReportSections).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Live chat' }));
    await waitFor(() => {
      expect(liveGameChatServiceMocks.subscribeToLiveGameChat).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('live-game-chat-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Live reactions' }));
    await waitFor(() => {
      expect(liveGameReactionsServiceMocks.subscribeToLiveGameReactions).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('live-game-reactions-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Lineup builder' }));
    await waitFor(() => {
      expect(scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /#1 Avery Smith/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Report sections' }));
    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(1);
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledWith('team-1', 'game-1');
      expect(screen.getByText('Loaded on demand.')).toBeTruthy();
    });
  });

  it('falls back to player rows when older report payloads omit roster partitions', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'completed',
        status: 'completed',
        canUpdateScore: true,
        isTeamStaff: true
      })],
      children: []
    });
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'completed', status: 'completed', homeScore: 42, awayScore: 38 },
      plays: [],
      summary: 'Loaded on demand.',
      opponentRows: [],
      opponentStatKeys: [],
      teamInsights: [],
      playerInsightRows: [],
      highlightClips: [],
      statSheetPhotoUrl: null,
      teamStatKeys: [],
      teamStats: {},
      statKeys: ['pts'],
      playerRows: [
        { playerId: 'player-1', playerName: 'Avery Smith', number: '1', stats: { pts: 8 }, timeMs: 600000, didNotPlay: false }
      ],
      statLabels: { pts: 'PTS' },
      hasPlayingTime: true,
      team: { id: 'team-1' }
    } as any);

    renderScheduleEventDetailWithRouteControls();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Game hub' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Report sections' }));
    await waitFor(() => {
      expect(screen.getByText('Loaded on demand.')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Players' }));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /#1 Avery Smith/i })).toBeTruthy();
      expect(screen.getByText('8')).toBeTruthy();
    });
  });

  it('keeps lineup builder loaded during live score updates', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'live',
        status: 'live',
        canUpdateScore: true,
        isTeamStaff: true,
        homeScore: 41,
        awayScore: 38,
        gamePlan: {
          formationId: 'basketball-5v5',
          lineups: { 'Q1-pg': 'p1' },
          publishedLineups: {},
          publishedVersion: 0
        }
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([
      { id: 'p1', name: 'Avery Smith', number: '1', points: 10, fouls: 1 }
    ]);
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
      formationId: 'basketball-5v5',
      formationName: 'Basketball 5v5',
      numPeriods: 4,
      positions: [],
      availablePlayers: [{ id: 'p1', name: 'Avery Smith', number: '1' }],
      goingPlayers: [{ id: 'p1', name: 'Avery Smith', number: '1' }],
      gamePlan: {
        formationId: 'basketball-5v5',
        lineups: { 'Q1-pg': 'p1' },
        publishedLineups: {},
        publishedVersion: 0
      }
    });
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 42, awayScore: 38 });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Lineup builder' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp).toHaveBeenCalledTimes(1);
      expect(screen.getAllByRole('button', { name: /#1 Avery Smith/i }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Home score up' }));
    expect(within(screen.getByTestId('live-score-editor')).getByText('Autosaving manual score change…')).toBeTruthy();
    expect(scheduleServiceMocks.updateGameScore).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '#1 Avery Smith plus 2 points' })).toHaveProperty('disabled', true);

    await waitFor(() => {
      expect(scheduleServiceMocks.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 42, awayScore: 38 }, auth.user);
    }, { timeout: 2000 });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '#1 Avery Smith plus 2 points' })).toHaveProperty('disabled', false);
    });
    await waitFor(() => {
      expect(scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp).toHaveBeenCalledTimes(1);
      expect(screen.getAllByRole('button', { name: /#1 Avery Smith/i }).length).toBeGreaterThan(0);
    });
    expect(chatServiceMocks.sendTeamChatMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('Loading lineup builder…')).toBeNull();
    expect(within(screen.getByTestId('live-score-editor')).getByText('Score autosaved and posted to live play-by-play.')).toBeTruthy();
  });

  it('keeps report sections mounted during live score updates', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'live',
        status: 'live',
        canUpdateScore: true,
        isTeamStaff: true,
        homeScore: 41,
        awayScore: 38
      })],
      children: []
    });
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([
      { id: 'p1', name: 'Avery Smith', number: '1', points: 10, fouls: 1 }
    ]);
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'live', status: 'live', homeScore: 41, awayScore: 38 },
      plays: [
        { id: 'play-1', period: 'Q1', clock: '02:11', text: 'Avery Smith made a layup' }
      ],
      summary: 'Loaded on demand.',
      opponentRows: [],
      opponentStatKeys: [],
      teamInsights: [],
      playerInsightRows: [],
      highlightClips: [],
      statSheetPhotoUrl: null,
      teamStatKeys: [],
      teamStats: {},
      statKeys: ['pts'],
      playerRows: [
        { playerId: 'player-1', playerName: 'Avery Smith', number: '1', stats: { pts: 8 }, timeMs: 600000, didNotPlay: false }
      ],
      statLabels: { pts: 'PTS' },
      hasPlayingTime: true,
      team: { id: 'team-1' }
    } as any);
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 42, awayScore: 38 });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Report sections' }));

    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Loaded on demand.')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));

    await waitFor(() => {
      expect(screen.getByText('Avery Smith made a layup')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Plays' }).className).toContain('bg-primary-600');

    fireEvent.click(screen.getByRole('button', { name: 'Home score up' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 42, awayScore: 38 }, auth.user);
    }, { timeout: 2000 });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Plays' }).className).toContain('bg-primary-600');
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Avery Smith made a layup')).toBeTruthy();
    });
    expect(screen.queryByText('Loading report sections...')).toBeNull();
  });

  it('keeps live substitutions loaded during live clock updates', async () => {
    const gamePlan = {
      formationId: 'basketball-5v5',
      numPeriods: 4,
      periodDuration: 8,
      lineups: {
        'Q1-pg': 'p1',
        'Q1-sg': 'p2',
        'Q1-sf': 'p3',
        'Q1-pf': 'p4',
        'Q1-c': 'p5'
      },
      isPublished: true,
      publishedLineups: {
        'Q1-pg': 'p1',
        'Q1-sg': 'p2',
        'Q1-sf': 'p3',
        'Q1-pf': 'p4',
        'Q1-c': 'p5'
      }
    };
    const players = [
      { id: 'p1', name: 'Avery Smith', number: '1' },
      { id: 'p2', name: 'Blake Jones', number: '2' },
      { id: 'p3', name: 'Casey Brown', number: '3' },
      { id: 'p4', name: 'Devon Lee', number: '4' },
      { id: 'p5', name: 'Emerson Fox', number: '5' },
      { id: 'p6', name: 'Finley Ray', number: '6' }
    ];
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'live',
        status: 'live',
        canUpdateScore: true,
        isTeamStaff: true,
        gamePlan,
        rotationPlan: { Q1: { pg: 'p1', sg: 'p2', sf: 'p3', pf: 'p4', c: 'p5' } }
      })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
      availablePlayers: players,
      goingPlayers: players,
      gamePlan
    });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    scheduleServiceMocks.updateLiveGameClockState.mockResolvedValue({
      liveClockMs: 0,
      liveClockRunning: true,
      liveClockPeriod: 'Q1',
      liveClockUpdatedAt: '2026-06-04T18:00:00.000Z'
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Live substitutions' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp).toHaveBeenCalledTimes(1);
      expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Out')).toBeTruthy();
      expect(screen.getByLabelText('In')).toBeTruthy();
    });
    const initialLiveEventLoadCount = scheduleServiceMocks.loadGameDayLiveEventsForApp.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Start clock' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateLiveGameClockState).toHaveBeenCalledWith(
        'team-1',
        'game-1',
        expect.objectContaining({ liveClockRunning: true, liveClockPeriod: 'Q1' }),
        auth.user
      );
    });
    await waitFor(() => {
      expect(scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp).toHaveBeenCalledTimes(1);
      expect(scheduleServiceMocks.loadGameDayLiveEventsForApp).toHaveBeenCalledTimes(initialLiveEventLoadCount);
      expect(screen.getByLabelText('Out')).toBeTruthy();
      expect(screen.getByLabelText('In')).toBeTruthy();
      expect(screen.getByText('1 periods')).toBeTruthy();
    });
  });

  it('clears live substitutions after cancelling the game from the same hub', async () => {
    const gamePlan = {
      formationId: 'basketball-5v5',
      numPeriods: 4,
      periodDuration: 8,
      lineups: {
        'Q1-pg': 'p1',
        'Q1-sg': 'p2',
        'Q1-sf': 'p3',
        'Q1-pf': 'p4',
        'Q1-c': 'p5'
      },
      isPublished: true,
      publishedLineups: {
        'Q1-pg': 'p1',
        'Q1-sg': 'p2',
        'Q1-sf': 'p3',
        'Q1-pf': 'p4',
        'Q1-c': 'p5'
      }
    };
    const players = [
      { id: 'p1', name: 'Avery Smith', number: '1' },
      { id: 'p2', name: 'Blake Jones', number: '2' },
      { id: 'p3', name: 'Casey Brown', number: '3' },
      { id: 'p4', name: 'Devon Lee', number: '4' },
      { id: 'p5', name: 'Emerson Fox', number: '5' },
      { id: 'p6', name: 'Finley Ray', number: '6' }
    ];
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'live',
        status: 'live',
        canUpdateScore: true,
        isTeamStaff: true,
        isTeamAdmin: true,
        gamePlan,
        rotationPlan: { Q1: { pg: 'p1', sg: 'p2', sf: 'p3', pf: 'p4', c: 'p5' } }
      })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
      availablePlayers: players,
      goingPlayers: players,
      gamePlan
    });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    scheduleServiceMocks.cancelScheduledGameForApp.mockResolvedValue({ notificationError: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Live substitutions' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Out')).toBeTruthy();
      expect(screen.getByLabelText('In')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel game' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.cancelScheduledGameForApp).toHaveBeenCalledWith(expect.any(Object), auth.user);
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('Out')).toBeNull();
      expect(screen.queryByLabelText('In')).toBeNull();
      expect(screen.getByText('Publish a lineup first to enable live substitution planning.')).toBeTruthy();
    });
  });

  it('passes the recurring practice occurrence through cancellation without falling back to the series', async () => {
    const recurringOccurrence = buildEvent({
      eventKey: 'team-1::practice-master__2026-06-04::player-1::2026-06-04T18:00:00.000Z::practice',
      id: 'practice-master__2026-06-04',
      type: 'practice',
      title: 'Skills practice',
      opponent: null,
      isTeamAdmin: true,
      isTeamStaff: true
    });
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [recurringOccurrence],
      children: []
    });
    scheduleServiceMocks.cancelPracticeOccurrenceForApp.mockResolvedValue({
      cancelled: true,
      masterId: 'practice-master',
      instanceDate: '2026-06-04'
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'More' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this occurrence' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.cancelPracticeOccurrenceForApp).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'practice-master__2026-06-04',
          type: 'practice',
          isTeamAdmin: true
        }),
        auth.user
      );
    });
    expect(screen.getByText('Practice occurrence cancelled for this date only.')).toBeTruthy();
  });

  it('resets deferred game hub panels before rendering a switched event', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockImplementation(async (_user, { eventId }) => ({
      events: [eventId === 'game-2'
        ? buildEvent({
            eventKey: 'team-1::game-2::player-1::2026-06-05T18:00:00.000Z::game',
            id: 'game-2',
            opponent: 'Lions',
            liveStatus: 'completed',
            status: 'completed',
            canUpdateScore: true,
            isTeamStaff: true
          })
        : buildEvent({
            liveStatus: 'completed',
            status: 'completed',
            canUpdateScore: true,
            isTeamStaff: true
          })],
      children: []
    }));
    scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([]);
    gameReportServiceMocks.loadGameReportSections.mockImplementation(async (_teamId, eventId) => ({
      game: { id: eventId, liveStatus: 'completed', status: 'completed', homeScore: 42, awayScore: 38 },
      plays: [],
      summary: eventId === 'game-2' ? 'Second game report.' : 'First game report.',
      opponentRows: [],
      opponentStatKeys: [],
      teamInsights: [],
      playerInsightRows: [],
      highlightClips: [],
      statSheetPhotoUrl: null,
      teamStatKeys: [],
      teamStats: {},
      statKeys: [],
      playerRows: [],
      statLabels: {},
      hasPlayingTime: false,
      team: { id: _teamId }
    }));

    renderScheduleEventDetailWithRouteControls();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Game hub' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Report sections' }));
    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(1);
      expect(screen.getByText('First game report.')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch game' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Lions/ })).toBeTruthy();
    });
    expect(screen.queryByText('First game report.')).toBeNull();
    expect(screen.queryByText('Second game report.')).toBeNull();
    expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Report sections' }));
    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Second game report.')).toBeTruthy();
    });
  });

  it('executes substitutions against shared game-day rotation fields and renders live logs', async () => {
    const gamePlan = {
      formationId: 'basketball-5v5',
      numPeriods: 4,
      periodDuration: 8,
      lineups: {
        'Q1-pg': 'p1',
        'Q1-sg': 'p2',
        'Q1-sf': 'p3',
        'Q1-pf': 'p4',
        'Q1-c': 'p5'
      },
      isPublished: true,
      publishedLineups: {
        'Q1-pg': 'p1',
        'Q1-sg': 'p2',
        'Q1-sf': 'p3',
        'Q1-pf': 'p4',
        'Q1-c': 'p5'
      }
    };
    const players = [
      { id: 'p1', name: 'Avery Smith', number: '1' },
      { id: 'p2', name: 'Blake Jones', number: '2' },
      { id: 'p3', name: 'Casey Brown', number: '3' },
      { id: 'p4', name: 'Devon Lee', number: '4' },
      { id: 'p5', name: 'Emerson Fox', number: '5' },
      { id: 'p6', name: 'Finley Ray', number: '6' }
    ];
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        gamePlan,
        rotationPlan: { Q1: { pg: 'p1', sg: 'p2', sf: 'p3', pf: 'p4', c: 'p5' } },
        coachingNotes: [{ type: 'substitution', period: 'Q1', text: '#6 Finley Ray for #2 Blake Jones at sg', createdAt: '2026-06-04T18:10:00.000Z' }]
      })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
      availablePlayers: players,
      goingPlayers: players,
      gamePlan
    });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([
      { eventId: 'score-1', type: 'score_update', period: 'Q1', description: 'Bears 2 - Wolves 0', createdAt: '2026-06-04T18:11:00.000Z' }
    ]);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Live substitutions' }));

    await waitFor(() => {
      expect(screen.getByTestId('game-day-substitution-panel')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('Bears 2 - Wolves 0')).toBeTruthy();
    });
    expect(screen.getByText('#6 Finley Ray for #2 Blake Jones at sg')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Out'), { target: { value: 'p2' } });
    fireEvent.change(screen.getByLabelText('In'), { target: { value: 'p6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Execute sub' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.saveGameDaySubstitutionForApp).toHaveBeenCalledWith(
        'team-1',
        'game-1',
        auth.user,
        expect.objectContaining({
          rotationPlan: expect.objectContaining({ Q1: expect.objectContaining({ sg: 'p6' }) }),
          rotationActual: expect.objectContaining({ Q1: expect.any(Object) }),
          coachingNotes: expect.arrayContaining([
            expect.objectContaining({ type: 'substitution', period: 'Q1', text: '#6 Finley Ray for #2 Blake Jones at sg' })
          ])
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Substitution saved to the shared game-day log.')).toBeTruthy();
    });
  });

  it('uses native-aware calendar export messaging for shared, downloaded, and failed event exports', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent()],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    publicActionMocks.exportCalendarIcsFile.mockResolvedValueOnce('shared');

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add to Calendar' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add to Calendar' }));

    await waitFor(() => {
      expect(publicActionMocks.exportCalendarIcsFile).toHaveBeenCalledWith(
        'Bears-vs. Wolves-2026-06-04.ics',
        'BEGIN:VCALENDAR'
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Calendar file ready to share.')).toBeTruthy();
    });

    publicActionMocks.exportCalendarIcsFile.mockResolvedValueOnce('downloaded');
    fireEvent.click(screen.getByRole('button', { name: 'Add to Calendar' }));

    await waitFor(() => {
      expect(screen.getByText('Add to Calendar download started.')).toBeTruthy();
    });

    publicActionMocks.exportCalendarIcsFile.mockRejectedValueOnce(new Error('Sharing is not available on this device. Try the Apple or Google calendar links instead.'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Calendar' }));

    await waitFor(() => {
      expect(screen.getByText('Sharing is not available on this device. Try the Apple or Google calendar links instead.')).toBeTruthy();
    });
  });

  it('shows actionable assignments before deferring filled roles behind a secondary reveal', async () => {
    const assignments = [
      { role: 'Snacks', value: '', claimable: true, claim: null },
      { role: 'Drinks', value: '', claimable: true, claim: { id: 'Drinks', claimedByUserId: 'coach-1', claimedByName: 'Coach Carter' } },
      { role: 'Setup', value: '', claimable: true, claim: { id: 'Setup', claimedByUserId: 'other-parent', claimedByName: 'Taylor' } },
      { role: 'Scorebook', value: 'Jamie', claimable: false, claim: null }
    ];

    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ assignments })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleAssignments.mockResolvedValue(assignments);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Assignments' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Assignments' })[0]);

    await waitFor(() => {
      expect(screen.getByText('4 posted · 1 open')).toBeTruthy();
    });

    expect(screen.getByText('Snacks')).toBeTruthy();
    expect(screen.getByText('Drinks')).toBeTruthy();
    expect(screen.queryByText('Setup')).toBeNull();
    expect(screen.queryByText('Scorebook')).toBeNull();

    const disclosure = screen.getByRole('button', { name: 'Show filled assignments (2)' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(disclosure);

    await waitFor(() => {
      expect(screen.getByText('Setup')).toBeTruthy();
    });
    expect(screen.getByText('Scorebook')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide filled assignments' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('shows filled assignments immediately when no actionable slots exist', async () => {
    const assignments = [
      { role: 'Setup', value: '', claimable: true, claim: { id: 'Setup', claimedByUserId: 'other-parent', claimedByName: 'Taylor' } },
      { role: 'Scorebook', value: 'Jamie', claimable: false, claim: null }
    ];

    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ assignments })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleAssignments.mockResolvedValue(assignments);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Assignments' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Assignments' })[0]);

    await waitFor(() => {
      expect(screen.getByText('2 posted · 0 open')).toBeTruthy();
    });

    expect(screen.getByText('Setup')).toBeTruthy();
    expect(screen.getByText('Scorebook')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show filled assignments/i })).toBeNull();
  });

  it('refreshes assignment cards after claim and release actions mutate the loaded array in place', async () => {
    const assignments = [
      { role: 'Snacks', value: '', claimable: true, claim: null },
      { role: 'Drinks', value: '', claimable: true, claim: { id: 'Drinks', claimedByUserId: 'coach-1', claimedByName: 'Coach Carter' } },
      { role: 'Setup', value: '', claimable: true, claim: { id: 'Setup', claimedByUserId: 'other-parent', claimedByName: 'Taylor' } },
      { role: 'Scorebook', value: 'Jamie', claimable: false, claim: null }
    ];

    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ assignments })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({ availablePlayers: [], goingPlayers: [], gamePlan: null });
    scheduleServiceMocks.loadGameDayLiveEventsForApp.mockResolvedValue([]);
    scheduleServiceMocks.loadParentScheduleAssignments.mockImplementation(async () => assignments);
    scheduleServiceMocks.claimParentScheduleAssignmentSlot.mockImplementation(async (_event, user, role) => {
      const assignment = assignments.find((item) => item.role === role);
      if (!assignment) throw new Error('Assignment not found');
      assignment.claim = { id: role, claimedByUserId: user.uid, claimedByName: user.displayName || user.email || 'Parent' };
    });
    scheduleServiceMocks.releaseParentScheduleAssignmentClaim.mockImplementation(async (_event, role) => {
      const assignment = assignments.find((item) => item.role === role);
      if (assignment) assignment.claim = null;
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Assignments' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Assignments' })[0]);

    await waitFor(() => {
      expect(screen.getByText('4 posted · 1 open')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show filled assignments (2)' }));

    await waitFor(() => {
      expect(screen.getByText('Setup')).toBeTruthy();
    });
    expect(screen.getByText('Scorebook')).toBeTruthy();

    const snacksCard = screen.getByText('Snacks').closest('article');
    expect(snacksCard).toBeTruthy();
    fireEvent.click(within(snacksCard as HTMLElement).getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(screen.getByText('Snacks claimed.')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('4 posted · 0 open')).toBeTruthy();
    });
    await waitFor(() => {
      expect(within(screen.getByText('Snacks').closest('article') as HTMLElement).getByText('You')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Hide filled assignments' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Setup')).toBeTruthy();
    expect(screen.getByText('Scorebook')).toBeTruthy();

    fireEvent.click(within(screen.getByText('Snacks').closest('article') as HTMLElement).getByRole('button', { name: 'Release' }));

    await waitFor(() => {
      expect(screen.getByText('Snacks released.')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('4 posted · 1 open')).toBeTruthy();
    });
    await waitFor(() => {
      expect(within(screen.getByText('Snacks').closest('article') as HTMLElement).getByRole('button', { name: 'Sign up' })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Hide filled assignments' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Setup')).toBeTruthy();
    expect(screen.getByText('Scorebook')).toBeTruthy();
  });
});

describe('ScheduleEventDetail staff RSVP overrides', () => {
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

  it('hides admin tools by default, then shows missing-player overrides and expands responded sections on demand', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isTeamAdmin: true,
        isTeamRsvpReminderManager: true,
        availabilityNotesVisible: true,
        availabilityNotes: [{ displayName: 'Sam Lee', response: 'maybe', note: 'Arriving after warmups' }]
      })],
      children: []
    });
    scheduleServiceMocks.loadStaffScheduleRsvpBreakdown.mockResolvedValue({
      grouped: {
        going: [{ playerId: 'p1', playerName: 'Avery Smith', playerNumber: '1', response: 'going' }],
        maybe: [{ playerId: 'p2', playerName: 'Blake Jones', playerNumber: '2', response: 'maybe' }],
        not_going: [{ playerId: 'p3', playerName: 'Casey Brown', playerNumber: '3', response: 'not_going' }],
        not_responded: [{ playerId: 'p4', playerName: 'Devon Lee', playerNumber: '4', response: 'not_responded' }]
      },
      counts: { going: 1, maybe: 1, notGoing: 1, notResponded: 1, total: 4 }
    });
    scheduleServiceMocks.loadStaffRsvpReminderPreview.mockResolvedValue({
      missingPlayerCount: 1,
      eligibleEmailCount: 1,
      players: [{ playerId: 'p4', playerName: 'Devon Lee', parentEmails: ['devon@example.com'] }]
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Team RSVP tools.*1 going.*1 missing/ })).toBeTruthy();
    });
    expect(screen.queryByText('Staff RSVP overrides')).toBeNull();
    expect(screen.queryByText('Staff RSVP reminder')).toBeNull();
    expect(screen.queryByText('Arriving after warmups')).toBeNull();
    expect(screen.queryByTestId('staff-rsvp-row-p4')).toBeNull();

    const teamToolsDisclosure = screen.getByRole('button', { name: /Team RSVP tools.*1 going.*1 missing/ });
    expect(teamToolsDisclosure.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(teamToolsDisclosure);

    await waitFor(() => {
      expect(screen.getByText('Staff RSVP overrides')).toBeTruthy();
    });
    expect(screen.getByText('Arriving after warmups')).toBeTruthy();
    expect(screen.getByTestId('staff-rsvp-row-p4')).toBeTruthy();
    expect(screen.queryByTestId('staff-rsvp-row-p1')).toBeNull();
    expect(screen.queryByTestId('staff-rsvp-row-p2')).toBeNull();
    expect(screen.queryByTestId('staff-rsvp-row-p3')).toBeNull();

    const disclosure = screen.getByRole('button', { name: 'Show responded players (1 going · 1 maybe · 1 out · 0 missing)' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(disclosure);

    await waitFor(() => {
      expect(screen.getByTestId('staff-rsvp-row-p1')).toBeTruthy();
    });
    expect(screen.getByTestId('staff-rsvp-row-p2')).toBeTruthy();
    expect(screen.getByTestId('staff-rsvp-row-p3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide responded players' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('uses the staff RSVP breakdown for both availability header and team tools summaries', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isTeamAdmin: true,
        isTeamRsvpReminderManager: true,
        rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 1, total: 1 }
      })],
      children: []
    });
    scheduleServiceMocks.loadStaffScheduleRsvpBreakdown.mockResolvedValue({
      grouped: {
        going: [{ playerId: 'p1', playerName: 'Avery Smith', playerNumber: '1', response: 'going' }],
        maybe: [],
        not_going: [],
        not_responded: [{ playerId: 'p4', playerName: 'Devon Lee', playerNumber: '4', response: 'not_responded' }]
      },
      counts: { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 }
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByText('1 going · 0 maybe · 0 out · 1 missing').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByText('0 going · 0 maybe · 0 out · 1 missing')).toBeNull();
  });

  it('recreates the shared staff RSVP loader when route reuse switches events', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockImplementation(async (_user, { eventId }) => ({
      events: [buildEvent({
        eventKey: `team-1::${eventId}::player-1::2026-06-04T18:00:00.000Z::game`,
        id: eventId,
        isTeamAdmin: true,
        isTeamRsvpReminderManager: true
      })],
      children: []
    }));
    scheduleServiceMocks.loadStaffScheduleRsvpBreakdown.mockResolvedValue({
      grouped: {
        going: [{ playerId: 'p1', playerName: 'Avery Smith', playerNumber: '1', response: 'going' }],
        maybe: [],
        not_going: [],
        not_responded: []
      },
      counts: { going: 1, maybe: 0, notGoing: 0, notResponded: 0, total: 1 }
    });

    function StaffRsvpRouteHarness() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate('/schedule/team-1/game-2?childId=player-1')}>Switch RSVP game</button>
          <ScheduleEventDetail auth={auth} />
        </>
      );
    }

    render(
      <MemoryRouter initialEntries={['/schedule/team-1/game-1?childId=player-1']}>
        <Routes>
          <Route path="/schedule/:teamId/:eventId" element={<StaffRsvpRouteHarness />} />
          <Route path="/schedule" element={<div>Schedule</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(scheduleServiceMocks.createStaffRsvpAvailabilityLoader).toHaveBeenCalledTimes(1);
      expect(scheduleServiceMocks.loadStaffScheduleRsvpBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: 'team-1', id: 'game-1' }),
        auth.user
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch RSVP game' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.createStaffRsvpAvailabilityLoader).toHaveBeenCalledTimes(2);
      expect(scheduleServiceMocks.loadStaffScheduleRsvpBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: 'team-1', id: 'game-2' }),
        auth.user
      );
    });
  });

  it('lets staff override a responded player after expanding and refreshes the counts', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamAdmin: true, isTeamRsvpReminderManager: true })],
      children: []
    });
    scheduleServiceMocks.loadStaffScheduleRsvpBreakdown
      .mockResolvedValueOnce({
        grouped: {
          going: [{ playerId: 'p1', playerName: 'Avery Smith', playerNumber: '1', response: 'going' }],
          maybe: [{ playerId: 'p2', playerName: 'Blake Jones', playerNumber: '2', response: 'maybe' }],
          not_going: [{ playerId: 'p3', playerName: 'Casey Brown', playerNumber: '3', response: 'not_going' }],
          not_responded: [{ playerId: 'p4', playerName: 'Devon Lee', playerNumber: '4', response: 'not_responded' }]
        },
        counts: { going: 1, maybe: 1, notGoing: 1, notResponded: 1, total: 4 }
      })
      .mockResolvedValueOnce({
        grouped: {
          going: [],
          maybe: [
            { playerId: 'p1', playerName: 'Avery Smith', playerNumber: '1', response: 'maybe' },
            { playerId: 'p2', playerName: 'Blake Jones', playerNumber: '2', response: 'maybe' }
          ],
          not_going: [{ playerId: 'p3', playerName: 'Casey Brown', playerNumber: '3', response: 'not_going' }],
          not_responded: [{ playerId: 'p4', playerName: 'Devon Lee', playerNumber: '4', response: 'not_responded' }]
        },
        counts: { going: 0, maybe: 2, notGoing: 1, notResponded: 1, total: 4 }
      });
    scheduleServiceMocks.loadStaffRsvpReminderPreview
      .mockResolvedValueOnce({
        missingPlayerCount: 1,
        eligibleEmailCount: 1,
        players: [{ playerId: 'p4', playerName: 'Devon Lee', parentEmails: ['devon@example.com'] }]
      })
      .mockResolvedValueOnce({
        missingPlayerCount: 1,
        eligibleEmailCount: 1,
        players: [{ playerId: 'p4', playerName: 'Devon Lee', parentEmails: ['devon@example.com'] }]
      });
    scheduleServiceMocks.submitStaffScheduleRsvpOverride.mockResolvedValue({ playerId: 'p1', response: 'maybe' });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Team RSVP tools.*1 going.*1 missing/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Team RSVP tools.*1 going.*1 missing/ }));

    await waitFor(() => {
      expect(screen.getByText('Staff RSVP overrides')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show responded players (1 going · 1 maybe · 1 out · 0 missing)' }));

    const respondedRow = await screen.findByTestId('staff-rsvp-row-p1');
    fireEvent.click(within(respondedRow).getByRole('button', { name: 'Maybe' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.submitStaffScheduleRsvpOverride).toHaveBeenCalledWith(expect.any(Object), auth.user, 'p1', 'maybe');
    });
    expect(scheduleServiceMocks.invalidateStaffRsvpAvailabilityEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }));
    await waitFor(() => {
      expect(screen.getByText('Avery Smith marked maybe.')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getAllByText('0 going · 2 maybe · 1 out · 1 missing').length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(scheduleServiceMocks.loadStaffRsvpReminderPreview).toHaveBeenCalledTimes(2);
    });
    expect(scheduleServiceMocks.loadStaffScheduleRsvpBreakdown.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('hides staff override controls for coach-only staff without admin write access', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, isTeamAdmin: false })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Availability' })).toBeTruthy();
    });

    expect(screen.queryByText('Staff RSVP overrides')).toBeNull();
    expect(screen.queryByRole('button', { name: /Team RSVP tools/ })).toBeNull();
    expect(scheduleServiceMocks.loadStaffScheduleRsvpBreakdown).not.toHaveBeenCalled();
  });

  it('defers reminder-manager tools and reminder loading until the disclosure opens', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamAdmin: false, isTeamRsvpReminderManager: true })],
      children: []
    });
    scheduleServiceMocks.loadStaffRsvpReminderPreview.mockResolvedValue({
      missingPlayerCount: 1,
      eligibleEmailCount: 1,
      players: [{ playerId: 'p4', playerName: 'Devon Lee', parentEmails: ['devon@example.com'] }]
    });

    renderScheduleEventDetail();

    const disclosure = await screen.findByRole('button', { name: /Team RSVP tools.*1 going.*1 missing/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Staff RSVP reminder')).toBeNull();
    expect(scheduleServiceMocks.loadStaffRsvpReminderPreview).not.toHaveBeenCalled();

    fireEvent.click(disclosure);

    await waitFor(() => {
      expect(screen.getByText('Staff RSVP reminder')).toBeTruthy();
    });
    expect(scheduleServiceMocks.loadStaffRsvpReminderPreview).toHaveBeenCalledTimes(1);
    expect(scheduleServiceMocks.loadStaffScheduleRsvpBreakdown).not.toHaveBeenCalled();
  });

  it('keeps the quick RSVP and shared notes unchanged for a normal parent without staff tools', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isTeamStaff: false,
        availabilityNotesVisible: true,
        availabilityNotes: [{ displayName: 'Sam Lee', response: 'maybe', note: 'Arriving late' }]
      })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByText('Is Avery Smith going?')).toBeTruthy();
    });

    expect(screen.getByText('Arriving late')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Team RSVP tools/ })).toBeNull();
    expect(scheduleServiceMocks.loadStaffScheduleRsvpBreakdown).not.toHaveBeenCalled();
    expect(scheduleServiceMocks.loadStaffRsvpReminderPreview).not.toHaveBeenCalled();
  });
});

describe('ScheduleEventDetail practice attendance', () => {
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

  it('lets team admins mark practice players present, late, or absent from the More tab', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        id: 'practice-1',
        eventKey: 'team-1::practice-1::staff-team-team-1::2026-06-04T18:00:00.000Z::practice',
        type: 'practice',
        title: 'Finishing session',
        childId: 'staff-team-team-1',
        childName: 'Team schedule',
        isTeamAdmin: true,
        isTeamStaff: true,
        practiceSessionId: 'session-1',
        practiceAttendanceSummary: '1/2 present'
      })],
      children: []
    });
    scheduleServiceMocks.loadParentPracticePacket.mockResolvedValue(null);
    scheduleServiceMocks.loadStaffPracticeAttendance.mockResolvedValue({
      sessionId: 'session-1',
      teamId: 'team-1',
      eventId: 'practice-1',
      rosterSize: 2,
      checkedInCount: 1,
      players: [
        { playerId: 'p1', displayName: 'Avery Smith', playerNumber: '1', status: 'present', checkedInAt: new Date('2026-06-04T17:55:00Z') },
        { playerId: 'p2', displayName: 'Blake Jones', playerNumber: '2', status: 'not_marked', checkedInAt: null }
      ]
    });
    scheduleServiceMocks.saveStaffPracticeAttendance.mockResolvedValue({
      sessionId: 'session-1',
      teamId: 'team-1',
      eventId: 'practice-1',
      rosterSize: 2,
      checkedInCount: 2,
      players: [
        { playerId: 'p1', displayName: 'Avery Smith', playerNumber: '1', status: 'present', checkedInAt: new Date('2026-06-04T17:55:00Z') },
        { playerId: 'p2', displayName: 'Blake Jones', playerNumber: '2', status: 'late', checkedInAt: new Date('2026-06-04T18:05:00Z') }
      ]
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'More' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Mark each player present, late, or absent.')).toBeTruthy();
    });

    const row = screen.getByTestId('practice-attendance-row-p2');
    fireEvent.click(within(row).getByRole('button', { name: 'Late' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.saveStaffPracticeAttendance).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'practice-1', practiceSessionId: 'session-1' }),
        auth.user,
        expect.objectContaining({
          players: expect.arrayContaining([
            expect.objectContaining({ playerId: 'p2', status: 'late' })
          ])
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Blake Jones marked late.')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('2/2 checked in')).toBeTruthy();
    });
  });

  it('hides practice attendance controls for coach-only staff without admin write access', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        id: 'practice-1',
        eventKey: 'team-1::practice-1::staff-team-team-1::2026-06-04T18:00:00.000Z::practice',
        type: 'practice',
        title: 'Finishing session',
        childId: 'staff-team-team-1',
        childName: 'Team schedule',
        isTeamAdmin: false,
        isTeamStaff: true,
        practiceSessionId: 'session-1'
      })],
      children: []
    });
    scheduleServiceMocks.loadParentPracticePacket.mockResolvedValue(null);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'More' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0]);

    await waitFor(() => {
      expect(screen.queryByText('Mark each player present, late, or absent.')).toBeNull();
    });
    expect(scheduleServiceMocks.loadStaffPracticeAttendance).not.toHaveBeenCalled();
  });

  it('optimistically disables all attendance buttons and sends the latest roster snapshot while saving', async () => {
    let resolveSave: () => void = () => {};
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        id: 'practice-1',
        eventKey: 'team-1::practice-1::staff-team-team-1::2026-06-04T18:00:00.000Z::practice',
        type: 'practice',
        title: 'Finishing session',
        childId: 'staff-team-team-1',
        childName: 'Team schedule',
        isTeamAdmin: true,
        isTeamStaff: true,
        practiceSessionId: 'session-1'
      })],
      children: []
    });
    scheduleServiceMocks.loadParentPracticePacket.mockResolvedValue(null);
    scheduleServiceMocks.loadStaffPracticeAttendance.mockResolvedValue({
      sessionId: 'session-1',
      teamId: 'team-1',
      eventId: 'practice-1',
      rosterSize: 2,
      checkedInCount: 0,
      players: [
        { playerId: 'p1', displayName: 'Avery Smith', playerNumber: '1', status: 'not_marked', checkedInAt: null },
        { playerId: 'p2', displayName: 'Blake Jones', playerNumber: '2', status: 'not_marked', checkedInAt: null }
      ]
    });
    scheduleServiceMocks.saveStaffPracticeAttendance.mockImplementation((_, __, payload) => new Promise((resolve) => {
      resolveSave = () => resolve({ ...payload, checkedInCount: 1 });
    }));

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'More' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Mark each player present, late, or absent.')).toBeTruthy();
    });

    const rowOne = screen.getByTestId('practice-attendance-row-p1');
    const rowTwo = screen.getByTestId('practice-attendance-row-p2');
    fireEvent.click(within(rowOne).getByRole('button', { name: 'Present' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.saveStaffPracticeAttendance).toHaveBeenCalledWith(
        expect.any(Object),
        auth.user,
        expect.objectContaining({
          checkedInCount: 1,
          players: [
            expect.objectContaining({ playerId: 'p1', status: 'present' }),
            expect.objectContaining({ playerId: 'p2', status: 'not_marked' })
          ]
        })
      );
    });
    expect(within(rowOne).getByRole('button', { name: 'Present' })).toHaveProperty('disabled', true);
    expect(within(rowTwo).getByRole('button', { name: 'Late' })).toHaveProperty('disabled', true);
    expect(screen.getByText('1/2 checked in')).toBeTruthy();

    resolveSave();

    await waitFor(() => {
      expect(screen.getByText('Avery Smith marked present.')).toBeTruthy();
    });
  });

  it('rolls an explicit absent selection back to not marked when saving fails', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        id: 'practice-1',
        eventKey: 'team-1::practice-1::staff-team-team-1::2026-06-04T18:00:00.000Z::practice',
        type: 'practice',
        childId: 'staff-team-team-1',
        childName: 'Team schedule',
        isTeamAdmin: true,
        isTeamStaff: true,
        practiceSessionId: 'session-1'
      })],
      children: []
    });
    scheduleServiceMocks.loadParentPracticePacket.mockResolvedValue(null);
    scheduleServiceMocks.loadStaffPracticeAttendance.mockResolvedValue({
      sessionId: 'session-1',
      teamId: 'team-1',
      eventId: 'practice-1',
      rosterSize: 1,
      checkedInCount: 0,
      players: [
        { playerId: 'p1', displayName: 'Avery Smith', playerNumber: '1', status: 'not_marked', checkedInAt: null }
      ]
    });
    scheduleServiceMocks.saveStaffPracticeAttendance.mockRejectedValue(new Error('Save failed'));

    renderScheduleEventDetail();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'More' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0]);
    await waitFor(() => expect(screen.getByText('Not marked')).toBeTruthy());

    const row = screen.getByTestId('practice-attendance-row-p1');
    fireEvent.click(within(row).getByRole('button', { name: 'Absent' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.saveStaffPracticeAttendance).toHaveBeenCalledWith(
        expect.any(Object),
        auth.user,
        expect.objectContaining({
          checkedInCount: 0,
          players: [expect.objectContaining({ playerId: 'p1', status: 'absent' })]
        })
      );
    });
    await waitFor(() => expect(screen.getByText('Save failed')).toBeTruthy());
    expect(within(row).getByText('Not marked')).toBeTruthy();
    expect(screen.getByText('0/1 checked in')).toBeTruthy();
  });
});

describe('ScheduleEventDetail practice timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    practiceTimelineServiceMocks.loadPracticeTimelineModel.mockResolvedValue({
      sessionId: 'session-1',
      teamId: 'team-1',
      eventId: 'practice-1',
      teamName: 'Bears',
      teamSport: 'Soccer',
      blocks: [
        {
          order: 0,
          drillId: 'drill-1',
          drillTitle: 'Warm-up',
          type: 'Warm-up',
          duration: 10,
          description: 'Start with touches',
          notes: 'Keep it moving',
          notesLog: []
        }
      ],
      drillOptions: [
        {
          id: 'drill-2',
          title: 'Finishing',
          type: 'Technical',
          duration: 15,
          description: 'Shots from the top',
          source: 'team'
        }
      ]
    });
    practiceTimelineServiceMocks.savePracticeTimelineForApp.mockResolvedValue('session-1');
    practiceTimelineServiceMocks.appendPracticeTimelineLiveNoteForApp.mockImplementation(async (input: { blocks: PracticeTimelineBlock[]; blockIndex: number; text: string }) => ({
      sessionId: 'session-1',
      blocks: input.blocks.map((block: PracticeTimelineBlock, index: number) => (
        index === input.blockIndex
          ? { ...block, notesLog: [...(block.notesLog || []), { type: 'text', text: input.text, createdAt: '2026-06-11T06:08:00.000Z' }] }
          : block
      ))
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it('lets team admins manage the practice timeline and save live notes', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        id: 'practice-1',
        type: 'practice',
        title: 'Thursday Practice',
        isTeamStaff: true,
        isTeamAdmin: true,
        practiceSessionId: 'session-1'
      })],
      children: []
    });
    scheduleServiceMocks.loadParentPracticePacket.mockResolvedValue(null);
    scheduleServiceMocks.loadStaffPracticeAttendance.mockResolvedValue(null);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'More' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Practice timeline')).toBeTruthy();
    });
    expect(screen.getAllByText('Warm-up').length).toBeGreaterThan(0);
    expect(screen.getByText('1 drill · 10 min planned')).toBeTruthy();
    const addDrillButton = screen.getByRole('button', { name: 'Add drill' }) as HTMLButtonElement;
    const saveLiveNoteButton = screen.getByRole('button', { name: 'Save live note' }) as HTMLButtonElement;
    expect(addDrillButton.disabled).toBe(false);
    expect(saveLiveNoteButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Live note'), { target: { value: 'Shorten the water break' } });
    expect(saveLiveNoteButton.disabled).toBe(false);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'drill-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add drill' }));

    await waitFor(() => {
      expect(practiceTimelineServiceMocks.savePracticeTimelineForApp).toHaveBeenCalledWith(expect.objectContaining({
        eventId: 'practice-1',
        blocks: [
          expect.objectContaining({ drillTitle: 'Warm-up' }),
          expect.objectContaining({ drillTitle: 'Finishing', duration: 15 })
        ]
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save live note' }));

    await waitFor(() => {
      expect(practiceTimelineServiceMocks.appendPracticeTimelineLiveNoteForApp).toHaveBeenCalledWith(expect.objectContaining({
        eventId: 'practice-1',
        text: 'Shorten the water break'
      }));
    });
    await waitFor(() => {
      expect(screen.getByText('Shorten the water break', { exact: false })).toBeTruthy();
    });
  });

  it('preserves UTC midnight packet due dates as calendar dates in the date input', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        id: 'practice-1',
        type: 'practice',
        title: 'Thursday Practice',
        isTeamStaff: true,
        isTeamAdmin: true,
        practiceSessionId: 'session-1'
      })],
      children: []
    });
    scheduleServiceMocks.loadParentPracticePacket.mockResolvedValue(null);
    scheduleServiceMocks.loadStaffPracticeAttendance.mockResolvedValue(null);
    scheduleServiceMocks.loadStaffPracticePacket.mockResolvedValue({
      sessionId: 'session-1',
      teamId: 'team-1',
      eventId: 'practice-1',
      title: 'Practice',
      date: new Date('2026-06-04T18:00:00Z'),
      location: 'Main Gym',
      packetTitle: 'Practice home packet',
      dueDate: '2026-05-24T00:00:00.000Z',
      totalMinutes: 0,
      homePacket: { blocks: [], totalMinutes: 0 },
      completions: [],
      children: [{ id: 'player-1', name: 'Avery Smith' }]
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'More' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Assign practice packet')).toBeTruthy();
    });

    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('2026-05-24');
  });

  it('shows the practice packet first and hides the timeline for non-admin practice viewers', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        id: 'practice-1',
        type: 'practice',
        title: 'Thursday Practice',
        isTeamStaff: true,
        isTeamAdmin: false,
        practiceSessionId: 'session-1'
      })],
      children: []
    });
    scheduleServiceMocks.loadParentPracticePacket.mockResolvedValue(buildPracticePacket());
    scheduleServiceMocks.loadStaffPracticeAttendance.mockResolvedValue(null);

    const { container } = renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'More' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Practice packet')).toBeTruthy();
    });

    const packetPanel = container.querySelector('#practice-packet-panel');
    const practiceHubTitle = screen.getByText('Practice hub');
    expect(packetPanel).toBeTruthy();
    if (!packetPanel) {
      throw new Error('Expected practice packet panel to be rendered');
    }
    expect(packetPanel.compareDocumentPosition(practiceHubTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Packet ready')).toBeTruthy();
    expect(screen.queryByText('Practice timeline')).toBeNull();
    expect(screen.queryByText('No practice timeline yet. Add drills above to build this practice plan.')).toBeNull();
    expect(practiceTimelineServiceMocks.loadPracticeTimelineModel).not.toHaveBeenCalled();
  });

  it('shows a neutral packet empty state for non-admin practice viewers when no packet exists', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        id: 'practice-1',
        type: 'practice',
        title: 'Thursday Practice',
        isTeamStaff: false,
        isTeamAdmin: false,
        practiceSessionId: 'session-1'
      })],
      children: []
    });
    scheduleServiceMocks.loadParentPracticePacket.mockResolvedValue(null);
    scheduleServiceMocks.loadStaffPracticeAttendance.mockResolvedValue(null);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'More' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0]);

    await waitFor(() => {
      expect(screen.getByText('No packet posted yet')).toBeTruthy();
    });

    expect(screen.getByText('Packets appear here when coaches publish home drills for this practice.')).toBeTruthy();
    expect(screen.queryByText('Practice timeline')).toBeNull();
    expect(screen.queryByText('No practice timeline yet. Add drills above to build this practice plan.')).toBeNull();
    expect(practiceTimelineServiceMocks.loadPracticeTimelineModel).not.toHaveBeenCalled();
  });
});

describe('ScheduleEventDetail wrap-up', () => {
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

  it('completes wrap-up with AI artifacts and broadcasts score corrections', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true, homeScore: 51, awayScore: 47 })],
      children: []
    });
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 52, awayScore: 47 });
    scheduleServiceMocks.completeGameWrapupForApp.mockResolvedValue({ status: 'completed', liveStatus: 'completed' });
    gameWrapupServiceMocks.generateGameWrapupArtifactsForApp.mockResolvedValue({
      summary: 'Bears finished strong and controlled the glass.',
      practiceFeedItems: [{ weakness: 'Closeouts', evidence: 'Late rotations', drillCategory: 'Defense', urgency: 'high', addedAt: '2026-06-10T18:00:00.000Z' }]
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Post-game wrap-up' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Post-game notes')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Final home score up' }));
    fireEvent.change(screen.getByLabelText('Post-game notes'), { target: { value: '  Finished stronger on the glass.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete wrap-up' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 52, awayScore: 47 }, auth.user);
    });
    expect(scheduleServiceMocks.publishLiveScoreUpdateEvent).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 52, awayScore: 47 }, auth.user, { homeScore: 51, awayScore: 47 });
    expect(gameWrapupServiceMocks.generateGameWrapupArtifactsForApp).toHaveBeenCalledWith({
      teamId: 'team-1',
      gameId: 'game-1',
      score: { home: 52, away: 47 },
      notes: 'Finished stronger on the glass.'
    });
    expect(scheduleServiceMocks.completeGameWrapupForApp).toHaveBeenCalledWith(
      'team-1',
      'game-1',
      expect.objectContaining({
        homeScore: 52,
        awayScore: 47,
        postGameNotes: 'Finished stronger on the glass.',
        status: 'completed',
        liveStatus: 'completed',
        summary: 'Bears finished strong and controlled the glass.',
        practiceFeedItems: [expect.objectContaining({ weakness: 'Closeouts', drillCategory: 'Defense' })]
      }),
      auth.user
    );
    await waitFor(() => {
      expect(screen.getByText('Wrap-up saved with 1 practice focus item.')).toBeTruthy();
    });
  });

  it('completes wrap-up even when AI analysis fails', async () => {
    const aiError = new Error('AI unavailable');
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true, homeScore: 51, awayScore: 47 })],
      children: []
    });
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 51, awayScore: 47 });
    scheduleServiceMocks.completeGameWrapupForApp.mockResolvedValue({ status: 'completed', liveStatus: 'completed' });
    gameWrapupServiceMocks.generateGameWrapupArtifactsForApp.mockRejectedValue(aiError);

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Post-game wrap-up' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Post-game notes')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Post-game notes'), { target: { value: 'Finished stronger on the glass.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete wrap-up' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 51, awayScore: 47 }, auth.user);
    });
    await waitFor(() => {
      expect(scheduleServiceMocks.completeGameWrapupForApp).toHaveBeenCalledWith(
        'team-1',
        'game-1',
        expect.objectContaining({
          homeScore: 51,
          awayScore: 47,
          postGameNotes: 'Finished stronger on the glass.',
          status: 'completed',
          liveStatus: 'completed',
          summary: '',
          practiceFeedItems: []
        }),
        auth.user
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Wrap-up saved. AI analysis failed, so you can retry by running wrap-up again.')).toBeTruthy();
    });
    expect(consoleWarn).toHaveBeenCalledWith('[schedule-event-detail] Wrap-up AI failed:', aiError);
    consoleWarn.mockRestore();
  });

  it('warns when wrap-up saves but the live score post fails', async () => {
    const publishError = new Error('Live feed unavailable');
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true, homeScore: 51, awayScore: 47 })],
      children: []
    });
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 52, awayScore: 47 });
    scheduleServiceMocks.publishLiveScoreUpdateEvent.mockRejectedValue(publishError);
    scheduleServiceMocks.completeGameWrapupForApp.mockResolvedValue({ status: 'completed', liveStatus: 'completed' });
    gameWrapupServiceMocks.generateGameWrapupArtifactsForApp.mockResolvedValue({
      summary: 'Bears finished strong.',
      practiceFeedItems: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Post-game wrap-up' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Final home score up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete wrap-up' }));

    await waitFor(() => {
      expect(screen.getByText('Wrap-up saved, but the live score post failed. You can retry by running wrap-up again.')).toBeTruthy();
    });
    expect(scheduleServiceMocks.completeGameWrapupForApp).toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      '[schedule-event-detail] Wrap-up score saved but live play-by-play posting failed:',
      publishError
    );
    consoleWarn.mockRestore();
  });

  it('allows wrap-up to skip AI generation and still complete', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true, homeScore: 51, awayScore: 47 })],
      children: []
    });
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 51, awayScore: 47 });
    scheduleServiceMocks.completeGameWrapupForApp.mockResolvedValue({ status: 'completed', liveStatus: 'completed' });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Post-game wrap-up' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Post-game notes')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Generate AI summary' }));
    fireEvent.change(screen.getByLabelText('Post-game notes'), { target: { value: 'Finished stronger on the glass.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete wrap-up' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.completeGameWrapupForApp).toHaveBeenCalledWith(
        'team-1',
        'game-1',
        expect.objectContaining({
          homeScore: 51,
          awayScore: 47,
          postGameNotes: 'Finished stronger on the glass.',
          summary: '',
          practiceFeedItems: []
        }),
        auth.user
      );
    });
    expect(gameWrapupServiceMocks.generateGameWrapupArtifactsForApp).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('Wrap-up saved without AI summary.')).toBeTruthy();
    });
  });

  it('shows an explicit final-score share action for completed staff games and posts once to team chat', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true, homeScore: 51, awayScore: 47, status: 'completed', liveStatus: 'completed' })],
      children: []
    });
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 52, awayScore: 47 });
    chatServiceMocks.sendTeamChatMessage.mockResolvedValue({ conversationId: 'team' });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Post-game wrap-up' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Share final score to team chat' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Final home score up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share final score to team chat' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateGameScore).toHaveBeenCalledWith('team-1', 'game-1', { homeScore: 52, awayScore: 47 }, auth.user);
    });
    await waitFor(() => {
      expect(chatServiceMocks.sendTeamChatMessage).toHaveBeenCalledWith(expect.objectContaining({
        teamId: 'team-1',
        user: auth.user,
        profile: {},
        text: 'Final vs. Wolves: Bears 52, Wolves 47.',
        selectedConversationId: 'team',
        selectedRecipientTarget: 'full_team',
        selectedRecipientIds: []
      }));
    });
    expect(chatServiceMocks.sendTeamChatMessage).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('live-score-editor').textContent).toContain('52-47');
      expect(screen.getByText('Final score posted to team chat.')).toBeTruthy();
    });
  });

  it('offers an email recap using the saved final score and summary', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true, homeScore: 51, awayScore: 47, teamNotificationEmail: 'staff@example.com' })],
      children: []
    });
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 51, awayScore: 47 });
    scheduleServiceMocks.completeGameWrapupForApp.mockResolvedValue({ status: 'completed', liveStatus: 'completed' });
    gameWrapupServiceMocks.generateGameWrapupArtifactsForApp.mockResolvedValue({
      summary: 'Bears finished strong and controlled the glass.',
      practiceFeedItems: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Post-game wrap-up' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Post-game notes')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Post-game notes'), { target: { value: 'Finished stronger on the glass.' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Email recap after save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete wrap-up' }));

    await waitFor(() => {
      expect(gameWrapupServiceMocks.buildGameWrapupEmailDraft).toHaveBeenCalledWith(expect.objectContaining({
        teamName: 'Bears',
        opponentName: 'Wolves',
        score: { home: 51, away: 47 },
        summary: 'Bears finished strong and controlled the glass.',
        postGameNotes: 'Finished stronger on the glass.',
        teamNotificationEmail: 'staff@example.com',
        userEmail: auth.user?.email
      }));
    });
  });

  it('hides wrap-up for coach-only staff without game update access', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: false, homeScore: 51, awayScore: 47 })],
      children: []
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Game hub' })).toBeTruthy();
    });

    expect(screen.queryByText('Post-game wrap-up')).toBeNull();
  });
});

describe('ScheduleEventDetail lineup builder', () => {
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

  it('autosaves tapped lineup assignments from the game tab grid', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isTeamStaff: true,
        gamePlan: {
          formationId: 'basketball-5v5',
          lineups: { 'Q1-pg': 'p1' },
          publishedLineups: {},
          publishedVersion: 0
        }
      })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
      formationId: 'basketball-5v5',
      formationName: 'Basketball 5v5',
      numPeriods: 4,
      positions: [],
      availablePlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' },
        { id: 'p2', name: 'Blake Jones', number: '2' }
      ],
      goingPlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' },
        { id: 'p2', name: 'Blake Jones', number: '2' }
      ],
      gamePlan: {
        formationId: 'basketball-5v5',
        lineups: { 'Q1-pg': 'p1' },
        publishedLineups: {},
        publishedVersion: 0
      }
    });
    scheduleServiceMocks.saveScheduledGameLineupDraftForApp.mockImplementation(async (_event, _user, _formationId, options) => ({
      formationId: 'basketball-5v5',
      formationName: 'Basketball 5v5',
      numPeriods: 4,
      positions: [],
      availablePlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' },
        { id: 'p2', name: 'Blake Jones', number: '2' }
      ],
      goingPlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' },
        { id: 'p2', name: 'Blake Jones', number: '2' }
      ],
      gamePlan: {
        formationId: 'basketball-5v5',
        lineups: options?.lineups || {},
        publishedLineups: {},
        publishedVersion: 0
      }
    }));

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Lineup builder' }));

    await waitFor(() => {
      expect(screen.getByTestId('lineup-slot-Q1-sg')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /#2 Blake Jones/i }));
    fireEvent.click(screen.getByTestId('lineup-slot-Q1-sg'));

    await new Promise((resolve) => setTimeout(resolve, 900));

    await waitFor(() => {
      expect(scheduleServiceMocks.saveScheduledGameLineupDraftForApp).toHaveBeenCalledWith(
        expect.any(Object),
        auth.user,
        'basketball-5v5',
        expect.objectContaining({
          lineups: expect.objectContaining({
            'Q1-pg': 'p1',
            'Q1-sg': 'p2'
          })
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Lineup draft autosaved.')).toBeTruthy();
    });
  });

  it('keeps the lineup autosave confirmation when the saved game plan refreshes the same event', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isTeamStaff: true,
        gamePlan: {
          formationId: 'basketball-5v5',
          lineups: { 'Q1-pg': 'p1' },
          publishedLineups: {},
          publishedVersion: 0
        }
      })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
      formationId: 'basketball-5v5',
      formationName: 'Basketball 5v5',
      numPeriods: 4,
      positions: [],
      availablePlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' },
        { id: 'p2', name: 'Blake Jones', number: '2' }
      ],
      goingPlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' },
        { id: 'p2', name: 'Blake Jones', number: '2' }
      ],
      gamePlan: {
        formationId: 'basketball-5v5',
        lineups: { 'Q1-pg': 'p1' },
        publishedLineups: {},
        publishedVersion: 0
      }
    });
    scheduleServiceMocks.saveScheduledGameLineupDraftForApp.mockImplementation(async (_event, _user, _formationId, options) => ({
      formationId: 'basketball-5v5',
      formationName: 'Basketball 5v5',
      numPeriods: 4,
      positions: [],
      availablePlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' },
        { id: 'p2', name: 'Blake Jones', number: '2' }
      ],
      goingPlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' },
        { id: 'p2', name: 'Blake Jones', number: '2' }
      ],
      gamePlan: {
        formationId: 'basketball-5v5',
        lineups: options?.lineups || {},
        publishedLineups: {},
        publishedVersion: 0
      }
    }));

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Lineup builder' }));

    await waitFor(() => {
      expect(screen.getByTestId('lineup-slot-Q1-sg')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /#2 Blake Jones/i }));
    fireEvent.click(screen.getByTestId('lineup-slot-Q1-sg'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });

    await waitFor(() => {
      expect(scheduleServiceMocks.saveScheduledGameLineupDraftForApp).toHaveBeenCalled();
      expect(scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp).toHaveBeenCalledWith(
        expect.objectContaining({
          gamePlan: expect.objectContaining({
            lineups: expect.objectContaining({
              'Q1-pg': 'p1',
              'Q1-sg': 'p2'
            })
          })
        }),
        auth.user,
        'basketball-5v5'
      );
      expect(screen.getByText('Lineup draft autosaved.')).toBeTruthy();
      expect((screen.getByLabelText('Formation') as HTMLSelectElement).value).toBe('basketball-5v5');
    });
  });

  it('does not reload lineup preview when live clock updates the same event', async () => {
    const gamePlan = {
      formationId: 'basketball-5v5',
      lineups: { 'Q1-pg': 'p1' },
      publishedLineups: {},
      publishedVersion: 0
    };
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        liveStatus: 'live',
        status: 'live',
        canUpdateScore: true,
        isTeamStaff: true,
        gamePlan
      })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
      formationId: 'basketball-5v5',
      formationName: 'Basketball 5v5',
      numPeriods: 4,
      positions: [],
      availablePlayers: [{ id: 'p1', name: 'Avery Smith', number: '1' }],
      goingPlayers: [{ id: 'p1', name: 'Avery Smith', number: '1' }],
      gamePlan
    });
    scheduleServiceMocks.updateLiveGameClockState.mockResolvedValue({
      liveClockMs: 0,
      liveClockRunning: true,
      liveClockPeriod: 'Q1',
      liveClockUpdatedAt: '2026-06-04T18:00:00.000Z'
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Lineup builder' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('lineup-slot-Q1-pg')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start clock' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.updateLiveGameClockState).toHaveBeenCalledWith(
        'team-1',
        'game-1',
        expect.objectContaining({ liveClockRunning: true }),
        auth.user
      );
    });
    await waitFor(() => {
      expect(scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('lineup-slot-Q1-pg')).toBeTruthy();
    });
  });

  it('disables publish immediately after the last populated lineup slot is cleared', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isTeamStaff: true,
        gamePlan: {
          formationId: 'basketball-5v5',
          lineups: { 'Q1-pg': 'p1' },
          publishedLineups: { 'Q1-pg': 'p1' },
          publishedVersion: 1
        }
      })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
      formationId: 'basketball-5v5',
      formationName: 'Basketball 5v5',
      numPeriods: 4,
      positions: [],
      availablePlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' }
      ],
      goingPlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' }
      ],
      gamePlan: {
        formationId: 'basketball-5v5',
        lineups: { 'Q1-pg': 'p1' },
        publishedLineups: { 'Q1-pg': 'p1' },
        publishedVersion: 1
      }
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Lineup builder' }));

    await waitFor(() => {
      expect(screen.getByTestId('lineup-slot-Q1-pg')).toBeTruthy();
    });

    const publishButton = screen.getByRole('button', { name: 'Publish lineup' }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(false);

    fireEvent.doubleClick(screen.getByTestId('lineup-slot-Q1-pg'));

    await waitFor(() => {
      expect(publishButton.disabled).toBe(true);
    });
  });

  it('autosaves an empty lineup after the last populated slot is cleared', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({
        isTeamStaff: true,
        gamePlan: {
          formationId: 'basketball-5v5',
          lineups: { 'Q1-pg': 'p1' },
          publishedLineups: { 'Q1-pg': 'p1' },
          publishedVersion: 1
        }
      })],
      children: []
    });
    scheduleServiceMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
      formationId: 'basketball-5v5',
      formationName: 'Basketball 5v5',
      numPeriods: 4,
      positions: [],
      availablePlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' }
      ],
      goingPlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' }
      ],
      gamePlan: {
        formationId: 'basketball-5v5',
        lineups: { 'Q1-pg': 'p1' },
        publishedLineups: { 'Q1-pg': 'p1' },
        publishedVersion: 1
      }
    });
    scheduleServiceMocks.saveScheduledGameLineupDraftForApp.mockImplementation(async (_event, _user, _formationId, options) => ({
      formationId: 'basketball-5v5',
      formationName: 'Basketball 5v5',
      numPeriods: 4,
      positions: [],
      availablePlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' }
      ],
      goingPlayers: [
        { id: 'p1', name: 'Avery Smith', number: '1' }
      ],
      gamePlan: {
        formationId: 'basketball-5v5',
        lineups: options?.lineups || {},
        publishedLineups: { 'Q1-pg': 'p1' },
        publishedVersion: 1
      }
    }));

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Lineup builder' }));

    await waitFor(() => {
      expect(screen.getByTestId('lineup-slot-Q1-pg')).toBeTruthy();
    });

    fireEvent.doubleClick(screen.getByTestId('lineup-slot-Q1-pg'));

    await new Promise((resolve) => setTimeout(resolve, 900));

    await waitFor(() => {
      expect(scheduleServiceMocks.saveScheduledGameLineupDraftForApp).toHaveBeenCalledWith(
        expect.any(Object),
        auth.user,
        'basketball-5v5',
        expect.objectContaining({ lineups: {} })
      );
    });
  });
});

describe('ScheduleEventDetail statsheet import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:statsheet-preview'),
      writable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      writable: true
    });
    liveGameReactionsServiceMocks.canUseLiveGameReactions.mockReturnValue(true);
    liveGameReactionsServiceMocks.getLiveGameReactionNotice.mockReturnValue(null);
    liveGameReactionsServiceMocks.subscribeToLiveGameReactions.mockReturnValue(vi.fn());
    liveGameChatServiceMocks.canUseLiveGameChat.mockReturnValue(true);
    liveGameChatServiceMocks.getLiveGameChatNotice.mockReturnValue(null);
    liveGameChatServiceMocks.subscribeToLiveGameChat.mockReturnValue(vi.fn());
    scheduleHubMocks.buildGameHubDestinations.mockReturnValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    {
      button: 'Take photo',
      source: 'camera',
      message: 'Camera permission was denied. Allow camera access to capture a statsheet.'
    },
    {
      button: 'Choose from library',
      source: 'photos',
      message: 'Photo permission was denied. Allow photo library access to choose a statsheet.'
    }
  ])('keeps $button permission recovery copy specific to statsheet import', async ({ button, source, message }) => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true })],
      children: []
    });
    statsheetImportServiceMocks.acquireTrackStatsheetPhoto.mockRejectedValue({
      code: 'permission-denied',
      message: 'Permission denied'
    });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Statsheet import' }));
    fireEvent.click(await screen.findByRole('button', { name: button }));

    await waitFor(() => {
      expect(statsheetImportServiceMocks.acquireTrackStatsheetPhoto).toHaveBeenCalledWith(source);
    });
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('lets coaches correct home row fouls before applying a statsheet photo', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true })],
      children: []
    });
    statsheetImportServiceMocks.loadTrackStatsheetContextForApp.mockResolvedValue({
      roster: [{ id: 'p1', name: 'Avery Smith', number: '12' }],
      config: { columns: ['PTS'] }
    });
    statsheetImportServiceMocks.analyzeTrackStatsheetPhoto.mockResolvedValue({
      homeRows: [{ number: '12', name: 'Avery Smith', fouls: 1, totalPoints: 10, include: true, mappedPlayerId: 'p1' }],
      visitorRows: [],
      homeScore: 10,
      awayScore: 8,
      shouldSwap: false,
      homeMatches: 1,
      visitorMatches: 0
    });
    statsheetImportServiceMocks.applyTrackStatsheetImportForApp.mockResolvedValue({
      requiresReplaceConfirmation: false,
      uploadedPhotoUrl: 'https://img.test/statsheet.png'
    });

    const rendered = renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Statsheet import' }));

    await waitFor(() => {
      expect(screen.getByTestId('statsheet-import-panel')).toBeTruthy();
    });

    const fileInput = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['sheet'], 'statsheet.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze photo' }));

    const foulsInput = await screen.findByLabelText('Home player 1 fouls') as HTMLInputElement;
    fireEvent.change(foulsInput, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to game' }));

    await waitFor(() => {
      expect(statsheetImportServiceMocks.applyTrackStatsheetImportForApp).toHaveBeenCalledWith(expect.objectContaining({
        homeRows: [expect.objectContaining({ mappedPlayerId: 'p1', fouls: 4, totalPoints: 10 })]
      }));
    });
  });

  it('applies matched statsheet rows while leaving unmatched rows available for manual mapping', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true })],
      children: []
    });
    statsheetImportServiceMocks.loadTrackStatsheetContextForApp.mockResolvedValue({
      roster: [
        { id: 'p1', name: 'Avery Smith', number: '12' },
        { id: 'p2', name: 'Mia Diaz', number: '5' }
      ],
      config: { columns: ['PTS'] }
    });
    statsheetImportServiceMocks.analyzeTrackStatsheetPhoto.mockResolvedValue({
      homeRows: [
        { number: '12', name: 'Avery Smith', fouls: 1, totalPoints: 10, include: true, mappedPlayerId: 'p1' },
        { number: '55', name: 'Mystery Player', fouls: 2, totalPoints: 7, include: false, mappedPlayerId: '' }
      ],
      visitorRows: [],
      homeScore: 17,
      awayScore: 8,
      shouldSwap: false,
      homeMatches: 1,
      visitorMatches: 0
    });
    statsheetImportServiceMocks.applyTrackStatsheetImportForApp.mockResolvedValue({
      requiresReplaceConfirmation: false,
      uploadedPhotoUrl: 'https://img.test/statsheet.png'
    });

    const rendered = renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Statsheet import' }));

    const fileInput = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['sheet'], 'statsheet.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze photo' }));

    const panel = await screen.findByTestId('statsheet-import-panel');
    await screen.findByLabelText('Home player 2 roster match');
    const includeInputs = within(panel).getAllByLabelText('Include') as HTMLInputElement[];
    expect(includeInputs[0].checked).toBe(true);
    expect(includeInputs[1].checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Apply to game' }));

    await waitFor(() => {
      expect(statsheetImportServiceMocks.applyTrackStatsheetImportForApp).toHaveBeenCalledWith(expect.objectContaining({
        homeRows: [
          expect.objectContaining({ name: 'Avery Smith', include: true, mappedPlayerId: 'p1' }),
          expect.objectContaining({ name: 'Mystery Player', include: false, mappedPlayerId: '' })
        ]
      }));
    });
  });

  it('lets coaches manually include and map a review-only statsheet row before applying', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true })],
      children: []
    });
    statsheetImportServiceMocks.loadTrackStatsheetContextForApp.mockResolvedValue({
      roster: [
        { id: 'p1', name: 'Avery Smith', number: '12' },
        { id: 'p2', name: 'Mia Diaz', number: '5' }
      ],
      config: { columns: ['PTS'] }
    });
    statsheetImportServiceMocks.analyzeTrackStatsheetPhoto.mockResolvedValue({
      homeRows: [
        { number: '12', name: 'Avery Smith', fouls: 1, totalPoints: 10, include: true, mappedPlayerId: 'p1' },
        { number: '55', name: 'Mystery Player', fouls: 2, totalPoints: 7, include: false, mappedPlayerId: '' }
      ],
      visitorRows: [],
      homeScore: 17,
      awayScore: 8,
      shouldSwap: false,
      homeMatches: 1,
      visitorMatches: 0
    });
    statsheetImportServiceMocks.applyTrackStatsheetImportForApp.mockResolvedValue({
      requiresReplaceConfirmation: false,
      uploadedPhotoUrl: 'https://img.test/statsheet.png'
    });

    const rendered = renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Statsheet import' }));

    const fileInput = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['sheet'], 'statsheet.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze photo' }));

    const panel = await screen.findByTestId('statsheet-import-panel');
    await screen.findByLabelText('Home player 2 roster match');
    const includeInputs = within(panel).getAllByLabelText('Include') as HTMLInputElement[];
    fireEvent.click(includeInputs[1]);
    fireEvent.change(screen.getByLabelText('Home player 2 roster match'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to game' }));

    await waitFor(() => {
      expect(statsheetImportServiceMocks.applyTrackStatsheetImportForApp).toHaveBeenCalledTimes(1);
    });
    expect(statsheetImportServiceMocks.applyTrackStatsheetImportForApp).toHaveBeenCalledWith(expect.objectContaining({
      homeRows: [
        expect.objectContaining({ name: 'Avery Smith', include: true, mappedPlayerId: 'p1' }),
        expect.objectContaining({ name: 'Mystery Player', include: true, mappedPlayerId: 'p2', totalPoints: 7, fouls: 2 })
      ]
    }));
  });

  it('stops retrying when replacement confirmation keeps being required', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true })],
      children: []
    });
    statsheetImportServiceMocks.loadTrackStatsheetContextForApp.mockResolvedValue({
      roster: [{ id: 'p1', name: 'Avery Smith', number: '12' }],
      config: { columns: ['PTS'] }
    });
    statsheetImportServiceMocks.analyzeTrackStatsheetPhoto.mockResolvedValue({
      homeRows: [{ number: '12', name: 'Avery Smith', fouls: 1, totalPoints: 10, include: true, mappedPlayerId: 'p1' }],
      visitorRows: [],
      homeScore: 10,
      awayScore: 8,
      shouldSwap: false,
      homeMatches: 1,
      visitorMatches: 0
    });
    statsheetImportServiceMocks.applyTrackStatsheetImportForApp
      .mockResolvedValueOnce({ requiresReplaceConfirmation: true })
      .mockResolvedValueOnce({ requiresReplaceConfirmation: true });

    const rendered = renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Statsheet import' }));

    const fileInput = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['sheet'], 'statsheet.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze photo' }));
    await screen.findByLabelText('Home player 1 fouls');

    fireEvent.click(screen.getByRole('button', { name: 'Apply to game' }));

    await waitFor(() => {
      expect(statsheetImportServiceMocks.applyTrackStatsheetImportForApp).toHaveBeenCalledTimes(2);
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Replacement confirmation could not be completed. Please try again later.')).toBeTruthy();

    confirmSpy.mockRestore();
  });

  it('clears stale statsheet state and reloads context when switching games', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockImplementation(async (_user, { eventId }) => ({
      events: [eventId === 'game-2'
        ? buildEvent({
            eventKey: 'team-1::game-2::player-1::2026-06-05T18:00:00.000Z::game',
            id: 'game-2',
            opponent: 'Lions',
            homeScore: 21,
            awayScore: 19,
            isTeamStaff: true,
            canUpdateScore: true
          })
        : buildEvent({ isTeamStaff: true, canUpdateScore: true })],
      children: []
    }));
    statsheetImportServiceMocks.loadTrackStatsheetContextForApp.mockImplementation(async (_teamId, gameId) => ({
      roster: gameId === 'game-2'
        ? [{ id: 'p2', name: 'Jordan Lee', number: '7' }]
        : [{ id: 'p1', name: 'Avery Smith', number: '12' }],
      config: { columns: ['PTS'] }
    }));
    statsheetImportServiceMocks.analyzeTrackStatsheetPhoto.mockImplementation(async (_file, roster) => {
      if (roster[0]?.id === 'p2') {
        return {
          homeRows: [{ number: '7', name: 'Jordan Lee', fouls: 2, totalPoints: 14, include: true, mappedPlayerId: 'p2' }],
          visitorRows: [],
          homeScore: 21,
          awayScore: 19,
          shouldSwap: false,
          homeMatches: 1,
          visitorMatches: 0
        };
      }
      return {
        homeRows: [{ number: '12', name: 'Avery Smith', fouls: 1, totalPoints: 10, include: true, mappedPlayerId: 'p1' }],
        visitorRows: [],
        homeScore: 10,
        awayScore: 8,
        shouldSwap: false,
        homeMatches: 1,
        visitorMatches: 0
      };
    });

    const rendered = renderScheduleEventDetailWithRouteControls();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Statsheet import' }));

    await waitFor(() => {
      expect(screen.getByTestId('statsheet-import-panel')).toBeTruthy();
    });

    let fileInput = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['sheet-1'], 'statsheet-1.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze photo' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Avery Smith')).toBeTruthy();
    });
    expect(screen.getByAltText('Statsheet preview')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Switch game' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Lions/ })).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Avery Smith')).toBeNull();
    });
    expect(screen.queryByAltText('Statsheet preview')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Statsheet import' }));

    fileInput = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['sheet-2'], 'statsheet-2.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze photo' }));

    await waitFor(() => {
      expect(statsheetImportServiceMocks.loadTrackStatsheetContextForApp).toHaveBeenCalledWith('team-1', 'game-2');
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue('Jordan Lee')).toBeTruthy();
    });
  });
});
