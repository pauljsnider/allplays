// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../lib/types';

const scheduleServiceMocks = vi.hoisted(() => ({
    loadParentScheduleEventDetail: vi.fn(),
    summarizeParentScheduleRideOffers: vi.fn(() => ({ offerCount: 0, seatsLeft: 0, requests: 0 }))
}));

const parentToolsServiceMocks = vi.hoisted(() => ({
    buildParentScheduleEventIcs: vi.fn(() => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'),
    downloadIcs: vi.fn()
}));

vi.mock('../lib/scheduleService', () => new Proxy({ __esModule: true, ...scheduleServiceMocks }, {
    get(target, prop) {
        if (typeof prop === 'symbol' || prop === 'then' || prop === 'catch' || prop === 'finally') {
            return undefined;
        }
        if (prop in target) return target[prop as keyof typeof target];
        return vi.fn();
    }
}));
vi.mock('../lib/parentToolsService', () => parentToolsServiceMocks);
vi.mock('../lib/gameReportService', () => ({ loadGameReportSections: vi.fn() }));
vi.mock('../lib/publicActions', () => ({ openPublicUrl: vi.fn(), sharePublicUrl: vi.fn() }));
vi.mock('../lib/liveGameAnnouncer', () => ({
    useLiveGameAnnouncer: vi.fn(() => ({ supported: false, enabled: false, paused: false, toggleEnabled: vi.fn() }))
}));
vi.mock('../lib/scheduleHub', () => ({
    buildGameHubDestinations: vi.fn(() => []),
    buildPracticeHubDestinations: vi.fn(() => []),
    getPublicPlayerHref: vi.fn(() => '')
}));

import { ScheduleEventDetail } from './ScheduleEventDetail';

const auth: AuthState = {
    user: {
        uid: 'parent-1',
        email: 'parent@example.com',
        displayName: 'Parent One',
        roles: ['parent'],
        parentOf: []
    } as any,
    profile: null,
    loading: false,
    error: null,
    roles: ['parent'],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(undefined)
};

function renderScheduleEventDetail() {
    return render(
        <MemoryRouter initialEntries={['/schedule/team-1/game-1']}>
            <Routes>
                <Route path="/schedule/:teamId/:eventId" element={<ScheduleEventDetail auth={auth} />} />
                <Route path="/schedule" element={<div>Schedule home</div>} />
            </Routes>
        </MemoryRouter>
    );
}

describe('ScheduleEventDetail add to calendar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.scrollTo = vi.fn();
        window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });

        scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
            events: [
                {
                    eventKey: 'team-1::game-1::player-1',
                    id: 'game-1',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    type: 'game',
                    date: new Date('2026-06-07T15:00:00Z'),
                    location: 'Field 1',
                    opponent: 'Wildcats',
                    childId: 'player-1',
                    childName: 'Sam Player',
                    isDbGame: true,
                    isCancelled: false,
                    myRsvp: 'not_responded',
                    assignments: []
                }
            ]
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('renders the CTA and exports only the selected event', async () => {
        renderScheduleEventDetail();

        const addToCalendarButton = await screen.findByRole('button', { name: 'Add to Calendar' });
        expect(addToCalendarButton).toBeTruthy();

        fireEvent.click(addToCalendarButton);

        await waitFor(() => {
            expect(parentToolsServiceMocks.buildParentScheduleEventIcs).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'game-1', childId: 'player-1', opponent: 'Wildcats' }),
                'vs. Wildcats | Bears'
            );
        });
        expect(parentToolsServiceMocks.downloadIcs).toHaveBeenCalledWith(
            expect.stringContaining('.ics'),
            'BEGIN:VCALENDAR\r\nEND:VCALENDAR'
        );
        expect(await screen.findByText('Add to Calendar download started.')).toBeTruthy();
    });
});
