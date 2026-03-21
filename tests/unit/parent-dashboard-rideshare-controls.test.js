import { describe, expect, it, vi } from 'vitest';
import {
    createRideRequestHandlers,
    resolveRideRequestSelection,
    resolveSelectedRideChildId
} from '../../js/parent-dashboard-rideshare-controls.js';

describe('parent dashboard rideshare controls', () => {
    it('prefers the child with the parent request in the modal picker state', () => {
        const selectedChildId = resolveSelectedRideChildId({
            includeChildPicker: true,
            defaultChildId: 'child-a',
            childChoices: [
                { childId: 'child-a', childName: 'Child A' },
                { childId: 'child-b', childName: 'Child B' }
            ],
            offer: {
                requests: [
                    { id: 'req-b', parentUserId: 'parent-1', childId: 'child-b', childName: 'Child B', status: 'pending' }
                ]
            },
            parentUserId: 'parent-1'
        });

        expect(selectedChildId).toBe('child-b');
    });

    it('resolves the selected child name from the active picker value', () => {
        expect(resolveRideRequestSelection({
            defaultChildId: 'child-a',
            defaultChildName: 'Child A',
            selectorValue: 'child-b',
            childChoices: [
                { childId: 'child-a', childName: 'Child A' },
                { childId: 'child-b', childName: 'Child B' }
            ]
        })).toEqual({
            childId: 'child-b',
            childName: 'Child B'
        });
    });

    it('requests a ride for child B and preserves the picker selection before rerender', async () => {
        const requestRideSpot = vi.fn().mockResolvedValue('parent-1__child-b');
        const refreshRideshareForEvent = vi.fn().mockResolvedValue(undefined);
        const renderScheduleFromControls = vi.fn();
        const rerenderActiveDayModal = vi.fn();
        const selectedRideChildByOffer = new Map();
        const handlers = createRideRequestHandlers({
            documentRef: {
                getElementById(id) {
                    if (id === 'ride-child-picker') return { value: 'child-b' };
                    return null;
                }
            },
            resolveChildChoices() {
                return [
                    { childId: 'child-a', childName: 'Child A' },
                    { childId: 'child-b', childName: 'Child B' }
                ];
            },
            getRideOfferSelectionKey(teamId, gameId, offerId) {
                return `${teamId}::${gameId}::${offerId}`;
            },
            selectedRideChildByOffer,
            requestRideSpot,
            cancelRideRequest: vi.fn(),
            refreshRideshareForEvent,
            renderScheduleFromControls,
            rerenderActiveDayModal,
            alertFn: vi.fn(),
            consoleRef: { error: vi.fn() }
        });

        await handlers.requestRideSpotForChild(
            'team-1',
            'event-1',
            '',
            'offer-game-1',
            'offer-1',
            'child-a',
            'Child A',
            'ride-child-picker'
        );

        expect(requestRideSpot).toHaveBeenCalledWith('team-1', 'offer-game-1', 'offer-1', {
            childId: 'child-b',
            childName: 'Child B'
        });
        expect(selectedRideChildByOffer.get('team-1::event-1::offer-1')).toBe('child-b');
        expect(refreshRideshareForEvent).toHaveBeenCalledWith('team-1', 'event-1', '');
        expect(renderScheduleFromControls).toHaveBeenCalledTimes(1);
        expect(rerenderActiveDayModal).toHaveBeenCalledTimes(1);
    });

    it('cancels an existing ride request and rerenders the modal state', async () => {
        const cancelRideRequest = vi.fn().mockResolvedValue(undefined);
        const refreshRideshareForEvent = vi.fn().mockResolvedValue(undefined);
        const renderScheduleFromControls = vi.fn();
        const rerenderActiveDayModal = vi.fn();
        const handlers = createRideRequestHandlers({
            documentRef: null,
            resolveChildChoices: vi.fn(),
            getRideOfferSelectionKey: vi.fn(),
            selectedRideChildByOffer: new Map(),
            requestRideSpot: vi.fn(),
            cancelRideRequest,
            refreshRideshareForEvent,
            renderScheduleFromControls,
            rerenderActiveDayModal,
            alertFn: vi.fn(),
            consoleRef: { error: vi.fn() }
        });

        await handlers.cancelMyRideRequest('team-1', 'event-1', 'legacy-1', 'offer-game-1', 'offer-1', 'req-1');

        expect(cancelRideRequest).toHaveBeenCalledWith('team-1', 'offer-game-1', 'offer-1', 'req-1');
        expect(refreshRideshareForEvent).toHaveBeenCalledWith('team-1', 'event-1', 'legacy-1');
        expect(renderScheduleFromControls).toHaveBeenCalledTimes(1);
        expect(rerenderActiveDayModal).toHaveBeenCalledTimes(1);
    });
});
