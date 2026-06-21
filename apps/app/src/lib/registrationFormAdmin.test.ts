import { describe, expect, it } from 'vitest';
import {
  buildAppRegistrationFormAdminPayload,
  buildRegistrationFormEditorDraft
} from './registrationFormAdmin';

describe('registrationFormAdmin', () => {
  it('hydrates an existing registration form into app-editable draft state', () => {
    const draft = buildRegistrationFormEditorDraft({
      id: 'form-1',
      teamId: 'team-1',
      programName: 'Spring Soccer',
      description: 'Season signup',
      season: 'Spring 2026',
      feeAmountCents: 12550,
      participantFields: [
        { id: 'participant_1', label: 'Player name', type: 'text', required: true },
        { id: 'participant_2', label: 'Birthdate', type: 'date', required: true }
      ],
      guardianFields: [
        { id: 'guardian_1', label: 'Guardian name', type: 'text', required: true },
        { id: 'guardian_2', label: 'Guardian email', type: 'email', required: true }
      ],
      registrationOptions: [
        { id: 'travel', title: 'Travel Team', capacityLimit: 12, waitlistEnabled: true },
        { id: 'academy', title: 'Academy', capacityLimit: null, active: false }
      ],
      paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: false },
      installmentPlan: { enabled: true, title: 'Three payments', installmentCount: 3, firstDueDate: '2026-05-01', intervalDays: 30 },
      waiverText: 'I accept the risk.',
      status: 'published'
    });

    expect(draft).toMatchObject({
      teamId: 'team-1',
      formId: 'form-1',
      title: 'Spring Soccer',
      feeAmount: '125.50',
      participantFieldsText: 'Player name\nBirthdate',
      guardianFieldsText: 'Guardian name\nGuardian email',
      paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: false },
      installmentPlan: { enabled: true, title: 'Three payments', installmentCount: 3, firstDueDate: '2026-05-01', intervalDays: 30 },
      waiverText: 'I accept the risk.',
      status: 'published'
    });
    expect(draft.registrationOptions).toEqual([
      { id: 'travel', label: 'Travel Team', description: '', capacityLimit: '12', active: true, waitlistEnabled: true },
      { id: 'academy', label: 'Academy', description: '', capacityLimit: '', active: false, waitlistEnabled: false }
    ]);
  });

  it('builds legacy-compatible app setup payloads with options, fees, waivers, payment plans, and waitlists', () => {
    const result = buildAppRegistrationFormAdminPayload({
      title: 'Summer Hoops',
      description: 'June camp',
      programType: 'camp',
      season: 'Summer 2026',
      feeAmount: '200',
      participantFieldsText: 'Player name\nBirthdate',
      guardianFieldsText: 'Guardian name\nGuardian email\nGuardian phone',
      registrationOptions: [
        { id: 'full-day', label: 'Full day', capacityLimit: '20', active: true, waitlistEnabled: true },
        { id: 'half-day', label: 'Half day', capacityLimit: '', active: false, waitlistEnabled: false }
      ],
      paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
      installmentPlan: { enabled: true, installmentCount: '4', firstDueDate: '2026-06-01', intervalDays: '14' },
      waiverText: 'Guardian accepts camp waiver.',
      status: 'published'
    }, {
      teamId: 'team-1',
      now: new Date('2026-05-15T12:00:00Z')
    });

    expect(result.errors).toEqual([]);
    expect(result.payload).toMatchObject({
      teamId: 'team-1',
      programType: 'camp',
      programName: 'Summer Hoops',
      feeAmountCents: 20000,
      waiverText: 'Guardian accepts camp waiver.',
      status: 'published',
      published: true
    });
    expect(result.payload.registrationOptions).toEqual([
      { id: 'full-day', label: 'Full day', capacityLimit: 20, active: true, waitlistEnabled: true, sortOrder: 0 },
      { id: 'half-day', label: 'Half day', capacityLimit: null, active: false, waitlistEnabled: false, sortOrder: 1 }
    ]);
    expect(result.normalizedForm.registrationOptions[0]).toMatchObject({
      id: 'full-day',
      title: 'Full day',
      capacityLimit: 20,
      waitlistEnabled: true,
      active: true
    });
    expect(result.paymentPlans.map((plan) => plan.id)).toEqual(['pay_full', 'installments']);
    expect(result.feeSnapshot).toMatchObject({
      originalFeeAmountCents: 20000,
      finalAmountDueCents: 20000
    });
  });

  it('returns validation errors without throwing so the app editor can show inline setup problems', () => {
    const result = buildAppRegistrationFormAdminPayload({
      title: '',
      waiverText: '',
      participantFieldsText: 'Player name',
      guardianFieldsText: 'Guardian email',
      registrationOptions: []
    }, { teamId: 'team-1' });

    expect(result.errors).toEqual([
      'Title is required.',
      'Waiver text is required.'
    ]);
    expect(result.normalizedForm.published).toBe(false);
  });
});
