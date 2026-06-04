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
  updateGameScore: vi.fn(),
  updateParentScheduleRideRequestStatus: vi.fn()
}));

vi.mock('../lib/scheduleService', () => scheduleServiceMocks);
vi.mock('../lib/gameReportService', () => ({ loadGameReportSections: vi.fn() }));
vi.mock('../lib/publicActions', () => ({ openPublicUrl: vi.fn(), sharePublicUrl: vi.fn() }));
vi.mock('../lib/liveGameAnnouncer', () => ({ useLiveGameAnnouncer: vi.fn() }));
vi.mock('../lib/parentToolsService', () => ({ buildParentScheduleEventIcs: vi.fn(() => 'BEGIN:VCALENDAR'), downloadIcs: vi.fn() }));
vi.mock('../lib/scheduleHub', () => ({
  buildGameHubDestinations: vi.fn(() => []),
  buildPracticeHubDestinations: vi.fn(() => []),
  getPublicPlayerHref: vi.fn(() => '#')
}));

import { ScheduleEventDetail } from './ScheduleEventDetail';
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
      events: [buildEvent()],
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
