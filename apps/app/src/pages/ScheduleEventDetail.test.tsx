// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleServiceMocks = vi.hoisted(() => ({
  cancelParentScheduleRideRequest: vi.fn(),
  cancelPracticeOccurrenceForApp: vi.fn(),
  cancelScheduledGameForApp: vi.fn(),
  claimParentScheduleAssignmentSlot: vi.fn(),
  createParentScheduleRideOffer: vi.fn(),
  loadParentPracticePacket: vi.fn(),
  loadStaffPracticeAttendance: vi.fn(),
  loadParentScheduleAssignments: vi.fn(),
  loadParentScheduleEventDetail: vi.fn(),
  loadParentScheduleRideOffers: vi.fn(),
  loadStaffScheduleRsvpBreakdown: vi.fn(),
  loadStaffRsvpReminderPreview: vi.fn(),
  loadAutoFilledLineupDraftPreviewForApp: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({ availablePlayers: [] as any[], goingPlayers: [] as any[], gamePlan: null as any })),
  markParentPracticePacketComplete: vi.fn(),
  publishGamePlanForApp: vi.fn(),
  releaseParentScheduleAssignmentClaim: vi.fn(),
  requestParentScheduleRideSpot: vi.fn(),
  sendStaffRsvpReminder: vi.fn(),
  setParentScheduleRideOfferStatus: vi.fn(),
  submitParentScheduleRsvp: vi.fn(),
  submitStaffScheduleRsvpOverride: vi.fn(),
  summarizeParentScheduleRideOffers: vi.fn(() => ({ offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false })),
  loadHomeScoringPlayers: vi.fn(),
  publishLiveScoreUpdateEvent: vi.fn(),
  recordPlayerGameStat: vi.fn(),
  recordPlayerScoringStat: vi.fn(),
  undoRecordedPlayerGameStat: vi.fn(),
  saveScheduledGameLineupDraftForApp: vi.fn(),
  saveStaffPracticeAttendance: vi.fn(),
  completeGameWrapupForApp: vi.fn(),
  loadGameDayLiveEventsForApp: vi.fn<(...args: any[]) => Promise<any[]>>(() => Promise.resolve([] as any[])),
  saveGameDaySubstitutionForApp: vi.fn((_teamId, _gameId, _user, payload) => Promise.resolve(payload)),
  updateGameScore: vi.fn(),
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
const publicActionMocks = vi.hoisted(() => ({
  exportCalendarIcsFile: vi.fn(),
  openPublicUrl: vi.fn(),
  sharePublicUrl: vi.fn()
}));

vi.mock('../lib/gameReportService', () => ({ loadGameReportSections: vi.fn() }));
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
vi.mock('../lib/publicActions', () => publicActionMocks);
vi.mock('../lib/liveGameAnnouncer', () => ({ useLiveGameAnnouncer: vi.fn() }));
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

import { ScheduleEventDetail, shouldAutosaveGeneratedLineupDraft, shouldAutosaveLineupDraft, shouldPersistLineupDraft } from './ScheduleEventDetail';
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

describe('ScheduleEventDetail loading states', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
    expect(screen.queryByText('Pulling parent actions and game-day details.')).toBeNull();
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
});

