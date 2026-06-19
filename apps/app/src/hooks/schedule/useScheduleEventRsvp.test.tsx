// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
            <button type="button" onClick={() => workflow.submit('maybe')}>Submit maybe</button>
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
        cleanup();
        vi.clearAllMocks();
    });

    it('does not submit when the parent is signed out', async () => {
        function Harness() {
            const [events, setEvents] = useState([buildEvent()]);

            return (
                <ScheduleEventDetailProvider
                    value={{
                        auth: { ...auth, user: null },
                        event: events[0],
                        childEvents: events,
                        refreshEvent: vi.fn(),
                        updateEvents: (updater) => setEvents((current) => updater(current))
                    }}
                >
                    <RsvpProbe availabilityNote="Running late" />
                </ScheduleEventDetailProvider>
            );
        }

        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Submit going' }));

        await waitFor(() => {
            expect(submitParentScheduleRsvp).not.toHaveBeenCalled();
        });
        expect(screen.getByTestId('current-rsvp').textContent).toBe('not_responded');
    });

    it('optimistically updates RSVP state before the server resolves and reconciles on success', async () => {
        let resolveSubmit: (value: any) => void = () => {};
        vi.mocked(submitParentScheduleRsvp).mockImplementation(() => new Promise((resolve) => {
            resolveSubmit = resolve;
        }));

        renderProbe('Running late');

        expect(screen.getByTestId('can-submit').textContent).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Submit going' }));

        expect(screen.getByTestId('current-rsvp').textContent).toBe('going');
        expect(screen.getByTestId('current-note').textContent).toBe('Running late');
        expect(screen.getByTestId('submitting').textContent).toBe('going');

        resolveSubmit({ going: 1, maybe: 0, notGoing: 0, notResponded: 0, total: 1 } as any);

        await waitFor(() => {
            expect(submitParentScheduleRsvp).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user, 'going', 'Running late');
        });
        await waitFor(() => {
            expect(screen.getByText('Avery Smith marked going.')).toBeTruthy();
        });
        expect(screen.getByTestId('submitting').textContent).toBe('');
    });

    it('rolls back optimistic RSVP state when the save fails', async () => {
        vi.mocked(submitParentScheduleRsvp).mockRejectedValue(new Error('Unable to save RSVP.'));

        renderProbe();
        fireEvent.click(screen.getByRole('button', { name: 'Submit going' }));

        expect(screen.getByTestId('current-rsvp').textContent).toBe('going');

        await waitFor(() => {
            expect(screen.getByText('Unable to save RSVP.')).toBeTruthy();
        });
        expect(screen.getByTestId('current-rsvp').textContent).toBe('not_responded');
        expect(screen.getByTestId('current-note').textContent).toBe('');
    });

    it('does not roll back a newer RSVP choice when an earlier submission fails later', async () => {
        let rejectFirst: (reason?: unknown) => void = () => {};
        let resolveSecond: (value: any) => void = () => {};
        vi.mocked(submitParentScheduleRsvp)
            .mockImplementationOnce(() => new Promise((_, reject) => {
                rejectFirst = reject;
            }))
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveSecond = resolve;
            }));

        renderProbe();

        fireEvent.click(screen.getByRole('button', { name: 'Submit going' }));
        expect(screen.getByTestId('current-rsvp').textContent).toBe('going');

        fireEvent.click(screen.getByRole('button', { name: 'Submit maybe' }));
        expect(screen.getByTestId('current-rsvp').textContent).toBe('maybe');

        resolveSecond({ going: 0, maybe: 1, notGoing: 0, notResponded: 0, total: 1 } as any);
        await waitFor(() => {
            expect(screen.getByText('Avery Smith marked maybe.')).toBeTruthy();
        });

        rejectFirst(new Error('Unable to save RSVP.'));
        await waitFor(() => {
            expect(screen.getByText('Unable to save RSVP.')).toBeTruthy();
        });

        expect(screen.getByTestId('current-rsvp').textContent).toBe('maybe');
        expect(screen.getByTestId('current-note').textContent).toBe('Running late');
    });
});
