// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    createFamilyShareToken: vi.fn(),
    createParentMembershipRequest: vi.fn(),
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
    getTeam: vi.fn(),
    getTeamMediaFolders: vi.fn(),
    getTeamMediaItems: vi.fn(),
    canAccessTeamChat: vi.fn(() => true),
    listCertificatesForPlayer: vi.fn(),
    listFamilyShareTokens: vi.fn(),
    listMyParentMembershipRequests: vi.fn(),
    listParentTeamFeeRecipients: vi.fn(),
    listTeamRegistrationForms: vi.fn(),
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
    initiateTeamFeeCheckout: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/firebase.js', () => firebaseMocks);
vi.mock('../../js/parent-dashboard-fees.js', () => feeMocks);
vi.mock('../../js/registration-flow.js', () => registrationMocks);
vi.mock('../../js/team-media-utils.js', () => mediaMocks);
vi.mock('../../apps/app/src/lib/authService.ts', () => authMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);
vi.mock('../../js/stripe-service.js', () => stripeMocks);

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
    loadFamilyShareModel,
    loadParentAccessModel,
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
    authMocks.firebaseAuth.currentUser.getIdToken.mockResolvedValue('firebase-token');
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-token');
});

describe('React app parent tools service', () => {
    it('builds legacy URLs used for current-site handoffs', () => {
        expect(getLegacyUrl('team.html', {}, { teamId: 'team-1' })).toBe('https://allplays.ai/team.html#teamId=team-1');
        expect(getFamilyShareUrl('token-1')).toBe('https://allplays.ai/family.html?token=token-1');
        expect(getRegistrationUrl('team-1', 'form-1')).toBe('https://allplays.ai/registration.html?teamId=team-1&formId=form-1');
        expect(getAppRegistrationUrl('team-1', 'form-1')).toBe('https://allplays.ai/app/#/registration?teamId=team-1&formId=form-1');
        expect(getCertificateUrl('team-1', 'cert-1')).toBe('https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1');
    });

    it('builds Apple and Google subscription URLs without altering private feed tokens', () => {
        const privateFeedUrl = 'https://example.test/privateTeamCalendarIcs?teamId=team-1&token=abc123%2Bsafe&view=full';
        expect(getAppleCalendarFeedUrl(privateFeedUrl)).toBe('webcal://example.test/privateTeamCalendarIcs?teamId=team-1&token=abc123%2Bsafe&view=full');
        expect(getGoogleCalendarFeedUrl(privateFeedUrl)).toBe(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(privateFeedUrl)}`);
    });

    it('loads public access teams, selectable players, and submits membership requests', async () => {
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
            teams: [{ id: 'team-a', name: 'Bears', sport: 'Basketball', zip: '66210' }],
            requests: [{ id: 'request-1', playerName: 'Pat Star', status: 'pending' }]
        });
        await expect(loadParentAccessPlayers('team-a')).resolves.toEqual([
            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null },
            { id: 'player-2', name: 'Sam Wing', number: '12', photoUrl: 'https://img.example.test/sam.png' }
        ]);
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
            submittedAt: new Date(),
        };

        const mockForm = {
            id: formId,
            teamId,
            programName: 'Summer Camp',
            registrationOptions: [
                { id: 'opt-1', countKey: 'opt-1-key', capacityLimit: 10, waitlistEnabled: true, active: true },
            ],
            registrationOptionCounts: {
                'opt-1-key': { enrolled: 9, waitlisted: 0 },
            },
        };

        dbMocks.getDoc.mockImplementation((docRef) => {
            if (docRef.path.includes(`teams/${teamId}/registrationForms/${formId}`)) {
                return Promise.resolve({
                    exists: () => true,
                    data: () => mockForm,
                    id: formId,
                });
            }
            return Promise.resolve({ exists: () => false, data: () => null });
        });

        // Mock runTransaction
        firebaseMocks.runTransaction.mockImplementation(async (db, updateFunction) => {
            const mockTransaction = {
                get: (docRef) => dbMocks.getDoc(docRef),
                update: dbMocks.updateDoc,
                set: dbMocks.setDoc,
            };
            return updateFunction(mockTransaction);
        });

        registrationMocks.decideRegistrationPlacement.mockReturnValue({
            status: 'pending',
            message: 'Placement pending',
            selectedOption: { id: 'opt-1', countKey: 'opt-1-key' },
            nextCounts: { enrolled: 10, waitlisted: 0 },
        });

        const result = await submitOfflineRegistration(teamId, formId, registrationRecord);

        expect(result).toEqual({ success: true, status: 'pending', registrationId: expect.any(String), feeSnapshot: expect.any(Object) });
        expect(firebaseMocks.runTransaction).toHaveBeenCalledTimes(1);

        // Verify that updateDoc was called on the formRef with updated counts
        expect(dbMocks.updateDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: `teams/${teamId}/registrationForms/${formId}` }),
            expect.objectContaining({
                'registrationOptionCounts.opt-1-key.enrolled': 10,
                'registrationOptionCounts.opt-1-key.waitlisted': 0,
                registrationCapacityUpdateId: expect.any(String),
                updatedAt: { _serverTimestamp: true },
            })
        );

        // Verify that setDoc was called to add the new registration record
        expect(dbMocks.setDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: expect.stringContaining(`teams/${teamId}/registrationForms/${formId}/registrations/`) }),
            expect.objectContaining({
                participant: registrationRecord.participant,
                guardian: registrationRecord.guardian,
                waiverAccepted: true,
                selectedOption: expect.objectContaining({ id: 'opt-1' }),
                status: 'pending',
            })
        );
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

        const mockForm = {
            id: formId,
            teamId,
            programName: 'Summer Camp',
            registrationOptions: [
                { id: 'opt-1', countKey: 'opt-1-key', capacityLimit: 10, waitlistEnabled: true, active: true },
            ],
            registrationOptionCounts: {
                'opt-1-key': { enrolled: 10, waitlisted: 0 }, // Form is full
            },
        };

        dbMocks.getDoc.mockImplementation((docRef) => {
            if (docRef.path.includes(`teams/${teamId}/registrationForms/${formId}`)) {
                return Promise.resolve({
                    exists: () => true,
                    data: () => mockForm,
                    id: formId,
                });
            }
            return Promise.resolve({ exists: () => false, data: () => null });
        });

        firebaseMocks.runTransaction.mockImplementation(async (db, updateFunction) => {
            const mockTransaction = {
                get: (docRef) => dbMocks.getDoc(docRef),
                update: dbMocks.updateDoc,
                set: dbMocks.setDoc,
            };
            return updateFunction(mockTransaction);
        });

        registrationMocks.decideRegistrationPlacement.mockReturnValue({
            status: 'waitlisted',
            message: 'Placement waitlisted',
            selectedOption: { id: 'opt-1', countKey: 'opt-1-key' },
            nextCounts: { enrolled: 10, waitlisted: 1 },
        });

        const result = await submitOfflineRegistration(teamId, formId, registrationRecord);

        expect(result).toEqual({ success: true, status: 'waitlisted', registrationId: expect.any(String), feeSnapshot: expect.any(Object) });
        expect(dbMocks.updateDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: `teams/${teamId}/registrationForms/${formId}` }),
            expect.objectContaining({
                'registrationOptionCounts.opt-1-key.enrolled': 10,
                'registrationOptionCounts.opt-1-key.waitlisted': 1,
                registrationCapacityUpdateId: expect.any(String),
                updatedAt: { _serverTimestamp: true },
            })
        );
        expect(dbMocks.setDoc).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                participant: registrationRecord.participant,
                guardian: registrationRecord.guardian,
                waiverAccepted: true,
                selectedOption: expect.objectContaining({ id: 'opt-1' }),
                status: 'waitlisted',
            })
        );
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

        const mockForm = {
            id: formId,
            teamId,
            programName: 'Summer Camp',
            registrationOptions: [
                { id: 'opt-2', countKey: 'opt-2-key', capacityLimit: 10, waitlistEnabled: false, active: true },
            ],
            registrationOptionCounts: {
                'opt-2-key': { enrolled: 10, waitlisted: 0 }, // Form is full, no waitlist
            },
        };

        dbMocks.getDoc.mockImplementation((docRef) => {
            if (docRef.path.includes(`teams/${teamId}/registrationForms/${formId}`)) {
                return Promise.resolve({
                    exists: () => true,
                    data: () => mockForm,
                    id: formId,
                });
            }
            return Promise.resolve({ exists: () => false, data: () => null });
        });

        firebaseMocks.runTransaction.mockImplementation(async (db, updateFunction) => {
            const mockTransaction = {
                get: (docRef) => dbMocks.getDoc(docRef),
                update: dbMocks.updateDoc,
                set: dbMocks.setDoc,
            };
            return updateFunction(mockTransaction);
        });

        registrationMocks.decideRegistrationPlacement.mockReturnValue({
            status: 'blocked',
            message: 'Option is full and not accepting waitlist registrations.',
            selectedOption: { id: 'opt-2', countKey: 'opt-2-key' },
            nextCounts: { enrolled: 10, waitlisted: 0 },
        });

        await expect(submitOfflineRegistration(teamId, formId, registrationRecord)).rejects.toThrow(
            'Option is full and not accepting waitlist registrations.'
        );
        expect(dbMocks.updateDoc).not.toHaveBeenCalled();
        expect(dbMocks.setDoc).not.toHaveBeenCalled();
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
                status: 'unpaid',
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
        expect(fees.map((fee) => fee.title)).toEqual(['Dues', 'Uniform']);
        expect(fees[0]).toMatchObject({
            amountLabel: '$120',
            dueLabel: 'No due date',
            statusLabel: 'Open',
            notes: 'Bring jersey deposit form.',
            offlinePaymentInstructions: 'Cash or check accepted at practice.',
            canPay: true,
            checkoutInitiatable: false,
            paymentAction: 'checkoutUrl',
            lineItems: [{ title: 'Season', amountCents: 10000 }],
            installments: [{ label: 'Deposit', amountCents: 5000 }],
            ledgerEntries: [{ label: 'Adjustment', amountCents: -1000 }]
        });
        expect(fees[1].canPay).toBe(false);
    });

    it('marks unpaid team fees without checkout URLs as initiatable only when identifiers exist', async () => {
        dbMocks.listParentTeamFeeRecipients.mockResolvedValue([
            { id: 'missing-team', title: 'Missing team', status: 'unpaid', balanceDueCents: 1500, batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'paid', title: 'Paid', status: 'paid', balanceDueCents: 1500, teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'partial', title: 'Partial', status: 'partial', balanceDueCents: 2500, teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'adjusted', title: 'Adjusted', status: 'adjusted', balanceDueCents: 3000, checkoutUrl: 'https://pay.example.test/adjusted', teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'adjusted-zero', title: 'Adjusted zero', status: 'adjusted', balanceDueCents: 0, checkoutUrl: 'https://pay.example.test/adjusted-zero', teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            { id: 'zero', title: 'Zero', status: 'unpaid', balanceDueCents: 0, teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' }
        ]);

        const fees = await loadParentFeesForApp(user);
        const partialFee = fees.find((fee) => fee.id === 'partial');

        const adjustedFee = fees.find((fee) => fee.id === 'adjusted');

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
        expect(fees.find((fee) => fee.id === 'missing-team').canPay).toBe(false);
        expect(fees.find((fee) => fee.id === 'paid').canPay).toBe(false);
        expect(fees.find((fee) => fee.id === 'adjusted-zero').canPay).toBe(false);
        expect(fees.find((fee) => fee.id === 'zero').canPay).toBe(false);
        expect(canInitiateParentTeamFeeCheckout(partialFee)).toBe(true);
        expect(isParentTeamFeePayActionAllowed({ status: 'partially_paid', balanceDueCents: 1 })).toBe(true);
        expect(isParentTeamFeePayActionAllowed({ status: 'adjusted', balanceDueCents: 1 })).toBe(true);
        expect(isParentTeamFeePayActionAllowed({ status: 'open', balanceDueCents: 1 })).toBe(true);
        expect(isParentTeamFeePayActionAllowed({ status: 'adjusted', balanceDueCents: 0 })).toBe(false);
    });

    it('loads calendar tools with lightweight parent schedule options and builds escaped ICS content', async () => {
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
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [],
            events: [event, { id: 'event-2', teamId: 'team-1', teamName: 'Bears', type: 'practice', date: new Date('2100-06-02T18:00:00Z') }]
        });

        await expect(loadParentCalendarTools(user)).resolves.toMatchObject({
            events: [event, { id: 'event-2', teamId: 'team-1', teamName: 'Bears', type: 'practice', date: new Date('2100-06-02T18:00:00Z') }],
            teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 2 }]
        });
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledWith(user, {
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
        expect(buildPrivateTeamCalendarFeedUrl('team-1', { calendarSubscriptionToken: 'stored-token' })).toBe('https://us-central1-all-plays-prod.cloudfunctions.net/privateTeamCalendarIcs?teamId=team-1&token=stored-token');
    });

    it('creates private calendar feed URLs with stored-team and native token fallback support', async () => {
        dbMocks.getTeam.mockResolvedValueOnce({ id: 'team-1', calendarSubscriptionToken: 'stored-token' });
        await expect(getPrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('https://us-central1-all-plays-prod.cloudfunctions.net/privateTeamCalendarIcs?teamId=team-1&token=stored-token');

        dbMocks.getTeam.mockResolvedValueOnce(null);
        await expect(getPrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('https://us-central1-all-plays-prod.cloudfunctions.net/privateTeamCalendarIcs?teamId=team-1&token=native-token');

        dbMocks.getTeam.mockResolvedValueOnce(null);
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
        expect(cards.map((card) => card.appUrl)).toEqual(expect.arrayContaining([
            'https://allplays.ai/app/#/registration?teamId=team-1&formId=team-1-open',
            'https://allplays.ai/app/#/registration?teamId=team-coach&formId=team-coach-open'
        ]));
    });

    it('loads a linked registration detail model for in-app review', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears' });
        dbMocks.listTeamRegistrationForms.mockResolvedValue([
            {
                id: 'form-1',
                programName: 'Summer Camp',
                status: 'published',
                finalAmountDueCents: 12000,
                checkoutUrl: 'https://pay.example.test/camp',
                options: [{ id: 'opt-1', title: 'Full Day' }],
                paymentNotice: 'Online checkout available.'
            }
        ]);

        await expect(loadParentRegistrationDetail(user, 'team-1', 'form-1')).resolves.toMatchObject({
            teamName: 'Bears',
            isPublished: true,
            onlineCheckout: true,
            legacyUrl: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1',
            feeSnapshot: { finalAmountDueCents: 12000 },
            options: [{ id: 'opt-1', title: 'Full Day' }],
            paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }]
        });
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
            { id: 'folder-2', name: 'Game video', visibility: 'team', order: 3, itemCount: 2 },
            { id: 'folder-private', name: 'Private', visibility: 'private', order: 1, itemCount: 9 }
        ]);
        dbMocks.getTeamMediaItems.mockImplementation(async (teamId, folderId) => (folderId === 'folder-1' ? [
            { id: 'bad', title: 'Bad', type: 'photo', url: 'javascript:alert(1)', order: 1 },
            { id: 'photo-1', title: 'Tipoff', type: 'photo', url: 'https://img.example.test/photo.jpg', order: 0 }
        ] : folderId === 'folder-2' ? [
            { id: 'video-1', title: 'Replay', type: 'video_link', url: 'https://video.example.test/replay', order: 0 }
        ] : []));
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
                    itemCount: 1,
                    itemsLoaded: true,
                    items: [{ id: 'photo-1', title: 'Tipoff', type: 'photo', url: 'https://img.example.test/photo.jpg' }]
                },
                {
                    id: 'folder-2',
                    itemCount: 2,
                    itemsLoaded: false,
                    items: []
                }
            ]
        });
        expect(dbMocks.getTeamMediaItems).toHaveBeenCalledTimes(1);
        expect(dbMocks.getTeamMediaItems).toHaveBeenCalledWith('team-1', 'folder-1');

        await expect(loadTeamMediaForApp(user, 'team-1', { folderIds: ['folder-2'] })).resolves.toMatchObject({
            folders: [
                { id: 'folder-1', itemCount: 4, itemsLoaded: false, items: [] },
                { id: 'folder-2', itemCount: 1, itemsLoaded: true, items: [{ id: 'video-1', title: 'Replay' }] }
            ]
        });
        expect(dbMocks.getTeamMediaItems).toHaveBeenCalledTimes(2);
        expect(dbMocks.getTeamMediaItems).toHaveBeenLastCalledWith('team-1', 'folder-2');

        await expect(createTeamMediaAlbumForApp('team-1', { name: '  Spring photos  ', visibility: 'private' })).resolves.toBe('folder-new');
        await uploadParentTeamMediaPhoto('team-1', 'folder-1', photoFile);
        await uploadParentTeamMediaFile('team-1', 'folder-1', docFile);
        await addParentTeamMediaLink('team-1', 'folder-1', 'Replay', 'https://video.example.test/replay');
        expect(dbMocks.canAccessTeamChat).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), { id: 'team-1', name: 'Bears' });
        expect(dbMocks.createTeamMediaFolder).toHaveBeenCalledWith('team-1', { name: 'Spring photos', visibility: 'private' });
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
        const mockCheckoutUrl = 'https://checkout.stripe.com/mock-session-123';
        dbMocks.createRegistrationCheckoutSession.mockResolvedValue({ checkoutUrl: mockCheckoutUrl });
        await expect(initiateRegistrationCheckout('', 'f', 'r', 'o', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', '', 'r', 'o', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
        await expect(initiateRegistrationCheckout('t', 'f', '', 'o', 'p', 1, 100, 'USD'))
            .rejects.toThrow('Missing required fields for checkout.');
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
