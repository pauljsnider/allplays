// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Officials } from './Officials';
import type { OfficialAssignmentItem } from '../lib/scheduleService';
import type { AuthState } from '../lib/types';

const scheduleServiceMocks = vi.hoisted(() => ({
    loadOfficialAssignments: vi.fn(),
    respondToOfficialAssignmentItem: vi.fn(),
    claimOfficialAssignmentItem: vi.fn()
}));

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock
    };
});

vi.mock('../lib/homeLogic', () => ({
    getEventDetailPath: vi.fn(() => '/schedule/team-1/game-1')
}));

vi.mock('../lib/scheduleService', () => scheduleServiceMocks);

const auth: AuthState = {
    user: {
        uid: 'official-1',
        email: 'ref@example.com',
        displayName: 'Riley Ref',
        roles: []
    },
    profile: null,
    loading: false,
    error: null,
    roles: [],
    isParent: false,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn(),
    signOut: vi.fn()
};

function buildAssignment(overrides: Partial<OfficialAssignmentItem> = {}): OfficialAssignmentItem {
    return {
        kind: 'assigned',
        teamId: 'team-1',
        teamName: 'Bears FC',
        gameId: 'game-1',
        slotId: 'slot-1',
        position: 'Center Referee',
        status: 'pending',
        opponent: 'Tigers',
        location: 'Field 2',
        date: new Date('2026-06-20T18:00:00.000Z'),
        canClaim: false,
        scheduleReviewRequired: false,
        ...overrides
    };
}

function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderOfficials(path = '/officials') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/officials" element={<Officials auth={auth} />} />
                <Route path="/home" element={<div><div>Home page</div><LocationProbe /></div>} />
            </Routes>
        </MemoryRouter>
    );
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('Officials', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        navigateMock.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders assignment and open-slot summaries with the correct action controls', async () => {
        scheduleServiceMocks.loadOfficialAssignments.mockResolvedValue({
            hasAccess: true,
            teamIds: ['team-1'],
            teamCount: 1,
            assignments: [
                buildAssignment({ scheduleReviewRequired: true }),
                buildAssignment({
                    kind: 'open',
                    slotId: 'slot-2',
                    position: 'Line Judge',
                    status: 'open',
                    canClaim: true
                })
            ]
        });

        renderOfficials('/officials?teamId=team-1');

        expect(await screen.findByRole('heading', { name: 'Assignments' })).toBeTruthy();
        expect(screen.getByText('Assigned').nextElementSibling?.textContent).toBe('1');
        expect(screen.getByText('Open').nextElementSibling?.textContent).toBe('1');
        expect(screen.getByText('Pending').nextElementSibling?.textContent).toBe('1');
        expect(screen.getAllByText('Center Referee · vs. Tigers')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Claim slot' })).toBeTruthy();
        expect(screen.getByText('Needs review')).toBeTruthy();
        expect(scheduleServiceMocks.loadOfficialAssignments).toHaveBeenCalledWith(auth.user, { teamId: 'team-1' });
    });

    it('refreshes the page after accepting an assignment and shows the success state', async () => {
        const pendingAssignment = buildAssignment({ scheduleReviewRequired: true });
        const refreshedAssignment = buildAssignment({ status: 'accepted', scheduleReviewRequired: false });
        const acceptRequest = deferred<void>();

        scheduleServiceMocks.loadOfficialAssignments
            .mockResolvedValueOnce({
                hasAccess: true,
                teamIds: ['team-1'],
                teamCount: 1,
                assignments: [pendingAssignment]
            })
            .mockResolvedValueOnce({
                hasAccess: true,
                teamIds: ['team-1'],
                teamCount: 1,
                assignments: [refreshedAssignment]
            });
        scheduleServiceMocks.respondToOfficialAssignmentItem.mockReturnValue(acceptRequest.promise);

        renderOfficials();

        const acceptButton = await screen.findByRole('button', { name: 'Accept' });
        fireEvent.click(acceptButton);

        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: 'Saving' })).toHaveLength(2);
        });
        expect(scheduleServiceMocks.respondToOfficialAssignmentItem).toHaveBeenCalledWith(pendingAssignment, 'accepted');

        acceptRequest.resolve();

        expect(await screen.findByText('Center Referee accepted.')).toBeTruthy();
        await waitFor(() => {
            expect(scheduleServiceMocks.loadOfficialAssignments).toHaveBeenCalledTimes(2);
        });
        expect(screen.getByText('Assigned').nextElementSibling?.textContent).toBe('1');
        expect(screen.getByText('Open').nextElementSibling?.textContent).toBe('0');
        expect(screen.getByText('Pending').nextElementSibling?.textContent).toBe('0');
        expect(screen.getByText('Status saved on the team schedule.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
        expect(screen.queryByText('Needs review')).toBeNull();
    });

    it('refreshes the page after claiming an open slot and shows updated counts', async () => {
        const openAssignment = buildAssignment({
            kind: 'open',
            slotId: 'slot-2',
            position: 'Line Judge',
            status: 'open',
            canClaim: true
        });
        const claimedAssignment = buildAssignment({
            slotId: 'slot-2',
            position: 'Line Judge',
            status: 'accepted',
            canClaim: false
        });
        const claimRequest = deferred<void>();

        scheduleServiceMocks.loadOfficialAssignments
            .mockResolvedValueOnce({
                hasAccess: true,
                teamIds: ['team-1'],
                teamCount: 1,
                assignments: [openAssignment]
            })
            .mockResolvedValueOnce({
                hasAccess: true,
                teamIds: ['team-1'],
                teamCount: 1,
                assignments: [claimedAssignment]
            });
        scheduleServiceMocks.claimOfficialAssignmentItem.mockReturnValue(claimRequest.promise);

        renderOfficials();

        await screen.findByText('Line Judge · vs. Tigers');
        const claimButton = screen.getByRole('button', { name: 'Claim slot' });
        fireEvent.click(claimButton);

        expect(await screen.findByRole('button', { name: 'Claiming' })).toBeTruthy();
        expect(scheduleServiceMocks.claimOfficialAssignmentItem).toHaveBeenCalledWith(openAssignment, auth.user);

        claimRequest.resolve();

        expect(await screen.findByText('Line Judge claimed.')).toBeTruthy();
        await waitFor(() => {
            expect(scheduleServiceMocks.loadOfficialAssignments).toHaveBeenCalledTimes(2);
        });
        expect(screen.getByText('Assigned').nextElementSibling?.textContent).toBe('1');
        expect(screen.getByText('Open').nextElementSibling?.textContent).toBe('0');
        expect(screen.getByText('Pending').nextElementSibling?.textContent).toBe('0');
        expect(screen.getByText('Status saved on the team schedule.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Claim slot' })).toBeNull();
    });

    it('redirects unauthorized officials back home without rendering stale assignments', async () => {
        scheduleServiceMocks.loadOfficialAssignments.mockResolvedValue({
            hasAccess: false,
            teamIds: [],
            teamCount: 0,
            assignments: [buildAssignment()]
        });

        renderOfficials();

        await waitFor(() => {
            expect(navigateMock).toHaveBeenCalledWith('/home', { replace: true });
        });
        await waitFor(() => {
            expect(screen.queryByText('Assignments')).toBeNull();
        });
        expect(screen.queryByText('Center Referee · vs. Tigers')).toBeNull();
    });
});
