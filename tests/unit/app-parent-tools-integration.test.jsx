// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const serviceMocks = vi.hoisted(() => ({
    addParentTeamMediaLink: vi.fn(),
    buildParentScheduleIcs: vi.fn(() => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'),
    createParentFamilyShare: vi.fn(),
    createParentHouseholdMemberInvite: vi.fn(),
    createTeamMediaAlbumForApp: vi.fn(),
    downloadIcs: vi.fn(),
    getAppleCalendarFeedUrl: vi.fn((url) => `webcal://${url.replace(/^https?:\/\//, '')}`),
    getCalendarEventShareText: vi.fn((event) => `${event.teamName} ${event.title || event.opponent}`),
    getGoogleCalendarFeedUrl: vi.fn((url) => `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(url)}`),
    getPrivateTeamCalendarFeedUrl: vi.fn(),
    initiateParentTeamFeeCheckout: vi.fn(),
    loadFamilyShareModel: vi.fn(),
    loadParentAccessModel: vi.fn(),
    loadParentAccessPlayers: vi.fn(),
    loadParentCalendarTools: vi.fn(),
    loadParentCertificates: vi.fn(),
    loadParentFeesForApp: vi.fn(),
    loadParentHouseholdInviteModel: vi.fn(),
    loadParentRegistrations: vi.fn(),
    loadTeamMediaForApp: vi.fn(),
    revokeParentFamilyShare: vi.fn(),
    submitParentAccessRequest: vi.fn(),
    updateParentFamilyShareCalendars: vi.fn(),
    uploadParentTeamMediaFile: vi.fn(),
    uploadParentTeamMediaPhoto: vi.fn()
}));

const publicActionMocks = vi.hoisted(() => ({
    exportCalendarIcsFile: vi.fn().mockResolvedValue('downloaded'),
    openPublicUrl: vi.fn(),
    sharePublicUrl: vi.fn().mockResolvedValue('shared')
}));

vi.mock('../../apps/app/src/lib/parentToolsService.ts', () => serviceMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);

import { ParentTools } from '../../apps/app/src/pages/ParentTools.tsx';
import { TeamMedia } from '../../apps/app/src/pages/TeamMedia.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        parentOf: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', teamName: 'Bears' }]
    },
    profile: {},
    loading: false,
    error: null,
    roles: ['parent'],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: async () => {},
    signOut: async () => {}
};

async function renderParentTools(initialEntry = '/parent-tools/access') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: [initialEntry] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: '/parent-tools', element: React.createElement(ParentTools, { auth }) }),
                React.createElement(Route, { path: '/parent-tools/:toolId', element: React.createElement(ParentTools, { auth }) }),
                React.createElement(Route, { path: '/teams/:teamId/media', element: React.createElement(TeamMedia, { auth }) })
            )
        ));
    });

    await flush();
    return { container, root };
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function waitForText(container, text) {
    for (let index = 0; index < 30; index += 1) {
        if (container.textContent.includes(text)) return;
        await flush();
    }
    throw new Error(`Timed out waiting for text: ${text}`);
}

async function clickButton(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.trim().includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
}

async function clickButtonWithin(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.trim().includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
}

async function submitForm(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.trim().includes(text));
    if (!button) throw new Error(`Submit button not found: ${text}`);
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
}

