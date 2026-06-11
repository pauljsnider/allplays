// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
  loadAutoFilledLineupDraftPreviewForApp: vi.fn(),
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
  recordPlayerScoringStat: vi.fn(),
  saveScheduledGameLineupDraftForApp: vi.fn(),
  saveStaffPracticeAttendance: vi.fn(),
  updateGameScore: vi.fn(),
  updateParentScheduleRideRequestStatus: vi.fn()
}));

vi.mock('../lib/scheduleService', () => scheduleServiceMocks);
const publicActionMocks = vi.hoisted(() => ({
  exportCalendarIcsFile: vi.fn(),
  openPublicUrl: vi.fn(),
  sharePublicUrl: vi.fn()
}));

vi.mock('../lib/gameReportService', () => ({ loadGameReportSections: vi.fn() }));
vi.mock('../lib/publicActions', () => publicActionMocks);
vi.mock('../lib/liveGameAnnouncer', () => ({ useLiveGameAnnouncer: vi.fn() }));
vi.mock('../lib/parentToolsService', () => ({ buildParentScheduleEventIcs: vi.fn(() => 'BEGIN:VCALENDAR') }));
vi.mock('../lib/scheduleHub', () => ({
  buildGameHubDestinations: vi.fn(() => []),
  buildPracticeHubDestinations: vi.fn(() => []),
  getPublicPlayerHref: vi.fn(() => '#')
}));

import { ScheduleEventDetail, shouldAutosaveGeneratedLineupDraft, shouldAutosaveLineupDraft, shouldPersistLineupDraft } from './ScheduleEventDetail';
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

function renderScheduleEventDetail() {
  return render(
    <MemoryRouter initialEntries={['/schedule/team-1/game-1?childId=player-1']}>
      <Routes>
        <Route path="/schedule/:teamId/:eventId" element={<ScheduleEventDetail auth={auth} />} />
        <Route path="/schedule" element={<div>Schedule</div>} />
      </Routes>
    </MemoryRouter>
  );
}

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

describe('ScheduleEventDetail assignments', () => {
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

  it('uses native-aware calendar export messaging for shared, downloaded, and failed event exports', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent()],
      children: []
    });
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
