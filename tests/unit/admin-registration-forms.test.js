import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
    buildAdminRegistrationFormPayload,
    fieldLabelsToDefinitions,
    formatRegistrationDiscountRulesText,
    getAdminRegistrationShareUrl,
    normalizeInstallmentPlan,
    normalizeRegistrationDiscountRules,
    normalizeRegistrationOptions,
    parseRegistrationDiscountRulesText,
    validateAdminRegistrationFormPayload
} from '../../js/admin-registration-forms.js';

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
                { id: 'division-a', label: 'Division A', capacityLimit: '12', active: true, waitlistEnabled: true },
                { label: 'Division B', capacityLimit: '', active: false, waitlistEnabled: false }
            ],
            installmentPlan: { enabled: true, installmentCount: '3', firstDueDate: '2026-06-01', intervalDays: '30' },
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
            installmentPlan: { enabled: true, title: 'Installment plan', installmentCount: 3, firstDueDate: '2026-06-01', intervalDays: 30 },
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
            { id: 'division-a', label: 'Division A', capacityLimit: 12, active: true, waitlistEnabled: true, sortOrder: 0 },
            { id: 'option_2', label: 'Division B', capacityLimit: null, active: false, waitlistEnabled: false, sortOrder: 1 }
        ]);
        expect(payload.discountRules).toEqual([
            { id: 'early', type: 'early_bird', label: 'Early bird', amountType: 'fixed', amountValue: 2500, earlyBirdDeadline: '2026-03-01', minimumQuantity: 1, active: true, sortOrder: 0 },
            { id: 'discount_2', type: 'quantity', label: 'Sibling discount', amountType: 'percent', amountValue: 10, earlyBirdDeadline: '', minimumQuantity: 2, active: true, sortOrder: 1 }
        ]);
        expect(validateAdminRegistrationFormPayload(payload)).toEqual([]);
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
            { id: 'early', label: 'Early bird', capacityLimit: '25.9', waitlistEnabled: true },
            { label: 'Open registration', capacityLimit: '-1', active: false }
        ])).toEqual([
            { id: 'early', label: 'Early bird', capacityLimit: 25, active: true, waitlistEnabled: true, sortOrder: 0 },
            { id: 'option_2', label: 'Open registration', capacityLimit: 0, active: false, waitlistEnabled: false, sortOrder: 1 }
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
        expect(validateAdminRegistrationFormPayload(payload)).toEqual([
            'Title is required.',
            'Waiver text is required.'
        ]);
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
        expect(adminPage).toContain('registration-installments-enabled');
        expect(adminPage).toContain('registration-discount-rules');
        expect(adminPage).toContain('registration-waiver');
        expect(adminPage).toContain('Publish and show link');
        expect(adminJs).toContain('window.openRegistrationFormsAdmin');
        expect(adminJs).toContain('window.addRegistrationOptionAdmin');
        expect(adminJs).toContain('window.moveRegistrationOptionAdmin');
        expect(adminJs).toContain('window.removeRegistrationOptionAdmin');
        expect(adminJs).toContain('collectRegistrationOptionsFromEditor()');
        expect(adminJs).toContain("document.getElementById('registration-installment-count')");
        expect(adminJs).toContain('parseRegistrationDiscountRulesText');
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
