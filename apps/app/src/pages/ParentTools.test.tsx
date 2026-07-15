// @vitest-environment jsdom
import { useCallback, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHorizontalScrollTarget, ParentTools, type ParentToolId } from './ParentTools';
import type { AuthState } from '../lib/types';
import { getNativeBackTarget } from '../lib/nativeBackButton';
import { openPublicUrl, sharePublicUrl } from '../lib/publicActions';

const parentToolsServiceMocks = vi.hoisted(() => ({
    buildParentScheduleIcs: vi.fn(),
    createParentFamilyShare: vi.fn(),
    createParentHouseholdMemberInvite: vi.fn(),
    downloadIcs: vi.fn(),
    getAppleCalendarFeedUrl: vi.fn(),
    getCalendarEventShareText: vi.fn(),
    getGoogleCalendarFeedUrl: vi.fn(),
    getPrivateTeamCalendarFeedUrl: vi.fn(),
    initiateParentTeamFeeCheckout: vi.fn(),
    loadFamilyShareModel: vi.fn(),
    loadParentCalendarTools: vi.fn(),
    loadParentCertificates: vi.fn(),
    loadParentFeesForApp: vi.fn(),
    loadParentHouseholdInviteModel: vi.fn(),
    loadParentRegistrations: vi.fn(),
    revokeParentFamilyShare: vi.fn(),
    updateParentFamilyShareCalendars: vi.fn()
}));

const parentToolsAccessServiceMocks = vi.hoisted(() => ({
    loadParentAccessModel: vi.fn(),
    loadParentAccessTeam: vi.fn(),
    discoverParentAccessTeams: vi.fn(),
    loadParentAccessPlayers: vi.fn(),
    submitParentAccessRequest: vi.fn()
}));

const inviteRedemptionMocks = vi.hoisted(() => ({
    redeemSignedInInvite: vi.fn()
}));

vi.mock('../lib/parentToolsService', () => parentToolsServiceMocks);
vi.mock('../lib/parentCalendarService', () => ({
    buildParentScheduleIcs: parentToolsServiceMocks.buildParentScheduleIcs,
    getAppleCalendarFeedUrl: parentToolsServiceMocks.getAppleCalendarFeedUrl,
    getCalendarEventShareText: parentToolsServiceMocks.getCalendarEventShareText,
    getGoogleCalendarFeedUrl: parentToolsServiceMocks.getGoogleCalendarFeedUrl,
    getPrivateTeamCalendarFeedUrl: parentToolsServiceMocks.getPrivateTeamCalendarFeedUrl,
    loadParentCalendarTools: parentToolsServiceMocks.loadParentCalendarTools
}));
vi.mock('../lib/parentFeesService', () => ({
    initiateParentTeamFeeCheckout: parentToolsServiceMocks.initiateParentTeamFeeCheckout,
    loadParentFeesForApp: parentToolsServiceMocks.loadParentFeesForApp
}));
vi.mock('../lib/parentFamilyShareService', () => ({
    createParentFamilyShare: parentToolsServiceMocks.createParentFamilyShare,
    loadFamilyShareModel: parentToolsServiceMocks.loadFamilyShareModel,
    revokeParentFamilyShare: parentToolsServiceMocks.revokeParentFamilyShare,
    updateParentFamilyShareCalendars: parentToolsServiceMocks.updateParentFamilyShareCalendars
}));
vi.mock('../lib/parentHouseholdService', () => ({
    createParentHouseholdMemberInvite: parentToolsServiceMocks.createParentHouseholdMemberInvite,
    loadParentHouseholdInviteModel: parentToolsServiceMocks.loadParentHouseholdInviteModel
}));
vi.mock('../lib/parentRegistrationsService', () => ({
    loadParentRegistrations: parentToolsServiceMocks.loadParentRegistrations
}));
vi.mock('../lib/parentCertificatesService', () => ({
    loadParentCertificates: parentToolsServiceMocks.loadParentCertificates
}));
vi.mock('../lib/parentToolsAccessService', () => parentToolsAccessServiceMocks);
vi.mock('../lib/inviteRedemption', () => inviteRedemptionMocks);
vi.mock('../lib/publicActions', () => ({
    openPublicUrl: vi.fn(),
    sharePublicUrl: vi.fn()
}));
vi.mock('lucide-react', () => {
    const Icon = () => null;
    return {
        AlertCircle: Icon,
        Award: Icon,
        CalendarDays: Icon,
        CheckCircle2: Icon,
        ChevronLeft: Icon,
        Copy: Icon,
        DollarSign: Icon,
        Download: Icon,
        ExternalLink: Icon,
        KeyRound: Icon,
        Loader2: Icon,
        RefreshCw: Icon,
        Search: Icon,
        Share2: Icon,
        Shield: Icon,
        Ticket: Icon,
        Users: Icon
    };
});

const auth: AuthState = {
    user: {
        uid: 'parent-1',
        email: 'parent@example.com',
        displayName: 'Parent One',
        roles: ['parent'],
        parentOf: []
    },
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

const linkedAuth: AuthState = {
    ...auth,
    user: auth.user ? {
        ...auth.user,
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } : null
};

const indexedLinkedAuth: AuthState = {
    ...auth,
    user: auth.user ? {
        ...auth.user,
        parentOf: [],
        parentTeamIds: ['team-1'],
        parentPlayerKeys: ['team-1::player-1']
    } : null
};

function ParentToolsRoute({ authState = auth }: { authState?: AuthState }) {
    return <ParentTools auth={authState} />;
}

function InvalidParentToolsButton() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate('/parent-tools/not-a-real-tab')}>Go invalid</button>;
}

function renderParentTools(
    initialEntries: string[] = ['/parent-tools/access'],
    includeInvalidButton = false,
    authState: AuthState = auth
) {
    return render(
        <MemoryRouter initialEntries={initialEntries}>
            <Routes>
                <Route
                    path="/parent-tools/:toolId"
                    element={(
                        <>
                            {includeInvalidButton ? <InvalidParentToolsButton /> : null}
                            <ParentToolsRoute authState={authState} />
                        </>
                    )}
                />
                <Route path="/accept-invite" element={<div>Accept invite route</div>} />
            </Routes>
        </MemoryRouter>
    );
}

function RefreshingParentToolsRoute() {
    const [parentOf, setParentOf] = useState<Array<Record<string, unknown>>>([]);
    const refresh = useCallback(async () => {
        const nextParentOf = [{ teamId: 'team-1', playerId: 'player-1' }];
        setParentOf(nextParentOf);
        return auth.user ? { ...auth.user, parentOf: nextParentOf } : null;
    }, []);
    const authState: AuthState = {
        ...auth,
        user: auth.user ? { ...auth.user, parentOf } : null,
        refresh
    };

    return <ParentTools auth={authState} />;
}

describe('getHorizontalScrollTarget', () => {
    it('scrolls left only enough to reveal a tab left of the visible window', () => {
        expect(getHorizontalScrollTarget(240, 0, 390, -80, 20)).toBe(160);
    });

    it('keeps the current position when the active tab is fully visible', () => {
        expect(getHorizontalScrollTarget(240, 0, 390, 120, 220)).toBe(240);
    });

    it('scrolls right only enough to reveal a tab right of the visible window', () => {
        expect(getHorizontalScrollTarget(240, 0, 390, 380, 480)).toBe(330);
    });
});

