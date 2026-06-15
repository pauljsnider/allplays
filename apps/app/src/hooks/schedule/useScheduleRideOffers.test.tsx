// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
    createParentScheduleRideOffer,
    loadParentScheduleRideOffers,
    summarizeParentScheduleRideOffers
} from '../../lib/scheduleService';
import { useScheduleRideOffers } from './useScheduleRideOffers';
import { ScheduleEventDetailProvider, useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';
import type { AuthState } from '../../lib/types';

vi.mock('../../lib/scheduleService', () => ({
    cancelParentScheduleRideRequest: vi.fn(),
    createParentScheduleRideOffer: vi.fn(),
    loadParentScheduleRideOffers: vi.fn(),
    requestParentScheduleRideSpot: vi.fn(),
    setParentScheduleRideOfferStatus: vi.fn(),
    summarizeParentScheduleRideOffers: vi.fn((offers: any[]) => ({
        offerCount: offers.length,
        seatsLeft: offers.reduce((sum, offer) => sum + Math.max(0, Number(offer.seatCapacity || 0) - Number(offer.seatCountConfirmed || 0)), 0),
        requests: offers.reduce((sum, offer) => sum + (offer.requests?.length || 0), 0),
        pending: 0,
        confirmed: 0,
        isFull: false
    })),
    updateParentScheduleRideRequestStatus: vi.fn()
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
        rideshareSummary: { offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false },
        ...overrides
    } as any;
}

function RideOffersProbe({ onSwitchEvent }: { onSwitchEvent?: () => void }) {
    const rideOffers = useScheduleRideOffers();
    const { event } = useScheduleEventDetailContext();

    return (
        <div>
            <div data-testid="event-id">{event.id}</div>
            <div data-testid="loading">{String(rideOffers.loading)}</div>
            <div data-testid="offers-count">{String(rideOffers.offers.length)}</div>
            <div data-testid="summary-count">{String(event.rideshareSummary?.offerCount || 0)}</div>
            <div>{rideOffers.message || ''}</div>
            <div>{rideOffers.error || ''}</div>
            <button type="button" onClick={() => rideOffers.submit()}>Create offer</button>
            {onSwitchEvent ? <button type="button" onClick={onSwitchEvent}>Switch event</button> : null}
        </div>
    );
}

function renderProbe() {
    function Harness() {
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [events, setEvents] = useState([
            buildEvent(),
            buildEvent({ eventKey: 'team-1::game-2::player-2', id: 'game-2', childId: 'player-2', childName: 'Blake Jones' })
        ]);

        return (
            <ScheduleEventDetailProvider
                value={{
                    auth,
                    event: events[selectedIndex],
                    childEvents: events,
                    refreshEvent: vi.fn(),
                    updateEvents: (updater) => setEvents((current) => updater(current))
                }}
            >
                <RideOffersProbe onSwitchEvent={() => setSelectedIndex(1)} />
            </ScheduleEventDetailProvider>
        );
    }

    return render(<Harness />);
}

describe('useScheduleRideOffers', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads and refreshes ride offers after a successful offer submission', async () => {
        vi.mocked(loadParentScheduleRideOffers)
            .mockResolvedValueOnce([] as any)
            .mockResolvedValueOnce([
                {
                    id: 'offer-1',
                    driverUserId: 'parent-1',
                    driverName: 'Parent One',
                    seatCapacity: 3,
                    seatCountConfirmed: 1,
                    direction: 'to',
                    status: 'open',
                    requests: []
                }
            ] as any);
        vi.mocked(createParentScheduleRideOffer).mockResolvedValue(undefined as any);

        renderProbe();

        await waitFor(() => {
            expect(loadParentScheduleRideOffers).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Create offer' }));

        await waitFor(() => {
            expect(createParentScheduleRideOffer).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user, expect.objectContaining({ seatCapacity: 3, direction: 'to', note: '' }));
        });
        await waitFor(() => {
            expect(loadParentScheduleRideOffers).toHaveBeenCalledTimes(2);
        });
        await waitFor(() => {
            expect(screen.getByText('Ride offer saved.')).toBeTruthy();
        });
        expect(screen.getByTestId('offers-count')).toHaveTextContent('1');
        expect(screen.getByTestId('summary-count')).toHaveTextContent('1');
        expect(summarizeParentScheduleRideOffers).toHaveBeenCalled();
    });

    it('surfaces ride-offer submission failures without changing shared summary state', async () => {
        vi.mocked(loadParentScheduleRideOffers).mockResolvedValue([] as any);
        vi.mocked(createParentScheduleRideOffer).mockRejectedValue(new Error('Unable to save ride offer.'));

        renderProbe();

        await waitFor(() => {
            expect(loadParentScheduleRideOffers).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Create offer' }));

        await waitFor(() => {
            expect(screen.getByText('Unable to save ride offer.')).toBeTruthy();
        });
        expect(screen.getByTestId('offers-count')).toHaveTextContent('0');
        expect(screen.getByTestId('summary-count')).toHaveTextContent('0');
    });

    it('reloads ride offers when the selected schedule event changes', async () => {
        vi.mocked(loadParentScheduleRideOffers)
            .mockResolvedValueOnce([] as any)
            .mockResolvedValueOnce([
                {
                    id: 'offer-2',
                    driverUserId: 'parent-2',
                    driverName: 'Parent Two',
                    seatCapacity: 2,
                    seatCountConfirmed: 0,
                    direction: 'from',
                    status: 'open',
                    requests: []
                }
            ] as any);

        renderProbe();

        await waitFor(() => {
            expect(loadParentScheduleRideOffers).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }));
        });

        fireEvent.click(screen.getByRole('button', { name: 'Switch event' }));

        await waitFor(() => {
            expect(screen.getByTestId('event-id')).toHaveTextContent('game-2');
        });
        await waitFor(() => {
            expect(loadParentScheduleRideOffers).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-2' }));
        });
        expect(screen.getByTestId('offers-count')).toHaveTextContent('1');
        expect(screen.getByTestId('summary-count')).toHaveTextContent('1');
    });
});