async function changeValue(element, value) {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
        if (setter) {
            setter.call(element, value);
        } else {
            element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
}

async function changeSelectValue(element, value) {
    await act(async () => {
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
}

beforeEach(() => {
    vi.clearAllMocks();
    window.requestAnimationFrame = (callback) => {
        callback(0);
        return 0;
    };
    window.scrollTo = vi.fn();
    Object.assign(navigator, {
        clipboard: {
            writeText: vi.fn().mockResolvedValue()
        }
    });
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();

    serviceMocks.loadParentAccessModel.mockResolvedValue({
        teams: [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }],
        requests: [{ id: 'request-1', teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', relation: 'Parent', status: 'pending' }]
    });
    serviceMocks.loadParentAccessPlayers.mockResolvedValue([{ id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null }]);
    serviceMocks.submitParentAccessRequest.mockResolvedValue({ success: true });
    serviceMocks.loadParentHouseholdInviteModel.mockResolvedValue({
        linkedPlayers: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9' }],
        members: [{ id: 'member-1', email: 'grandma@example.com', displayName: 'Grandma', relation: 'Grandparent', status: 'pending', teamName: 'Bears', playerName: 'Pat Star', playerNumber: '9', accessCode: 'HOME1234', inviteUrl: 'https://allplays.ai/accept-invite.html?code=HOME1234' }]
    });
    serviceMocks.createParentHouseholdMemberInvite.mockResolvedValue({ code: 'HOME5678', inviteUrl: 'https://allplays.ai/accept-invite.html?code=HOME5678' });
    serviceMocks.loadParentFeesForApp.mockResolvedValue([{
        id: 'fee-1',
        title: 'Team dues',
        teamId: 'team-1',
        teamName: 'Bears',
        playerName: 'Pat Star',
        status: 'open',
        amountLabel: '$120',
        dueLabel: 'Jun 1',
        statusLabel: 'Open',
        balanceDueCents: 12000,
        checkoutUrl: 'https://pay.example.test/fee',
        canPay: true,
        lineItems: [{ title: 'Season', amountCents: 12000 }],
        installments: [{ label: 'Deposit', amountCents: 6000 }],
        ledgerEntries: [{ label: 'Adjustment', amountCents: -1000 }]
    }]);
    serviceMocks.loadParentCalendarTools.mockResolvedValue({
        events: [{ teamId: 'team-1', teamName: 'Bears', title: 'Practice', opponent: '', date: new Date('2100-06-01T18:00:00Z') }],
        teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 1 }]
    });
    serviceMocks.getPrivateTeamCalendarFeedUrl.mockResolvedValue('https://feed.example.test/team-1.ics');
    serviceMocks.initiateParentTeamFeeCheckout.mockResolvedValue({ success: true, checkoutUrl: 'https://pay.example.test/created-fee' });
    serviceMocks.loadFamilyShareModel.mockResolvedValue({
        children: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star' }],
        tokens: [{ id: 'token-1', label: 'Grandma', url: 'https://allplays.ai/family.html?token=token-1', childCount: 1, extraCalendarUrls: [] }]
    });
    serviceMocks.createParentFamilyShare.mockResolvedValue({ tokenId: 'token-2', url: 'https://allplays.ai/family.html?token=token-2' });
    serviceMocks.revokeParentFamilyShare.mockResolvedValue();
    serviceMocks.updateParentFamilyShareCalendars.mockResolvedValue();
    serviceMocks.loadParentRegistrations.mockResolvedValue([{
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        description: 'Skills week',
        season: 'Summer',
        feeLabel: '$75.00',
        paymentNotice: 'Online checkout available.',
        onlineCheckout: true,
        options: [{ id: 'opt-1' }],
        url: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1'
    }]);
    serviceMocks.loadParentCertificates.mockResolvedValue([{
        id: 'cert-1',
        teamId: 'team-1',
        teamName: 'Bears',
        playerId: 'player-1',
        playerName: 'Pat Star',
        title: 'Hustle Award',
        narrative: 'Great effort.',
        url: 'https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1'
    }]);
    serviceMocks.loadTeamMediaForApp.mockResolvedValue({
        team: { id: 'team-1', name: 'Bears' },
        canManage: false,
        canContribute: true,
        folders: [{
            id: 'folder-1',
            name: 'Game photos',
            visibility: 'team',
            itemCount: 1,
            items: [{ id: 'photo-1', title: 'Tipoff', type: 'photo', url: 'https://img.example.test/tipoff.jpg' }]
        }]
    });
    serviceMocks.uploadParentTeamMediaPhoto.mockResolvedValue('photo-2');
    serviceMocks.uploadParentTeamMediaFile.mockResolvedValue('file-1');
    serviceMocks.addParentTeamMediaLink.mockResolvedValue('link-1');
    serviceMocks.createTeamMediaAlbumForApp.mockResolvedValue('folder-new');
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('React app parent tools integration', () => {
    it('drives access, household, fee, calendar, share, registration, and award workflows from one hub', async () => {
        const { container } = await renderParentTools('/parent-tools/access');
        await waitForText(container, 'Request player access');
        expect(container.textContent).toContain('Access requests');
        await submitForm(container, 'Send request');
        expect(serviceMocks.submitParentAccessRequest).toHaveBeenCalledWith('team-1', 'player-1', 'Parent');

        await clickButton(container, 'Household');
        await waitForText(container, 'Household member invite');
        expect(container.textContent).toContain('Grandma');
        const householdEmail = container.querySelector('input[placeholder="Household contact email"]');
        const householdRelation = container.querySelector('input[placeholder^="Relation"]');
        await changeValue(householdEmail, 'aunt@example.com');
        await changeValue(householdRelation, 'Aunt');
        await submitForm(container, 'Create household invite');
        expect(serviceMocks.createParentHouseholdMemberInvite).toHaveBeenCalledWith(auth.user, {
            playerKey: 'team-1::player-1',
            displayName: '',
            email: 'aunt@example.com',
            relation: 'Aunt'
        });
        expect(container.textContent).toContain('HOME5678');

        await clickButton(container, 'Fees');
        await waitForText(container, 'Team dues');
        expect(container.textContent).toContain('Line items');
        await clickButton(container, 'Pay fee');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://pay.example.test/fee');
        expect(serviceMocks.initiateParentTeamFeeCheckout).not.toHaveBeenCalled();

        await clickButton(container, 'Calendar');
        await waitForText(container, 'Calendar tools');
        await clickButton(container, 'Download .ics');
        expect(publicActionMocks.exportCalendarIcsFile).toHaveBeenCalledWith('all-plays-family-schedule.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');
        expect(container.textContent).toContain('Calendar file ready to share.');
        await clickButton(container, 'Copy agenda');
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Bears Practice');
        await clickButton(container, 'Apple');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('webcal://feed.example.test/team-1.ics');

        await clickButton(container, 'Share');
        await waitForText(container, 'Family share');
        const labelInput = container.querySelector('input[placeholder^="Label"]');
        await changeValue(labelInput, 'Grandpa');
        await submitForm(container, 'Create share link');
        expect(serviceMocks.createParentFamilyShare).toHaveBeenCalledWith(auth.user, 'Grandpa', []);
        await clickButton(container, 'Revoke');
        expect(serviceMocks.revokeParentFamilyShare).not.toHaveBeenCalled();
        const confirmDialog = container.querySelector('[role="dialog"]');
        expect(confirmDialog?.textContent).toContain('Anyone using the family share link for Grandma will lose access.');
        await clickButtonWithin(confirmDialog, 'Revoke link');
        expect(serviceMocks.revokeParentFamilyShare).toHaveBeenCalledWith('token-1');

        await clickButton(container, 'Register');
        await waitForText(container, 'Summer Camp');
        const reviewLink = Array.from(container.querySelectorAll('a')).find((link) => link.textContent.trim() === 'Review');
        expect(reviewLink?.getAttribute('href')).toBe('/parent-tools/registrations/team-1/form-1');
        await clickButton(container, 'Legacy form');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/registration.html?teamId=team-1&formId=form-1');

        await clickButton(container, 'Awards');
        await waitForText(container, 'Hustle Award');
        const awardShareButton = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent.trim() === 'Share').at(-1);
        await act(async () => {
            awardShareButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        await flush();
        expect(publicActionMocks.sharePublicUrl).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Hustle Award',
            url: 'https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1'
        }));
    });

    it('keeps previously opened parent tool tabs warm until a tab refresh is requested', async () => {
        const { container } = await renderParentTools('/parent-tools/access');
        await waitForText(container, 'Request player access');
        expect(serviceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        expect(serviceMocks.loadParentAccessPlayers).toHaveBeenCalledTimes(1);

        await clickButton(container, 'Fees');
        await waitForText(container, 'Team dues');
        expect(serviceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);

        await clickButton(container, 'Access');
        await waitForText(container, 'Request player access');
        expect(serviceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1);
        expect(serviceMocks.loadParentAccessPlayers).toHaveBeenCalledTimes(1);

        await clickButton(container, 'Register');
        await waitForText(container, 'Summer Camp');
        expect(serviceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        await clickButton(container, 'Awards');
        await waitForText(container, 'Hustle Award');
        expect(serviceMocks.loadParentCertificates).toHaveBeenCalledTimes(1);

        await clickButton(container, 'Register');
        await waitForText(container, 'Summer Camp');
        expect(serviceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);
        expect(container.textContent).not.toContain('Loading registrations');

        const refreshButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.trim().includes('Refresh') && !button.closest('[hidden]'));
        if (!refreshButton) throw new Error('Visible refresh button not found');
        await act(async () => {
            refreshButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        await flush();
        await waitForText(container, 'Summer Camp');
        expect(serviceMocks.loadParentRegistrations).toHaveBeenCalledTimes(2);
        expect(serviceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);
    });

    it('defers hidden parent tool refreshes after access changes until each tab is reopened', async () => {
        const { container } = await renderParentTools('/parent-tools/access');
        await waitForText(container, 'Request player access');

        await clickButton(container, 'Fees');
        await waitForText(container, 'Team dues');
        await clickButton(container, 'Register');
        await waitForText(container, 'Summer Camp');
        expect(serviceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);
        expect(serviceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        await clickButton(container, 'Access');
        await waitForText(container, 'Request player access');
        await submitForm(container, 'Send request');
        await waitForText(container, 'Access request sent.');
        expect(serviceMocks.loadParentAccessModel).toHaveBeenCalledTimes(2);
        expect(serviceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);
        expect(serviceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        await clickButton(container, 'Register');
        await waitForText(container, 'Summer Camp');
        expect(serviceMocks.loadParentRegistrations).toHaveBeenCalledTimes(2);
        expect(serviceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(1);

        await clickButton(container, 'Fees');
        await waitForText(container, 'Team dues');
        expect(serviceMocks.loadParentFeesForApp).toHaveBeenCalledTimes(2);
    });

    it('refreshes the active dependent tab when access changes finish after navigation', async () => {
        let resolveRequest;
        const pendingRequest = new Promise((resolve) => {
            resolveRequest = resolve;
        });
        serviceMocks.submitParentAccessRequest.mockImplementationOnce(() => pendingRequest);
        serviceMocks.loadParentRegistrations
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{
                id: 'form-1',
                teamId: 'team-1',
                teamName: 'Bears',
                programName: 'Summer Camp',
                description: 'Skills week',
                season: 'Summer',
                feeLabel: '$75.00',
                paymentNotice: 'Online checkout available.',
                onlineCheckout: true,
                options: [{ id: 'opt-1' }],
                url: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1'
            }]);

        const { container } = await renderParentTools('/parent-tools/access');
        await waitForText(container, 'Request player access');

        await clickButton(container, 'Register');
        await waitForText(container, 'No open registrations');
        expect(serviceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        await clickButton(container, 'Access');
        await waitForText(container, 'Request player access');
        await submitForm(container, 'Send request');

        await clickButton(container, 'Register');
        await waitForText(container, 'No open registrations');
        expect(serviceMocks.loadParentRegistrations).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveRequest({ success: true });
        });
        await waitForText(container, 'Summer Camp');
        expect(serviceMocks.loadParentRegistrations).toHaveBeenCalledTimes(2);
    });

    it('requires confirmation before revoking a family share link', async () => {
        const { container } = await renderParentTools('/parent-tools/share');
        await waitForText(container, 'Grandma');

        await clickButton(container, 'Revoke');

        expect(serviceMocks.revokeParentFamilyShare).not.toHaveBeenCalled();
        const confirmDialog = container.querySelector('[role="dialog"]');
        expect(confirmDialog?.textContent).toContain('Anyone using the family share link for Grandma will lose access.');

        await clickButtonWithin(confirmDialog, 'Cancel');

        expect(serviceMocks.revokeParentFamilyShare).not.toHaveBeenCalled();
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('only revokes a family share link after confirmation', async () => {
        const { container } = await renderParentTools('/parent-tools/share');
        await waitForText(container, 'Grandma');

        await clickButton(container, 'Revoke');
        const confirmDialog = container.querySelector('[role="dialog"]');
        await clickButtonWithin(confirmDialog, 'Revoke link');

        expect(serviceMocks.revokeParentFamilyShare).toHaveBeenCalledWith('token-1');
        await waitForText(container, 'Family link revoked.');
    });

    it('keeps revoke disabled for already revoked family share links', async () => {
        serviceMocks.loadFamilyShareModel.mockResolvedValueOnce({
            children: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star' }],
            tokens: [{ id: 'token-1', label: 'Grandma', url: 'https://allplays.ai/family.html?token=token-1', childCount: 1, extraCalendarUrls: [], revoked: true }]
        });
        const { container } = await renderParentTools('/parent-tools/share');
        await waitForText(container, 'Revoked');

        const revokeButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.trim() === 'Revoke');
        expect(revokeButton?.disabled).toBe(true);
        await act(async () => {
            revokeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        await flush();

        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(serviceMocks.revokeParentFamilyShare).not.toHaveBeenCalled();
    });

    it('renders fee notes and offline payment guidance without changing checkout', async () => {
        serviceMocks.loadParentFeesForApp.mockResolvedValueOnce([{
            id: 'fee-2',
            title: 'Tournament fee',
            teamId: 'team-1',
            teamName: 'Bears',
            playerName: 'Pat Star',
            status: 'unpaid',
            amountLabel: '$75',
            dueLabel: 'Jul 1',
            statusLabel: 'Open',
            balanceDueCents: 7500,
            checkoutUrl: 'https://pay.example.test/tournament',
            notes: 'Uniform deposit is included.',
            paymentInstructions: 'Bring a check payable to Bears Booster Club.',
            canPay: true,
            checkoutInitiatable: false,
            paymentAction: 'checkoutUrl',
            lineItems: [],
            installments: [],
            ledgerEntries: []
        }]);

        const { container } = await renderParentTools('/parent-tools/fees');
        await waitForText(container, 'Tournament fee');

        expect(container.textContent).toContain('Notes');
        expect(container.textContent).toContain('Uniform deposit is included.');
        expect(container.textContent).toContain('Offline payment');
        expect(container.textContent).toContain('Bring a check payable to Bears Booster Club.');

        await clickButton(container, 'Pay fee');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://pay.example.test/tournament');
        expect(serviceMocks.initiateParentTeamFeeCheckout).not.toHaveBeenCalled();
    });

    it('creates a team fee checkout session when no checkout URL exists', async () => {
        serviceMocks.loadParentFeesForApp.mockResolvedValueOnce([{
            id: 'fee-3',
            title: 'Tournament fee',
            teamId: 'team-1',
            batchId: 'batch-1',
            recipientId: 'recipient-1',
            teamName: 'Bears',
            playerName: 'Pat Star',
            status: 'unpaid',
            amountLabel: '$75',
            dueLabel: 'Jul 1',
            statusLabel: 'Open',
            balanceDueCents: 7500,
            checkoutUrl: '',
            canPay: true,
            checkoutInitiatable: true,
            paymentAction: 'createCheckout',
            lineItems: [],
            installments: [],
            ledgerEntries: []
        }]);

        const { container } = await renderParentTools('/parent-tools/fees');
        await waitForText(container, 'Tournament fee');
        await clickButton(container, 'Pay fee');

        expect(serviceMocks.initiateParentTeamFeeCheckout).toHaveBeenCalledWith('team-1', 'batch-1', 'recipient-1');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://pay.example.test/created-fee');
    });

    it('shows an inline fee checkout error without leaving Parent Tools', async () => {
        serviceMocks.loadParentFeesForApp.mockResolvedValueOnce([{
            id: 'fee-4',
            title: 'Camp fee',
            teamId: 'team-1',
            batchId: 'batch-1',
            recipientId: 'recipient-1',
            teamName: 'Bears',
            playerName: 'Pat Star',
            status: 'partial',
            amountLabel: '$50',
            dueLabel: 'Jul 15',
            statusLabel: 'Open',
            balanceDueCents: 5000,
            checkoutUrl: '',
            canPay: true,
            checkoutInitiatable: true,
            paymentAction: 'createCheckout',
            lineItems: [],
            installments: [],
            ledgerEntries: []
        }]);
        serviceMocks.initiateParentTeamFeeCheckout.mockRejectedValueOnce(new Error('Stripe session failed.'));

        const { container } = await renderParentTools('/parent-tools/fees');
        await waitForText(container, 'Camp fee');
        await clickButton(container, 'Pay fee');

        expect(container.textContent).toContain('Stripe session failed.');
        expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
    });

    it('shows calendar export success only after the handoff resolves', async () => {
        let resolveExport;
        const pendingExport = new Promise((resolve) => {
            resolveExport = resolve;
        });
        publicActionMocks.exportCalendarIcsFile.mockImplementationOnce(() => pendingExport);

        const { container } = await renderParentTools('/parent-tools/calendar');
        await waitForText(container, 'Calendar tools');

        await clickButton(container, 'Download .ics');

        expect(publicActionMocks.exportCalendarIcsFile).toHaveBeenCalledWith('all-plays-family-schedule.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');
        expect(container.textContent).not.toContain('Calendar file ready to share.');

        await act(async () => {
            resolveExport('shared');
        });
        await waitForText(container, 'Calendar file ready to share.');
    });

    it('shows an actionable calendar export error when native handoff fails', async () => {
        publicActionMocks.exportCalendarIcsFile.mockRejectedValueOnce(new Error('Sharing is not available on this device. Try the Apple or Google calendar links instead.'));

        const { container } = await renderParentTools('/parent-tools/calendar');
        await waitForText(container, 'Calendar tools');
        await clickButton(container, 'Download .ics');

        await waitForText(container, 'Sharing is not available on this device. Try the Apple or Google calendar links instead.');
        expect(container.textContent).not.toContain('Calendar file ready to share.');
    });

    it('filters team media albums by media type in the app', async () => {
        serviceMocks.loadTeamMediaForApp.mockResolvedValueOnce({
            team: { id: 'team-1', name: 'Bears' },
            canManage: false,
            canContribute: false,
            folders: [{
                id: 'folder-1',
                name: 'Game media',
                visibility: 'team',
                itemCount: 3,
                items: [
                    { id: 'photo-1', title: 'Tipoff', type: 'photo', url: 'https://img.example.test/tipoff.jpg' },
                    { id: 'video-1', title: 'Replay', type: 'video_link', url: 'https://youtube.com/watch?v=abc' },
                    { id: 'file-1', title: 'Packet', type: 'file', url: 'https://docs.example.test/packet.pdf' }
                ]
            }]
        });

        const { container } = await renderParentTools('/teams/team-1/media');
        await waitForText(container, 'Game media');
        expect(container.textContent).toContain('All3');
        expect(container.textContent).toContain('Photos1');
        expect(container.textContent).toContain('Videos1');
        expect(container.textContent).toContain('Files1');

        await clickButton(container, 'Videos');

        expect(container.textContent).toContain('Replay');
        expect(container.textContent).not.toContain('Tipoff');
        expect(container.textContent).not.toContain('Packet');
    });

    it('shows an empty state when the selected app media type has no matches', async () => {
        serviceMocks.loadTeamMediaForApp.mockResolvedValueOnce({
            team: { id: 'team-1', name: 'Bears' },
            canManage: false,
            canContribute: false,
            folders: [{
                id: 'folder-1',
                name: 'Photos only',
                visibility: 'team',
                itemCount: 1,
                items: [{ id: 'photo-1', title: 'Tipoff', type: 'photo', url: 'https://img.example.test/tipoff.jpg' }]
            }]
        });

        const { container } = await renderParentTools('/teams/team-1/media');
        await waitForText(container, 'Photos only');
        await clickButton(container, 'Videos');

        expect(container.textContent).toContain('Videos0');
        expect(container.textContent).toContain('No videos in this album.');
    });

    it('creates the first team media album and unlocks add-media actions for managers', async () => {
        serviceMocks.loadTeamMediaForApp
            .mockResolvedValueOnce({
                team: { id: 'team-1', name: 'Bears' },
                canManage: true,
                canContribute: true,
                folders: []
            })
            .mockResolvedValueOnce({
                team: { id: 'team-1', name: 'Bears' },
                canManage: true,
                canContribute: true,
                folders: [{
                    id: 'folder-new',
                    name: 'Spring photos',
                    visibility: 'team',
                    itemCount: 0,
                    items: []
                }]
            });
        const { container } = await renderParentTools('/teams/team-1/media');
        await waitForText(container, 'Create album');
        expect(container.textContent).toContain('Start this media library');
        expect(container.textContent).toContain('Team-visible');
        expect(container.textContent).toContain('Private/admins only');
        const submitButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.trim().includes('Create album'));
        expect(submitButton.disabled).toBe(true);

        await changeValue(container.querySelector('#team-media-album-name'), '  Spring photos  ');
        await changeSelectValue(container.querySelector('#team-media-album-visibility'), 'team');
        expect(submitButton.disabled).toBe(false);
        await submitForm(container, 'Create album');

        expect(serviceMocks.createTeamMediaAlbumForApp).toHaveBeenCalledWith('team-1', { name: 'Spring photos', visibility: 'team' });
        await waitForText(container, 'Album created. You can add photos, files, or links now.');
        expect(container.textContent).toContain('Add to Spring photos');
        expect(container.textContent).toContain('Photo');
        expect(container.textContent).toContain('File');
        expect(container.textContent).toContain('Add link');
    });

    it('preserves the album draft and hides create controls from non-managers', async () => {
        serviceMocks.loadTeamMediaForApp.mockResolvedValue({
            team: { id: 'team-1', name: 'Bears' },
            canManage: true,
            canContribute: true,
            folders: []
        });
        serviceMocks.createTeamMediaAlbumForApp.mockRejectedValueOnce(new Error('permission-denied'));
        const { container, root } = await renderParentTools('/teams/team-1/media');
        await waitForText(container, 'Create album');
        await changeValue(container.querySelector('#team-media-album-name'), 'Private board notes');
        await changeSelectValue(container.querySelector('#team-media-album-visibility'), 'private');
        await submitForm(container, 'Create album');
        await waitForText(container, 'permission-denied');
        expect(container.querySelector('#team-media-album-name').value).toBe('Private board notes');
        expect(container.querySelector('#team-media-album-visibility').value).toBe('private');

        await act(async () => root.unmount());
        document.body.innerHTML = '';
        serviceMocks.loadTeamMediaForApp.mockResolvedValue({
            team: { id: 'team-1', name: 'Bears' },
            canManage: false,
            canContribute: true,
            folders: []
        });
        const nextRender = await renderParentTools('/teams/team-1/media');
        await waitForText(nextRender.container, 'No albums are available yet.');
        expect(nextRender.container.textContent).not.toContain('Create album');
    });

    it('uploads app team media photos with bounded concurrency and one final refresh', async () => {
        const deferredUploads = Array.from({ length: 5 }, () => {
            let resolve;
            let reject;
            const promise = new Promise((nextResolve, nextReject) => {
                resolve = nextResolve;
                reject = nextReject;
            });
            return { promise, resolve, reject };
        });
        let uploadCallIndex = 0;
        serviceMocks.uploadParentTeamMediaPhoto.mockImplementation(() => {
            const nextUpload = deferredUploads[uploadCallIndex];
            uploadCallIndex += 1;
            return nextUpload.promise;
        });
        const { container } = await renderParentTools('/teams/team-1/media');
        await waitForText(container, 'Bears media');

        const photoButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.trim().includes('Photo'));
        const photoInput = container.querySelector('input[accept="image/*"]');
        const photos = Array.from({ length: 5 }, (_, index) => new File([`photo-${index + 1}`], `photo-${index + 1}.jpg`, { type: 'image/jpeg' }));
        expect(photoInput.hasAttribute('multiple')).toBe(true);
        Object.defineProperty(photoInput, 'files', { value: photos, configurable: true });
        await act(() => {
            photoInput.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(photoButton.disabled).toBe(true);
        expect(serviceMocks.uploadParentTeamMediaPhoto).toHaveBeenCalledTimes(3);
        expect(serviceMocks.uploadParentTeamMediaPhoto).toHaveBeenNthCalledWith(1, 'team-1', 'folder-1', photos[0]);
        expect(serviceMocks.uploadParentTeamMediaPhoto).toHaveBeenNthCalledWith(2, 'team-1', 'folder-1', photos[1]);
        expect(serviceMocks.uploadParentTeamMediaPhoto).toHaveBeenNthCalledWith(3, 'team-1', 'folder-1', photos[2]);

        await act(async () => {
            deferredUploads[0].resolve();
        });
        await vi.waitUntil(() => serviceMocks.uploadParentTeamMediaPhoto.mock.calls.length === 4);
        expect(serviceMocks.uploadParentTeamMediaPhoto).toHaveBeenNthCalledWith(4, 'team-1', 'folder-1', photos[3]);

        await act(async () => {
            deferredUploads[1].resolve();
            deferredUploads[2].resolve();
        });
        await vi.waitUntil(() => serviceMocks.uploadParentTeamMediaPhoto.mock.calls.length === 5);
        expect(serviceMocks.uploadParentTeamMediaPhoto).toHaveBeenNthCalledWith(5, 'team-1', 'folder-1', photos[4]);

        await act(async () => {
            deferredUploads[3].resolve();
            deferredUploads[4].resolve();
        });

        await waitForText(container, '5 photos uploaded.');
        expect(serviceMocks.loadTeamMediaForApp).toHaveBeenCalledTimes(2);
    });

    it('reports partial app team media photo failures without blocking queued valid images', async () => {
        const deferredUploads = Array.from({ length: 4 }, () => {
            let resolve;
            let reject;
            const promise = new Promise((nextResolve, nextReject) => {
                resolve = nextResolve;
                reject = nextReject;
            });
            return { promise, resolve, reject };
        });
        let uploadCallIndex = 0;
        serviceMocks.uploadParentTeamMediaPhoto.mockImplementation(() => {
            const nextUpload = deferredUploads[uploadCallIndex];
            uploadCallIndex += 1;
            return nextUpload.promise;
        });
        const { container } = await renderParentTools('/teams/team-1/media');
        await waitForText(container, 'Bears media');

        const photoInput = container.querySelector('input[accept="image/*"]');
        const textFile = new File(['not-image'], 'notes.txt', { type: 'text/plain' });
        const photos = [
            new File(['photo-1'], 'photo-1.jpg', { type: 'image/jpeg' }),
            new File(['photo-2'], 'photo-2.jpg', { type: 'image/jpeg' }),
            new File(['photo-3'], 'photo-3.jpg', { type: 'image/jpeg' }),
            new File(['photo-4'], 'photo-4.jpg', { type: 'image/jpeg' })
        ];
        Object.defineProperty(photoInput, 'files', { value: [textFile, ...photos], configurable: true });
        await act(async () => {
            photoInput.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(serviceMocks.uploadParentTeamMediaPhoto).toHaveBeenCalledTimes(3);
        await act(async () => {
            deferredUploads[0].reject(new Error('Upload failed.'));
        });
        await vi.waitUntil(() => serviceMocks.uploadParentTeamMediaPhoto.mock.calls.length === 4);
        expect(serviceMocks.uploadParentTeamMediaPhoto).toHaveBeenNthCalledWith(4, 'team-1', 'folder-1', photos[3]);

        await act(async () => {
            deferredUploads[1].resolve();
            deferredUploads[2].resolve();
            deferredUploads[3].resolve();
        });

        await waitForText(container, '3 photos uploaded; 2 failed.');
        expect(serviceMocks.loadTeamMediaForApp).toHaveBeenCalledTimes(2);
    });

    it('uploads multiple app team media files in one batch, skips invalid files, and refreshes once', async () => {
        let resolveUpload;
        const pendingUpload = new Promise((resolve) => {
            resolveUpload = resolve;
        });
        serviceMocks.uploadParentTeamMediaFile.mockImplementation(() => pendingUpload);
        const { container } = await renderParentTools('/teams/team-1/media');
        await waitForText(container, 'Bears media');

        const photoButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.trim().includes('Photo'));
        const fileButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.trim().includes('File'));
        const fileInput = container.querySelector('input[accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx"]');
        const invalidFile = new File(['image'], 'photo.png', { type: 'image/png' });
        const validFile = new File(['doc'], 'packet.pdf', { type: 'application/pdf' });
        expect(fileInput.hasAttribute('multiple')).toBe(true);
        Object.defineProperty(fileInput, 'files', { value: [invalidFile, validFile], configurable: true });
        await act(async () => {
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await vi.waitUntil(() => serviceMocks.uploadParentTeamMediaFile.mock.calls.length === 1);
        expect(photoButton.disabled).toBe(true);
        expect(fileButton.disabled).toBe(true);

        expect(serviceMocks.uploadParentTeamMediaFile).toHaveBeenCalledWith('team-1', 'folder-1', validFile);
        await act(async () => {
            resolveUpload();
        });
        expect(serviceMocks.loadTeamMediaForApp).toHaveBeenCalledTimes(2);
        await waitForText(container, '1 file uploaded; 1 failed.');
        expect(container.textContent).toContain('Unsupported file or file exceeds 10 MB.');
    });

    it('loads team media, uploads photos/files, adds links, and opens media items', async () => {
        const { container } = await renderParentTools('/teams/team-1/media');
        await waitForText(container, 'Bears media');
        expect(container.textContent).toContain('Game photos');

        const photoInput = container.querySelector('input[accept="image/*"]');
        const photoFile = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
        Object.defineProperty(photoInput, 'files', { value: [photoFile], configurable: true });
        await act(async () => {
            photoInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await flush();
        expect(serviceMocks.uploadParentTeamMediaPhoto).toHaveBeenCalledWith('team-1', 'folder-1', photoFile);

        const fileInput = container.querySelector('input[accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx"]');
        const docFile = new File(['doc'], 'packet.pdf', { type: 'application/pdf' });
        Object.defineProperty(fileInput, 'files', { value: [docFile], configurable: true });
        await act(async () => {
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await flush();
        expect(serviceMocks.uploadParentTeamMediaFile).toHaveBeenCalledWith('team-1', 'folder-1', docFile);

        const inputs = Array.from(container.querySelectorAll('input.auth-input'));
        await changeValue(inputs.find((input) => input.placeholder.includes('title')), 'Replay');
        await changeValue(inputs.find((input) => input.placeholder.includes('https://')), 'https://video.example.test/replay');
        await submitForm(container, 'Add link');
        expect(serviceMocks.addParentTeamMediaLink).toHaveBeenCalledWith('team-1', 'folder-1', 'Replay', 'https://video.example.test/replay');

        expect(container.textContent).toContain('Tipoff');
        expect(container.textContent).toContain('Open');
        expect(container.textContent).toContain('Share');
        expect(container.textContent).toContain('Save');
        expect(container.textContent).toContain('Copy');

        await clickButton(container, 'Open');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://img.example.test/tipoff.jpg');

        publicActionMocks.sharePublicUrl.mockResolvedValueOnce('copied');
        await clickButton(container, 'Share');
        expect(publicActionMocks.sharePublicUrl).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Tipoff',
            url: 'https://img.example.test/tipoff.jpg'
        }));
        expect(container.textContent).toContain('Share unavailable here. Link copied instead.');

        const originalCreateElement = document.createElement.bind(document);
        const downloadClick = vi.fn();
        const downloadRemove = vi.fn();
        let downloadLink;
        vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
            if (String(tagName).toLowerCase() === 'a') {
                downloadLink = originalCreateElement('a');
                downloadLink.click = downloadClick;
                downloadLink.remove = downloadRemove;
                return downloadLink;
            }
            return originalCreateElement(tagName, options);
        });
        await clickButton(container, 'Save');
        expect(downloadLink.href).toBe('https://img.example.test/tipoff.jpg');
        expect(downloadLink.download).toBe('tipoff');
        expect(downloadLink.rel).toBe('noopener noreferrer');
        expect(downloadClick).toHaveBeenCalled();
        expect(downloadRemove).toHaveBeenCalled();
        document.createElement.mockRestore();

        await clickButton(container, 'Copy');
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://img.example.test/tipoff.jpg');
        expect(container.textContent).toContain('Media link copied.');
    });
});
