import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const appAdminSource = readFileSync(new URL('../../apps/app/src/lib/registrationFormAdmin.ts', import.meta.url), 'utf8');
const appAdminTestSource = readFileSync(new URL('../../apps/app/src/lib/registrationFormAdmin.test.ts', import.meta.url), 'utf8');
const appAdminServiceSource = readFileSync(new URL('../../apps/app/src/lib/registrationFormAdminService.ts', import.meta.url), 'utf8');
const appAdminServiceTestSource = readFileSync(new URL('../../apps/app/src/lib/registrationFormAdminService.test.ts', import.meta.url), 'utf8');
const legacyAdminSource = readFileSync(new URL('../../js/admin-registration-forms.js', import.meta.url), 'utf8');
const legacyAdminTestSource = readFileSync(new URL('./admin-registration-forms.test.js', import.meta.url), 'utf8');
const capabilitySource = readFileSync(new URL('../../apps/app/src/data/capabilities.ts', import.meta.url), 'utf8');
const workflowRegistrationTestSource = readFileSync(new URL('./workflow-registration.test.js', import.meta.url), 'utf8');

describe('issue 1995 registration form admin source contract', () => {
    it('keeps app registration setup drafts mapped to legacy form payloads', () => {
        expect(appAdminSource).toContain('export type RegistrationFormEditorDraft');
        expect(appAdminSource).toContain('export function buildRegistrationFormEditorDraft');
        expect(appAdminSource).toContain('export function buildAppRegistrationFormAdminPayload');
        expect(appAdminSource).toContain('export function validateRegistrationFormEditorDraft');
        expect(appAdminSource).toContain('export function getRegistrationFormPublishState');
        expect(appAdminSource).toContain('buildAdminRegistrationFormPayload(draft, { teamId: context.teamId || draft.teamId || \'\' })');
        expect(appAdminSource).toContain('normalizeRegistrationForm(payload, {');
        expect(appAdminSource).toContain('paymentPlans: getPaymentPlanChoices(normalizedForm)');
        expect(appAdminSource).toContain('feeSnapshot: calculateRegistrationFeeSnapshot(normalizedForm, { now: context.now || new Date() })');
    });

    it('keeps app registration form admin service wired to legacy registrationForms documents', () => {
        expect(appAdminServiceSource).toContain('export async function loadRegistrationFormEditorForApp');
        expect(appAdminServiceSource).toContain('export async function saveRegistrationFormEditorForApp');
        expect(appAdminServiceSource).toContain("'teams', normalizedTeamId, 'registrationForms'");
        expect(appAdminServiceSource).toContain('createdAt: timestamp');
        expect(appAdminServiceSource).toContain('updatedAt: timestamp');
        expect(appAdminServiceSource).toContain('canManageRegistrationFormsForApp');
    });

    it('keeps the legacy admin form builder normalizing options, discounts, payment plans, and screening settings', () => {
        expect(legacyAdminSource).toContain('export function buildAdminRegistrationFormPayload');
        expect(legacyAdminSource).toContain('registrationOptions: normalizeRegistrationOptions(input.registrationOptions)');
        expect(legacyAdminSource).toContain('paymentSettings: normalizePaymentSettings(input.paymentSettings)');
        expect(legacyAdminSource).toContain('discountRules: normalizeRegistrationDiscountRules(input.discountRules)');
        expect(legacyAdminSource).toContain('backgroundCheck: normalizeBackgroundCheckSettings(input.backgroundCheck)');
        expect(legacyAdminSource).toContain('export function normalizeInstallmentPlan');
        expect(legacyAdminSource).toContain('export function normalizeAdminRegistrationFormStatus');
        expect(legacyAdminSource).toContain('export function parseAdminRegistrationFeeAmountCents');
        expect(legacyAdminSource).toContain('export function getAdminRegistrationShareUrl');
        expect(legacyAdminSource).toContain('export const adminRegistrationDefaults');
    });

    it('keeps regression coverage for setup, editing, validation, and workflow scope', () => {
        expect(appAdminTestSource).toContain('hydrates an existing registration form into app-editable draft state');
        expect(appAdminTestSource).toContain('builds legacy-compatible app setup payloads with options, fees, waivers, payment plans, waitlists, and editable fixed discounts');
        expect(appAdminTestSource).toContain('round-trips web-created closed fixtures without reopening them for submissions');
        expect(appAdminTestSource).toContain('returns validation errors without throwing so the app editor can show inline setup problems');
        expect(appAdminTestSource).toContain('validates editor-only setup errors before saving');
        expect(appAdminTestSource).toContain('converts registration fee inputs to cents consistently');
        expect(appAdminServiceTestSource).toContain('loads a web-created registration form into the app editor model');
        expect(appAdminServiceTestSource).toContain('creates published registration forms with legacy-compatible payload metadata');
        expect(appAdminServiceTestSource).toContain('updates closed registration forms without reopening public submissions');
        expect(legacyAdminTestSource).toContain('builds draft and published form payloads with metadata, fields, waiver, and fee');
        expect(legacyAdminTestSource).toContain('emits the option, waiver, fee, and payment-plan shape consumed by app and legacy registration flows');
        expect(legacyAdminTestSource).toContain('preserves closed forms as unavailable and normalizes open status aliases');
        expect(legacyAdminTestSource).toContain('creates a shareable public registration URL for published forms');
        expect(capabilitySource).toContain('legacy still owns setup');
        expect(workflowRegistrationTestSource).toContain('manual provider pulls');
    });
});