describe('ParentTools access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__;
        delete globalThis.__ALLPLAYS_PARENT_TOOLS_PANEL_LOAD_TRACKER__;
        parentToolsAccessServiceMocks.loadParentAccessModel.mockResolvedValue({
            requests: []
        });
        parentToolsAccessServiceMocks.discoverParentAccessTeams.mockResolvedValue({
            teams: [{ id: 'team-1', name: 'Bears', sport: 'Soccer' }],
            nextCursor: null
        });
        parentToolsAccessServiceMocks.loadParentAccessTeam.mockImplementation(async (teamId: string) => (
            teamId === 'team-1' ? { id: 'team-1', name: 'Bears', sport: 'Soccer' } : null
        ));
        parentToolsAccessServiceMocks.loadParentAccessPlayers.mockResolvedValue([
            { id: 'player-1', name: 'Sam Player', number: '12' }
        ]);
        parentToolsAccessServiceMocks.submitParentAccessRequest.mockResolvedValue(undefined);
        parentToolsServiceMocks.loadParentCalendarTools.mockResolvedValue({
            events: [],
            teams: []
        });
        parentToolsServiceMocks.loadFamilyShareModel.mockResolvedValue({
            children: [],
            tokens: []
        });
        parentToolsServiceMocks.loadParentHouseholdInviteModel.mockResolvedValue({
            linkedPlayers: [
                {
                    teamId: 'team-1',
                    teamName: 'Bears',
                    playerId: 'player-1',
                    playerName: 'Sam Player',
                    playerNumber: '12'
                }
            ],
            members: []
        });
        inviteRedemptionMocks.redeemSignedInInvite.mockResolvedValue({
            code: 'AB12CD34',
            redirectPath: '/home',
            message: 'Invite accepted.'
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__;
        delete globalThis.__ALLPLAYS_PARENT_TOOLS_PANEL_LOAD_TRACKER__;
        Reflect.deleteProperty(navigator, 'clipboard');
        cleanup();
    });

    it('redeems an invite inline and stays on parent tools', async () => {
        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.change(screen.getByPlaceholderText('XXXXXXXX'), { target: { value: 'ab12cd34' } });
        fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));

        expect(await screen.findByText('Invite accepted.')).toBeTruthy();
        expect(inviteRedemptionMocks.redeemSignedInInvite).toHaveBeenCalledWith({
            userId: 'parent-1',
            code: 'AB12CD34',
            email: 'parent@example.com',
            refresh: auth.refresh
        });
        expect(screen.queryByText('Accept invite route')).toBeNull();
        expect(screen.getByRole('button', { name: 'Redeem code' })).toBeTruthy();
    });

    it('keeps invite redemption disabled until the normalized code has 8 characters', async () => {
        renderParentTools();

        await screen.findByText('Request player access');
        const input = screen.getByPlaceholderText('XXXXXXXX') as HTMLInputElement;
        const button = screen.getByRole('button', { name: 'Redeem code' }) as HTMLButtonElement;
        const form = input.closest('form');

        expect(button.disabled).toBe(true);

        fireEvent.change(input, { target: { value: '   ' } });
        expect(button.disabled).toBe(true);

        fireEvent.change(input, { target: { value: 'abc1234' } });
        expect(button.disabled).toBe(true);
        expect(form).not.toBeNull();
        fireEvent.submit(form as HTMLFormElement);
        expect(inviteRedemptionMocks.redeemSignedInInvite).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: 'ab12cd34' } });
        expect(button.disabled).toBe(false);
        fireEvent.click(button);

        await waitFor(() => expect(inviteRedemptionMocks.redeemSignedInInvite).toHaveBeenCalledWith({
            userId: 'parent-1',
            code: 'AB12CD34',
            email: 'parent@example.com',
            refresh: auth.refresh
        }));
    });

    it('shows inline redeem errors without breaking the request form', async () => {
        inviteRedemptionMocks.redeemSignedInInvite.mockRejectedValue(new Error('Invite code expired.'));
        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.change(screen.getByPlaceholderText('XXXXXXXX'), { target: { value: 'expired1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));

        expect(await screen.findByText('Invite code expired.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Request access without a code' })).toBeTruthy();
    });

    it('blocks inline redeem when the signed-in user is unavailable', async () => {
        const signedOutAuth: AuthState = {
            ...auth,
            user: null,
            roles: [],
            isParent: false
        };
        renderParentTools(['/parent-tools/access'], false, signedOutAuth);

        await screen.findByText('Request player access');
        fireEvent.change(screen.getByPlaceholderText('XXXXXXXX'), { target: { value: 'ab12cd34' } });
        fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));

        expect(await screen.findByText('Sign in to redeem an invite code.')).toBeTruthy();
        expect(inviteRedemptionMocks.redeemSignedInInvite).not.toHaveBeenCalled();
    });

    it('opens the manual request form without loading public teams until search starts', async () => {
        type PublicTeamRow = { id: string; name: string; sport: string };
        const deferredTeams: { resolve: ((value: { teams: PublicTeamRow[]; nextCursor: null }) => void) | null } = { resolve: null };
        let loadStartedAfterFormRendered = false;
        parentToolsAccessServiceMocks.discoverParentAccessTeams.mockImplementation(() => {
            loadStartedAfterFormRendered = Boolean(screen.queryByRole('combobox', { name: 'Team' }));
            return new Promise<{ teams: PublicTeamRow[]; nextCursor: null }>((resolve) => {
                deferredTeams.resolve = resolve;
            });
        });
        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Request access without a code' }));

        const teamSelect = screen.getByRole('combobox', { name: 'Team' }) as HTMLSelectElement;
        const playerSelect = screen.getByRole('combobox', { name: 'Player' }) as HTMLSelectElement;
        expect(teamSelect).toBeTruthy();
        expect(playerSelect).toBeTruthy();
        expect(teamSelect.disabled).toBe(true);
        expect(playerSelect.disabled).toBe(true);
        expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).not.toHaveBeenCalled();
        expect(screen.getByRole('option', { name: 'Search or browse teams' })).toBeTruthy();

        fireEvent.change(screen.getByPlaceholderText('Team name, city, state, or zip'), { target: { value: 'Bears' } });
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));

        expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(1);
        expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledWith({ searchText: 'Bears', cursor: null, pageSize: 20 });
        expect(loadStartedAfterFormRendered).toBe(true);
        expect(screen.queryByRole('button', { name: 'Request access without a code' })).toBeNull();
        expect(screen.getByRole('option', { name: 'Loading public teams...' })).toBeTruthy();

        await waitFor(() => expect(deferredTeams.resolve).toBeTruthy());
        if (!deferredTeams.resolve) throw new Error('Expected public teams loader to be pending.');
        deferredTeams.resolve({ teams: [{ id: 'team-1', name: 'Bears', sport: 'Soccer' }], nextCursor: null });

        expect(await screen.findByRole('option', { name: 'Bears - Soccer' })).toBeTruthy();
        expect((screen.getByLabelText('Team') as HTMLSelectElement).disabled).toBe(false);
    });

    it('auto-opens and preselects the deep-linked team on access routes', async () => {
        type ParentAccessPlayerRow = { id: string; name: string; number: string };
        const deferredPlayers: { resolve: ((value: ParentAccessPlayerRow[]) => void) | null } = { resolve: null };
        parentToolsAccessServiceMocks.loadParentAccessPlayers.mockImplementation((teamId: string) => {
            expect(teamId).toBe('team-1');
            return new Promise<ParentAccessPlayerRow[]>((resolve) => {
                deferredPlayers.resolve = resolve;
            });
        });

        renderParentTools(['/parent-tools/access?teamId=team-1']);

        await screen.findByText('Request player access');
        await waitFor(() => expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(1));

        const teamSelect = await screen.findByRole('combobox', { name: 'Team' }) as HTMLSelectElement;
        expect(screen.queryByRole('button', { name: 'Request access without a code' })).toBeNull();
        expect(teamSelect.value).toBe('team-1');
        await waitFor(() => expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-1'));
        expect(screen.getByRole('option', { name: 'Loading players...' })).toBeTruthy();

        await waitFor(() => expect(deferredPlayers.resolve).toBeTruthy());
        if (!deferredPlayers.resolve) throw new Error('Expected players loader to be pending.');
        deferredPlayers.resolve([{ id: 'player-1', name: 'Sam Player', number: '12' }]);

        expect(await screen.findByRole('option', { name: '#12 Sam Player' })).toBeTruthy();
        expect((screen.getByLabelText('Player') as HTMLSelectElement).value).toBe('player-1');
    });

    it('falls back safely when the deep-linked team is missing', async () => {
        renderParentTools(['/parent-tools/access?teamId=missing-team']);

        await screen.findByText('Request player access');
        // Wait for the manual-request panel to actually render (only true once
        // teams have loaded and the deep-link reconciliation effect has run) before
        // asserting on its contents — asserting synchronously right after only the
        // load call was observed races the state update under full-suite load and
        // was intermittently failing in CI while passing in isolation.
        const teamSelect = await screen.findByRole('combobox', { name: 'Team' }) as HTMLSelectElement;
        expect(teamSelect.value).toBe('');
        expect(await screen.findByRole('option', { name: 'Bears - Soccer' })).toBeTruthy();
        expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Request access without a code' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Redeem code' })).toBeTruthy();
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();
    });

    it('allows retry when public team loading fails after opening manual requests', async () => {
        parentToolsAccessServiceMocks.discoverParentAccessTeams
            .mockRejectedValueOnce(new Error('Network hiccup.'))
            .mockResolvedValueOnce({ teams: [{ id: 'team-1', name: 'Bears', sport: 'Soccer' }], nextCursor: null });
        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Request access without a code' }));
        fireEvent.click(screen.getByRole('button', { name: 'Browse' }));

        expect(await screen.findByText('Network hiccup.')).toBeTruthy();
        const retryButton = screen.getByRole('button', { name: 'Retry' });
        expect(retryButton).toBeTruthy();
        fireEvent.click(retryButton);

        expect(await screen.findByRole('option', { name: 'Bears - Soccer' })).toBeTruthy();
        expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(2);
    });

    it('still submits request access after the redeem panel is added', async () => {
        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Request access without a code' }));
        fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
        await screen.findByRole('option', { name: 'Bears - Soccer' });
        fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'team-1' } });
        await screen.findByRole('option', { name: '#12 Sam Player' });
        const submitButton = screen.getByRole('button', { name: 'Send request' });
        expect(submitButton.hasAttribute('disabled')).toBe(false);
        fireEvent.click(submitButton);

        expect(await screen.findByText('Access request sent.')).toBeTruthy();
        expect(parentToolsAccessServiceMocks.submitParentAccessRequest).toHaveBeenCalledWith('team-1', 'player-1', 'Parent');

        const requestsSection = screen.getByText('Access requests').closest('section');
        expect(requestsSection).toBeTruthy();
        if (!requestsSection) throw new Error('Requests section not found');
        expect(within(requestsSection).getByText('No requests yet')).toBeTruthy();
    });

    it('shows only Access for parents without linked players', async () => {
        renderParentTools();

        expect(await screen.findByText('Request player access')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Access' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Household' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Fees' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Calendar' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Register' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Awards' })).toBeNull();
    });

    it('redirects hidden tool routes back to Access with an explanation', async () => {
        renderParentTools(['/parent-tools/calendar']);

        expect(await screen.findByText('Request player access')).toBeTruthy();
        expect(screen.getByText('Link a player in Access to unlock the rest of Parent Tools.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Calendar' })).toBeNull();
    });

    it('shows the full tab set when a parent already has linked players', async () => {
        renderParentTools(['/parent-tools/access'], false, linkedAuth);

        expect(await screen.findByText('Request player access')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Access' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Household' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fees' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Calendar' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Awards' })).toBeTruthy();
    });

    it('reveals the active tab on deep links without moving an already visible Access tab', async () => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (this.classList.contains('parent-tools-nav')) {
                return { left: 0, right: 390, top: 96, bottom: 144, width: 390, height: 48, x: 0, y: 96, toJSON: () => ({}) };
            }
            if (this.textContent === 'Awards') {
                return { left: 540, right: 620, top: 100, bottom: 140, width: 80, height: 40, x: 540, y: 100, toJSON: () => ({}) };
            }
            return { left: 0, right: 80, top: 100, bottom: 140, width: 80, height: 40, x: 0, y: 100, toJSON: () => ({}) };
        });

        const awardsView = renderParentTools(['/parent-tools/certificates'], false, linkedAuth);
        const awardsNav = document.querySelector('.parent-tools-nav') as HTMLDivElement;
        await waitFor(() => expect(awardsNav.scrollLeft).toBe(230));
        expect(screen.getByRole('button', { name: 'Awards' })).toHaveAttribute('aria-pressed', 'true');
        awardsView.unmount();

        renderParentTools(['/parent-tools/access'], false, linkedAuth);
        await screen.findByText('Request player access');
        expect((document.querySelector('.parent-tools-nav') as HTMLDivElement).scrollLeft).toBe(0);
    });

    it('reveals newly active nonadjacent tabs without scrolling the window', async () => {
        parentToolsServiceMocks.loadParentCertificates.mockResolvedValue([]);
        const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (this.classList.contains('parent-tools-nav')) {
                return { left: 0, right: 390, top: 96, bottom: 144, width: 390, height: 48, x: 0, y: 96, toJSON: () => ({}) };
            }
            if (this.textContent === 'Awards') {
                return { left: 540, right: 620, top: 100, bottom: 140, width: 80, height: 40, x: 540, y: 100, toJSON: () => ({}) };
            }
            return { left: 0, right: 80, top: 100, bottom: 140, width: 80, height: 40, x: 0, y: 100, toJSON: () => ({}) };
        });

        renderParentTools(['/parent-tools/access'], false, linkedAuth);
        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Awards' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Awards' })).toHaveAttribute('aria-pressed', 'true'));
        expect((document.querySelector('.parent-tools-nav') as HTMLDivElement).scrollLeft).toBe(230);
        expect(windowScrollTo).not.toHaveBeenCalled();
    });

    it('treats indexed parent player links as unlocked parent tools access', async () => {
        renderParentTools(['/parent-tools/calendar'], false, indexedLinkedAuth);

        expect(await screen.findByText('No team schedules')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Access' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Calendar' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy();
        expect(screen.queryByText('Link a player in Access to unlock the rest of Parent Tools.')).toBeNull();
    });

    it('lazy-loads tab panels only when their tab is opened', async () => {
        const panelLoads: ParentToolId[] = [];
        globalThis.__ALLPLAYS_PARENT_TOOLS_PANEL_LOAD_TRACKER__ = (toolId) => {
            panelLoads.push(toolId);
        };
        parentToolsServiceMocks.loadParentFeesForApp.mockResolvedValue([]);

        renderParentTools(['/parent-tools/access'], false, linkedAuth);

        await screen.findByText('Request player access');
        expect(panelLoads).not.toContain('fees');

        fireEvent.click(screen.getByRole('button', { name: 'Fees' }));
        await screen.findByText('No fees in this view');
        expect(panelLoads.filter((toolId) => toolId === 'fees')).toEqual(['fees']);

        fireEvent.click(screen.getByRole('button', { name: 'Access' }));
        await screen.findByText('Request player access');
        expect(panelLoads.filter((toolId) => toolId === 'fees')).toEqual(['fees']);
    });

    it('reuses loaded tab data on revisit and only refreshes when requested', async () => {
        parentToolsServiceMocks.loadParentFeesForApp.mockResolvedValue([
            {
                id: 'fee-1',
                title: 'Team dues',
                teamId: 'team-1',
                teamName: 'Bears',
                playerName: 'Sam Player',
                status: 'open',
                amountLabel: '$100',
                dueLabel: 'Today',
                statusLabel: 'Open',
                balanceDueCents: 10000,
                canPay: false,
                lineItems: [],
                installments: [],
                ledgerEntries: []
            }
        ]);
        parentToolsServiceMocks.loadParentRegistrations.mockResolvedValue([
            {
                id: 'form-1',
                teamId: 'team-1',
                teamName: 'Bears',
                programName: 'Summer Camp',
                description: 'Skills week',
                season: 'Summer',
                feeLabel: '$75.00',
                paymentNotice: '',
                onlineCheckout: true,
                options: [],
                url: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1'
            }
        ]);
        parentToolsServiceMocks.loadParentCertificates.mockResolvedValue([
            {
                id: 'cert-1',
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Sam Player',
                title: 'Hustle Award',
                narrative: 'Great effort.',
                url: 'https://allplays.ai/certificates.html#cert-1'
            }
        ]);

        renderParentTools(['/parent-tools/access'], false, linkedAuth);

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Fees' }));
        await screen.findByText('Team dues');
        expect(parentToolsAccessServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).not.toHaveBeenCalled();
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Access' }));
        await screen.findByText('Request player access');
        expect(parentToolsAccessServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).not.toHaveBeenCalled();
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Register' }));
        await screen.findByText('Summer Camp');
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Awards' }));
        await screen.findByText('Hustle Award');
        expect(parentToolsServiceMocks.loadParentCertificates).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Register' }));
        await screen.findByText('Summer Camp');
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        expect(await screen.findByText('Summer Camp')).toBeTruthy();
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(2);
    });

    it('reveals deferred tabs after access changes add a linked player', async () => {
        inviteRedemptionMocks.redeemSignedInInvite.mockImplementationOnce(async ({ refresh }) => {
            await refresh();
            return {
                code: 'AB12CD34',
                redirectPath: '/home',
                message: 'Invite accepted.'
            };
        });

        render(
            <MemoryRouter initialEntries={['/parent-tools/access']}>
                <Routes>
                    <Route path="/parent-tools/:toolId" element={<RefreshingParentToolsRoute />} />
                    <Route path="/accept-invite" element={<div>Accept invite route</div>} />
                </Routes>
            </MemoryRouter>
        );

        expect(await screen.findByText('Request player access')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Register' })).toBeNull();

        fireEvent.change(screen.getByPlaceholderText('XXXXXXXX'), { target: { value: 'ab12cd34' } });
        fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));

        expect(await screen.findByText('Invite accepted.')).toBeTruthy();
        expect(await screen.findByRole('button', { name: 'Register' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Calendar' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Household' })).toBeTruthy();
    });

    it('loads calendar tools with cached defaults across remounts and forces refresh on demand', async () => {
        parentToolsServiceMocks.loadParentCalendarTools.mockResolvedValue({
            events: [
                {
                    id: 'event-1',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    type: 'game',
                    date: new Date('2100-06-01T18:00:00Z')
                }
            ],
            teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 1 }]
        });

        const firstRender = renderParentTools(['/parent-tools/calendar'], false, linkedAuth);
        expect(await screen.findByText('Bears')).toBeTruthy();
        expect(parentToolsServiceMocks.loadParentCalendarTools).toHaveBeenNthCalledWith(1, linkedAuth.user, {});
        firstRender.unmount();

        renderParentTools(['/parent-tools/calendar'], false, linkedAuth);
        expect(await screen.findByText('Bears')).toBeTruthy();
        expect(parentToolsServiceMocks.loadParentCalendarTools).toHaveBeenNthCalledWith(2, linkedAuth.user, {});

        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(parentToolsServiceMocks.loadParentCalendarTools).toHaveBeenNthCalledWith(3, linkedAuth.user, { force: true }));
    });

    it('prioritizes live calendar subscriptions and preserves each feed action', async () => {
        const privateFeedUrl = 'https://calendar.example.test/team-1.ics?token=private-token';
        const appleFeedUrl = 'webcal://calendar.example.test/team-1.ics?token=private-token';
        const googleFeedUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(privateFeedUrl)}`;
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText }
        });
        parentToolsServiceMocks.loadParentCalendarTools.mockResolvedValue({
            events: [
                {
                    id: 'event-1',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    type: 'practice',
                    date: new Date('2100-06-01T18:00:00Z')
                }
            ],
            teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 1 }]
        });
        parentToolsServiceMocks.getPrivateTeamCalendarFeedUrl.mockResolvedValue(privateFeedUrl);
        parentToolsServiceMocks.getAppleCalendarFeedUrl.mockReturnValue(appleFeedUrl);
        parentToolsServiceMocks.getGoogleCalendarFeedUrl.mockReturnValue(googleFeedUrl);

        renderParentTools(['/parent-tools/calendar'], false, linkedAuth);

        const subscriptionsHeading = await screen.findByRole('heading', { name: 'Keep calendars updated' });
        const moreOptionsHeading = screen.getByRole('heading', { name: 'More options' });
        expect(subscriptionsHeading.compareDocumentPosition(moreOptionsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('Subscribe to live games and practices. Schedule changes will sync automatically.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Apple Calendar' }));
        await waitFor(() => expect(openPublicUrl).toHaveBeenCalledWith(appleFeedUrl));
        expect(parentToolsServiceMocks.getAppleCalendarFeedUrl).toHaveBeenCalledWith(privateFeedUrl);

        fireEvent.click(screen.getByRole('button', { name: 'Google Calendar' }));
        await waitFor(() => expect(openPublicUrl).toHaveBeenCalledWith(googleFeedUrl));
        expect(parentToolsServiceMocks.getGoogleCalendarFeedUrl).toHaveBeenCalledWith(privateFeedUrl);

        fireEvent.click(screen.getByRole('button', { name: 'Copy private link' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(privateFeedUrl));
        expect(parentToolsServiceMocks.getPrivateTeamCalendarFeedUrl).toHaveBeenCalledTimes(3);
    });

    it('keeps empty-calendar feedback without rendering subscription actions', async () => {
        renderParentTools(['/parent-tools/calendar'], false, linkedAuth);

        expect(await screen.findByText('No team schedules')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Copy agenda' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Keep calendars updated' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Apple Calendar' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Google Calendar' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Copy private link' })).toBeNull();
    });

    it('keeps parent tool refresh effects stable during local rerenders', async () => {
        renderParentTools(['/parent-tools/access'], false, linkedAuth);

        await screen.findByText('Request player access');
        expect(parentToolsAccessServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getByPlaceholderText('XXXXXXXX'), { target: { value: 'stays-local' } });
        expect(parentToolsAccessServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
        await screen.findByText('No team schedules');
        expect(parentToolsServiceMocks.loadParentCalendarTools).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Copy agenda' }));
        expect(await screen.findByText('No events to copy yet.')).toBeTruthy();
        expect(parentToolsServiceMocks.loadParentCalendarTools).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Share' }));
        await screen.findByText('No family links');
        expect(parentToolsServiceMocks.loadFamilyShareModel).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getByPlaceholderText('Label, like Grandma or babysitter'), { target: { value: 'Grandma' } });
        expect(parentToolsServiceMocks.loadFamilyShareModel).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Household' }));
        await screen.findByText('No pending household invites');
        expect(parentToolsServiceMocks.loadParentHouseholdInviteModel).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getByPlaceholderText('Household contact email'), { target: { value: 'guardian@example.com' } });
        expect(parentToolsServiceMocks.loadParentHouseholdInviteModel).toHaveBeenCalledTimes(1);
    });

    it('keeps loaded family share links visible when a save action fails', async () => {
        parentToolsServiceMocks.loadFamilyShareModel.mockResolvedValue({
            children: [
                {
                    teamId: 'team-1',
                    playerId: 'player-1',
                    playerName: 'Sam Player'
                }
            ],
            tokens: [
                {
                    id: 'token-1',
                    label: 'Grandma',
                    url: 'https://allplays.ai/app/#/family/token-1',
                    childCount: 1,
                    extraCalendarUrls: []
                }
            ]
        });
        parentToolsServiceMocks.revokeParentFamilyShare.mockRejectedValue(new Error('Unable to revoke family share link.'));

        renderParentTools(['/parent-tools/share'], false, linkedAuth);

        expect(await screen.findByText('Grandma')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Revoke link' }));

        expect(await screen.findByText('Unable to revoke family share link.')).toBeTruthy();
        expect(screen.getByText('Grandma')).toBeTruthy();
        expect(screen.getByText('https://allplays.ai/app/#/family/token-1')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    });

    it('shows a created family link when clipboard copy and refresh recovery miss it', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: vi.fn().mockRejectedValue(new Error('Clipboard unavailable.'))
            }
        });
        parentToolsServiceMocks.loadFamilyShareModel.mockResolvedValue({
            children: [
                {
                    teamId: 'team-1',
                    playerId: 'player-1',
                    playerName: 'Sam Player'
                }
            ],
            tokens: [
                {
                    id: 'token-1',
                    label: 'Grandma',
                    url: 'https://allplays.ai/app/#/family/token-1',
                    childCount: 1,
                    extraCalendarUrls: []
                }
            ]
        });
        parentToolsServiceMocks.createParentFamilyShare.mockResolvedValue({
            tokenId: 'token-2',
            url: 'https://allplays.ai/app/#/family/token-2'
        });

        renderParentTools(['/parent-tools/share'], false, linkedAuth);

        expect(await screen.findByText('Grandma')).toBeTruthy();
        fireEvent.change(screen.getByPlaceholderText('Label, like Grandma or babysitter'), { target: { value: 'Aunt Chris' } });
        fireEvent.change(screen.getByPlaceholderText('Optional external calendar feed URLs, one per line'), { target: { value: 'https://calendar.example.test/feed.ics' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create share link' }));

        expect(await screen.findByText('https://allplays.ai/app/#/family/token-2')).toBeTruthy();
        expect(screen.getByText('Copy is not available in this browser.')).toBeTruthy();
        expect(parentToolsServiceMocks.createParentFamilyShare).toHaveBeenCalledWith(linkedAuth.user, 'Aunt Chris', ['https://calendar.example.test/feed.ics']);
        expect(parentToolsServiceMocks.loadFamilyShareModel).toHaveBeenCalledTimes(2);
        expect(screen.getByText('Aunt Chris')).toBeTruthy();
        expect((screen.getByPlaceholderText('Label, like Grandma or babysitter') as HTMLInputElement).value).toBe('');
        expect((screen.getByPlaceholderText('Optional external calendar feed URLs, one per line') as HTMLTextAreaElement).value).toBe('');

        fireEvent.click(screen.getByRole('button', { name: 'Share newly created family link' }));
        await waitFor(() => {
            expect(sharePublicUrl).toHaveBeenCalledWith({
                title: 'ALL PLAYS family page',
                text: 'Aunt Chris',
                url: 'https://allplays.ai/app/#/family/token-2'
            });
        });
    });

    it('clears the created family link panel after revoking that token', async () => {
        const children = [
            {
                teamId: 'team-1',
                playerId: 'player-1',
                playerName: 'Sam Player'
            }
        ];
        const createdToken = {
            id: 'token-2',
            label: 'Aunt Chris',
            url: 'https://allplays.ai/app/#/family/token-2',
            childCount: 1,
            extraCalendarUrls: []
        };
        parentToolsServiceMocks.loadFamilyShareModel
            .mockResolvedValueOnce({
                children,
                tokens: []
            })
            .mockResolvedValueOnce({
                children,
                tokens: [createdToken]
            })
            .mockResolvedValueOnce({
                children,
                tokens: []
            });
        parentToolsServiceMocks.createParentFamilyShare.mockResolvedValue({
            tokenId: 'token-2',
            url: createdToken.url
        });
        parentToolsServiceMocks.revokeParentFamilyShare.mockResolvedValue(undefined);

        renderParentTools(['/parent-tools/share'], false, linkedAuth);

        await screen.findByText('No family links');
        fireEvent.change(screen.getByPlaceholderText('Label, like Grandma or babysitter'), { target: { value: 'Aunt Chris' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create share link' }));

        expect(await screen.findByText('New family link')).toBeTruthy();
        expect(await screen.findByRole('button', { name: 'Revoke' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Revoke link' }));

        await waitFor(() => {
            expect(parentToolsServiceMocks.revokeParentFamilyShare).toHaveBeenCalledWith('token-2');
            expect(screen.queryByText('New family link')).toBeNull();
            expect(screen.queryByRole('button', { name: 'Copy newly created family link' })).toBeNull();
            expect(screen.queryByRole('button', { name: 'Share newly created family link' })).toBeNull();
        });
    });

    it('clears the created family link panel when the signed-in parent changes', async () => {
        const children = [
            {
                teamId: 'team-1',
                playerId: 'player-1',
                playerName: 'Sam Player'
            }
        ];
        const otherLinkedAuth: AuthState = {
            ...linkedAuth,
            user: linkedAuth.user ? {
                ...linkedAuth.user,
                uid: 'parent-2',
                email: 'other-parent@example.com'
            } : null
        };
        parentToolsServiceMocks.loadFamilyShareModel.mockImplementation(async (user) => ({
            children,
            tokens: user?.uid === 'parent-2' ? [
                {
                    id: 'token-9',
                    label: 'Other family',
                    url: 'https://allplays.ai/app/#/family/token-9',
                    childCount: 1,
                    extraCalendarUrls: []
                }
            ] : []
        }));
        parentToolsServiceMocks.createParentFamilyShare.mockResolvedValue({
            tokenId: 'token-2',
            url: 'https://allplays.ai/app/#/family/token-2'
        });

        const view = renderParentTools(['/parent-tools/share'], false, linkedAuth);

        await screen.findByText('No family links');
        fireEvent.change(screen.getByPlaceholderText('Label, like Grandma or babysitter'), { target: { value: 'Aunt Chris' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create share link' }));

        expect(await screen.findByText('https://allplays.ai/app/#/family/token-2')).toBeTruthy();

        view.rerender(
            <MemoryRouter initialEntries={['/parent-tools/share']}>
                <Routes>
                    <Route path="/parent-tools/:toolId" element={<ParentToolsRoute authState={otherLinkedAuth} />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(parentToolsServiceMocks.loadFamilyShareModel).toHaveBeenCalledWith(otherLinkedAuth.user);
            expect(screen.queryByText('https://allplays.ai/app/#/family/token-2')).toBeNull();
            expect(screen.queryByText('New family link')).toBeNull();
        });
        expect(await screen.findByText('Other family')).toBeTruthy();
        expect(screen.getByText('https://allplays.ai/app/#/family/token-9')).toBeTruthy();
    });

    it('opens reusable team fee checkout links when legacy fee payloads omit paymentAction', async () => {
        parentToolsServiceMocks.loadParentFeesForApp.mockResolvedValue([
            {
                id: 'fee-1',
                title: 'Team dues',
                teamId: 'team-1',
                teamName: 'Bears',
                playerName: 'Sam Player',
                status: 'open',
                amountLabel: '$100',
                dueLabel: 'Today',
                statusLabel: 'Open',
                balanceDueCents: 10000,
                checkoutUrl: 'https://pay.example.test/legacy',
                canPay: true,
                checkoutInitiatable: false,
                paymentAction: '',
                lineItems: [],
                installments: [],
                ledgerEntries: []
            }
        ]);

        renderParentTools(['/parent-tools/fees'], false, linkedAuth);

        await screen.findByText('Team dues');
        fireEvent.click(screen.getByRole('button', { name: 'Pay fee' }));

        await waitFor(() => {
            expect(openPublicUrl).toHaveBeenCalledWith('https://pay.example.test/legacy');
        });
        expect(parentToolsServiceMocks.initiateParentTeamFeeCheckout).not.toHaveBeenCalled();
    });

    it('keeps online fee payment primary and reveals invoice details on demand', async () => {
        parentToolsServiceMocks.loadParentFeesForApp.mockResolvedValue([
            {
                id: 'fee-detailed',
                title: 'Tournament dues',
                teamId: 'team-1',
                teamName: 'Bears',
                playerName: 'Sam Player',
                status: 'open',
                amountLabel: '$125',
                dueLabel: 'August 1',
                statusLabel: 'Open',
                balanceDueCents: 10000,
                checkoutUrl: 'https://pay.example.test/detailed',
                canPay: true,
                checkoutInitiatable: false,
                paymentAction: 'checkoutUrl',
                lineItems: [{ title: 'Tournament entry', amountCents: 7500 }],
                installments: [{ label: 'Final installment', amountCents: 5000 }],
                ledgerEntries: [{ description: 'Deposit received', paidAmountCents: 2500 }],
                notes: 'Uniform fitting is included.'
            }
        ]);

        renderParentTools(['/parent-tools/fees'], false, linkedAuth);

        await screen.findByText('Tournament dues');
        expect(screen.getByRole('button', { name: 'Pay fee' })).toBeVisible();
        expect(screen.queryByText('Line items')).toBeNull();
        expect(screen.queryByText('Installments')).toBeNull();
        expect(screen.queryByText('Payments and adjustments')).toBeNull();
        expect(screen.queryByText('Uniform fitting is included.')).toBeNull();

        const disclosure = screen.getByRole('button', { name: 'View details' });
        expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(disclosure);

        expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Line items')).toBeVisible();
        expect(screen.getByText('Installments')).toBeVisible();
        expect(screen.getByText('Payments and adjustments')).toBeVisible();
        expect(screen.getByText('Notes')).toBeVisible();
        expect(screen.getByText('Uniform fitting is included.')).toBeVisible();
    });

    it('keeps offline payment instructions visible while invoice details stay collapsed', async () => {
        parentToolsServiceMocks.loadParentFeesForApp.mockResolvedValue([
            {
                id: 'fee-offline',
                title: 'Cash fundraiser fee',
                teamId: 'team-1',
                teamName: 'Bears',
                playerName: 'Sam Player',
                status: 'open',
                amountLabel: '$40',
                dueLabel: 'Friday',
                statusLabel: 'Open',
                balanceDueCents: 4000,
                canPay: false,
                checkoutInitiatable: false,
                paymentAction: '',
                offlinePaymentInstructions: 'Bring cash or a check to practice.',
                lineItems: [{ title: 'Fundraiser contribution', amountCents: 4000 }],
                installments: [],
                ledgerEntries: [],
                notes: 'Ask the team manager for a receipt.'
            }
        ]);

        renderParentTools(['/parent-tools/fees'], false, linkedAuth);

        await screen.findByText('Cash fundraiser fee');
        expect(screen.getByText('Offline payment')).toBeVisible();
        expect(screen.getByText('Bring cash or a check to practice.')).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Pay fee' })).toBeNull();
        expect(screen.queryByText('Line items')).toBeNull();
        expect(screen.queryByText('Ask the team manager for a receipt.')).toBeNull();
        expect(screen.getByRole('button', { name: 'View details' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('shows safe Fees copy instead of raw Firestore index errors', async () => {
        parentToolsServiceMocks.loadParentFeesForApp.mockRejectedValue(new Error('The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/game-flow-c6311/firestore/indexes?create_composite=test'));

        renderParentTools(['/parent-tools/fees'], false, linkedAuth);

        expect(await screen.findByText('Unable to load fees.')).toBeTruthy();
        expect(screen.queryByText(/console\.firebase\.google\.com/)).toBeNull();
        expect(screen.queryByText(/query requires an index/i)).toBeNull();
    });

    it('regenerates stale team fee checkout links instead of opening the stored URL', async () => {
        parentToolsServiceMocks.loadParentFeesForApp.mockResolvedValue([
            {
                id: 'fee-1',
                title: 'Team dues',
                teamId: 'team-1',
                batchId: 'batch-1',
                recipientId: 'recipient-1',
                teamName: 'Bears',
                playerName: 'Sam Player',
                status: 'open',
                amountLabel: '$100',
                dueLabel: 'Today',
                statusLabel: 'Open',
                balanceDueCents: 10000,
                checkoutUrl: 'https://pay.example.test/stale',
                checkoutStatus: 'stale',
                canPay: true,
                checkoutInitiatable: true,
                paymentAction: 'createCheckout',
                lineItems: [],
                installments: [],
                ledgerEntries: []
            }
        ]);
        parentToolsServiceMocks.initiateParentTeamFeeCheckout.mockResolvedValue({
            success: true,
            checkoutUrl: 'https://pay.example.test/fresh'
        });

        renderParentTools(['/parent-tools/fees'], false, linkedAuth);

        await screen.findByText('Team dues');
        fireEvent.click(screen.getByRole('button', { name: 'Pay fee' }));

        await waitFor(() => {
            expect(parentToolsServiceMocks.initiateParentTeamFeeCheckout).toHaveBeenCalledWith('team-1', 'batch-1', 'recipient-1');
        });
        expect(openPublicUrl).toHaveBeenCalledWith('https://pay.example.test/fresh');
        expect(openPublicUrl).not.toHaveBeenCalledWith('https://pay.example.test/stale');
    });

    it('shows deep-linked paid fees from notification query params', async () => {
        parentToolsServiceMocks.loadParentFeesForApp.mockResolvedValue([
            {
                id: 'fee-open',
                title: 'Open fee',
                teamId: 'team-1',
                batchId: 'batch-open',
                recipientId: 'recipient-open',
                teamName: 'Bears',
                playerName: 'Sam Player',
                status: 'open',
                amountLabel: '$50',
                dueLabel: 'Tomorrow',
                statusLabel: 'Open',
                balanceDueCents: 5000,
                canPay: true,
                lineItems: [],
                installments: [],
                ledgerEntries: []
            },
            {
                id: 'fee-paid',
                title: 'Paid fee',
                teamId: 'team-1',
                batchId: 'batch-1',
                recipientId: 'recipient-1',
                teamName: 'Bears',
                playerName: 'Sam Player',
                status: 'paid',
                amountLabel: '$100',
                dueLabel: 'Paid today',
                statusLabel: 'Paid',
                balanceDueCents: 0,
                canPay: false,
                lineItems: [],
                installments: [],
                ledgerEntries: []
            }
        ]);

        renderParentTools(['/parent-tools/fees?teamId=team-1&batchId=batch-1&recipientId=recipient-1'], false, linkedAuth);

        expect(await screen.findByText('Paid fee')).toBeTruthy();
        expect(screen.queryByText('Open fee')).toBeNull();
        expect(screen.getByRole('button', { name: /all/i }).getAttribute('aria-pressed')).toBe('true');
    });

    it('shows deep-linked awards from notification query params', async () => {
        parentToolsServiceMocks.loadParentCertificates.mockResolvedValue([
            {
                id: 'cert-2',
                teamId: 'team-2',
                teamName: 'Falcons',
                playerId: 'player-2',
                playerName: 'Jordan Star',
                title: 'Leadership Award',
                narrative: 'Great teammate.',
                url: 'https://allplays.ai/certificates.html#teamId=team-2&certificateId=cert-2'
            },
            {
                id: 'cert-1',
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Sam Player',
                title: 'Hustle Award',
                narrative: 'Great effort.',
                url: 'https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1'
            }
        ]);

        renderParentTools(['/parent-tools/certificates?teamId=team-1&certificateId=cert-1'], false, linkedAuth);

        expect(await screen.findByText('Hustle Award')).toBeTruthy();
        expect(screen.queryByText('Leadership Award')).toBeNull();
        expect(screen.getByText('Opened from a notification')).toBeTruthy();
        const requestedAwardCard = screen.getByText('Hustle Award').closest('section') as HTMLElement;
        expect(within(requestedAwardCard).getByRole('button', { name: 'View award' })).toBeTruthy();
        expect(within(requestedAwardCard).getByRole('button', { name: 'Share' })).toBeTruthy();
    });

    it('redirects invalid tabs without triggering a hook order violation', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        renderParentTools(['/parent-tools/access'], true);

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Go invalid' }));

        expect(await screen.findByText('Request player access')).toBeTruthy();
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Rendered fewer hooks than expected'));
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('change in the order of Hooks'));

        consoleErrorSpy.mockRestore();
    });

    it('does not rerender inactive visited panels when only the active tab changes', async () => {
        parentToolsServiceMocks.loadParentFeesForApp.mockResolvedValue([
            {
                id: 'fee-1',
                title: 'Team dues',
                teamId: 'team-1',
                teamName: 'Bears',
                playerName: 'Sam Player',
                status: 'open',
                amountLabel: '$100',
                dueLabel: 'Today',
                statusLabel: 'Open',
                balanceDueCents: 10000,
                canPay: false,
                lineItems: [],
                installments: [],
                ledgerEntries: []
            }
        ]);
        parentToolsServiceMocks.loadParentCalendarTools.mockResolvedValue({
            events: [],
            teams: []
        });

        const renderCounts: Record<string, number> = {};
        globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__ = (toolId) => {
            renderCounts[toolId] = (renderCounts[toolId] || 0) + 1;
        };

        renderParentTools(['/parent-tools/access'], false, linkedAuth);

        await screen.findByText('Request player access');
        expect(renderCounts.access).toBe(1);

        fireEvent.click(screen.getByRole('button', { name: 'Fees' }));
        await screen.findByText('Team dues');
        expect(renderCounts.fees).toBe(1);
        expect(renderCounts.access).toBe(1);

        fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
        await screen.findByText('No team schedules');
        expect(renderCounts.calendar).toBe(1);
        expect(renderCounts.fees).toBe(1);
        expect(renderCounts.access).toBe(1);

        fireEvent.click(screen.getByRole('button', { name: 'Fees' }));
        await screen.findByText('Team dues');
        expect(renderCounts.fees).toBe(1);
        expect(renderCounts.calendar).toBe(1);
        expect(renderCounts.access).toBe(1);
    });

    it('does not refetch visited panels for cloned same-user auth state', async () => {
        parentToolsServiceMocks.loadParentFeesForApp.mockResolvedValue([]);
        parentToolsServiceMocks.loadParentRegistrations.mockResolvedValue([]);
        parentToolsServiceMocks.loadParentCertificates.mockResolvedValue([]);
        const renderCounts: Record<string, number> = {};
        globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__ = (toolId) => {
            renderCounts[toolId] = (renderCounts[toolId] || 0) + 1;
        };

        const view = renderParentTools(['/parent-tools/access'], false, linkedAuth);

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Fees' }));
        await screen.findByText('No fees in this view');
        fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
        await screen.findByText('No team schedules');
        fireEvent.click(screen.getByRole('button', { name: 'Household' }));
        await screen.findByText('No pending household invites');
        fireEvent.click(screen.getByRole('button', { name: 'Share' }));
        await screen.findByText('No family links');
        fireEvent.click(screen.getByRole('button', { name: 'Register' }));
        await screen.findByText('No open registrations');
        fireEvent.click(screen.getByRole('button', { name: 'Awards' }));
        await screen.findByText('No published awards');

        const serviceCountsBeforeRehydrate = {
            fees: parentToolsServiceMocks.loadParentFeesForApp.mock.calls.length,
            calendar: parentToolsServiceMocks.loadParentCalendarTools.mock.calls.length,
            household: parentToolsServiceMocks.loadParentHouseholdInviteModel.mock.calls.length,
            share: parentToolsServiceMocks.loadFamilyShareModel.mock.calls.length,
            registrations: parentToolsServiceMocks.loadParentRegistrations.mock.calls.length,
            certificates: parentToolsServiceMocks.loadParentCertificates.mock.calls.length
        };
        expect(serviceCountsBeforeRehydrate).toEqual({
            fees: 1,
            calendar: 1,
            household: 1,
            share: 1,
            registrations: 1,
            certificates: 1
        });
        expect(renderCounts).toMatchObject({
            access: 1,
            fees: 1,
            calendar: 1,
            household: 1,
            share: 1,
            registrations: 1,
            certificates: 1
        });

        const clonedLinkedAuth: AuthState = {
            ...linkedAuth,
            user: linkedAuth.user ? {
                ...linkedAuth.user,
                parentOf: linkedAuth.user.parentOf?.map((link) => ({ ...link }))
            } : null
        };
        view.rerender(
            <MemoryRouter initialEntries={['/parent-tools/access']}>
                <Routes>
                    <Route path="/parent-tools/:toolId" element={<ParentToolsRoute authState={clonedLinkedAuth} />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('No published awards')).toBeTruthy());
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.fees);
        expect(parentToolsServiceMocks.loadParentCalendarTools).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.calendar);
        expect(parentToolsServiceMocks.loadParentHouseholdInviteModel).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.household);
        expect(parentToolsServiceMocks.loadFamilyShareModel).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.share);
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.registrations);
        expect(parentToolsServiceMocks.loadParentCertificates).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.certificates);
        expect(renderCounts).toMatchObject({
            access: 1,
            fees: 1,
            calendar: 1,
            household: 1,
            share: 1,
            registrations: 1,
            certificates: 1
        });

        const changedParentLinksAuth: AuthState = {
            ...linkedAuth,
            user: linkedAuth.user ? {
                ...linkedAuth.user,
                parentOf: [
                    ...(linkedAuth.user.parentOf || []),
                    { teamId: 'team-2', playerId: 'player-2' }
                ]
            } : null
        };
        view.rerender(
            <MemoryRouter initialEntries={['/parent-tools/access']}>
                <Routes>
                    <Route path="/parent-tools/:toolId" element={<ParentToolsRoute authState={changedParentLinksAuth} />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(parentToolsServiceMocks.loadParentCertificates).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.certificates + 1));
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.fees + 1);
        expect(parentToolsServiceMocks.loadParentCalendarTools).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.calendar + 1);
        expect(parentToolsServiceMocks.loadParentHouseholdInviteModel).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.household + 1);
        expect(parentToolsServiceMocks.loadFamilyShareModel).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.share + 1);
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.registrations + 1);

        const registrationManagerAuth: AuthState = {
            ...changedParentLinksAuth,
            roles: ['parent', 'coach'],
            isCoach: true,
            user: changedParentLinksAuth.user ? {
                ...changedParentLinksAuth.user,
                roles: ['parent', 'coach'],
                coachOf: ['team-3']
            } : null
        };
        view.rerender(
            <MemoryRouter initialEntries={['/parent-tools/access']}>
                <Routes>
                    <Route path="/parent-tools/:toolId" element={<ParentToolsRoute authState={registrationManagerAuth} />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(serviceCountsBeforeRehydrate.registrations + 2));
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenLastCalledWith(expect.objectContaining({
            coachOf: ['team-3'],
            roles: ['parent', 'coach']
        }));
    });

    it('defers hidden fees refresh after access changes until fees is reopened', async () => {
        parentToolsServiceMocks.loadParentFeesForApp
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: 'fee-1',
                    title: 'Team dues',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    playerName: 'Sam Player',
                    status: 'open',
                    amountLabel: '$100',
                    dueLabel: 'Today',
                    statusLabel: 'Open',
                    balanceDueCents: 10000,
                    canPay: false,
                    lineItems: [],
                    installments: [],
                    ledgerEntries: []
                }
            ]);

        renderParentTools(['/parent-tools/access'], false, linkedAuth);

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Fees' }));
        await screen.findByText('No fees in this view');
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Access' }));
        await screen.findByText('Request player access');
        fireEvent.change(screen.getByPlaceholderText('XXXXXXXX'), { target: { value: 'ab12cd34' } });
        fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));
        expect(await screen.findByText('Invite accepted.')).toBeTruthy();
        await waitFor(() => expect(parentToolsAccessServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(2));
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Fees' }));
        expect(await screen.findByText('Team dues')).toBeTruthy();
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(2);
    });

    it('forces a calendar reload after access changes update linked players', async () => {
        parentToolsServiceMocks.loadParentCalendarTools
            .mockResolvedValueOnce({
                events: [],
                teams: []
            })
            .mockResolvedValueOnce({
                events: [
                    {
                        id: 'event-1',
                        teamId: 'team-1',
                        teamName: 'Bears',
                        type: 'game',
                        date: new Date('2100-06-01T18:00:00Z')
                    }
                ],
                teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 1 }]
            });

        renderParentTools(['/parent-tools/access'], false, linkedAuth);

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
        await screen.findByText('No team schedules');
        expect(parentToolsServiceMocks.loadParentCalendarTools).toHaveBeenNthCalledWith(1, linkedAuth.user, {});

        fireEvent.click(screen.getByRole('button', { name: 'Access' }));
        await screen.findByText('Request player access');
        fireEvent.change(screen.getByPlaceholderText('XXXXXXXX'), { target: { value: 'ab12cd34' } });
        fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));
        expect(await screen.findByText('Invite accepted.')).toBeTruthy();
        await waitFor(() => expect(parentToolsAccessServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(2));

        fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
        expect(await screen.findByText('Bears')).toBeTruthy();
        expect(parentToolsServiceMocks.loadParentCalendarTools).toHaveBeenNthCalledWith(2, linkedAuth.user, { force: true });
    });

    it('refreshes the currently viewed dependent tab when access changes finish after navigation', async () => {
        let resolveRedeem: ((value: { code: string; redirectPath: string; message: string }) => void) | undefined;
        inviteRedemptionMocks.redeemSignedInInvite.mockImplementationOnce(() => new Promise<{ code: string; redirectPath: string; message: string }>((resolve) => {
            resolveRedeem = resolve;
        }));
        parentToolsServiceMocks.loadParentRegistrations
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: 'form-1',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    programName: 'Summer Camp',
                    description: 'Skills week',
                    season: 'Summer',
                    feeLabel: '$75.00',
                    paymentNotice: '',
                    onlineCheckout: true,
                    options: [],
                    url: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1'
                }
            ]);

        renderParentTools(['/parent-tools/access'], false, linkedAuth);

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Register' }));
        await screen.findByText('No open registrations');
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Access' }));
        await screen.findByText('Request player access');
        fireEvent.change(screen.getByPlaceholderText('XXXXXXXX'), { target: { value: 'ab12cd34' } });
        fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));

        fireEvent.click(screen.getByRole('button', { name: 'Register' }));
        await screen.findByText('No open registrations');
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        resolveRedeem?.({
            code: 'AB12CD34',
            redirectPath: '/home',
            message: 'Invite accepted.'
        });

        expect(await screen.findByText('Summer Camp')).toBeTruthy();
        await waitFor(() => expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(2));
    });

    it('shows a retryable registrations load error and refreshes the section on retry', async () => {
        parentToolsServiceMocks.loadParentRegistrations
            .mockRejectedValueOnce(new Error('Registration service unavailable.'))
            .mockResolvedValueOnce([
                {
                    id: 'form-1',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    programName: 'Spring Skills',
                    description: 'Sunday clinic',
                    season: 'Spring',
                    feeLabel: '$50.00',
                    paymentNotice: '',
                    onlineCheckout: true,
                    options: [],
                    url: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1'
                }
            ]);

        renderParentTools(['/parent-tools/registrations'], false, linkedAuth);

        expect(await screen.findByText('Registration service unavailable.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        expect(await screen.findByText('Spring Skills')).toBeTruthy();
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(2);
    });

    it('restores the registrations tab and list after native back from registration detail', async () => {
        parentToolsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
            {
                id: 'form-1',
                teamId: 'team-1',
                teamName: 'Bears',
                programName: 'Summer Camp',
                description: 'Skills week',
                season: 'Summer',
                feeLabel: '$75.00',
                paymentNotice: '',
                onlineCheckout: true,
                options: [],
                url: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1'
            }
        ]);
        const nativeBackTarget = getNativeBackTarget('/parent-tools/registrations/team-1/form-1');

        expect(nativeBackTarget).toBe('/parent-tools/registrations');
        renderParentTools([nativeBackTarget!], false, linkedAuth);

        expect(await screen.findByText('Summer Camp')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Register' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Access' })).toHaveAttribute('aria-pressed', 'false');
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledWith(linkedAuth.user);
    });

    it('defers public team and player loading until manual access starts', async () => {
        renderParentTools();

        await screen.findByText('Request player access');
        expect(parentToolsAccessServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).not.toHaveBeenCalled();
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Request access without a code' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Request access without a code' }));
        expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
        await screen.findByRole('option', { name: 'Bears - Soccer' });
        expect(parentToolsAccessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(1);
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'team-1' } });
        await screen.findByRole('option', { name: '#12 Sam Player' });
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledTimes(1);
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-1');
    });
});
