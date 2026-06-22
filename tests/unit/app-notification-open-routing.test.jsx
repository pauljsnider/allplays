// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { addPushNotificationOpenListener } from '../../apps/app/src/lib/pushService.ts';
import { resolvePushNotificationRoute } from '../../apps/app/src/lib/pushNotificationRouting.ts';

const pushListenerState = vi.hoisted(() => ({ listener: null }));

vi.mock('../../apps/app/src/lib/pushService.ts', () => ({
    addPushNotificationOpenListener: vi.fn(async (onRouteOpen) => {
        pushListenerState.listener = (event) => {
            const route = resolvePushNotificationRoute(event.notification?.data || {});
            onRouteOpen(route);
        };
        return async () => {
            pushListenerState.listener = null;
        };
    })
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function NotificationOpenHarness() {
    const navigate = useNavigate();

    useEffect(() => {
        let removeListener = async () => {};

        addPushNotificationOpenListener((route) => {
            navigate(route, { replace: true });
        }).then((remove) => {
            removeListener = remove;
        });

        return () => {
            removeListener();
        };
    }, [navigate]);

    return (
        <>
            <Routes>
                <Route path="/home" element={<div>Home</div>} />
                <Route path="/messages/:teamId" element={<div>Messages</div>} />
                <Route path="/schedule/:teamId/:eventId" element={<div>Schedule Event</div>} />
                <Route path="/games/:gameId" element={<div>Game Detail</div>} />
                <Route path="/teams/:teamId/fees/:batchId" element={<div>Team Fees</div>} />
                <Route path="/parent-tools/:toolId" element={<div>Parent Tools</div>} />
                <Route path="/officials" element={<div>Officials</div>} />
            </Routes>
            <LocationProbe />
        </>
    );
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function renderHarness(initialEntry = '/home') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(
            <MemoryRouter initialEntries={[initialEntry]}>
                <NotificationOpenHarness />
            </MemoryRouter>
        );
    });

    await flush();
    if (!pushListenerState.listener) {
        throw new Error('Notification listener was not registered.');
    }
    return { container, root };
}

function installLocalStorageMock() {
    const store = new Map();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => store.get(key) ?? null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: (key) => store.delete(key),
            clear: () => store.clear()
        }
    });
}

describe('app notification open routing', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    beforeEach(() => {
        installLocalStorageMock();
        window.localStorage.clear();
        pushListenerState.listener = null;
        vi.clearAllMocks();
    });

    it.each([
        [{ category: 'liveChat', teamId: 'team-1' }, '/messages/team-1'],
        [{ category: 'liveScore', teamId: 'team-1', gameId: 'game-7' }, '/schedule/team-1/game-7?section=game'],
        [{ category: 'liveScore', gameId: 'game-7' }, '/games/game-7'],
        [{ category: 'schedule', teamId: 'team-1', eventId: 'event-9' }, '/schedule/team-1/event-9'],
        [{ category: 'fees', teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' }, '/teams/team-1/fees/batch-1?recipientId=recipient-1'],
        [{ category: 'rsvp', teamId: 'team-1', eventId: 'game-7', childId: 'player-2' }, '/schedule/team-1/game-7?childId=player-2&section=availability'],
        [{ category: 'rideshare', teamId: 'team-1', eventId: 'game-7' }, '/schedule/team-1/game-7?section=rideshare'],
        [{ category: 'rideshare', teamId: 'team-1', eventId: 'game-7', childId: 'player-2' }, '/schedule/team-1/game-7?childId=player-2&section=rideshare'],
        [{ category: 'awards', teamId: 'team-1', certificateId: 'cert-1' }, '/parent-tools/certificates?teamId=team-1&certificateId=cert-1'],
        [{ category: 'officiating', teamId: 'team-1' }, '/officials?teamId=team-1']
    ])('navigates to the expected route when a notification is opened: %o', async (payload, expectedRoute) => {
        const { container, root } = await renderHarness();

        await act(async () => {
            await pushListenerState.listener({
                actionId: 'tap',
                notification: {
                    data: payload
                }
            });
        });
        await flush();

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(expectedRoute);

        await act(async () => {
            root.unmount();
        });
    });
});
