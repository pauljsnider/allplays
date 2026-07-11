// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { submitParentScheduleRsvp, submitParentScheduleRsvpForChildren } from '../../lib/scheduleService';
import { UX_TIMING } from '../../lib/uxTiming';
import { useScheduleEventRsvp } from './useScheduleEventRsvp';
import { ScheduleEventDetailProvider, useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';
import type { AuthState } from '../../lib/types';

vi.mock('../../lib/scheduleService', () => ({
    submitParentScheduleRsvp: vi.fn(),
    submitParentScheduleRsvpForChildren: vi.fn()
}));

const rsvpInteractionEnd = vi.fn();
const startInteractionTimer = vi.fn((_label?: string, _meta?: Record<string, unknown>) => ({ end: rsvpInteractionEnd }));

vi.mock('../../lib/uxTiming', () => ({
    UX_TIMING: {
        rsvpTap: 'rsvp tap latency'
    },
    startInteractionTimer: (label: string, meta?: Record<string, unknown>) => startInteractionTimer(label, meta)
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
        isLinkedParentChild: true,
        isDbGame: true,
        isCancelled: false,
        availabilityLocked: false,
        myRsvp: 'not_responded',
        myRsvpNote: '',
        rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 1, total: 1 },
        ...overrides
    } as any;
}

function RsvpProbe({ availabilityNote, applyToAllChildren = false }: { availabilityNote: string; applyToAllChildren?: boolean }) {
    const workflow = useScheduleEventRsvp({ availabilityNote, applyToAllChildren });
    const { event, childEvents } = useScheduleEventDetailContext();

    return (
        <div>
            <div data-testid="can-submit">{String(workflow.canSubmit)}</div>
            <div data-testid="current-rsvp">{String(event.myRsvp)}</div>
            <div data-testid="current-note">{String(event.myRsvpNote || '')}</div>
            <div data-testid="submitting">{String(workflow.submitting || '')}</div>
            <div data-testid="all-rsvps">{JSON.stringify(childEvents.map((childEvent) => ({
                childId: childEvent.childId,
                myRsvp: childEvent.myRsvp,
                myRsvpNote: childEvent.myRsvpNote,
                rsvpSummary: childEvent.rsvpSummary
            })))}</div>
            <div>{workflow.message || ''}</div>
            <div>{workflow.error || ''}</div>
            <button type="button" onClick={() => workflow.submit('going')}>Submit going</button>
            <button type="button" onClick={() => workflow.submit('maybe')}>Submit maybe</button>
        </div>
    );
}

function renderProbe(availabilityNote = 'Running late', options: { events?: any[]; applyToAllChildren?: boolean } = {}) {
    function Harness() {
        const [events, setEvents] = useState(options.events || [buildEvent()]);

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
                <RsvpProbe availabilityNote={availabilityNote} applyToAllChildren={options.applyToAllChildren} />
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
        expect(startInteractionTimer).toHaveBeenCalledWith(UX_TIMING.rsvpTap, { response: 'going' });
        await waitFor(() => {
            expect(rsvpInteractionEnd).toHaveBeenCalledWith();
        });
        expect(screen.getByTestId('submitting').textContent).toBe('');
    });

    it('submits one family response for every matching child and updates their local state', async () => {
        const summary = { going: 2, maybe: 0, notGoing: 0, notResponded: 0, total: 2 };
        vi.mocked(submitParentScheduleRsvpForChildren).mockResolvedValue(summary as any);
        const events = [
            buildEvent({ rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 2, total: 2 } }),
            buildEvent({
                eventKey: 'team-1::game-1::player-2',
                childId: 'player-2',
                childName: 'Sam Lee',
                rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 2, total: 2 }
            })
        ];

        renderProbe('Both need a ride', { events, applyToAllChildren: true });
        fireEvent.click(screen.getByRole('button', { name: 'Submit going' }));

        await waitFor(() => expect(submitParentScheduleRsvpForChildren).toHaveBeenCalledTimes(1));
        const submittedEvents = vi.mocked(submitParentScheduleRsvpForChildren).mock.calls[0][0];
        expect(submittedEvents.map((submittedEvent) => submittedEvent.childId)).toEqual(['player-1', 'player-2']);
        expect(submitParentScheduleRsvpForChildren).toHaveBeenCalledWith(
            submittedEvents,
            auth.user,
            'going',
            'Both need a ride'
        );
        expect(submitParentScheduleRsvp).not.toHaveBeenCalled();

        await waitFor(() => expect(screen.getByText('2 children marked going.')).toBeTruthy());
        const localEvents = JSON.parse(screen.getByTestId('all-rsvps').textContent || '[]');
        expect(localEvents).toEqual([
            expect.objectContaining({ childId: 'player-1', myRsvp: 'going', myRsvpNote: 'Both need a ride', rsvpSummary: summary }),
            expect.objectContaining({ childId: 'player-2', myRsvp: 'going', myRsvpNote: 'Both need a ride', rsvpSummary: summary })
        ]);
    });

    it('excludes staff-expanded roster rows from family RSVP writes', async () => {
        const events = [
            buildEvent(),
            buildEvent({
                eventKey: 'team-1::game-1::player-2',
                childId: 'player-2',
                childName: 'Roster Player',
                isLinkedParentChild: false
            })
        ];

        renderProbe('Family only', { events, applyToAllChildren: true });
        fireEvent.click(screen.getByRole('button', { name: 'Submit going' }));

        await waitFor(() => expect(submitParentScheduleRsvp).toHaveBeenCalledTimes(1));
        expect(submitParentScheduleRsvp).toHaveBeenCalledWith(expect.objectContaining({ childId: 'player-1' }), auth.user, 'going', 'Family only');
        expect(submitParentScheduleRsvpForChildren).not.toHaveBeenCalled();
    });

    it('treats a null RSVP summary as a successful submission', async () => {
        vi.mocked(submitParentScheduleRsvp).mockResolvedValue(null as any);

        renderProbe('Running late');
        fireEvent.click(screen.getByRole('button', { name: 'Submit going' }));

        await waitFor(() => {
            expect(screen.getByText('Avery Smith marked going.')).toBeTruthy();
        });
        expect(screen.getByTestId('current-rsvp').textContent).toBe('going');
        expect(startInteractionTimer).toHaveBeenCalledWith(UX_TIMING.rsvpTap, { response: 'going' });
        await waitFor(() => {
            expect(rsvpInteractionEnd).toHaveBeenCalledWith();
        });
        expect(rsvpInteractionEnd).not.toHaveBeenCalledWith({ error: 'RSVP submit failed' });
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
