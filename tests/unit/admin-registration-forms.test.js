import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
    buildAdminRegistrationFormPayload,
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

    it('preserves blank capacity inputs when rerendering registration options', () => {
        const adminSource = fs.readFileSync(new URL('../../js/admin.js', import.meta.url), 'utf8');

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
            'https://allplays.example/registration.html?teamId=team%201&formId=form%2F2'
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
    });
});
