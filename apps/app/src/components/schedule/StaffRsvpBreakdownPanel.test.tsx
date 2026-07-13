// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduleEventDetailProvider } from '../../pages/schedule/ScheduleEventDetailContext';
import { StaffRsvpBreakdownPanel } from './StaffRsvpBreakdownPanel';
import type { AuthState } from '../../lib/types';

const auth: AuthState = {
    user: {
        uid: 'coach-1',
        email: 'coach@example.com',
        displayName: 'Coach One'
    } as any,
    profile: { displayName: 'Coach One' },
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

function buildEvent(overrides: Record<string, unknown> = {}) {
    return {
        eventKey: 'team-1::game-1::player-1',
        id: 'game-1',
        teamId: 'team-1',
        childId: 'player-1',
        childName: 'Avery Smith',
        isDbGame: true,
        isTeamAdmin: true,
        isCancelled: false,
        availabilityLocked: false,
        ...overrides
    } as any;
}

function renderPanel(breakdown: any, eventOverrides: Record<string, unknown> = {}) {
    return render(
        <ScheduleEventDetailProvider
            value={{
                auth,
                event: buildEvent(eventOverrides),
                childEvents: [buildEvent(eventOverrides)],
                refreshEvent: vi.fn(),
                updateEvents: vi.fn()
            }}
        >
            <StaffRsvpBreakdownPanel
                breakdown={breakdown}
                loading={false}
                error={null}
                submittingPlayerId={null}
                status={null}
                onOverride={vi.fn()}
            />
        </ScheduleEventDetailProvider>
    );
}

describe('StaffRsvpBreakdownPanel', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('handles an initially empty breakdown and shows missing players after data loads', () => {
        const breakdown = {
            grouped: {
                going: [{ playerId: 'p1', playerName: 'Avery Smith', playerNumber: '1', response: 'going' }],
                maybe: [],
                not_going: [],
                not_responded: [{ playerId: 'p2', playerName: 'Blake Jones', playerNumber: '2', response: 'not_responded' }]
            },
            counts: { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 }
        } as any;

        const view = renderPanel(null);
        expect(screen.queryByText('Staff RSVP overrides')).toBeNull();

        view.rerender(
            <ScheduleEventDetailProvider
                value={{
                    auth,
                    event: buildEvent(),
                    childEvents: [buildEvent()],
                    refreshEvent: vi.fn(),
                    updateEvents: vi.fn()
                }}
            >
                <StaffRsvpBreakdownPanel
                    breakdown={breakdown}
                    loading={false}
                    error={null}
                    submittingPlayerId={null}
                    status={null}
                    onOverride={vi.fn()}
                />
            </ScheduleEventDetailProvider>
        );

        expect(screen.getByText('Staff RSVP overrides')).toBeTruthy();
        expect(screen.getByTestId('staff-rsvp-row-p2')).toBeTruthy();
        expect(screen.queryByTestId('staff-rsvp-row-p1')).toBeNull();
        expect(screen.getByRole('button', { name: 'Show responded players (1 going · 0 maybe · 0 out · 0 missing)' }).getAttribute('aria-expanded')).toBe('false');
    });

    it('shows saved responses that could not be linked to a roster player', () => {
        renderPanel({
            grouped: {
                going: [],
                maybe: [],
                not_going: [],
                not_responded: [{ playerId: 'p1', playerName: 'Avery Smith', playerNumber: '1', response: 'not_responded' }]
            },
            unmatchedResponders: [{
                responderUserId: 'parent-1',
                responderName: 'dad@allplays.ai',
                response: 'going',
                respondedAt: '2026-07-13T12:00:00.000Z'
            }],
            counts: { going: 0, maybe: 0, notGoing: 0, notResponded: 1, total: 1 }
        });

        expect(screen.getByTestId('staff-rsvp-unmatched-responders')).toBeTruthy();
        expect(screen.getByText('Answered by dad@allplays.ai — not linked to a player (Going).')).toBeTruthy();
    });
});
