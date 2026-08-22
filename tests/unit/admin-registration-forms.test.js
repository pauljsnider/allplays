// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

const adminDbMocks = vi.hoisted(() => ({
    getAdminTeamsPage: vi.fn(),
    getAdminUsersPage: vi.fn(),
    searchAdminUsers: vi.fn(),
    getGames: vi.fn(),
    getOfficials: vi.fn(),
    getOfficialsForUsers: vi.fn(),
    addOfficial: vi.fn(),
    updateOfficial: vi.fn(),
    deleteOfficial: vi.fn(),
    deleteTeam: vi.fn(),
    getTelemetryEvents: vi.fn(),
    getTelemetryDaily: vi.fn(),
    getTelemetryPageDaily: vi.fn(),
    getTelemetryRouteDaily: vi.fn(),
    getTelemetryEventDaily: vi.fn(),
    getTelemetrySessions: vi.fn()
}));
const adminFirebaseMocks = vi.hoisted(() => ({
    db: {},
    collection: vi.fn((database, path) => ({ database, path })),
    documentId: vi.fn(() => 'documentId'),
    getDocs: vi.fn(),
    doc: vi.fn(),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    query: vi.fn((...parts) => ({ parts })),
    setDoc: vi.fn(),
    startAfter: vi.fn((value) => ({ type: 'startAfter', value })),
    updateDoc: vi.fn(),
    serverTimestamp: vi.fn(),
    where: vi.fn()
}));
const adminAuthMocks = vi.hoisted(() => ({
    callback: null,
    checkAuth: vi.fn((callback) => {
        adminAuthMocks.callback = callback;
    })
}));

vi.mock('../../js/db.js?v=4433182', () => adminDbMocks);
vi.mock('../../js/firebase.js?v=26', () => adminFirebaseMocks);
vi.mock('../../js/utils.js?v=443358', () => ({
    renderHeader: vi.fn(),
    renderFooter: vi.fn(),
    escapeHtml: (value) => String(value || '')
}));
vi.mock('../../js/auth.js?v=4433186', () => adminAuthMocks);
vi.mock('../../js/admin-premium-access-control.js?v=4', () => ({
    createAdminPremiumAccessControl: () => ({ load: vi.fn() })
}));
import {
    ADMIN_REGISTRATION_FORMS_PAGE_SIZE,
    buildAdminRegistrationFormPayload,
    buildRegistrationOptionCountKey,
    createAdminRegistrationFormsPageState,
    fieldLabelsToDefinitions,
    formatRegistrationDiscountRulesText,
    getAdminRegistrationShareUrl,
    isPublishedAdminRegistrationFormStatus,
    normalizeBackgroundCheck,
    normalizeAdminRegistrationFormStatus,
    normalizePaymentSettings,
    normalizeBackgroundCheckSettings,
    normalizeInstallmentPlan,
    normalizeRegistrationDiscountRules,
    normalizeRegistrationOptions,
    loadAdminRegistrationFormsPage,
    mergeAdminRegistrationFormsPage,
    parseAdminRegistrationFeeAmountCents,
    parseRegistrationDiscountRulesText,
    validateAdminRegistrationFormPayload
} from '../../js/admin-registration-forms.js';
import {
    buildPaymentPlanSnapshot,
    getActiveRegistrationOptions,
    getPaymentPlanChoices,
    normalizeRegistrationForm
} from '../../js/registration-flow.js';

