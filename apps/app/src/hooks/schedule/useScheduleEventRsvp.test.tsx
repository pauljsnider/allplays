// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { submitParentScheduleRsvp } from '../../lib/scheduleService';
import { useScheduleEventRsvp } from './useScheduleEventRsvp';
import { ScheduleEventDetailProvider, useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';
import type { AuthState } from '../../lib/types';

vi.mock('../../lib/scheduleService', () => ({
    submitParentScheduleRsvp: vi.fn()
}));

const auth: AuthState = {
    user: {
        uid: 'parent-1',
        email: 'parent@example.com',
        displayName: 'Parent One'
    } as any,
    profile: null,
    loading: false,
    error: null,
    roles: [],
    isParent: true,
    isCoach: false,
    isAdmin: false,
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
        isCancelled: false,
        availabilityLocked: false,
        myRsvp: 'not_responded',
        myRsvpNote: '',
        rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 1, total: 1 },
        ...overrides
    } as any;
}

function RsvpProbe({ availabilityNote }: { availabilityNote: string }) {
    const workflow = useScheduleEventRsvp({ availabilityNote });
    const { event } = useScheduleEventDetailContext();

    return (
        <div>
            <div data-testid="can-submit">{String(workflow.canSubmit)}</div>
            <div data-testid="current-rsvp">{String(event.myRsvp)}</div>
            <div data-testid="current-note">{String(event.myRsvpNote || '')}</div>
            <div data-testid="submitting">{String(workflow.submitting || '')}</div>
            <div>{workflow.message || ''}</div>
            <div>{workflow.error || ''}</div>
            <button type="button" onClick={() => workflow.submit('going')}>Submit going</button>
        </div>
    );
}

function renderProbe(availabilityNote = 'Running late') {
    function Harness() {
        const [events, setEvents] = useState([buildEvent()]);

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
                <RsvpProbe availabilityNote={availabilityNote} />
            </ScheduleEventDetailProvider>
        );
    }

    return render(<Harness />);
}

describe('useScheduleEventRsvp', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('submits RSVP updates and patches the shared event state on success', async () => {
        vi.mocked(submitParentScheduleRsvp).mockResolvedValue({ going: 1, maybe: 0, notGoing: 0, notResponded: 0, total: 1 } as any);

        renderProbe('Running late');

        expect(screen.getByTestId('can-submit')).toHaveTextContent('true');
        fireEvent.click(screen.getByRole('button', { name: 'Submit going' }));

        await waitFor(() => {
            expect(submitParentScheduleRsvp).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user, 'going', 'Running late');
        });
        await waitFor(() => {
            expect(screen.getByText('Avery Smith marked going.')).toBeTruthy();
        });
        expect(screen.getByTestId('current-rsvp')).toHaveTextContent('going');
        expect(screen.getByTestId('current-note')).toHaveTextContent('Running late');
        expect(screen.getByTestId('submitting')).toHaveTextContent('');
    });

    it('surfaces submission failures without mutating shared event state', async () => {
        vi.mocked(submitParentScheduleRsvp).mockRejectedValue(new Error('Unable to save RSVP.'));

        renderProbe();
        fireEvent.click(screen.getByRole('button', { name: 'Submit going' }));

        await waitFor(() => {
            expect(screen.getByText('Unable to save RSVP.')).toBeTruthy();
        });
        expect(screen.getByTestId('current-rsvp')).toHaveTextContent('not_responded');
        expect(screen.getByTestId('current-note')).toHaveTextContent('');
    });
});
