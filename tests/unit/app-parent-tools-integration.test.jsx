// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const serviceMocks = vi.hoisted(() => ({
    addParentTeamMediaLink: vi.fn(),
    buildParentScheduleIcs: vi.fn(() => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'),
    createParentFamilyShare: vi.fn(),
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
    loadParentRegistrations: vi.fn(),
    loadTeamMediaForApp: vi.fn(),
    revokeParentFamilyShare: vi.fn(),
    submitParentAccessRequest: vi.fn(),
    updateParentFamilyShareCalendars: vi.fn(),
    uploadParentTeamMediaFile: vi.fn(),
    uploadParentTeamMediaPhoto: vi.fn()
}));

const publicActionMocks = vi.hoisted(() => ({
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
        parentOf: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star', teamName: 'Bears' }]
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
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('React app parent tools integration', () => {
    it('drives access, fee, calendar, share, registration, and award workflows from one hub', async () => {
        const { container } = await renderParentTools('/parent-tools/access');
        await waitForText(container, 'Request player access');
        expect(container.textContent).toContain('Access requests');
        await submitForm(container, 'Send request');
        expect(serviceMocks.submitParentAccessRequest).toHaveBeenCalledWith('team-1', 'player-1', 'Parent');

        await clickButton(container, 'Fees');
        await waitForText(container, 'Team dues');
        expect(container.textContent).toContain('Line items');
        await clickButton(container, 'Pay fee');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://pay.example.test/fee');
        expect(serviceMocks.initiateParentTeamFeeCheckout).not.toHaveBeenCalled();

        await clickButton(container, 'Calendar');
        await waitForText(container, 'Calendar tools');
        await clickButton(container, 'Download .ics');
        expect(serviceMocks.downloadIcs).toHaveBeenCalledWith('all-plays-family-schedule.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');
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