describe('admin registration form setup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        adminAuthMocks.callback = null;
    });

    it('builds a valid minimal form with the default participant and guardian fields', () => {
        const payload = buildAdminRegistrationFormPayload({
            title: 'Spring Soccer',
            waiverText: 'I accept the waiver.',
            status: 'draft'
        }, { teamId: 'team-1' });

        expect(payload.participantFields.map((field) => field.label)).toEqual(['Participant name', 'Birthdate']);
        expect(payload.guardianFields.map((field) => field.label)).toEqual(['Guardian name', 'Guardian email', 'Guardian phone']);
        expect(payload.paymentSettings).toEqual({ offlinePaymentEnabled: false, onlineCheckoutEnabled: false });
        expect(payload.registrationOptions).toEqual([]);
        expect(payload.installmentPlan).toBeNull();
        expect(validateAdminRegistrationFormPayload(payload)).toEqual([]);
    });

    it('builds draft and published form payloads with metadata, fields, waiver, and fee', () => {
        const payload = buildAdminRegistrationFormPayload({
            title: 'Spring Soccer',
            description: 'Season registration',
            programType: 'season',
            season: 'Spring 2026',
            feeAmount: '125.50',
            participantFieldsText: 'Player name\nBirthdate',
            guardianFieldsText: 'Guardian name, Guardian email, Guardian phone',
            registrationOptions: [
                { id: 'division-a', label: 'Division A', description: 'Tryout required.', capacityLimit: '12', active: true, waitlistEnabled: true },
                { label: 'Division B', capacityLimit: '', active: false, waitlistEnabled: false }
            ],
            paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
            installmentPlan: { enabled: true, installmentCount: '3', firstDueDate: '2026-06-01', intervalDays: '30' },
            backgroundCheck: {
                required: true,
                instructions: 'Coaches must complete screening before practices.',
                enabled: true,
                initialScreeningStatus: 'submitted',
                providerName: 'JDP'
            },
            discountRules: [
                { id: 'early', type: 'early_bird', label: 'Early bird', amountType: 'fixed', amountValue: '25', earlyBirdDeadline: '2026-03-01' },
                { type: 'quantity', label: 'Sibling discount', amountType: 'percent', amountValue: '10', minimumQuantity: '2' }
            ],
            waiverText: 'I accept the risk.',
            status: 'published'
        }, { teamId: 'team-1' });

        expect(payload).toMatchObject({
            teamId: 'team-1',
            programName: 'Spring Soccer',
            title: 'Spring Soccer',
            description: 'Season registration',
            programType: 'season',
            season: 'Spring 2026',
            feeAmountCents: 12550,
            currency: 'USD',
            paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
            installmentPlan: { enabled: true, title: 'Installment plan', installmentCount: 3, firstDueDate: '2026-06-01', intervalDays: 30 },
            backgroundCheck: {
                required: true,
                instructions: 'Coaches must complete screening before practices.',
                enabled: true,
                initialScreeningStatus: 'submitted',
                providerName: 'JDP'
            },
            waiverText: 'I accept the risk.',
            status: 'published',
            published: true
        });
        expect(payload.participantFields).toEqual([
            { id: 'participant_1', label: 'Player name', type: 'text', required: true, options: [] },
            { id: 'participant_2', label: 'Birthdate', type: 'date', required: true, options: [] }
        ]);
        expect(payload.guardianFields[1]).toMatchObject({ label: 'Guardian email', type: 'email', required: true });
        expect(payload.registrationOptions).toEqual([
            { id: 'division-a', label: 'Division A', description: 'Tryout required.', capacityLimit: 12, active: true, waitlistEnabled: true, sortOrder: 0 },
            { id: 'option_2', label: 'Division B', description: '', capacityLimit: null, active: false, waitlistEnabled: false, sortOrder: 1 }
        ]);
        expect(payload.discountRules).toEqual([
            { id: 'early', type: 'early_bird', label: 'Early bird', amountType: 'fixed', amountValue: 2500, earlyBirdDeadline: '2026-03-01', minimumQuantity: 1, active: true, sortOrder: 0 },
            { id: 'discount_2', type: 'quantity', label: 'Sibling discount', amountType: 'percent', amountValue: 10, earlyBirdDeadline: '', minimumQuantity: 2, active: true, sortOrder: 1 }
        ]);
        expect(validateAdminRegistrationFormPayload(payload)).toEqual([]);
    });

    it('emits the option, waiver, fee, and payment-plan shape consumed by app and legacy registration flows', () => {
        const payload = buildAdminRegistrationFormPayload({
            title: 'Summer Camp',
            description: 'Skills camp',
            programType: 'camp',
            season: 'Summer 2026',
            feeAmount: '90',
            participantFieldsText: 'Player name',
            guardianFieldsText: 'Guardian email',
            registrationOptions: [
                { id: 'travel', label: 'Travel', capacityLimit: '12', active: true, waitlistEnabled: false },
                { id: 'rec', label: 'Recreation', capacityLimit: '5', active: true, waitlistEnabled: true }
            ],
            installmentPlan: { enabled: true, installmentCount: '2', firstDueDate: '2026-06-01', intervalDays: '14' },
            waiverText: 'Guardian accepts the camp waiver.',
            status: 'published'
        }, { teamId: 'team-1' });
        const normalized = normalizeRegistrationForm({
            ...payload,
            id: 'form-1',
            registrationOptionCounts: {
                travel: { enrolled: 11 },
                rec: { enrolled: 5 }
            }
        }, { teamId: 'team-1', formId: 'form-1' });

        expect(normalized).toMatchObject({
            id: 'form-1',
            teamId: 'team-1',
            programName: 'Summer Camp',
            feeAmountCents: 9000,
            waiverText: 'Guardian accepts the camp waiver.',
            published: true
        });
        expect(getActiveRegistrationOptions(normalized, normalized.registrationOptionCounts).map((option) => option.id)).toEqual(['travel', 'rec']);
        expect(getPaymentPlanChoices(normalized).map((choice) => choice.id)).toEqual(['pay_full', 'installments']);
        expect(buildPaymentPlanSnapshot(normalized, 'installments')).toMatchObject({
            id: 'installments',
            installmentCount: 2,
            totalBalanceDueCents: 9000,
            schedule: [
                { label: 'Installment 1', dueDate: '2026-06-01', amountCents: 4500 },
                { label: 'Installment 2', dueDate: '2026-06-15', amountCents: 4500 }
            ]
        });
    });

    it('normalizes manual screening settings to bounded admin statuses', () => {
        expect(normalizeBackgroundCheckSettings()).toEqual({ required: false, instructions: '', enabled: false, initialScreeningStatus: 'pending', providerName: '' });
        expect(normalizeBackgroundCheckSettings({ enabled: true, initialScreeningStatus: 'flagged', providerName: ' Protect Youth Sports ' })).toEqual({
            required: false,
            instructions: '',
            enabled: true,
            initialScreeningStatus: 'flagged',
            providerName: 'Protect Youth Sports'
        });
        expect(normalizeBackgroundCheckSettings({ required: true, instructions: ' Screen before volunteering. ' })).toEqual({
            required: true,
            instructions: 'Screen before volunteering.',
            enabled: true,
            initialScreeningStatus: 'pending',
            providerName: ''
        });
        expect(normalizeBackgroundCheckSettings({ enabled: true, initialScreeningStatus: 'unknown' }).initialScreeningStatus).toBe('pending');
    });

    it('normalizes background-check policy metadata safely', () => {
        expect(normalizeBackgroundCheck()).toEqual({ required: false, instructions: '' });
        expect(normalizeBackgroundCheck({ required: true, instructions: '  Complete screening before volunteering.  ' })).toEqual({
            required: true,
            instructions: 'Complete screening before volunteering.'
        });
        expect(normalizeBackgroundCheck({ required: false, instructions: 'Ignored when disabled' })).toEqual({
            required: false,
            instructions: ''
        });
    });

    it('normalizes checkout and payment settings to bounded booleans', () => {
        expect(normalizePaymentSettings()).toEqual({ offlinePaymentEnabled: false, onlineCheckoutEnabled: false });
        expect(normalizePaymentSettings({ offlinePaymentEnabled: true, onlineCheckoutEnabled: 'yes' })).toEqual({
            offlinePaymentEnabled: true,
            onlineCheckoutEnabled: false
        });
    });

    it('normalizes simple installment plan settings safely', () => {
        expect(normalizeInstallmentPlan()).toBeNull();
        expect(normalizeInstallmentPlan({ enabled: true, installmentCount: '24', firstDueDate: '2026-06-01', intervalDays: '0' })).toEqual({
            enabled: true,
            title: 'Installment plan',
            installmentCount: 12,
            firstDueDate: '2026-06-01',
            intervalDays: 30
        });
    });

    it('parses and formats early-bird and quantity discount rules', () => {
        const parsed = parseRegistrationDiscountRulesText('Early bird before 2026-03-01: $25\nSibling/cart discount 2+: 10%');
        const normalized = normalizeRegistrationDiscountRules(parsed);

        expect(normalized).toEqual([
            { id: 'discount_1', type: 'early_bird', label: 'Early bird before 2026-03-01', amountType: 'fixed', amountValue: 2500, earlyBirdDeadline: '2026-03-01', minimumQuantity: 1, active: true, sortOrder: 0 },
            { id: 'discount_2', type: 'quantity', label: 'Sibling/cart discount 2+', amountType: 'percent', amountValue: 10, earlyBirdDeadline: '', minimumQuantity: 2, active: true, sortOrder: 1 }
        ]);
        expect(formatRegistrationDiscountRulesText(normalized)).toContain('Early bird before 2026-03-01 before 2026-03-01: $25.00');
        expect(formatRegistrationDiscountRulesText(normalized)).toContain('Sibling/cart discount 2+ 2+: 10%');
    });

    it('normalizes empty and legacy registration option settings safely', () => {
        expect(normalizeRegistrationOptions()).toEqual([]);
        expect(normalizeRegistrationOptions([
            { label: '  ' },
            { id: 'early', label: 'Early bird', description: '  Discounted setup window.  ', capacityLimit: '25.9', waitlistEnabled: true },
            { label: 'Open registration', capacityLimit: '-1', active: false }
        ])).toEqual([
            { id: 'early', label: 'Early bird', description: 'Discounted setup window.', capacityLimit: 25, active: true, waitlistEnabled: true, sortOrder: 0 },
            { id: 'option_2', label: 'Open registration', description: '', capacityLimit: 0, active: false, waitlistEnabled: false, sortOrder: 1 }
        ]);
    });

    it('rejects distinct option IDs that map to the same capacity counter', () => {
        const payload = buildAdminRegistrationFormPayload({
            title: 'Collision League',
            waiverText: 'Accepted.',
            registrationOptions: [
                { id: 'local division', label: 'Local space' },
                { id: 'local/division', label: 'Local slash' },
                { id: 'local_division', label: 'Local underscore' }
            ]
        }, { teamId: 'team-1' });

        expect(payload.registrationOptions.map((option) => buildRegistrationOptionCountKey(option.id))).toEqual([
            'local_division',
            'local_division',
            'local_division'
        ]);
        expect(validateAdminRegistrationFormPayload(payload)).toContain(
            'Registration option IDs must map to unique capacity counters.'
        );
    });

    it('preserves blank capacity inputs when rerendering registration options', () => {
        const adminSource = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminSource).toContain("option.capacityLimit === null || option.capacityLimit === undefined || option.capacityLimit === '' ? '' : Number(option.capacityLimit)");
    });

    it('keeps unpublished forms as drafts and validates required admin setup', () => {
        const payload = buildAdminRegistrationFormPayload({
            title: '',
            waiverText: '',
            status: 'draft'
        }, { teamId: 'team-1' });

        expect(payload.status).toBe('draft');
        expect(payload.published).toBe(false);
        expect(payload.backgroundCheck).toEqual({ required: false, instructions: '', enabled: false, initialScreeningStatus: 'pending', providerName: '' });
        expect(validateAdminRegistrationFormPayload(payload)).toEqual([
            'Title is required.',
            'Waiver text is required.'
        ]);
    });

    it('preserves closed forms as unavailable and normalizes open status aliases', () => {
        const closedPayload = buildAdminRegistrationFormPayload({
            title: 'Spring Soccer',
            waiverText: 'Accepted.',
            feeAmount: '$1,234.56',
            status: 'closed'
        }, { teamId: 'team-1' });
        const openPayload = buildAdminRegistrationFormPayload({
            title: 'Summer Camp',
            waiverText: 'Accepted.',
            status: 'open'
        }, { teamId: 'team-1' });

        expect(closedPayload).toMatchObject({
            status: 'closed',
            published: false,
            feeAmountCents: 123456
        });
        expect(openPayload).toMatchObject({
            status: 'published',
            published: true
        });
        expect(normalizeAdminRegistrationFormStatus('paused')).toBe('draft');
        expect(isPublishedAdminRegistrationFormStatus('closed')).toBe(false);
    });

    it('converts admin registration fee inputs to safe cents', () => {
        expect(parseAdminRegistrationFeeAmountCents('125.50')).toBe(12550);
        expect(parseAdminRegistrationFeeAmountCents('$1,234.56')).toBe(123456);
        expect(parseAdminRegistrationFeeAmountCents('19.995')).toBe(2000);
        expect(parseAdminRegistrationFeeAmountCents('')).toBe(0);
        expect(parseAdminRegistrationFeeAmountCents('-2')).toBe(0);
        expect(validateAdminRegistrationFormPayload({
            teamId: 'team-1',
            programName: 'Bad fee',
            waiverText: 'Accepted.',
            status: 'published',
            feeAmountCents: Number.NaN,
            participantFields: [{ id: 'p', label: 'Player' }],
            guardianFields: [{ id: 'g', label: 'Guardian' }]
        })).toEqual(['Fee amount must be zero or greater.']);
    });

    it('creates a shareable public registration URL for published forms', () => {
        expect(getAdminRegistrationShareUrl('team 1', 'form/2', 'https://allplays.example')).toBe(
            'https://allplays.example/app/#/registration?teamId=team+1&formId=form%2F2'
        );
    });

    it('infers date inputs only from date-specific labels', () => {
        expect(fieldLabelsToDefinitions(['Birthdate', 'Start date', 'Update notes', 'Candidate info'])).toEqual([
            { id: 'field_1', label: 'Birthdate', type: 'date', required: true, options: [] },
            { id: 'field_2', label: 'Start date', type: 'date', required: true, options: [] },
            { id: 'field_3', label: 'Update notes', type: 'text', required: true, options: [] },
            { id: 'field_4', label: 'Candidate info', type: 'text', required: true, options: [] }
        ]);
    });

    it('wires the admin dashboard to create, edit, publish, and copy registration links', () => {
        const adminPage = fs.readFileSync('admin.html', 'utf8');
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminPage).toContain('registration-forms-modal');
        expect(adminPage).toContain('registration-forms-load-more');
        expect(adminPage).toContain('src="js/admin.js?v=443354"');
        expect(adminPage).toContain('registration-advanced-settings');
        expect(adminPage).toContain('Advanced registration settings');
        expect(adminPage).toContain('registration-participant-fields');
        expect(adminPage).toContain('registration-guardian-fields');
        expect(adminPage).toContain('registration-options-list');
        expect(adminPage).toContain('registration-offline-payment');
        expect(adminPage).toContain('registration-online-checkout');
        expect(adminPage).toContain('Online payment processing is not available yet');
        expect(adminPage).toContain('registration-installments-enabled');
        expect(adminPage).toContain('registration-discount-rules');
        expect(adminPage).toContain('registration-background-check-enabled');
        expect(adminPage).toContain('registration-screening-initial-status');
        expect(adminPage).toContain('registration-screening-provider');
        expect(adminPage).toContain('registration-background-check-required');
        expect(adminPage).toContain('registration-background-check-instructions');
        expect(adminPage).toContain('registration-waiver');
        expect(adminPage).toContain('Publish and show link');
        expect(adminPage).toContain('Closed to new submissions');
        expect(adminJs).toContain('window.openRegistrationFormsAdmin');
        expect(adminJs).toContain('window.addRegistrationOptionAdmin');
        expect(adminJs).toContain('window.moveRegistrationOptionAdmin');
        expect(adminJs).toContain('window.removeRegistrationOptionAdmin');
        expect(adminJs).toContain('collectRegistrationOptionsFromEditor()');
        expect(adminJs).toContain('offlinePaymentEnabled: document.getElementById');
        expect(adminJs).toContain("document.getElementById('registration-installment-count')");
        expect(adminJs).toContain('parseRegistrationDiscountRulesText');
        expect(adminJs).toContain('backgroundCheck: {');
        expect(adminJs).toContain("document.getElementById('registration-background-check-enabled')");
        expect(adminJs).toContain("document.getElementById('registration-background-check-required')");
        expect(adminJs).toContain("document.getElementById('registration-background-check-instructions')");
        expect(adminJs).toContain('getRegistrationAdminStatus(form)');
        expect(adminJs).toContain("payload.status === 'closed'");
        expect(adminJs).toContain('const teamId = activeRegistrationTeam.id;');
        expect(adminJs).toContain('if (activeRegistrationTeam?.id !== teamId) return;');
        expect(adminJs).toContain('teams/${teamId}/registrationForms');
        expect(adminJs).toContain('setDoc(formRef');
        expect(adminJs).toContain('updateDoc(doc(db, `teams/${teamId}/registrationForms`, formId)');
        expect(adminJs).toContain('try {');
        expect(adminJs).toContain('inlineJsString');
        expect(adminJs).toContain('copyRegistrationLinkAdmin');
        expect(adminJs).toContain('window.loadMoreRegistrationFormsAdmin');
        expect(adminJs).toContain("from './admin-registration-forms.js?v=4'");
    });

    it('loads bounded legacy registration-form pages with deterministic cursors', async () => {
        const firstPageDocs = Array.from({ length: 26 }, (_, index) => ({
            id: `form-${String(index + 1).padStart(2, '0')}`,
            data: () => ({ title: `Form ${index + 1}` })
        }));
        const secondPageDocs = [
            { id: 'form-25', data: () => ({ title: 'Duplicate form' }) },
            { id: 'form-27', data: () => ({ title: 'Later form' }) }
        ];
        const snapshots = [{ docs: firstPageDocs }, { docs: secondPageDocs }];
        const calls = [];
        const firestore = {
            db: { id: 'db' },
            collection: (...args) => ({ type: 'collection', args }),
            documentId: () => 'documentId',
            orderBy: (...args) => ({ type: 'orderBy', args }),
            startAfter: (value) => ({ type: 'startAfter', value }),
            limit: (value) => ({ type: 'limit', value }),
            query: (reference, ...constraints) => {
                calls.push({ reference, constraints });
                return { reference, constraints };
            },
            getDocs: async () => snapshots.shift()
        };

        const firstPage = await loadAdminRegistrationFormsPage({ teamId: 'team-1', firestore });
        expect(firstPage.forms).toHaveLength(ADMIN_REGISTRATION_FORMS_PAGE_SIZE);
        expect(firstPage.hasMore).toBe(true);
        expect(firstPage.lastDoc).toBe(firstPageDocs[24]);
        expect(calls[0]).toEqual({
            reference: { type: 'collection', args: [{ id: 'db' }, 'teams/team-1/registrationForms'] },
            constraints: [
                { type: 'orderBy', args: ['documentId'] },
                { type: 'limit', value: 26 }
            ]
        });

        let state = mergeAdminRegistrationFormsPage(
            createAdminRegistrationFormsPageState('team-1'),
            { teamId: 'team-1', ...firstPage }
        );
        expect(state.forms).toHaveLength(25);

        const secondPage = await loadAdminRegistrationFormsPage({
            teamId: 'team-1',
            afterDoc: state.lastDoc,
            firestore
        });
        state = mergeAdminRegistrationFormsPage(state, { teamId: 'team-1', ...secondPage });

        expect(calls[1].constraints).toEqual([
            { type: 'orderBy', args: ['documentId'] },
            { type: 'startAfter', value: firstPageDocs[24] },
            { type: 'limit', value: 26 }
        ]);
        expect(state.forms).toHaveLength(26);
        expect(state.forms.filter((form) => form.id === 'form-25')).toHaveLength(1);
        const laterPageForm = state.forms.find((form) => form.id === 'form-27');
        expect(laterPageForm?.title).toBe('Later form');
        expect(state.hasMore).toBe(false);
    });

    it('sorts registration forms globally after merging pages', () => {
        let state = mergeAdminRegistrationFormsPage(
            createAdminRegistrationFormsPageState('team-1'),
            {
                teamId: 'team-1',
                forms: [
                    { id: 'form-01', title: 'Bravo' },
                    { id: 'form-02', title: 'Zulu' }
                ],
                lastDoc: { id: 'form-02' },
                hasMore: true
            }
        );

        state = mergeAdminRegistrationFormsPage(state, {
            teamId: 'team-1',
            forms: [
                { id: 'form-03', title: 'Alpha' },
                { id: 'form-04', title: 'Charlie' }
            ],
            lastDoc: { id: 'form-04' },
            hasMore: false
        });

        expect(state.forms.map((form) => form.title)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Zulu']);
        expect(state.lastDoc).toEqual({ id: 'form-04' });
    });

    it('preserves loaded rows and exposes a retryable error when loading more fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        document.documentElement.innerHTML = fs.readFileSync('admin.html', 'utf8');
        adminDbMocks.getAdminTeamsPage.mockResolvedValue({
            teams: [{ id: 'team-1', name: 'Test Team' }],
            nextCursor: null
        });
        adminDbMocks.getAdminUsersPage.mockResolvedValue({ users: [], nextCursor: null });
        adminDbMocks.getGames.mockResolvedValue([]);
        adminDbMocks.getOfficials.mockResolvedValue([]);
        adminDbMocks.getOfficialsForUsers.mockResolvedValue([]);
        adminDbMocks.getTelemetryEvents.mockResolvedValue([]);
        adminDbMocks.getTelemetryDaily.mockResolvedValue([]);
        adminDbMocks.getTelemetryPageDaily.mockResolvedValue([]);
        adminDbMocks.getTelemetryRouteDaily.mockResolvedValue([]);
        adminDbMocks.getTelemetryEventDaily.mockResolvedValue([]);
        adminDbMocks.getTelemetrySessions.mockResolvedValue([]);

        const firstPageDocs = Array.from({ length: 26 }, (_, index) => ({
            id: `form-${index + 1}`,
            data: () => ({ title: `Form ${index + 1}` })
        }));
        adminFirebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: firstPageDocs })
            .mockRejectedValueOnce(new Error('appended page failed'));

        vi.resetModules();
        await import('../../js/admin.js');
        await adminAuthMocks.callback({ uid: 'admin-1', email: 'admin@example.com', isAdmin: true });
        await window.openRegistrationFormsAdmin('team-1');

        const list = document.getElementById('registration-forms-list');
        const error = document.getElementById('registration-forms-load-more-error');
        const loadMore = document.getElementById('registration-forms-load-more');
        const loadedRows = list.innerHTML;

        expect(list.children).toHaveLength(25);
        expect(loadMore.classList.contains('hidden')).toBe(false);
        await window.loadMoreRegistrationFormsAdmin();

        expect(list.innerHTML).toBe(loadedRows);
        expect(error.classList.contains('hidden')).toBe(false);
        expect(loadMore.disabled).toBe(false);
        expect(loadMore.textContent).toBe('Load more');
        expect(consoleError).toHaveBeenCalledWith('Error loading registration forms:', expect.any(Error));
        consoleError.mockRestore();
    });

    it('resets registration pagination per team and ignores stale page merges', () => {
        const teamOne = mergeAdminRegistrationFormsPage(
            createAdminRegistrationFormsPageState('team-1'),
            {
                teamId: 'team-1',
                forms: [{ id: 'form-1', title: 'First form' }],
                lastDoc: { id: 'form-1' },
                hasMore: true
            }
        );
        const teamTwo = createAdminRegistrationFormsPageState('team-2');
        const afterStaleMerge = mergeAdminRegistrationFormsPage(teamTwo, {
            teamId: 'team-1',
            forms: [{ id: 'stale-form', title: 'Stale form' }],
            lastDoc: { id: 'stale-form' },
            hasMore: false
        });

        expect(teamOne.forms).toHaveLength(1);
        expect(teamTwo).toEqual({ teamId: 'team-2', forms: [], lastDoc: null, hasMore: false });
        expect(afterStaleMerge).toBe(teamTwo);
    });

    it('does not retain a bare legacy registrationForms collection read', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');

        expect(adminJs).not.toContain('getDocs(collection(db, `teams/${teamId}/registrationForms`))');
        expect(adminJs).toContain('loadAdminRegistrationFormsPage({');
    });

    it('keeps first-run basics outside the advanced registration disclosure', () => {
        const adminPage = fs.readFileSync('admin.html', 'utf8');
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');
        const advancedStart = adminPage.indexOf('id="registration-advanced-settings"');
        const advancedEnd = adminPage.indexOf('</details>', advancedStart);
        const advancedTagStart = adminPage.lastIndexOf('<details', advancedStart);
        const advancedTagEnd = adminPage.indexOf('>', advancedStart);

        expect(adminPage.slice(advancedTagStart, advancedTagEnd)).not.toMatch(/\sopen(?:\s|=|>)/);
        expect(advancedStart).toBeGreaterThan(adminPage.indexOf('id="registration-title"'));
        expect(advancedStart).toBeGreaterThan(adminPage.indexOf('id="registration-fee"'));
        expect(adminPage.indexOf('id="registration-description"')).toBeGreaterThan(advancedStart);
        expect(adminPage.indexOf('id="registration-participant-fields"')).toBeGreaterThan(advancedStart);
        expect(adminPage.indexOf('id="registration-participant-fields"')).toBeLessThan(advancedEnd);
        expect(adminPage.indexOf('id="registration-background-check-instructions"')).toBeLessThan(advancedEnd);
        expect(adminPage.indexOf('id="registration-waiver"')).toBeGreaterThan(advancedEnd);
        expect(adminPage.indexOf('id="registration-status"')).toBeGreaterThan(advancedEnd);
        expect(adminPage.slice(advancedStart, advancedEnd)).toContain('Participant name and Birthdate');
        expect(adminJs).toContain("document.getElementById('registration-advanced-settings').open = Boolean(form.id && hasAdvancedRegistrationSettings(form));");
    });
});
