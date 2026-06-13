// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParentTools } from './ParentTools';
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
    loadParentAccessModel: vi.fn(),
    loadParentAccessTeams: vi.fn(),
    loadParentAccessPlayers: vi.fn(),
    loadParentCalendarTools: vi.fn(),
    loadParentCertificates: vi.fn(),
    loadParentFeesForApp: vi.fn(),
    loadParentHouseholdInviteModel: vi.fn(),
    loadParentRegistrations: vi.fn(),
    revokeParentFamilyShare: vi.fn(),
    submitParentAccessRequest: vi.fn(),
    updateParentFamilyShareCalendars: vi.fn()
}));

const inviteRedemptionMocks = vi.hoisted(() => ({
    redeemSignedInInvite: vi.fn()
}));

vi.mock('../lib/parentToolsService', () => parentToolsServiceMocks);
vi.mock('../lib/inviteRedemption', () => inviteRedemptionMocks);
vi.mock('../lib/publicActions', () => ({
    openPublicUrl: vi.fn(),
    sharePublicUrl: vi.fn()
}));

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

function ParentToolsRoute() {
    return <ParentTools auth={auth} />;
}

function InvalidParentToolsButton() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate('/parent-tools/not-a-real-tab')}>Go invalid</button>;
}

function renderParentTools(initialEntries: string[] = ['/parent-tools/access'], includeInvalidButton = false) {
    return render(
        <MemoryRouter initialEntries={initialEntries}>
            <Routes>
                <Route
                    path="/parent-tools/:toolId"
                    element={(
                        <>
                            {includeInvalidButton ? <InvalidParentToolsButton /> : null}
                            <ParentToolsRoute />
                        </>
                    )}
                />
                <Route path="/accept-invite" element={<div>Accept invite route</div>} />
            </Routes>
        </MemoryRouter>
    );
}

