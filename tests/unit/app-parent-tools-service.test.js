// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    createFamilyShareToken: vi.fn(),
    createParentMembershipRequest: vi.fn(),
    createTeamMediaLink: vi.fn(),
    getPlayers: vi.fn(),
    getTeam: vi.fn(),
    getTeamMediaFolders: vi.fn(),
    getTeamMediaItems: vi.fn(),
    getTeams: vi.fn(),
    listCertificatesForPlayer: vi.fn(),
    listFamilyShareTokens: vi.fn(),
    listMyParentMembershipRequests: vi.fn(),
    listParentTeamFeeRecipients: vi.fn(),
    listTeamRegistrationForms: vi.fn(),
    revokeFamilyShareToken: vi.fn(),
    updateFamilyShareTokenCalendars: vi.fn(),
    uploadTeamMediaFile: vi.fn(),
    uploadTeamMediaPhoto: vi.fn(),
    createRegistrationCheckoutSession: vi.fn()
}));

const feeMocks = vi.hoisted(() => ({
    formatParentFeeAmount: vi.fn((fee) => `$${Number(fee.amountDueCents || 0) / 100}`),
    formatParentFeeDueDate: vi.fn((value) => value || 'No due date'),
    getParentFeeStatusMeta: vi.fn((status) => ({ label: status === 'paid' ? 'Paid' : 'Open' })),
    normalizeParentFeeRecord: vi.fn((fee) => fee),
    sortParentFeeRecords: vi.fn((fees) => [...fees].sort((a, b) => String(a.title).localeCompare(String(b.title))))
}));

const registrationMocks = vi.hoisted(() => ({
    calculateRegistrationFeeSnapshot: vi.fn((form) => ({ finalAmountDueCents: form.finalAmountDueCents ?? 0 })),
    getActiveRegistrationOptions: vi.fn((form) => form.options || []),
    getRegistrationPaymentNotice: vi.fn((form) => form.paymentNotice || ''),
    hasOnlineRegistrationCheckout: vi.fn((form) => Boolean(form.checkoutUrl)),
    normalizeRegistrationForm: vi.fn((form, context) => ({
        ...form,
        id: context.formId,
        teamId: context.teamId,
        published: form.published !== false,
        status: form.status || 'published',
        currency: form.currency || 'USD',
        programName: form.programName || 'Registration',
        description: form.description || '',
        season: form.season || ''
    }))
}));

const mediaMocks = vi.hoisted(() => ({
    canContributeTeamMedia: vi.fn(() => true),
    canManageTeamMedia: vi.fn(() => false),
    canReadTeamMediaAlbum: vi.fn((folder) => folder.visibility !== 'private'),
    getTeamMediaItemUrl: vi.fn((item) => item.url || item.downloadUrl || ''),
    isSafeTeamMediaUrl: vi.fn((url) => String(url).startsWith('https://')),
    sortByMediaOrder: vi.fn((items) => [...items].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)))
}));

const authMocks = vi.hoisted(() => ({
    firebaseAuth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('firebase-token') } },
    getNativeAuthIdToken: vi.fn().mockResolvedValue('native-token')
}));

const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn(),
    sharePublicUrl: vi.fn().mockResolvedValue('shared')
}));

