// @vitest-environment jsdom
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAppDataCache } from '../../apps/app/src/lib/appDataCache.ts';

const dbMocks = vi.hoisted(() => ({
    acceptTeamRegistrationOffer: vi.fn(),
    approveTeamRegistration: vi.fn(),
    createFamilyShareToken: vi.fn(),
    createParentMembershipRequest: vi.fn(),
    extendTeamRegistrationOffer: vi.fn(),
    createTeamMediaFolder: vi.fn(),
    createTeamMediaLink: vi.fn(),
    db: { _is_mock_db_instance: true }, // Mock db instance for runTransaction
    discoverPublicTeams: vi.fn(),
    doc: vi.fn((db, path, ...segments) => ({
        path: `${path}/${segments.join('/')}`,
        id: segments[segments.length - 1] || 'mock-id',
    })),
    collection: vi.fn((db, path) => ({ path })),
    getDoc: vi.fn(),
    updateDoc: vi.fn(),
    setDoc: vi.fn(),
    runTransaction: vi.fn(),
    getPlayers: vi.fn(),
    getTeamRegistrationForm: vi.fn(),
    getTeam: vi.fn(),
    getTeamMediaFolders: vi.fn(),
    getTeamMediaItems: vi.fn(),
    getTeamMediaItemsPage: vi.fn(),
    canAccessTeamChat: vi.fn(() => true),
    listCertificatesForPlayer: vi.fn(),
    listFamilyShareTokens: vi.fn(),
    listMyParentMembershipRequests: vi.fn(),
    listParentTeamFeeRecipients: vi.fn(),
    listPublishedTeamRegistrationForms: vi.fn(),
    listTeamRegistrationForms: vi.fn(),
    listTeamRegistrationReviews: vi.fn(),
    listTeamRegistrationReviewsPage: vi.fn(),
    rejectTeamRegistration: vi.fn(),
    revokeFamilyShareToken: vi.fn(),
    updateFamilyShareTokenCalendars: vi.fn(),
    uploadTeamMediaFile: vi.fn(),
    uploadTeamMediaPhoto: vi.fn(),
    deleteTeamMediaItem: vi.fn(),
    updateTeamMediaItem: vi.fn(),
    createRegistrationCheckoutSession: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => {
    let nextDocId = 1;
    return {
        db: { _is_mock_db_instance: true },
        functions: { _is_mock_functions_instance: true },
        httpsCallable: vi.fn(),
        serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
        collection: vi.fn((db, ...segments) => ({ path: segments.join('/') })),
        getDoc: vi.fn(),
        doc: vi.fn((dbOrCollection, ...segments) => {
            if (segments.length === 0) {
                const id = `registration-${nextDocId++}`;
                return { id, path: `${dbOrCollection.path}/${id}` };
            }
            const id = String(segments[segments.length - 1] || 'mock-id');
            return { id, path: segments.join('/') };
        }),
        runTransaction: vi.fn()
    };
});

const feeMocks = vi.hoisted(() => ({
    formatParentFeeAmount: vi.fn((fee) => `$${Number(fee.amountDueCents || 0) / 100}`),
    formatParentFeeDueDate: vi.fn((value) => value || 'No due date'),
    getParentFeeStatusMeta: vi.fn((status) => ({ label: status === 'paid' ? 'Paid' : 'Open' })),
    normalizeParentFeeRecord: vi.fn((fee) => fee),
    sortParentFeeRecords: vi.fn((fees) => [...fees].sort((a, b) => String(a.title).localeCompare(String(b.title))))
}));

const registrationMocks = vi.hoisted(() => ({
    buildPendingRegistrationRecord: vi.fn((submission) => ({
        teamId: submission.form.teamId,
        formId: submission.form.id,
        participant: submission.participant,
        guardian: submission.guardian,
        waiverAccepted: submission.waiverAccepted,
        selectedOption: submission.selectedOption,
        paymentPlan: { id: submission.selectedPaymentPlanId || 'pay_full' },
        status: submission.status || 'pending',
        feeSnapshot: submission.feeSnapshot,
        submittedAt: submission.now
    })),
    calculateRegistrationFeeSnapshot: vi.fn((form) => ({ finalAmountDueCents: form.finalAmountDueCents ?? 0 })),
    requiresRegistrationOption: vi.fn(() => true),
    getActiveRegistrationOptions: vi.fn((form) => form.options || []),
    getRegistrationPaymentNotice: vi.fn((form) => form.paymentNotice || ''),
    getPaymentPlanChoices: vi.fn(() => [{ id: 'pay_full', type: 'pay_full', title: 'Pay in full' }]),
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
    })),
    decideRegistrationPlacement: vi.fn((params) => ({
        status: 'pending',
        message: 'Placement pending',
        selectedOption: params.selectedOptionId ? { id: params.selectedOptionId, countKey: params.selectedOptionId } : null,
        nextCounts: { enrolled: 1, waitlisted: 0 },
    })),
}));

