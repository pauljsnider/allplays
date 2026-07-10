import { describe, expect, it } from 'vitest';
import {
  buildAppRegistrationFormAdminPayload,
  buildRegistrationFormEditorDraft,
  toRegistrationFeeCents,
  validateRegistrationFormEditorDraft
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
      discountRules: [
        { id: 'discount_1', type: 'quantity', label: 'Sibling discount', amountType: 'fixed', amountValue: 2500, minimumQuantity: 2, active: true }
      ],
      backgroundCheck: {
        enabled: true,
        required: true,
        instructions: 'Bring a photo ID.',
        initialScreeningStatus: 'submitted',
        providerName: 'Checkr'
      },
      waiverText: 'I accept the risk.',
      status: 'published',
      published: true,
      isOpen: true,
      isClosed: false
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
      backgroundCheck: {
        enabled: true,
        required: true,
        instructions: 'Bring a photo ID.',
        initialScreeningStatus: 'submitted',
        providerName: 'Checkr'
      },
      waiverText: 'I accept the risk.',
      status: 'published'
    });
    expect(draft.registrationOptions).toEqual([
      { id: 'travel', label: 'Travel Team', description: '', capacityLimit: '12', active: true, waitlistEnabled: true },
      { id: 'academy', label: 'Academy', description: '', capacityLimit: '', active: false, waitlistEnabled: false }
    ]);
    expect(draft.discountRules).toEqual([
      { id: 'discount_1', type: 'quantity', label: 'Sibling discount', amountType: 'fixed', amountValue: 25, earlyBirdDeadline: '', minimumQuantity: 2, active: true }
    ]);
  });

  it('builds legacy-compatible app setup payloads with options, fees, waivers, payment plans, waitlists, and editable fixed discounts', () => {
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
      discountRules: [
        { id: 'discount_1', type: 'quantity', label: 'Sibling discount', amountType: 'fixed', amountValue: 25, minimumQuantity: 2, active: true }
      ],
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
    expect(result.payload.discountRules).toEqual([
      { id: 'discount_1', type: 'quantity', label: 'Sibling discount', amountType: 'fixed', amountValue: 2500, earlyBirdDeadline: '', minimumQuantity: 2, active: true, sortOrder: 0 }
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
    expect(result.publishState).toEqual({
      status: 'published',
      published: true,
      isOpen: true,
      isClosed: false
    });
  });

  it('round-trips web-created closed fixtures without reopening them for submissions', () => {
    const draft = buildRegistrationFormEditorDraft({
      id: 'form-web',
      teamId: 'team-1',
      programName: 'Closed Spring Registration',
      feeAmountCents: 14999,
      participantFields: [{ id: 'participant_1', label: 'Player name', type: 'text', required: true }],
      guardianFields: [{ id: 'guardian_1', label: 'Guardian email', type: 'email', required: true }],
      registrationOptions: [
        { id: 'travel', label: 'Travel', capacityLimit: 12, active: true, waitlistEnabled: true, sortOrder: 0 }
      ],
      paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: false },
      installmentPlan: { enabled: true, title: 'Two payments', installmentCount: 2, firstDueDate: '2026-07-01', intervalDays: 30 },
      waiverText: 'Closed form waiver.',
      status: 'closed',
      published: true
    });
    const result = buildAppRegistrationFormAdminPayload(draft, { teamId: 'team-1' });

    expect(draft).toMatchObject({
      formId: 'form-web',
      status: 'closed',
      published: false,
      isOpen: false,
      isClosed: true,
      feeAmount: '149.99'
    });
    expect(result.errors).toEqual([]);
    expect(result.payload).toMatchObject({
      status: 'closed',
      published: false,
      feeAmountCents: 14999,
      waiverText: 'Closed form waiver.'
    });
    expect(result.payload.registrationOptions).toEqual([
      { id: 'travel', label: 'Travel', capacityLimit: 12, active: true, waitlistEnabled: true, sortOrder: 0 }
    ]);
    expect(result.publishState).toEqual({
      status: 'closed',
      published: false,
      isOpen: false,
      isClosed: true
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
      'Waiver text is required.',
      'At least one registration option is required.'
    ]);
    expect(result.normalizedForm.published).toBe(false);
  });

  it('validates editor-only setup errors before saving', () => {
    expect(validateRegistrationFormEditorDraft({
      teamId: '',
      title: '',
      waiverText: '',
      feeAmount: 'not money',
      status: 'paused' as any,
      installmentPlan: { enabled: true, installmentCount: 3, firstDueDate: '', intervalDays: 30 }
    })).toEqual([
      'Team is required.',
      'Title is required.',
      'Waiver text is required.',
      'At least one registration option is required.',
      'Fee amount must be a valid dollar amount.',
      'Registration status is invalid.',
      'First installment due date is required when payment plans are enabled.'
    ]);

    expect(validateRegistrationFormEditorDraft({
      teamId: 'team-1',
      title: 'Free clinic',
      waiverText: 'Accepted.',
      feeAmount: '-1'
    })).toEqual([
      'At least one registration option is required.',
      'Fee amount must be zero or greater.'
    ]);
  });

  it('converts registration fee inputs to cents consistently', () => {
    expect(toRegistrationFeeCents('125.50')).toBe(12550);
    expect(toRegistrationFeeCents('$1,234.56')).toBe(123456);
    expect(toRegistrationFeeCents('19.995')).toBe(2000);
    expect(toRegistrationFeeCents('')).toBe(0);
    expect(toRegistrationFeeCents('-5')).toBe(0);
  });
});