const scheduleMocks = vi.hoisted(() => ({
    loadParentSchedule: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/parent-dashboard-fees.js', () => feeMocks);
vi.mock('../../js/registration-flow.js', () => registrationMocks);
vi.mock('../../js/team-media-utils.js', () => mediaMocks);
vi.mock('../../apps/app/src/lib/authService.ts', () => authMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);

import {
    addParentTeamMediaLink,
    buildParentScheduleIcs,
    createParentFamilyShare,
    getAppleCalendarFeedUrl,
    getCertificateUrl,
    getFamilyShareUrl,
    getGoogleCalendarFeedUrl,
    getLegacyUrl,
    getPrivateTeamCalendarFeedUrl,
    getRegistrationUrl,
    loadFamilyShareModel,
    loadParentAccessModel,
    loadParentAccessPlayers,
    loadParentCalendarTools,
    loadParentCertificates,
    loadParentFeesForApp,
    loadParentRegistrations,
    loadTeamMediaForApp,
    revokeParentFamilyShare,
    submitParentAccessRequest,
    updateParentFamilyShareCalendars,
    uploadParentTeamMediaFile,
    uploadParentTeamMediaPhoto,
    initiateRegistrationCheckout
} from '../../apps/app/src/lib/parentToolsService.ts';

const user = {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    roles: ['parent'],
    parentOf: [
        { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' }
    ],
    coachOf: ['team-coach']
};

beforeEach(() => {
    vi.clearAllMocks();
    authMocks.firebaseAuth.currentUser.getIdToken.mockResolvedValue('firebase-token');
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-token');
});

describe('React app parent tools service', () => {
    it('builds legacy URLs used for current-site handoffs', () => {
        expect(getLegacyUrl('team.html', {}, { teamId: 'team-1' })).toBe('https://allplays.ai/team.html#teamId=team-1');
        expect(getFamilyShareUrl('token-1')).toBe('https://allplays.ai/family.html?token=token-1');
        expect(getRegistrationUrl('team-1', 'form-1')).toBe('https://allplays.ai/registration.html?teamId=team-1&formId=form-1');
        expect(getCertificateUrl('team-1', 'cert-1')).toBe('https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1');
        expect(getAppleCalendarFeedUrl('https://example.test/feed.ics')).toBe('webcal://example.test/feed.ics');
        expect(getGoogleCalendarFeedUrl('https://example.test/feed.ics')).toContain(encodeURIComponent('https://example.test/feed.ics'));
    });

    it('loads public access teams, selectable players, and submits membership requests', async () => {
        dbMocks.getTeams.mockResolvedValue([
            { id: 'team-b', name: 'Wolves', isPublic: false },
            { id: 'team-a', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true }
        ]);
        dbMocks.listMyParentMembershipRequests.mockResolvedValue([
            { id: 'request-1', teamId: 'team-a', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', relation: 'Parent', status: 'pending' }
        ]);
        dbMocks.getPlayers.mockResolvedValue([
            { id: 'inactive', name: 'Inactive', active: false },
            { id: 'player-2', name: 'Sam Wing', number: '12', photoUrl: 'https://img.example.test/sam.png' },
            { id: 'player-1', name: 'Pat Star', number: '9' }
        ]);
        dbMocks.createParentMembershipRequest.mockResolvedValue({ success: true, requestId: 'request-2' });

        await expect(loadParentAccessModel(user)).resolves.toMatchObject({
            teams: [{ id: 'team-a', name: 'Bears', sport: 'Basketball', zip: '66210' }],
            requests: [{ id: 'request-1', playerName: 'Pat Star', status: 'pending' }]
        });
        await expect(loadParentAccessPlayers('team-a')).resolves.toEqual([
            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null },
            { id: 'player-2', name: 'Sam Wing', number: '12', photoUrl: 'https://img.example.test/sam.png' }
        ]);
        await submitParentAccessRequest('team-a', 'player-1', 'Guardian');
        expect(dbMocks.createParentMembershipRequest).toHaveBeenCalledWith('team-a', 'player-1', 'Guardian');
    });

    it('normalizes fee records with parent-dashboard status, detail, and checkout data', async () => {
        dbMocks.listParentTeamFeeRecipients.mockResolvedValue([
            {
                id: 'fee-2',
                title: 'Uniform',
                status: 'paid',
                amountDueCents: 5000,
                balanceDueCents: 0,
                checkoutUrl: 'https://pay.example.test/paid'
            },
            {
                id: 'fee-1',
                title: 'Dues',
                status: 'open',
                amountDueCents: 12000,
                balanceDueCents: 12000,
                checkoutUrl: 'https://pay.example.test/open',
                lineItems: [{ title: 'Season', amountCents: 10000 }],
                installments: [{ label: 'Deposit', amountCents: 5000 }],
                ledgerEntries: [{ label: 'Adjustment', amountCents: -1000 }]
            }
        ]);

        const fees = await loadParentFeesForApp(user);

        expect(dbMocks.listParentTeamFeeRecipients).toHaveBeenCalledWith('user-1', user.parentOf);
        expect(fees.map((fee) => fee.title)).toEqual(['Dues', 'Uniform']);
        expect(fees[0]).toMatchObject({
            amountLabel: '$120',
            dueLabel: 'No due date',
            statusLabel: 'Open',
            canPay: true,
            lineItems: [{ title: 'Season', amountCents: 10000 }],
            installments: [{ label: 'Deposit', amountCents: 5000 }],
            ledgerEntries: [{ label: 'Adjustment', amountCents: -1000 }]
        });
        expect(fees[1].canPay).toBe(false);
    });

    it('loads schedule tools and builds escaped ICS content', async () => {
        const event = {
            eventKey: 'team-1::event-1::player-1',
            id: 'event-1',
            teamId: 'team-1',
            teamName: 'Bears',
            type: 'game',
            date: new Date('2100-06-01T18:00:00Z'),
            endDate: new Date('2100-06-01T19:30:00Z'),
            location: 'Field, 1',
            opponent: 'Falcons',
            childName: 'Pat Star',
            notes: 'Bring water; arrive early'
        };
        scheduleMocks.loadParentSchedule.mockResolvedValue({ children: [], events: [event] });

        await expect(loadParentCalendarTools(user)).resolves.toMatchObject({
            events: [event],
            teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 1 }]
        });

        const ics = buildParentScheduleIcs([event], 'Family, Schedule');
        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('X-WR-CALNAME:Family\\, Schedule');
        expect(ics).toContain('UID:team-1::event-1::player-1@allplays.ai');
        expect(ics).toContain('LOCATION:Field\\, 1');
        expect(ics).toContain('DESCRIPTION:Bears\\nGame\\nPlayer: Pat Star\\nBring water\\; arrive early');
    });

    it('creates private calendar feed URLs with native token fallback support', async () => {
        await expect(getPrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('https://us-central1-all-plays-prod.cloudfunctions.net/privateTeamCalendarIcs?teamId=team-1&token=native-token');
        authMocks.getNativeAuthIdToken.mockRejectedValueOnce(new Error('native unavailable'));
        await expect(getPrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('https://us-central1-all-plays-prod.cloudfunctions.net/privateTeamCalendarIcs?teamId=team-1&token=firebase-token');
    });

    it('loads and mutates family share tokens using current website contracts', async () => {
        dbMocks.listFamilyShareTokens.mockResolvedValue([
            { id: 'token-1', label: 'Grandma', children: [{ playerId: 'player-1' }], extraCalendarUrls: ['https://calendar.example.test/feed.ics'] }
        ]);
        dbMocks.createFamilyShareToken.mockResolvedValue('token-2');
        dbMocks.revokeFamilyShareToken.mockResolvedValue();
        dbMocks.updateFamilyShareTokenCalendars.mockResolvedValue();

        await expect(loadFamilyShareModel(user)).resolves.toMatchObject({
            children: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star' }],
            tokens: [{ id: 'token-1', url: 'https://allplays.ai/family.html?token=token-1', childCount: 1 }]
        });
        await expect(createParentFamilyShare(user, 'Coach', ['https://calendar.example.test/a.ics'])).resolves.toEqual({
            tokenId: 'token-2',
            url: 'https://allplays.ai/family.html?token=token-2'
        });
        expect(dbMocks.createFamilyShareToken).toHaveBeenCalledWith('user-1', expect.any(Array), 'Coach', ['https://calendar.example.test/a.ics']);
        await revokeParentFamilyShare('token-1');
        await updateParentFamilyShareCalendars('token-1', ['https://calendar.example.test/b.ics']);
        expect(dbMocks.revokeFamilyShareToken).toHaveBeenCalledWith('token-1');
        expect(dbMocks.updateFamilyShareTokenCalendars).toHaveBeenCalledWith('token-1', ['https://calendar.example.test/b.ics']);
    });

    it('loads published registrations for parent and coach teams', async () => {
        dbMocks.getTeam.mockImplementation(async (teamId) => ({ id: teamId, name: teamId === 'team-1' ? 'Bears' : 'Coach Wolves' }));
        dbMocks.listTeamRegistrationForms.mockImplementation(async (teamId) => ([
            { id: `${teamId}-open`, programName: 'Summer Camp', description: 'Skills', season: 'Summer', finalAmountDueCents: 7500, checkoutUrl: 'https://pay.example.test/camp', options: [{ id: 'opt-1' }] },
            { id: `${teamId}-closed`, programName: 'Closed Camp', status: 'closed' }
        ]));

        const cards = await loadParentRegistrations(user);

        expect(cards).toHaveLength(2);
        expect(cards[0]).toMatchObject({
            programName: 'Summer Camp',
            feeLabel: '$75.00',
            onlineCheckout: true,
            options: [{ id: 'opt-1' }]
        });
        expect(cards.map((card) => card.url)).toEqual(expect.arrayContaining([
            'https://allplays.ai/registration.html?teamId=team-1&formId=team-1-open',
            'https://allplays.ai/registration.html?teamId=team-coach&formId=team-coach-open'
        ]));
    });

    it('loads published certificates for linked players', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears' });
        dbMocks.listCertificatesForPlayer.mockResolvedValue([
            { id: 'cert-1', title: 'Hustle Award', recipientName: 'Pat Star', updatedAt: new Date('2100-01-01T00:00:00Z') }
        ]);

        await expect(loadParentCertificates(user)).resolves.toMatchObject([
            {
                id: 'cert-1',
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Pat Star',
                url: 'https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1'
            }
        ]);
        expect(dbMocks.listCertificatesForPlayer).toHaveBeenCalledWith('team-1', 'player-1', { status: 'published', limit: 25 });
    });

    it('loads team media, filters unsafe items, and exposes upload/link helpers', async () => {
        const photoFile = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
        const docFile = new File(['doc'], 'packet.pdf', { type: 'application/pdf' });
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears' });
        dbMocks.getTeamMediaFolders.mockResolvedValue([
            { id: 'folder-1', name: 'Game photos', visibility: 'team', order: 2 },
            { id: 'folder-private', name: 'Private', visibility: 'private', order: 1 }
        ]);
        dbMocks.getTeamMediaItems.mockImplementation(async (teamId, folderId) => (folderId === 'folder-1' ? [
            { id: 'bad', title: 'Bad', type: 'photo', url: 'javascript:alert(1)', order: 1 },
            { id: 'photo-1', title: 'Tipoff', type: 'photo', url: 'https://img.example.test/photo.jpg', order: 0 }
        ] : []));
        dbMocks.uploadTeamMediaPhoto.mockResolvedValue('photo-2');
        dbMocks.uploadTeamMediaFile.mockResolvedValue('file-1');
        dbMocks.createTeamMediaLink.mockResolvedValue('link-1');

        await expect(loadTeamMediaForApp(user, 'team-1')).resolves.toMatchObject({
            team: { id: 'team-1', name: 'Bears' },
            canManage: false,
            canContribute: true,
            folders: [{
                id: 'folder-1',
                itemCount: 1,
                items: [{ id: 'photo-1', title: 'Tipoff', type: 'photo', url: 'https://img.example.test/photo.jpg' }]
            }]
        });

        await uploadParentTeamMediaPhoto('team-1', 'folder-1', photoFile);
        await uploadParentTeamMediaFile('team-1', 'folder-1', docFile);
        await addParentTeamMediaLink('team-1', 'folder-1', 'Replay', 'https://video.example.test/replay');
        expect(dbMocks.uploadTeamMediaPhoto).toHaveBeenCalledWith('team-1', 'folder-1', photoFile);
        expect(dbMocks.uploadTeamMediaFile).toHaveBeenCalledWith('team-1', 'folder-1', docFile);
        expect(dbMocks.createTeamMediaLink).toHaveBeenCalledWith('team-1', 'folder-1', { title: 'Replay', url: 'https://video.example.test/replay' });
    });

    it('initiates Stripe checkout for registration and returns URL', async () => {
        const mockCheckoutUrl = 'https://checkout.stripe.com/mock-session-123';
        dbMocks.createRegistrationCheckoutSession.mockResolvedValue({ checkoutUrl: mockCheckoutUrl });

        const teamId = 'team-1';
        const formId = 'form-reg-1';
        const registrationId = 'reg-abc';
        const selectedOptionId = 'option-xyz';
        const paymentPlanId = 'plan-123';
        const quantity = 1;
        const amountCents = 7500;
        const currency = 'USD';

        const result = await initiateRegistrationCheckout(
            teamId,
            formId,
            registrationId,
            selectedOptionId,
            paymentPlanId,
            quantity,
            amountCents,
            currency
        );

        expect(dbMocks.createRegistrationCheckoutSession).toHaveBeenCalledWith(
            teamId,
            formId,
            registrationId,
            selectedOptionId,
            paymentPlanId,
            quantity,
            amountCents,
            currency
        );
        expect(result).toEqual({ success: true, checkoutUrl: mockCheckoutUrl });
    });

    it('throws error if required fields are missing for checkout', async () => {
        await expect(initiateRegistrationCheckout('', 'f', 'r', 'o', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', '', 'r', 'o', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', 'f', '', 'o', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', 'f', 'r', '', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', 'f', 'r', 'o', '', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', 'f', 'r', 'o', 'p', 0, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', 'f', 'r', 'o', 'p', 1, 0, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', 'f', 'r', 'o', 'p', 1, 100, ''))
            .rejects.toThrow('Missing required fields for checkout.');
    });

    it('throws error if checkout URL is not returned from backend', async () => {
        dbMocks.createRegistrationCheckoutSession.mockResolvedValue({ checkoutUrl: null });
        await expect(initiateRegistrationCheckout('t', 'f', 'r', 'o', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Failed to get checkout URL.');
    });
});