const registrationReviewMocks = vi.hoisted(() => ({
    getRegistrationGuardianDrafts: vi.fn((registration = {}) => {
        const submitted = registration.submittedData || {};
        const seen = new Set();
        return [registration.guardian, submitted.guardian].filter(Boolean).filter((guardian) => {
            const key = guardian.email || guardian.name;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }),
    getRegistrationPlayerDraft: vi.fn((registration = {}) => ({
        name: registration.player?.name || registration.submittedData?.participant?.name || '',
        number: registration.player?.number || registration.submittedData?.participant?.number || ''
    })),
    getRegistrationSubmittedData: vi.fn((registration = {}) => registration.submittedData || {}),
    normalizeRegistrationStatus: vi.fn((status = '') => {
        const value = String(status || '').toLowerCase();
        if (value === 'approved') return 'enrolled';
        if (value === 'declined') return 'rejected';
        return value || 'pending';
    })
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

const stripeMocks = vi.hoisted(() => ({
    cancelStripeRegistrationCheckout: vi.fn(),
    initiateTeamFeeCheckout: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/firebase.js', () => firebaseMocks);
vi.mock('../../js/parent-dashboard-fees.js', () => feeMocks);
vi.mock('../../js/registration-flow.js', () => registrationMocks);
vi.mock('../../js/registration-review.js', () => registrationReviewMocks);
vi.mock('../../js/team-media-utils.js', () => mediaMocks);
vi.mock('../../apps/app/src/lib/authService', () => authMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);
vi.mock('../../js/stripe-service.js', () => stripeMocks);
vi.mock('@sentry/browser', () => ({
    init: vi.fn(),
    withScope: vi.fn((callback) => callback({
        setTag: vi.fn(),
        setLevel: vi.fn(),
        setContext: vi.fn(),
        setExtra: vi.fn(),
        setFingerprint: vi.fn()
    })),
    captureException: vi.fn()
}));

import {
    addParentTeamMediaLink,
    buildParentScheduleIcs,
    createTeamMediaAlbumForApp,
    createParentFamilyShare,
    getAppleCalendarFeedUrl,
    getCertificateUrl,
    getFamilyShareUrl,
    getAppRegistrationUrl,
    getGoogleCalendarFeedUrl,
    getLegacyUrl,
    buildPrivateTeamCalendarFeedUrl,
    getPrivateTeamCalendarFeedUrl,
    getRegistrationUrl,
    loadStaffRegistrationDetail,
    loadTeamRegistrationQueue,
    loadTeamRegistrationQueuePage,
    loadFamilyShareModel,
    loadParentAccessModel,
    loadParentAccessTeams,
    loadParentAccessPlayers,
    loadParentCalendarTools,
    loadParentCertificates,
    loadParentFeesForApp,
    loadParentRegistrations,
    loadParentRegistrationDetail,
    loadPublicRegistrationDetail,
    loadTeamMediaForApp,
    revokeParentFamilyShare,
    submitOfflineRegistration,
    submitParentAccessRequest,
    updateParentFamilyShareCalendars,
    uploadParentTeamMediaFile,
    uploadParentTeamMediaPhoto,
    deleteTeamMediaItemForApp,
    updateTeamMediaItemForApp,
    approveTeamRegistrationForApp,
    acceptTeamRegistrationOfferForApp,
    extendTeamRegistrationOfferForApp,
    rejectTeamRegistrationForApp,
    cancelRegistrationCheckout,
    initiateRegistrationCheckout,
    initiateParentTeamFeeCheckout,
    canInitiateParentTeamFeeCheckout,
    isParentTeamFeePayActionAllowed
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
    clearAppDataCache();
    authMocks.firebaseAuth.currentUser.getIdToken.mockResolvedValue('firebase-token');
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-token');
});

describe('React app parent tools service', () => {
    it('uses the non-cache-busted firebase module path so the app build can resolve it', async () => {
        const source = await import('node:fs/promises').then(({ readFile }) =>
            readFile(resolve(process.cwd(), 'apps/app/src/lib/parentToolsService.ts'), 'utf8')
        );
        const adapterSource = await import('node:fs/promises').then(({ readFile }) =>
            readFile(resolve(process.cwd(), 'apps/app/src/lib/adapters/legacyParentTools.ts'), 'utf8')
        );

        expect(source).toContain("from './adapters/legacyParentTools';");
        expect(adapterSource).toContain("from '@legacy/firebase.js';");
        expect(source).not.toContain("firebase.js?v=");
        expect(adapterSource).not.toContain("firebase.js?v=");
    });

    it('builds legacy URLs used for current-site handoffs', () => {
        expect(getLegacyUrl('team.html', {}, { teamId: 'team-1' })).toBe('https://allplays.ai/team.html#teamId=team-1');
        expect(getFamilyShareUrl('token-1')).toBe('https://allplays.ai/family.html?token=token-1');
        expect(getRegistrationUrl('team-1', 'form-1')).toBe('https://allplays.ai/registration.html?teamId=team-1&formId=form-1');
        expect(getAppRegistrationUrl('team-1', 'form-1')).toBe('https://allplays.ai/app/#/registration?teamId=team-1&formId=form-1');
        expect(getCertificateUrl('team-1', 'cert-1')).toBe('https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1');
    });

    it('builds Apple and Google subscription URLs without altering private feed tokens', () => {
        const privateFeedUrl = 'https://example.test/team-calendar.ics?teamId=team-1&token=abc123%2Bsafe&view=full';
        expect(getAppleCalendarFeedUrl(privateFeedUrl)).toBe('webcal://example.test/team-calendar.ics?teamId=team-1&token=abc123%2Bsafe&view=full');
        expect(getGoogleCalendarFeedUrl(privateFeedUrl)).toBe(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(privateFeedUrl)}`);
    });

    it('loads access requests first, then lazy-loads public teams and players', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [
                { id: 'team-b', name: 'Wolves', isPublic: false },
                { id: 'team-a', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true }
            ],
            nextCursor: 'cursor-1'
        });
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
            teams: [],
            requests: [{ id: 'request-1', playerName: 'Pat Star', status: 'pending' }]
        });
        await expect(loadParentAccessTeams()).resolves.toEqual([
            { id: 'team-a', name: 'Bears', sport: 'Basketball', zip: '66210' }
        ]);
        await expect(loadParentAccessPlayers('team-a')).resolves.toEqual([
            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null },
            { id: 'player-2', name: 'Sam Wing', number: '12', photoUrl: 'https://img.example.test/sam.png' }
        ]);
        expect(dbMocks.listMyParentMembershipRequests).toHaveBeenCalledWith('user-1');
        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledWith({ pageSize: 100 });
        await submitParentAccessRequest('team-a', 'player-1', 'Guardian');
        expect(dbMocks.createParentMembershipRequest).toHaveBeenCalledWith('team-a', 'player-1', 'Guardian');
    });

    it('submits an offline registration with capacity and waitlist handling', async () => {
        const teamId = 'team-1';
        const formId = 'form-1';
        const registrationRecord = {
            participant: { name: 'Test Participant' },
            guardian: { name: 'Test Guardian' },
            waiverAccepted: true,
            selectedOption: { id: 'opt-1', countKey: 'opt-1-key' },
            selectedPaymentPlanId: 'pay_full',
            quantity: 2,
            checkoutAttemptToken: 'attempt-token-123456',
            submittedAt: new Date(),
        };
        const submitPublicRegistration = vi.fn().mockResolvedValue({
            data: { success: true, status: 'pending', registrationId: 'reg-1', feeSnapshot: { finalAmountDueCents: 5000 } }
        });
        firebaseMocks.httpsCallable.mockReturnValue(submitPublicRegistration);

        const result = await submitOfflineRegistration(teamId, formId, registrationRecord);

        expect(result).toEqual({ success: true, status: 'pending', registrationId: 'reg-1', feeSnapshot: { finalAmountDueCents: 5000 } });
        expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(firebaseMocks.functions, 'submitPublicRegistration');
        expect(submitPublicRegistration).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId,
                formId,
                participant: registrationRecord.participant,
                guardian: registrationRecord.guardian,
                waiverAccepted: true,
                selectedOptionId: 'opt-1',
                selectedPaymentPlanId: 'pay_full',
                quantity: 2,
                checkoutAttemptToken: 'attempt-token-123456'
            })
        );
        expect(firebaseMocks.runTransaction).not.toHaveBeenCalled();
        expect(dbMocks.updateDoc).not.toHaveBeenCalled();
        expect(dbMocks.setDoc).not.toHaveBeenCalled();
    });

    it('handles waitlisted placement correctly', async () => {
        const teamId = 'team-1';
        const formId = 'form-1';
        const registrationRecord = {
            participant: { name: 'Test Participant' },
            guardian: { name: 'Test Guardian' },
            waiverAccepted: true,
            selectedOption: { id: 'opt-1', countKey: 'opt-1-key' },
            selectedPaymentPlanId: 'pay_full',
            submittedAt: new Date(),
        };
        const submitPublicRegistration = vi.fn().mockResolvedValue({
            data: { success: true, status: 'waitlisted', registrationId: 'reg-waitlist', feeSnapshot: { finalAmountDueCents: 5000 } }
        });
        firebaseMocks.httpsCallable.mockReturnValue(submitPublicRegistration);

        const result = await submitOfflineRegistration(teamId, formId, registrationRecord);

        expect(result).toEqual({ success: true, status: 'waitlisted', registrationId: 'reg-waitlist', feeSnapshot: { finalAmountDueCents: 5000 } });
        expect(submitPublicRegistration).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId,
                formId,
                selectedOptionId: 'opt-1'
            })
        );
        expect(firebaseMocks.runTransaction).not.toHaveBeenCalled();
        expect(dbMocks.updateDoc).not.toHaveBeenCalled();
        expect(dbMocks.setDoc).not.toHaveBeenCalled();
    });

    it('throws an error if placement is blocked', async () => {
        const teamId = 'team-1';
        const formId = 'form-1';
        const registrationRecord = {
            participant: { name: 'Test Participant' },
            guardian: { name: 'Test Guardian' },
            waiverAccepted: true,
            selectedOption: { id: 'opt-2', countKey: 'opt-2-key' }, // Option without waitlist
            selectedPaymentPlanId: 'pay_full',
            submittedAt: new Date(),
        };
        const submitPublicRegistration = vi.fn().mockRejectedValue({
            code: 'functions/failed-precondition',
            details: { reason: 'option-full' },
            message: 'Option is full and not accepting waitlist registrations.',
        });
        firebaseMocks.httpsCallable.mockReturnValue(submitPublicRegistration);

        await expect(submitOfflineRegistration(teamId, formId, registrationRecord)).rejects.toThrow(
            'Option is full and not accepting waitlist registrations.'
        );
        expect(submitPublicRegistration).toHaveBeenCalledWith(expect.objectContaining({
            teamId,
            formId,
            selectedOptionId: 'opt-2'
        }));
        expect(firebaseMocks.runTransaction).not.toHaveBeenCalled();
        expect(dbMocks.updateDoc).not.toHaveBeenCalled();
        expect(dbMocks.setDoc).not.toHaveBeenCalled();
    });

    it('normalizes fee records with parent-dashboard status, detail, and checkout data', async () => {
        dbMocks.listParentTeamFeeRecipients.mockResolvedValue([
            {
                id: 'fee-2',
                title: 'Uniform',
                status: 'paid',
                collectionMode: 'online_stripe',
                checkoutStatus: 'paid',
                amountDueCents: 5000,
                balanceDueCents: 0,
                checkoutUrl: 'https://pay.example.test/paid'
            },
            {
                id: 'fee-3',
                title: 'Offline fee',
                status: 'unpaid',
                collectionMode: 'offline_manual',
                checkoutStatus: 'open',
                amountDueCents: 9000,
                balanceDueCents: 9000,
                checkoutUrl: 'https://pay.example.test/offline',
                teamId: 'team-1',
                batchId: 'batch-1',
                recipientId: 'recipient-3',
                offlinePaymentInstructions: 'Pay by cash or check.'
            },
            {
                id: 'fee-1',
                title: 'Dues',
                status: 'unpaid',
                collectionMode: 'online_stripe',
                checkoutStatus: 'open',
                amountDueCents: 12000,
                balanceDueCents: 12000,
                checkoutUrl: 'https://pay.example.test/open',
                notes: 'Bring jersey deposit form.',
                offlinePaymentInstructions: 'Cash or check accepted at practice.',
                lineItems: [{ title: 'Season', amountCents: 10000 }],
                installments: [{ label: 'Deposit', amountCents: 5000 }],
                ledgerEntries: [{ label: 'Adjustment', amountCents: -1000 }]
            }
        ]);

        const fees = await loadParentFeesForApp(user);

        expect(dbMocks.listParentTeamFeeRecipients).toHaveBeenCalledWith('user-1', user.parentOf);
        expect(fees.map((fee) => fee.title)).toEqual(['Dues', 'Offline fee', 'Uniform']);
        expect(fees[0]).toMatchObject({
            amountLabel: '$120',
            dueLabel: 'No due date',
            statusLabel: 'Open',
            collectionMode: 'online_stripe',
            checkoutStatus: 'open',
            checkoutUrl: 'https://pay.example.test/open',
            notes: 'Bring jersey deposit form.',
            offlinePaymentInstructions: 'Cash or check accepted at practice.',
            canPay: true,
            checkoutInitiatable: false,
            paymentAction: 'checkoutUrl',
            lineItems: [{ title: 'Season', amountCents: 10000 }],
            installments: [{ label: 'Deposit', amountCents: 5000 }],
            ledgerEntries: [{ label: 'Adjustment', amountCents: -1000 }]
        });
        expect(fees[1]).toMatchObject({
            collectionMode: 'offline_manual',
            checkoutStatus: 'open',
            checkoutUrl: 'https://pay.example.test/offline',
            offlinePaymentInstructions: 'Pay by cash or check.',
            canPay: false,
            checkoutInitiatable: false,
            paymentAction: ''
        });
        expect(fees[2].canPay).toBe(false);
    });

    it('marks unpaid team fees without checkout URLs as initiatable only when identifiers exist', async () => {
        dbMocks.listParentTeamFeeRecipients.mockResolvedValue([
            { id: 'missing-team', title: 'Missing team', status: 'unpaid', collectionMode: 'online_stripe', balanceDueCents: 1500, batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'paid', title: 'Paid', status: 'paid', collectionMode: 'online_stripe', balanceDueCents: 1500, teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'partial', title: 'Partial', status: 'partial', collectionMode: 'online_stripe', balanceDueCents: 2500, teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'adjusted', title: 'Adjusted', status: 'adjusted', collectionMode: 'online_stripe', checkoutStatus: 'open', balanceDueCents: 3000, checkoutUrl: 'https://pay.example.test/adjusted', teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'stale', title: 'Stale', status: 'unpaid', collectionMode: 'online_stripe', checkoutStatus: 'stale', balanceDueCents: 3000, checkoutUrl: 'https://pay.example.test/stale', teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'adjusted-zero', title: 'Adjusted zero', status: 'adjusted', collectionMode: 'online_stripe', balanceDueCents: 0, checkoutUrl: 'https://pay.example.test/adjusted-zero', teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'zero', title: 'Zero', status: 'unpaid', collectionMode: 'online_stripe', balanceDueCents: 0, teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' }
        ]);

        const fees = await loadParentFeesForApp(user);
        const partialFee = fees.find((fee) => fee.id === 'partial');

        const adjustedFee = fees.find((fee) => fee.id === 'adjusted');
        const staleFee = fees.find((fee) => fee.id === 'stale');

        expect(partialFee).toMatchObject({
            canPay: true,
            checkoutInitiatable: true,
            paymentAction: 'createCheckout'
        });
        expect(adjustedFee).toMatchObject({
            canPay: true,
            checkoutInitiatable: false,
            paymentAction: 'checkoutUrl'
        });
        expect(staleFee).toMatchObject({
            canPay: true,
            checkoutInitiatable: true,
            paymentAction: 'createCheckout'
        });
        expect(fees.find((fee) => fee.id === 'missing-team').canPay).toBe(false);
        expect(fees.find((fee) => fee.id === 'paid').canPay).toBe(false);
        expect(fees.find((fee) => fee.id === 'adjusted-zero').canPay).toBe(false);
        expect(fees.find((fee) => fee.id === 'zero').canPay).toBe(false);
        expect(canInitiateParentTeamFeeCheckout(partialFee)).toBe(true);
        expect(isParentTeamFeePayActionAllowed({ status: 'partially_paid', collectionMode: 'online_stripe', balanceDueCents: 1 })).toBe(true);
        expect(isParentTeamFeePayActionAllowed({ status: 'adjusted', collectionMode: 'online_stripe', balanceDueCents: 1 })).toBe(true);
        expect(isParentTeamFeePayActionAllowed({ status: 'open', collectionMode: 'online_stripe', balanceDueCents: 1 })).toBe(true);
        expect(isParentTeamFeePayActionAllowed({ status: 'unpaid', collectionMode: 'offline_manual', balanceDueCents: 1 })).toBe(false);
        expect(isParentTeamFeePayActionAllowed({ status: 'adjusted', collectionMode: 'online_stripe', balanceDueCents: 0 })).toBe(false);
    });

    it('reuses the shared parent schedule summary cache for calendar tools and only bypasses it on force refresh', async () => {
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
        scheduleMocks.loadParentSchedule
            .mockResolvedValueOnce({
                children: [],
                events: [event, { id: 'event-2', teamId: 'team-1', teamName: 'Bears', type: 'practice', date: new Date('2100-06-02T18:00:00Z') }]
            })
            .mockResolvedValueOnce({
                children: [],
                events: [event]
            });

        await expect(loadParentCalendarTools(user)).resolves.toMatchObject({
            events: [event, { id: 'event-2', teamId: 'team-1', teamName: 'Bears', type: 'practice', date: new Date('2100-06-02T18:00:00Z') }],
            teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 2 }]
        });
        await expect(loadParentCalendarTools(user)).resolves.toMatchObject({
            teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 2 }]
        });
        await expect(loadParentCalendarTools(user, { force: true })).resolves.toMatchObject({
            events: [event],
            teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 1 }]
        });
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(scheduleMocks.loadParentSchedule).toHaveBeenNthCalledWith(1, user, {
            hydrateDetails: false,
            expandStaffPlayers: false
        });
        expect(scheduleMocks.loadParentSchedule).toHaveBeenNthCalledWith(2, user, {
            hydrateDetails: false,
            expandStaffPlayers: false
        });

        const ics = buildParentScheduleIcs([event], 'Family, Schedule');
        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('X-WR-CALNAME:Family\\, Schedule');
        expect(ics).toContain('UID:team-1::event-1::player-1@allplays.ai');
        expect(ics).toContain('LOCATION:Field\\, 1');
        expect(ics).toContain('DESCRIPTION:Bears\\nGame\\nPlayer: Pat Star\\nBring water\\; arrive early');
    });

    it('builds private calendar feed URLs from stored team subscription URLs or tokens', () => {
        expect(buildPrivateTeamCalendarFeedUrl('team-1', { privateCalendarFeedUrl: 'webcal://example.test/private.ics?teamId=team-1&token=stored' })).toBe('https://example.test/private.ics?teamId=team-1&token=stored');
        expect(buildPrivateTeamCalendarFeedUrl('team-1', { calendarSubscriptionToken: 'stored-token' })).toBe('https://us-central1-all-plays-prod.cloudfunctions.net/teamCalendarFeed?teamId=team-1&token=stored-token');
    });

    it('creates private calendar feed URLs with stored-team and native token fallback support', async () => {
        dbMocks.getTeam.mockResolvedValueOnce({ id: 'team-1', calendarSubscriptionToken: 'stored-token' });
        await expect(getPrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('https://us-central1-all-plays-prod.cloudfunctions.net/teamCalendarFeed?teamId=team-1&token=stored-token');

        dbMocks.getTeam.mockResolvedValueOnce(null);
        await expect(getPrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('https://us-central1-all-plays-prod.cloudfunctions.net/teamCalendarFeed?teamId=team-1&token=native-token');

        dbMocks.getTeam.mockResolvedValueOnce(null);
        authMocks.getNativeAuthIdToken.mockRejectedValueOnce(new Error('native unavailable'));
        await expect(getPrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('https://us-central1-all-plays-prod.cloudfunctions.net/teamCalendarFeed?teamId=team-1&token=firebase-token');
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

    it('loads published registrations for parent and coach teams without scanning every form', async () => {
        dbMocks.getTeam.mockImplementation(async (teamId) => ({ id: teamId, name: teamId === 'team-1' ? 'Bears' : 'Coach Wolves' }));
        dbMocks.listTeamRegistrationForms.mockRejectedValue(new Error('parent discovery should not scan all forms'));
        dbMocks.listPublishedTeamRegistrationForms.mockImplementation(async (teamId, options) => {
            expect(options).toEqual({ pageSize: 50 });
            return [
                { id: `${teamId}-open`, programName: 'Summer Camp', description: 'Skills', season: 'Summer', finalAmountDueCents: 7500, checkoutUrl: 'https://pay.example.test/camp', options: [{ id: 'opt-1' }] },
                { id: `${teamId}-legacy`, programName: 'Legacy Camp', status: 'draft', published: true, finalAmountDueCents: 5000 },
                { id: `${teamId}-draft`, programName: 'Draft Camp', status: 'draft', published: false },
                { id: `${teamId}-closed`, programName: 'Closed Camp', status: 'closed', published: true }
            ];
        });

        const cards = await loadParentRegistrations(user);

        expect(cards).toHaveLength(4);
        expect(cards).toEqual(expect.arrayContaining([
            expect.objectContaining({
                programName: 'Summer Camp',
                feeLabel: '$75.00',
                onlineCheckout: true,
                options: [{ id: 'opt-1' }]
            }),
            expect.objectContaining({
                programName: 'Legacy Camp',
                feeLabel: '$50.00',
                onlineCheckout: false,
                options: []
            })
        ]));
        expect(cards.map((card) => card.url)).toEqual(expect.arrayContaining([
            'https://allplays.ai/registration.html?teamId=team-1&formId=team-1-open',
            'https://allplays.ai/registration.html?teamId=team-1&formId=team-1-legacy',
            'https://allplays.ai/registration.html?teamId=team-coach&formId=team-coach-open',
            'https://allplays.ai/registration.html?teamId=team-coach&formId=team-coach-legacy'
        ]));
        expect(cards.map((card) => card.appUrl)).toEqual(expect.arrayContaining([
            'https://allplays.ai/app/#/registration?teamId=team-1&formId=team-1-open',
            'https://allplays.ai/app/#/registration?teamId=team-coach&formId=team-coach-open'
        ]));
        expect(dbMocks.listPublishedTeamRegistrationForms).toHaveBeenCalledTimes(2);
        expect(dbMocks.listTeamRegistrationForms).not.toHaveBeenCalled();
    });

    it('loads a linked registration detail model for in-app review', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears' });
        dbMocks.listTeamRegistrationForms.mockRejectedValue(new Error('registration detail should not scan all forms'));
        dbMocks.getTeamRegistrationForm.mockResolvedValue({
            id: 'form-1',
            programName: 'Summer Camp',
            status: 'published',
            finalAmountDueCents: 12000,
            checkoutUrl: 'https://pay.example.test/camp',
            options: [{ id: 'opt-1', title: 'Full Day' }],
            paymentNotice: 'Online checkout available.'
        });

        await expect(loadParentRegistrationDetail(user, 'team-1', 'form-1')).resolves.toMatchObject({
            teamName: 'Bears',
            isPublished: true,
            onlineCheckout: true,
            legacyUrl: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1',
            feeSnapshot: { finalAmountDueCents: 12000 },
            options: [{ id: 'opt-1', title: 'Full Day' }],
            paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }]
        });
        expect(dbMocks.getTeamRegistrationForm).toHaveBeenCalledWith('team-1', 'form-1');
        expect(dbMocks.listTeamRegistrationForms).not.toHaveBeenCalled();
    });

    it('loads the staff registration detail model only for team staff', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-coach', name: 'Coach Wolves' });
        dbMocks.listTeamRegistrationForms.mockRejectedValue(new Error('registration detail should not scan all forms'));
        dbMocks.getTeamRegistrationForm.mockResolvedValue({
            id: 'form-review',
            programName: 'Travel Tryouts',
            status: 'published',
            finalAmountDueCents: 15000,
            options: [{ id: 'opt-1', title: 'Travel' }]
        });

        await expect(loadStaffRegistrationDetail(user, 'team-coach', 'form-review')).resolves.toMatchObject({
            teamName: 'Coach Wolves',
            isPublished: true,
            legacyUrl: 'https://allplays.ai/registration.html?teamId=team-coach&formId=form-review',
            options: [{ id: 'opt-1', title: 'Travel' }]
        });
        expect(dbMocks.getTeamRegistrationForm).toHaveBeenCalledWith('team-coach', 'form-review');
        expect(dbMocks.listTeamRegistrationForms).not.toHaveBeenCalled();
        await expect(loadStaffRegistrationDetail({ ...user, coachOf: [] }, 'team-coach', 'form-review')).rejects.toThrow('Admin access is required to review registrations.');
    });

    it('loads review queue cards and delegates approvals to legacy registration side effects', async () => {
        dbMocks.listTeamRegistrationReviews.mockResolvedValue([
            {
                id: 'reg-1',
                status: 'approved',
                participant: { name: 'Riley Runner', grade: '5' },
                guardian: { email: 'parent@example.com', name: 'Pat Parent' },
                selectedOption: { title: 'Travel' },
                feeSnapshot: { finalAmountDueCents: 15000, currency: 'USD' },
                paymentStatus: 'paid',
                waiverAccepted: true,
                linkedPlayerId: 'player-9'
            }
        ]);
        dbMocks.getPlayers.mockResolvedValue([{ id: 'player-9', name: 'Riley Runner', number: '12' }]);
        dbMocks.approveTeamRegistration.mockResolvedValue({ success: true });
        dbMocks.acceptTeamRegistrationOffer.mockResolvedValue({ success: true });
        dbMocks.extendTeamRegistrationOffer.mockResolvedValue({ success: true });
        dbMocks.rejectTeamRegistration.mockResolvedValue({ success: true });

        const queue = await loadTeamRegistrationQueue(user, 'team-coach', 'form-review');

        expect(dbMocks.listTeamRegistrationReviews).toHaveBeenCalledWith('team-coach', 'form-review', 'all');
        expect(queue).toMatchObject({
            reviews: [{
                id: 'reg-1',
                status: 'enrolled',
                participantName: 'Riley Runner',
                guardianLabel: 'parent@example.com',
                participant: { name: 'Riley Runner', grade: '5' },
                guardian: { email: 'parent@example.com', name: 'Pat Parent' },
                selectedOptionLabel: 'Travel',
                paymentLabel: 'paid · $150.00',
                waiverAccepted: true,
                linkedPlayerId: 'player-9'
            }],
            rosterPlayers: [{ id: 'player-9', name: 'Riley Runner', number: '12' }]
        });

        await approveTeamRegistrationForApp(user, 'team-coach', 'form-review', 'reg-1', { playerId: 'player-9' });
        expect(dbMocks.approveTeamRegistration).toHaveBeenCalledWith('team-coach', 'form-review', 'reg-1', { playerId: 'player-9' });

        await extendTeamRegistrationOfferForApp(user, 'team-coach', 'form-review', 'reg-1');
        expect(dbMocks.extendTeamRegistrationOffer).toHaveBeenCalledWith('team-coach', 'form-review', 'reg-1', '');

        await acceptTeamRegistrationOfferForApp(user, 'team-coach', 'form-review', 'reg-1');
        expect(dbMocks.acceptTeamRegistrationOffer).toHaveBeenCalledWith('team-coach', 'form-review', 'reg-1', '');

        await rejectTeamRegistrationForApp(user, 'team-coach', 'form-review', 'reg-1', 'Not eligible');
        expect(dbMocks.rejectTeamRegistration).toHaveBeenCalledWith('team-coach', 'form-review', 'reg-1', 'Not eligible');
    });

    it('surfaces installment-in-progress review labels from stored payment state', async () => {
        dbMocks.listTeamRegistrationReviews.mockResolvedValue([
            {
                id: 'reg-installment-1',
                status: 'pending',
                participant: { name: 'Riley Runner' },
                guardian: { email: 'parent@example.com', name: 'Pat Parent' },
                selectedOption: { title: 'Travel' },
                feeSnapshot: { finalAmountDueCents: 15000, currency: 'USD' },
                paymentStatus: 'installment_in_progress',
                balanceDueCents: 10000,
                paymentPlan: { remainingBalanceCents: 10000 },
                waiverAccepted: true
            }
        ]);
        dbMocks.getPlayers.mockResolvedValue([]);

        const queue = await loadTeamRegistrationQueue(user, 'team-coach', 'form-review');

        expect(queue.reviews[0]).toMatchObject({
            paymentLabel: 'installment in progress · $100.00'
        });
    });

    it('loads first page of registration reviews using a bounded query', async () => {
        const mockReviews = [
            {
                id: 'reg-1',
                status: 'pending',
                participant: { name: 'Alex Athlete' },
                guardian: { email: 'guardian@example.com', name: 'Alex Guardian' },
                selectedOption: { title: 'Travel' },
                feeSnapshot: { finalAmountDueCents: 10000, currency: 'USD' },
                paymentStatus: 'unpaid',
                waiverAccepted: true
            }
        ];
        dbMocks.listTeamRegistrationReviewsPage.mockResolvedValue({
            registrations: mockReviews,
            lastDoc: { id: 'reg-1' },
            hasMore: true
        });

        const result = await loadTeamRegistrationQueuePage('team-coach', 'form-review');

        expect(dbMocks.listTeamRegistrationReviewsPage).toHaveBeenCalledWith('team-coach', 'form-review', { status: 'all', pageSize: 25, afterDoc: null });
        expect(result.reviews).toHaveLength(1);
        expect(result.reviews[0].participantName).toBe('Alex Athlete');
        expect(result.hasMore).toBe(true);
        expect(result.lastDoc).toEqual({ id: 'reg-1' });
    });

    it('returns hasMore true when a full page was returned', async () => {
        const fullPage = Array.from({ length: 25 }, (_, i) => ({
            id: `reg-${i}`,
            status: 'pending',
            participant: { name: `Player ${i}` },
            guardian: { email: `guardian${i}@example.com` },
            feeSnapshot: { finalAmountDueCents: 0, currency: 'USD' },
            waiverAccepted: false
        }));
        dbMocks.listTeamRegistrationReviewsPage.mockResolvedValue({
            registrations: fullPage,
            lastDoc: { id: 'reg-24' },
            hasMore: true
        });

        const result = await loadTeamRegistrationQueuePage('team-coach', 'form-review');

        expect(result.reviews).toHaveLength(25);
        expect(result.hasMore).toBe(true);
    });

    it('returns hasMore false when a partial page was returned', async () => {
        dbMocks.listTeamRegistrationReviewsPage.mockResolvedValue({
            registrations: [
                {
                    id: 'reg-1',
                    status: 'pending',
                    participant: { name: 'Only One' },
                    guardian: { email: 'solo@example.com' },
                    feeSnapshot: { finalAmountDueCents: 0, currency: 'USD' },
                    waiverAccepted: false
                }
            ],
            lastDoc: { id: 'reg-1' },
            hasMore: false
        });

        const result = await loadTeamRegistrationQueuePage('team-coach', 'form-review');

        expect(result.reviews).toHaveLength(1);
        expect(result.hasMore).toBe(false);
    });

    it('passes afterDoc cursor for subsequent pages', async () => {
        const cursorDoc = { id: 'reg-24' };
        dbMocks.listTeamRegistrationReviewsPage.mockResolvedValue({
            registrations: [],
            lastDoc: null,
            hasMore: false
        });

        await loadTeamRegistrationQueuePage('team-coach', 'form-review', { afterDoc: cursorDoc, pageSize: 10 });

        expect(dbMocks.listTeamRegistrationReviewsPage).toHaveBeenCalledWith('team-coach', 'form-review', { status: 'all', pageSize: 10, afterDoc: cursorDoc });
    });

    it('loads a public registration detail without requiring public team document access', async () => {
        dbMocks.getTeam.mockRejectedValue(new Error('permission-denied'));
        firebaseMocks.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({
                id: 'form-public',
                teamName: 'Public Bears',
                programName: 'Open Clinic',
                status: 'published',
                published: true,
                finalAmountDueCents: 9900,
                options: [{ id: 'opt-public', title: 'Clinic' }]
            })
        });

        await expect(loadPublicRegistrationDetail('team-public', 'form-public')).resolves.toMatchObject({
            teamName: 'Public Bears',
            isPublished: true,
            legacyUrl: 'https://allplays.ai/registration.html?teamId=team-public&formId=form-public',
            feeSnapshot: { finalAmountDueCents: 9900 },
            options: [{ id: 'opt-public', title: 'Clinic' }]
        });
        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'teams', 'team-public', 'registrationForms', 'form-public');
        expect(firebaseMocks.getDoc).toHaveBeenCalledWith(expect.objectContaining({
            path: 'teams/team-public/registrationForms/form-public'
        }));
        expect(dbMocks.getTeam).not.toHaveBeenCalled();
    });

    it('rejects unavailable public registration details with safe errors', async () => {
        await expect(loadPublicRegistrationDetail('', 'form-1')).rejects.toThrow('Team and form are required.');

        firebaseMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ id: 'form-1', published: false, status: 'published' }) });
        await expect(loadPublicRegistrationDetail('team-1', 'form-1')).rejects.toThrow('This registration form is not available right now.');

        firebaseMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ id: 'form-1', published: true, status: 'closed' }) });
        await expect(loadPublicRegistrationDetail('team-1', 'form-1')).rejects.toThrow('This registration form is not available right now.');

        firebaseMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ id: 'form-1', published: true, status: 'archived' }) });
        await expect(loadPublicRegistrationDetail('team-1', 'form-1')).rejects.toThrow('This registration form is not available right now.');
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

    it('loads only the requested team media album items and leaves other albums lazy', async () => {
        const photoFile = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
        const docFile = new File(['doc'], 'packet.pdf', { type: 'application/pdf' });
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears' });
        dbMocks.getTeamMediaFolders.mockResolvedValue([
            { id: 'folder-1', name: 'Game photos', visibility: 'team', order: 2, itemCount: 4 },
            { id: 'folder-2', name: 'Game video', visibility: 'team', order: 3 },
            { id: 'folder-3', name: 'Highlights', visibility: 'team', order: 4, itemCount: 2 },
            { id: 'folder-private', name: 'Private', visibility: 'private', order: 1, itemCount: 9 }
        ]);
        dbMocks.getTeamMediaItemsPage.mockImplementation(async (teamId, folderId, options = {}) => ({
            items: folderId === 'folder-1' ? [
                { id: 'bad', title: 'Bad', type: 'photo', url: 'javascript:alert(1)', order: 1 },
                { id: 'photo-1', title: 'Tipoff', type: 'photo', url: 'https://img.example.test/photo.jpg', order: 0 }
            ] : folderId === 'folder-2' ? [
                { id: 'video-1', title: 'Replay', type: 'video_link', url: 'https://video.example.test/replay', order: 0 }
            ] : folderId === 'folder-3' ? [
                { id: 'highlight-1', title: 'Highlight', type: 'photo', url: 'https://img.example.test/highlight.jpg', order: 0 }
            ] : [],
            hasMore: folderId === 'folder-1',
            nextCursor: folderId === 'folder-1' ? { id: `cursor-${options.pageSize || 24}` } : null
        }));
        dbMocks.uploadTeamMediaPhoto.mockResolvedValue('photo-2');
        dbMocks.uploadTeamMediaFile.mockResolvedValue('file-1');
        dbMocks.createTeamMediaLink.mockResolvedValue('link-1');
        dbMocks.createTeamMediaFolder.mockResolvedValue('folder-new');

        await expect(loadTeamMediaForApp(user, 'team-1')).resolves.toMatchObject({
            team: { id: 'team-1', name: 'Bears' },
            canManage: false,
            canContribute: true,
            canPostChat: true,
            folders: [
                {
                    id: 'folder-1',
                    itemCount: 4,
                    itemsLoaded: true,
                    itemsHasMore: true,
                    items: [{ id: 'photo-1', title: 'Tipoff', type: 'photo', url: 'https://img.example.test/photo.jpg' }]
                },
                {
                    id: 'folder-2',
                    itemCount: 0,
                    itemsLoaded: false,
                    items: []
                },
                {
                    id: 'folder-3',
                    itemCount: 2,
                    itemsLoaded: false,
                    items: []
                }
            ]
        });
        expect(dbMocks.getTeamMediaItemsPage).toHaveBeenCalledTimes(1);
        expect(dbMocks.getTeamMediaItemsPage).toHaveBeenCalledWith('team-1', 'folder-1', { pageSize: 24, cursor: null });

        await expect(loadTeamMediaForApp(user, 'team-1', { folderIds: ['folder-2'] })).resolves.toMatchObject({
            folders: [
                { id: 'folder-1', itemCount: 4, itemsLoaded: false, items: [] },
                { id: 'folder-2', itemCount: 1, itemsLoaded: true, items: [{ id: 'video-1', title: 'Replay' }] },
                { id: 'folder-3', itemCount: 2, itemsLoaded: false, items: [] }
            ]
        });
        expect(dbMocks.getTeamMediaItemsPage).toHaveBeenCalledTimes(2);
        expect(dbMocks.getTeamMediaItemsPage).toHaveBeenLastCalledWith('team-1', 'folder-2', { pageSize: 24, cursor: null });

        await expect(createTeamMediaAlbumForApp('team-1', { name: '  Spring photos  ', visibility: 'private' })).resolves.toBe('folder-new');
        await uploadParentTeamMediaPhoto('team-1', 'folder-1', photoFile);
        await uploadParentTeamMediaFile('team-1', 'folder-1', docFile);
        await addParentTeamMediaLink('team-1', 'folder-1', 'Replay', 'https://video.example.test/replay');
        expect(dbMocks.canAccessTeamChat).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), { id: 'team-1', name: 'Bears' });
        expect(dbMocks.createTeamMediaFolder).toHaveBeenCalledWith('team-1', { name: 'Spring photos', visibility: 'private' });
        expect(dbMocks.uploadTeamMediaPhoto).toHaveBeenCalledWith('team-1', 'folder-1', photoFile, { returnItem: true });
        expect(dbMocks.uploadTeamMediaFile).toHaveBeenCalledWith('team-1', 'folder-1', docFile, { returnItem: true });
        expect(dbMocks.createTeamMediaLink).toHaveBeenCalledWith('team-1', 'folder-1', { title: 'Replay', url: 'https://video.example.test/replay' });
    });

    it('returns normalized team media upload items so the app can merge them without rereading the album', async () => {
        const photoFile = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
        const docFile = new File(['doc'], 'packet.pdf', { type: 'application/pdf' });
        dbMocks.uploadTeamMediaPhoto.mockResolvedValue({
            id: 'photo-2',
            title: 'photo.jpg',
            type: 'photo',
            downloadUrl: 'https://img.example.test/photo-2.jpg',
            order: 4
        });
        dbMocks.uploadTeamMediaFile.mockResolvedValue({
            id: 'file-1',
            title: 'packet.pdf',
            type: 'file',
            downloadUrl: 'https://files.example.test/packet.pdf',
            order: 5
        });

        await expect(uploadParentTeamMediaPhoto('team-1', 'folder-1', photoFile)).resolves.toMatchObject({
            id: 'photo-2',
            title: 'photo.jpg',
            type: 'photo',
            url: 'https://img.example.test/photo-2.jpg'
        });
        await expect(uploadParentTeamMediaFile('team-1', 'folder-1', docFile)).resolves.toMatchObject({
            id: 'file-1',
            title: 'packet.pdf',
            type: 'file',
            url: 'https://files.example.test/packet.pdf'
        });
        expect(dbMocks.getTeamMediaItems).not.toHaveBeenCalled();
    });

    it('passes team media pagination cursors through the app media model', async () => {
        const cursor = { id: 'cursor-1' };
        const nextCursor = { id: 'cursor-2' };
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears' });
        dbMocks.getTeamMediaFolders.mockResolvedValue([
            { id: 'folder-1', name: 'Game photos', visibility: 'team', order: 1, itemCount: 40 }
        ]);
        dbMocks.getTeamMediaItemsPage.mockResolvedValue({
            items: [
                { id: 'photo-25', title: 'Second page', type: 'photo', url: 'https://img.example.test/photo-25.jpg', order: 25 }
            ],
            hasMore: true,
            nextCursor
        });

        await expect(loadTeamMediaForApp(user, 'team-1', {
            folderIds: ['folder-1'],
            pageSize: 1,
            cursorsByFolderId: { 'folder-1': cursor }
        })).resolves.toMatchObject({
            folders: [
                {
                    id: 'folder-1',
                    itemCount: 40,
                    itemsLoaded: true,
                    itemsHasMore: true,
                    itemsNextCursor: nextCursor,
                    items: [{ id: 'photo-25', title: 'Second page' }]
                }
            ]
        });
        expect(dbMocks.getTeamMediaItemsPage).toHaveBeenCalledWith('team-1', 'folder-1', { pageSize: 1, cursor });
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
            currency,
            undefined,
            undefined,
            undefined
        );
        expect(result).toEqual({ success: true, checkoutUrl: mockCheckoutUrl });
    });

    it('allows capability-based retry checkout without a raw registration id', async () => {
        dbMocks.createRegistrationCheckoutSession.mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/mock-session-456' });

        await expect(initiateRegistrationCheckout(
            'team-1',
            'form-1',
            '',
            'option-1',
            'pay_full',
            1,
            5000,
            'USD',
            { publicCheckoutCapability: 'publiccapabilitytoken1234567890', retryPayment: true }
        )).resolves.toEqual({ success: true, checkoutUrl: 'https://checkout.stripe.com/mock-session-456' });

        expect(dbMocks.createRegistrationCheckoutSession).toHaveBeenCalledWith(
            'team-1',
            'form-1',
            '',
            'option-1',
            'pay_full',
            1,
            5000,
            'USD',
            undefined,
            true,
            'publiccapabilitytoken1234567890'
        );
    });

    it('throws error if required fields are missing for checkout', async () => {
        const mockCheckoutUrl = 'https://checkout.stripe.com/mock-session-123';
        dbMocks.createRegistrationCheckoutSession.mockResolvedValue({ checkoutUrl: mockCheckoutUrl });
        await expect(initiateRegistrationCheckout('', 'f', 'r', 'o', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', '', 'r', 'o', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', 'f', '', 'o', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', 'f', '', 'o', 'p', 1, 100, 'USD', { publicCheckoutCapability: 'publiccapabilitytoken1234567890' }))
            .resolves.toEqual({ success: true, checkoutUrl: mockCheckoutUrl });
        await expect(initiateRegistrationCheckout('t', 'f', 'r', '', 'p', 1, 100, 'USD'))
            .resolves.toEqual({ success: true, checkoutUrl: mockCheckoutUrl });
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

    it('allows capability-based checkout cancellation without a raw registration id', async () => {
        stripeMocks.cancelStripeRegistrationCheckout.mockResolvedValue({ released: true, nextPublicCheckoutCapability: 'publiccapabilitytoken999999999999' });

        await expect(cancelRegistrationCheckout(
            'team-1',
            'form-1',
            '',
            '',
            'publiccapabilitytoken1234567890'
        )).resolves.toEqual({ released: true, nextPublicCheckoutCapability: 'publiccapabilitytoken999999999999' });

        expect(stripeMocks.cancelStripeRegistrationCheckout).toHaveBeenCalledWith({
            teamId: 'team-1',
            formId: 'form-1',
            registrationId: '',
            checkoutAttemptToken: '',
            publicCheckoutCapability: 'publiccapabilitytoken1234567890'
        });
    });

    it('initiates Stripe checkout for team fees and requires a returned URL', async () => {
        stripeMocks.initiateTeamFeeCheckout.mockResolvedValue('https://checkout.stripe.test/team-fee');

        await expect(initiateParentTeamFeeCheckout('team-1', 'batch-1', 'recipient-1')).resolves.toEqual({
            success: true,
            checkoutUrl: 'https://checkout.stripe.test/team-fee'
        });
        expect(stripeMocks.initiateTeamFeeCheckout).toHaveBeenCalledWith({ teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' });

        await expect(initiateParentTeamFeeCheckout('', 'batch-1', 'recipient-1'))
            .rejects.toThrow('Missing required fields for team fee checkout.');

        stripeMocks.initiateTeamFeeCheckout.mockResolvedValueOnce('');
        await expect(initiateParentTeamFeeCheckout('team-1', 'batch-1', 'recipient-1'))
            .rejects.toThrow('Failed to get checkout URL.');
    });

    describe('updateTeamMediaItemForApp', () => {
        it('trims and persists a media item title through the legacy update helper', async () => {
            dbMocks.updateTeamMediaItem.mockResolvedValueOnce(undefined);

            await expect(updateTeamMediaItemForApp('team-1', 'item-1', '  New title  ')).resolves.toBeUndefined();

            expect(dbMocks.updateTeamMediaItem).toHaveBeenCalledWith('team-1', 'item-1', { title: 'New title' });
        });

        it('rejects missing IDs and blank titles before updating', async () => {
            await expect(updateTeamMediaItemForApp('', 'item-1', 'New title')).rejects.toThrow('Missing team or media item ID.');
            await expect(updateTeamMediaItemForApp('team-1', '', 'New title')).rejects.toThrow('Missing team or media item ID.');
            await expect(updateTeamMediaItemForApp('team-1', 'item-1', '   ')).rejects.toThrow('Media item title cannot be empty.');

            expect(dbMocks.updateTeamMediaItem).not.toHaveBeenCalled();
        });
    });

    describe('deleteTeamMediaItemForApp', () => {
        it('correctly calls deleteTeamMediaItem with teamId and item', async () => {
            const teamId = 'test-team';
            const item = { id: 'media-item-1', title: 'Test Photo', type: 'photo', storagePath: 'photos/test.jpg' };
            dbMocks.deleteTeamMediaItem.mockResolvedValueOnce(true);

            await expect(deleteTeamMediaItemForApp(teamId, item)).resolves.toBeUndefined();
            expect(dbMocks.deleteTeamMediaItem).toHaveBeenCalledWith(teamId, item);
        });

        it('throws an error if teamId or itemId are missing', async () => {
            const item = { id: 'media-item-1', title: 'Test Photo', type: 'photo', storagePath: 'photos/test.jpg' };
            await expect(deleteTeamMediaItemForApp('', item)).rejects.toThrow('Missing team or media item ID.');
            await expect(deleteTeamMediaItemForApp('team-id', { id: '', title: 'Test Photo', type: 'photo' })).rejects.toThrow('Missing team or media item ID.');
            expect(dbMocks.deleteTeamMediaItem).not.toHaveBeenCalled();
        });

        it('propagates errors from deleteTeamMediaItem', async () => {
            const teamId = 'test-team';
            const item = { id: 'media-item-1', title: 'Test Photo', type: 'photo', storagePath: 'photos/test.jpg' };
            const mockError = new Error('Firestore delete failed');
            dbMocks.deleteTeamMediaItem.mockRejectedValueOnce(mockError);

            await expect(deleteTeamMediaItemForApp(teamId, item)).rejects.toThrow('Firestore delete failed');
            expect(dbMocks.deleteTeamMediaItem).toHaveBeenCalledWith(teamId, item);
        });
    });
});