describe('ParentTools access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__;
        parentToolsServiceMocks.loadParentAccessModel.mockResolvedValue({
            requests: []
        });
        parentToolsServiceMocks.loadParentAccessTeams.mockResolvedValue([
            { id: 'team-1', name: 'Bears', sport: 'Soccer' }
        ]);
        parentToolsServiceMocks.loadParentAccessPlayers.mockResolvedValue([
            { id: 'player-1', name: 'Sam Player', number: '12' }
        ]);
        parentToolsServiceMocks.submitParentAccessRequest.mockResolvedValue(undefined);
        inviteRedemptionMocks.redeemSignedInInvite.mockResolvedValue({
            code: 'AB12CD34',
            redirectPath: '/home',
            message: 'Invite accepted.'
        });
    });

    afterEach(() => {
        delete globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__;
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

    it('opens the manual request form immediately while public teams finish loading', async () => {
        type PublicTeamRow = { id: string; name: string; sport: string };
        const deferredTeams: { resolve: ((value: PublicTeamRow[]) => void) | null } = { resolve: null };
        parentToolsServiceMocks.loadParentAccessTeams.mockImplementation(() => new Promise<PublicTeamRow[]>((resolve) => {
            deferredTeams.resolve = resolve;
        }));
        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Request access without a code' }));

        const teamSelect = screen.getByRole('combobox', { name: 'Team' }) as HTMLSelectElement;
        const playerSelect = screen.getByRole('combobox', { name: 'Player' }) as HTMLSelectElement;
        expect(teamSelect).toBeTruthy();
        expect(playerSelect).toBeTruthy();
        expect(teamSelect.disabled).toBe(true);
        expect(playerSelect.disabled).toBe(true);
        expect(parentToolsServiceMocks.loadParentAccessTeams).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Request access without a code' })).toBeNull();
        expect(screen.getByRole('option', { name: 'Loading public teams...' })).toBeTruthy();

        await waitFor(() => expect(deferredTeams.resolve).toBeTruthy());
        if (!deferredTeams.resolve) throw new Error('Expected public teams loader to be pending.');
        deferredTeams.resolve([{ id: 'team-1', name: 'Bears', sport: 'Soccer' }]);

        expect(await screen.findByRole('option', { name: 'Bears - Soccer' })).toBeTruthy();
        expect((screen.getByLabelText('Team') as HTMLSelectElement).disabled).toBe(false);
    });

    it('allows retry when public team loading fails after opening manual requests', async () => {
        parentToolsServiceMocks.loadParentAccessTeams
            .mockRejectedValueOnce(new Error('Network hiccup.'))
            .mockResolvedValueOnce([{ id: 'team-1', name: 'Bears', sport: 'Soccer' }]);
        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Request access without a code' }));

        expect(await screen.findByText('Network hiccup.')).toBeTruthy();
        const retryButton = screen.getByRole('button', { name: 'Retry loading public teams' });
        expect(retryButton).toBeTruthy();
        fireEvent.click(retryButton);

        expect(await screen.findByRole('option', { name: 'Bears - Soccer' })).toBeTruthy();
        expect(parentToolsServiceMocks.loadParentAccessTeams).toHaveBeenCalledTimes(2);
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
        expect(parentToolsServiceMocks.submitParentAccessRequest).toHaveBeenCalledWith('team-1', 'player-1', 'Parent');

        const requestsSection = screen.getByText('Access requests').closest('section');
        expect(requestsSection).toBeTruthy();
        if (!requestsSection) throw new Error('Requests section not found');
        expect(within(requestsSection).getByText('No requests yet')).toBeTruthy();
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

        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Fees' }));
        await screen.findByText('Team dues');
        expect(parentToolsServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        expect(parentToolsServiceMocks.loadParentAccessTeams).not.toHaveBeenCalled();
        expect(parentToolsServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Access' }));
        await screen.findByText('Request player access');
        expect(parentToolsServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        expect(parentToolsServiceMocks.loadParentAccessTeams).not.toHaveBeenCalled();
        expect(parentToolsServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();

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

    it('refreshes cached tool data after access changes update parent links', async () => {
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

        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Register' }));
        await screen.findByText('No open registrations');
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Access' }));
        await screen.findByText('Request player access');
        fireEvent.change(screen.getByPlaceholderText('XXXXXXXX'), { target: { value: 'ab12cd34' } });
        fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));
        expect(await screen.findByText('Invite accepted.')).toBeTruthy();
        await waitFor(() => expect(parentToolsServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(2));
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Register' }));
        expect(await screen.findByText('Summer Camp')).toBeTruthy();
        expect(parentToolsServiceMocks.loadParentRegistrations).toHaveBeenCalledTimes(2);
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

        renderParentTools(['/parent-tools/fees']);

        await screen.findByText('Team dues');
        fireEvent.click(screen.getByRole('button', { name: 'Pay fee' }));

        await waitFor(() => {
            expect(openPublicUrl).toHaveBeenCalledWith('https://pay.example.test/legacy');
        });
        expect(parentToolsServiceMocks.initiateParentTeamFeeCheckout).not.toHaveBeenCalled();
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

        renderParentTools(['/parent-tools/fees']);

        await screen.findByText('Team dues');
        fireEvent.click(screen.getByRole('button', { name: 'Pay fee' }));

        await waitFor(() => {
            expect(parentToolsServiceMocks.initiateParentTeamFeeCheckout).toHaveBeenCalledWith('team-1', 'batch-1', 'recipient-1');
        });
        expect(openPublicUrl).toHaveBeenCalledWith('https://pay.example.test/fresh');
        expect(openPublicUrl).not.toHaveBeenCalledWith('https://pay.example.test/stale');
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

        renderParentTools();

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

        renderParentTools();

        await screen.findByText('Request player access');
        fireEvent.click(screen.getByRole('button', { name: 'Fees' }));
        await screen.findByText('No fees in this view');
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Access' }));
        await screen.findByText('Request player access');
        fireEvent.change(screen.getByPlaceholderText('XXXXXXXX'), { target: { value: 'ab12cd34' } });
        fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));
        expect(await screen.findByText('Invite accepted.')).toBeTruthy();
        await waitFor(() => expect(parentToolsServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(2));
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Fees' }));
        expect(await screen.findByText('Team dues')).toBeTruthy();
        expect(parentToolsServiceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(2);
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

        renderParentTools();

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

    it('defers public team and player loading until manual access starts', async () => {
        renderParentTools();

        await screen.findByText('Request player access');
        expect(parentToolsServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        expect(parentToolsServiceMocks.loadParentAccessTeams).not.toHaveBeenCalled();
        expect(parentToolsServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Request access without a code' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Request access without a code' }));
        await screen.findByRole('option', { name: 'Bears - Soccer' });
        expect(parentToolsServiceMocks.loadParentAccessTeams).toHaveBeenCalledTimes(1);
        expect(parentToolsServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'team-1' } });
        await screen.findByRole('option', { name: '#12 Sam Player' });
        expect(parentToolsServiceMocks.loadParentAccessPlayers).toHaveBeenCalledTimes(1);
        expect(parentToolsServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-1');
    });
});
