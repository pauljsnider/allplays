// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
    loadStaffScheduleRsvpBreakdown,
    submitStaffScheduleRsvpOverride,
    type StaffScheduleRsvpBreakdown,
    type StaffScheduleRsvpRow
} from '../../lib/scheduleService';
import { ScheduleEventDetailProvider, useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';
import { useStaffRsvpBreakdown } from './useStaffRsvpBreakdown';
import type { AuthState } from '../../lib/types';

vi.mock('../../lib/scheduleService', () => ({
    loadStaffScheduleRsvpBreakdown: vi.fn(),
    submitStaffScheduleRsvpOverride: vi.fn()
}));

const auth: AuthState = {
    user: {
        uid: 'coach-1',
        email: 'coach@example.com',
        displayName: 'Coach One'
    } as any,
    profile: null,
    loading: false,
    error: null,
    roles: [],
    isParent: false,
    isCoach: true,
    isAdmin: true,
    isPlatformAdmin: false,
    refresh: vi.fn(),
    signOut: vi.fn()
};

const playerRow: StaffScheduleRsvpRow = {
    playerId: 'player-1',
    playerName: 'Avery Smith',
    playerNumber: '7',
    response: 'not_responded',
    note: ''
};

function buildBreakdown(response: StaffScheduleRsvpRow['response'], counts: StaffScheduleRsvpBreakdown['counts']): StaffScheduleRsvpBreakdown {
    const row = { ...playerRow, response };
    return {
        counts,
        grouped: {
            not_responded: response === 'not_responded' ? [row] : [],
            going: response === 'going' ? [row] : [],
            maybe: response === 'maybe' ? [row] : [],
            not_going: response === 'not_going' ? [row] : []
        }
    };
}

function buildEvent(overrides: Record<string, unknown> = {}) {
    return {
        eventKey: 'team-1::game-1::player-1',
        id: 'game-1',
        teamId: 'team-1',
        childId: 'player-1',
        childName: 'Avery Smith',
        isDbGame: true,
        isCancelled: false,
        isTeamAdmin: true,
        availabilityLocked: false,
        myRsvp: 'not_responded',
        rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 1, total: 1 },
        ...overrides
    } as any;
}

function StaffRsvpProbe() {
    const workflow = useStaffRsvpBreakdown();
    const { event } = useScheduleEventDetailContext();

    return (
        <div>
            <div data-testid="loading">{String(workflow.loading)}</div>
            <div data-testid="row-count">{String(Object.values(workflow.breakdown?.grouped || {}).flat().length)}</div>
            <div data-testid="current-rsvp">{String(event.myRsvp)}</div>
            <div data-testid="summary-going">{String(event.rsvpSummary?.going || 0)}</div>
            <div data-testid="submitting">{String(workflow.submittingPlayerId || '')}</div>
            <div data-testid="refresh-token">{String(workflow.refreshToken)}</div>
            <div>{workflow.status?.message || ''}</div>
            <div>{workflow.error || ''}</div>
            <button type="button" onClick={() => workflow.submitOverride(playerRow, 'going')}>Mark going</button>
        </div>
    );
}

function renderProbe(eventOverrides: Record<string, unknown> = {}) {
    function Harness() {
        const [events, setEvents] = useState([buildEvent(eventOverrides)]);

        return (
            <ScheduleEventDetailProvider
                value={{
                    auth,
                    event: events[0],
                    childEvents: events,
                    refreshEvent: vi.fn(),
                    updateEvents: (updater) => setEvents((current) => updater(current))
                }}
            >
                <StaffRsvpProbe />
            </ScheduleEventDetailProvider>
        );
    }

    return render(<Harness />);
}

describe('useStaffRsvpBreakdown', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('loads the staff RSVP breakdown for team admins', async () => {
        vi.mocked(loadStaffScheduleRsvpBreakdown).mockResolvedValue(buildBreakdown('not_responded', {
            going: 0,
            maybe: 0,
            notGoing: 0,
            notResponded: 1,
            total: 1
        }));

        renderProbe();

        await waitFor(() => {
            expect(screen.getByTestId('row-count').textContent).toBe('1');
        });
        expect(loadStaffScheduleRsvpBreakdown).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user);
        expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    it('submits an override, updates selected player state, and exposes reminder refresh status', async () => {
        vi.mocked(loadStaffScheduleRsvpBreakdown)
            .mockResolvedValueOnce(buildBreakdown('not_responded', {
                going: 0,
                maybe: 0,
                notGoing: 0,
                notResponded: 1,
                total: 1
            }))
            .mockResolvedValue(buildBreakdown('going', {
                going: 1,
                maybe: 0,
                notGoing: 0,
                notResponded: 0,
                total: 1
            }));
        vi.mocked(submitStaffScheduleRsvpOverride).mockResolvedValue({ going: 1, maybe: 0, notGoing: 0, notResponded: 0, total: 1 } as any);

        renderProbe();

        await waitFor(() => {
            expect(screen.getByTestId('row-count').textContent).toBe('1');
        });
        fireEvent.click(screen.getByRole('button', { name: 'Mark going' }));

        await waitFor(() => {
            expect(submitStaffScheduleRsvpOverride).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user, 'player-1', 'going');
        });
        await waitFor(() => {
            expect(screen.getByText('Avery Smith marked going.')).toBeTruthy();
        });
        expect(screen.getByTestId('current-rsvp').textContent).toBe('going');
        expect(screen.getByTestId('summary-going').textContent).toBe('1');
        expect(screen.getByTestId('refresh-token').textContent).toBe('1');
        expect(screen.getByTestId('submitting').textContent).toBe('');
    });

    it('does not load staff RSVP data when the event is not staff manageable', async () => {
        renderProbe({ isTeamAdmin: false });

        await waitFor(() => {
            expect(loadStaffScheduleRsvpBreakdown).not.toHaveBeenCalled();
        });
        expect(screen.getByTestId('row-count').textContent).toBe('0');
    });
});