describe('ScheduleEventDetail assignments', () => {
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

    await waitFor(() => {
      expect(screen.getByTestId('live-game-reactions-panel')).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByText('Live reactions are closed during replay.')).toBeTruthy();
    });

    expect((screen.getByRole('button', { name: 'Heart' }) as HTMLButtonElement).disabled).toBe(true);
    expect(liveGameReactionsServiceMocks.sendLiveGameReaction).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole('button', { name: 'Undo last foul' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.undoRecordedPlayerGameStat).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({ trackerEventId: 'tracker-foul-1', liveEventId: 'live-foul-1', statKey: 'fouls' }), auth.user);
    });
    expect(screen.getByLabelText('Team foul bonus state').textContent).toContain('Q1 · No bonus');
    expect(screen.getByText('Undo #12 Avery Smith FOULS +1')).toBeTruthy();

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

    await waitFor(() => {
      expect(screen.getByTestId('live-game-chat-panel')).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByText('Live chat is closed during replay.')).toBeTruthy();
    });

    expect((screen.getByLabelText('Live chat message') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(liveGameChatServiceMocks.sendLiveGameChatMessage).not.toHaveBeenCalled();
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
      expect(within(snacksCard as HTMLElement).getByText('You')).toBeTruthy();
    });

    fireEvent.click(within(snacksCard as HTMLElement).getByRole('button', { name: 'Release' }));

    await waitFor(() => {
      expect(screen.getByText('Snacks released.')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('4 posted · 1 open')).toBeTruthy();
    });
    await waitFor(() => {
      expect(within(snacksCard as HTMLElement).getByRole('button', { name: 'Sign up' })).toBeTruthy();
    });
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

  it('renders staff breakdown controls and refreshes counts after an override', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamAdmin: true })],
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
          going: [
            { playerId: 'p1', playerName: 'Avery Smith', playerNumber: '1', response: 'going' },
            { playerId: 'p4', playerName: 'Devon Lee', playerNumber: '4', response: 'going' }
          ],
          maybe: [{ playerId: 'p2', playerName: 'Blake Jones', playerNumber: '2', response: 'maybe' }],
          not_going: [{ playerId: 'p3', playerName: 'Casey Brown', playerNumber: '3', response: 'not_going' }],
          not_responded: []
        },
        counts: { going: 2, maybe: 1, notGoing: 1, notResponded: 0, total: 4 }
      });
    scheduleServiceMocks.submitStaffScheduleRsvpOverride.mockResolvedValue({ playerId: 'p4', response: 'going' });

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getByText('Staff RSVP overrides')).toBeTruthy();
    });

    const noResponseRow = screen.getByTestId('staff-rsvp-row-p4');
    fireEvent.click(within(noResponseRow).getByRole('button', { name: 'Going' }));

    await waitFor(() => {
      expect(scheduleServiceMocks.submitStaffScheduleRsvpOverride).toHaveBeenCalledWith(expect.any(Object), auth.user, 'p4', 'going');
    });
    await waitFor(() => {
      expect(screen.getByText('Devon Lee marked going.')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getAllByText('2 going · 1 maybe · 1 out · 0 missing').length).toBeGreaterThan(0);
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
    expect(scheduleServiceMocks.loadStaffScheduleRsvpBreakdown).not.toHaveBeenCalled();
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
        { playerId: 'p2', displayName: 'Blake Jones', playerNumber: '2', status: 'absent', checkedInAt: null }
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
        { playerId: 'p1', displayName: 'Avery Smith', playerNumber: '1', status: 'absent', checkedInAt: null },
        { playerId: 'p2', displayName: 'Blake Jones', playerNumber: '2', status: 'absent', checkedInAt: null }
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
            expect.objectContaining({ playerId: 'p2', status: 'absent' })
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

  it('hides practice timeline management for coach-only staff without admin write access', async () => {
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

    expect(screen.queryByRole('button', { name: 'Add drill' })).toBeNull();
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

    await waitFor(() => {
      expect(screen.getByText('Post-game wrap-up')).toBeTruthy();
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
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ isTeamStaff: true, canUpdateScore: true, homeScore: 51, awayScore: 47 })],
      children: []
    });
    scheduleServiceMocks.updateGameScore.mockResolvedValue({ homeScore: 51, awayScore: 47 });
    scheduleServiceMocks.completeGameWrapupForApp.mockResolvedValue({ status: 'completed', liveStatus: 'completed' });
    gameWrapupServiceMocks.generateGameWrapupArtifactsForApp.mockRejectedValue(new Error('AI unavailable'));

    renderScheduleEventDetail();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Game' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Game' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Post-game wrap-up')).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByText('Post-game wrap-up')).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByText('Post-game wrap-up')).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByText('Lineup builder')).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByText('Lineup builder')).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByText('Lineup builder')).toBeTruthy();
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
