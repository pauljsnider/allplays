import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => {
  const formatPart = (part: unknown) => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && 'path' in part) return String((part as any).path);
    return String(part);
  };

  return {
    db: { path: 'db' },
    collection: vi.fn((...parts: unknown[]) => ({ path: parts.map(formatPart).join('/') })),
    doc: vi.fn((...parts: unknown[]) => {
      if (parts.length === 1) {
        return { id: 'generated-form', path: `${formatPart(parts[0])}/generated-form` };
      }
      return { id: formatPart(parts[parts.length - 1]), path: parts.map(formatPart).join('/') };
    }),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    serverTimestamp: vi.fn(() => 'server-timestamp'),
    setDoc: vi.fn(),
    updateDoc: vi.fn()
  };
});

vi.mock('../../../../js/firebase.js', () => firebaseMocks);

import {
  canManageRegistrationFormsForApp,
  listRegistrationFormEditorsForApp,
  loadRegistrationFormEditorForApp,
  saveRegistrationFormEditorForApp
} from './registrationFormAdminService';

const coachUser = {
  uid: 'coach-1',
  email: 'coach@example.com',
  coachOf: ['team-1'],
  roles: []
} as any;

const webCreatedFixture = {
  teamId: 'team-1',
  programName: 'Spring Soccer',
  title: 'Spring Soccer',
  description: 'Season signup',
  season: 'Spring 2026',
  feeAmountCents: 12550,
  participantFields: [
    { id: 'participant_1', label: 'Player name', type: 'text', required: true },
    { id: 'participant_2', label: 'Birthdate', type: 'date', required: true }
  ],
  guardianFields: [
    { id: 'guardian_1', label: 'Guardian email', type: 'email', required: true }
  ],
  registrationOptions: [
    { id: 'travel', label: 'Travel', capacityLimit: 12, active: true, waitlistEnabled: true, sortOrder: 0 }
  ],
  paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
  installmentPlan: { enabled: true, title: 'Two payments', installmentCount: 2, firstDueDate: '2026-06-01', intervalDays: 14 },
  discountRules: [
    { id: 'discount_1', type: 'quantity', label: 'Sibling discount', amountType: 'fixed', amountValue: 2500, minimumQuantity: 2, active: true, sortOrder: 0 }
  ],
  waiverText: 'Guardian accepts the season waiver.',
  status: 'published',
  published: true
};

