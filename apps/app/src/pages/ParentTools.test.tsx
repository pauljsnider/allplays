// @vitest-environment jsdom
import { useCallback, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParentTools, type ParentToolId } from './ParentTools';
import type { AuthState } from '../lib/types';
import { openPublicUrl } from '../lib/publicActions';

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
    loadParentAccessTeams: vi.fn(),
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

describe('ParentTools access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__;
        delete globalThis.__ALLPLAYS_PARENT_TOOLS_PANEL_LOAD_TRACKER__;
        parentToolsAccessServiceMocks.loadParentAccessModel.mockResolvedValue({
            requests: []
        });
        parentToolsAccessServiceMocks.loadParentAccessTeams.mockResolvedValue([
            { id: 'team-1', name: 'Bears', sport: 'Soccer' }
        ]);
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
        delete globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__;
        delete globalThis.__ALLPLAYS_PARENT_TOOLS_PANEL_LOAD_TRACKER__;
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

    it('opens the manual request form immediately while public teams finish loading', async () => {
        type PublicTeamRow = { id: string; name: string; sport: string };
        const deferredTeams: { resolve: ((value: PublicTeamRow[]) => void) | null } = { resolve: null };
        let loadStartedAfterFormRendered = false;
        parentToolsAccessServiceMocks.loadParentAccessTeams.mockImplementation(() => {
            loadStartedAfterFormRendered = Boolean(screen.queryByRole('combobox', { name: 'Team' }));
            return new Promise<PublicTeamRow[]>((resolve) => {
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
        expect(parentToolsAccessServiceMocks.loadParentAccessTeams).toHaveBeenCalledTimes(1);
        expect(loadStartedAfterFormRendered).toBe(true);
        expect(screen.queryByRole('button', { name: 'Request access without a code' })).toBeNull();
        expect(screen.getByRole('option', { name: 'Loading public teams...' })).toBeTruthy();

        await waitFor(() => expect(deferredTeams.resolve).toBeTruthy());
        if (!deferredTeams.resolve) throw new Error('Expected public teams loader to be pending.');
        deferredTeams.resolve([{ id: 'team-1', name: 'Bears', sport: 'Soccer' }]);

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
        await waitFor(() => expect(parentToolsAccessServiceMocks.loadParentAccessTeams).toHaveBeenCalledTimes(1));

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
        expect(parentToolsAccessServiceMocks.loadParentAccessTeams).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Request access without a code' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Redeem code' })).toBeTruthy();
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();
    });

    it('allows retry when public team loading fails after opening manual requests', async () => {
        parentToolsAccessServiceMocks.loadParentAccessTeams
            .mockRejectedValueOnce(new Error('Network hiccup.'))
            .mockResolvedValueOnce([{ id: 'team-1', name: 'Bears', sport: 'Soccer' }]);
        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Request access without a code' }));

        expect(await screen.findByText('Network hiccup.')).toBeTruthy();
        const retryButton = screen.getByRole('button', { name: 'Retry' });
        expect(retryButton).toBeTruthy();
        fireEvent.click(retryButton);

        expect(await screen.findByRole('option', { name: 'Bears - Soccer' })).toBeTruthy();
        expect(parentToolsAccessServiceMocks.loadParentAccessTeams).toHaveBeenCalledTimes(2);
    });

    it('still submits request access after the redeem panel is added', async () => {
        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Request access without a code' }));
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
        expect(parentToolsAccessServiceMocks.loadParentAccessTeams).not.toHaveBeenCalled();
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Access' }));
        await screen.findByText('Request player access');
        expect(parentToolsAccessServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        expect(parentToolsAccessServiceMocks.loadParentAccessTeams).not.toHaveBeenCalled();
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
                    url: 'https://allplays.ai/family.html?token=token-1',
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
        expect(screen.getByText('https://allplays.ai/family.html?token=token-1')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
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
        expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
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

    it('defers public team and player loading until manual access starts', async () => {
        renderParentTools();

        await screen.findByText('Request player access');
        expect(parentToolsAccessServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        expect(parentToolsAccessServiceMocks.loadParentAccessTeams).not.toHaveBeenCalled();
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Request access without a code' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Request access without a code' }));
        await screen.findByRole('option', { name: 'Bears - Soccer' });
        expect(parentToolsAccessServiceMocks.loadParentAccessTeams).toHaveBeenCalledTimes(1);
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'team-1' } });
        await screen.findByRole('option', { name: '#12 Sam Player' });
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledTimes(1);
        expect(parentToolsAccessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-1');
    });
});