describe('registrationFormAdminService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks staff access for registration form management', () => {
    expect(canManageRegistrationFormsForApp(coachUser, 'team-1')).toBe(true);
    expect(canManageRegistrationFormsForApp({ uid: 'admin-1', roles: ['platformAdmin'] } as any, 'team-2')).toBe(true);
    expect(canManageRegistrationFormsForApp({ uid: 'admin-2', isAdmin: true } as any, 'team-2')).toBe(true);
    expect(canManageRegistrationFormsForApp({ uid: 'parent-1', coachOf: [] } as any, 'team-1')).toBe(false);
    expect(canManageRegistrationFormsForApp(null, 'team-1')).toBe(false);
  });

  it('loads a web-created registration form into the app editor model', async () => {
    firebaseMocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => webCreatedFixture
    });

    const draft = await loadRegistrationFormEditorForApp(coachUser, 'team-1', 'form-1');

    expect(firebaseMocks.getDoc).toHaveBeenCalledWith({ id: 'form-1', path: 'db/teams/team-1/registrationForms/form-1' });
    expect(draft).toMatchObject({
      teamId: 'team-1',
      formId: 'form-1',
      title: 'Spring Soccer',
      feeAmount: '125.50',
      status: 'published',
      published: true,
      isOpen: true,
      waiverText: 'Guardian accepts the season waiver.',
      paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true }
    });
    expect(draft.registrationOptions).toEqual([
      { id: 'travel', label: 'Travel', description: '', capacityLimit: '12', active: true, waitlistEnabled: true }
    ]);
    expect(draft.discountRules).toEqual([
      { id: 'discount_1', type: 'quantity', label: 'Sibling discount', amountType: 'fixed', amountValue: 25, earlyBirdDeadline: '', minimumQuantity: 2, active: true }
    ]);
  });

  it('lists web and app-created forms as sorted editor drafts', async () => {
    firebaseMocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'form-z', data: () => ({ ...webCreatedFixture, programName: 'Winter League', title: 'Winter League' }) },
        { id: 'form-a', data: () => ({ ...webCreatedFixture, programName: 'Autumn Camp', title: 'Autumn Camp', status: 'closed' }) }
      ]
    });

    const drafts = await listRegistrationFormEditorsForApp(coachUser, 'team-1');

    expect(firebaseMocks.getDocs).toHaveBeenCalledWith({ path: 'db/teams/team-1/registrationForms' });
    expect(drafts.map((draft) => ({ formId: draft.formId, title: draft.title, status: draft.status }))).toEqual([
      { formId: 'form-a', title: 'Autumn Camp', status: 'closed' },
      { formId: 'form-z', title: 'Winter League', status: 'published' }
    ]);
  });

  it('creates published registration forms with legacy-compatible payload metadata', async () => {
    const result = await saveRegistrationFormEditorForApp({
      user: coachUser,
      teamId: 'team-1',
      draft: {
        title: 'Summer Camp',
        description: 'June camp',
        season: 'Summer 2026',
        feeAmount: '200.00',
        participantFieldsText: 'Player name',
        guardianFieldsText: 'Guardian email',
        registrationOptions: [
          { id: 'full-day', label: 'Full day', capacityLimit: '20', active: true, waitlistEnabled: true }
        ],
        paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: false },
        installmentPlan: { enabled: true, installmentCount: 4, firstDueDate: '2026-06-01', intervalDays: 14 },
        waiverText: 'Guardian accepts camp waiver.',
        status: 'published'
      },
      now: new Date('2026-05-15T12:00:00Z')
    });

    expect(result).toMatchObject({ formId: 'generated-form', created: true });
    expect(firebaseMocks.setDoc).toHaveBeenCalledWith(
      { id: 'generated-form', path: 'db/teams/team-1/registrationForms/generated-form' },
      expect.objectContaining({
        teamId: 'team-1',
        programName: 'Summer Camp',
        title: 'Summer Camp',
        feeAmountCents: 20000,
        status: 'published',
        published: true,
        waiverText: 'Guardian accepts camp waiver.',
        createdAt: 'server-timestamp',
        createdBy: 'coach-1',
        updatedAt: 'server-timestamp',
        updatedBy: 'coach-1'
      })
    );
    expect((firebaseMocks.setDoc.mock.calls[0][1] as any).registrationOptions).toEqual([
      { id: 'full-day', label: 'Full day', capacityLimit: 20, active: true, waitlistEnabled: true, sortOrder: 0 }
    ]);
    expect((firebaseMocks.setDoc.mock.calls[0][1] as any).installmentPlan).toEqual({
      enabled: true,
      title: 'Installment plan',
      installmentCount: 4,
      firstDueDate: '2026-06-01',
      intervalDays: 14
    });
  });

  it('updates closed registration forms without reopening public submissions', async () => {
    const result = await saveRegistrationFormEditorForApp({
      user: coachUser,
      teamId: 'team-1',
      formId: 'form-1',
      draft: {
        formId: 'form-1',
        title: 'Spring Soccer Waitlist',
        description: 'Season signup',
        participantFieldsText: 'Player name\nBirthdate',
        guardianFieldsText: 'Guardian email',
        registrationOptions: [
          { id: 'travel', label: 'Travel', capacityLimit: '12', active: true, waitlistEnabled: true }
        ],
        paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
        installmentPlan: { enabled: true, title: 'Two payments', installmentCount: 2, firstDueDate: '2026-06-01', intervalDays: 14 },
        discountRules: [
          { id: 'discount_1', type: 'quantity', label: 'Sibling discount', amountType: 'fixed', amountValue: 25, minimumQuantity: 2, active: true }
        ],
        waiverText: 'Guardian accepts the season waiver.',
        feeAmount: '99.99',
        status: 'closed'
      }
    });

    expect(result).toMatchObject({
      formId: 'form-1',
      created: false,
      publishState: {
        status: 'closed',
        published: false,
        isOpen: false,
        isClosed: true
      }
    });
    expect(firebaseMocks.updateDoc).toHaveBeenCalledWith(
      { id: 'form-1', path: 'db/teams/team-1/registrationForms/form-1' },
      expect.objectContaining({
        programName: 'Spring Soccer Waitlist',
        feeAmountCents: 9999,
        status: 'closed',
        published: false,
        updatedAt: 'server-timestamp',
        updatedBy: 'coach-1'
      })
    );
  });

  it('rejects invalid drafts before writing to Firestore', async () => {
    await expect(saveRegistrationFormEditorForApp({
      user: coachUser,
      teamId: 'team-1',
      draft: {
        title: '',
        waiverText: '',
        feeAmount: 'bad',
        status: 'published'
      }
    })).rejects.toThrow('Title is required. Waiver text is required. At least one registration option is required. Fee amount must be a valid dollar amount.');

    expect(firebaseMocks.setDoc).not.toHaveBeenCalled();
    expect(firebaseMocks.updateDoc).not.toHaveBeenCalled();
  });
});
