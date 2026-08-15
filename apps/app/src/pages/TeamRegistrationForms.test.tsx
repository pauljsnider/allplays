// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamRegistrationForms } from './TeamRegistrationForms';
import type { AuthState } from '../lib/types';

const serviceMocks = vi.hoisted(() => ({
  canManageRegistrationFormsForApp: vi.fn(() => true),
  listRegistrationFormEditorsForApp: vi.fn(),
  saveRegistrationFormEditorForApp: vi.fn()
}));

vi.mock('../lib/registrationFormAdminService', () => serviceMocks);

const existingDraft = {
  teamId: 'team-1',
  formId: 'form-1',
  title: 'Spring Soccer',
  description: 'Season signup',
  programType: 'season',
  season: 'Spring 2027',
  feeAmount: '125.00',
  participantFieldsText: 'Player name\nBirthdate',
  guardianFieldsText: 'Guardian name\nGuardian email',
  registrationOptions: [{ id: 'travel', label: 'Travel', description: '', capacityLimit: '12', active: true, waitlistEnabled: false }],
  paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: false },
  installmentPlan: { enabled: false, title: 'Installment plan', installmentCount: 3, firstDueDate: '', intervalDays: 30 },
  discountRules: [],
  backgroundCheck: { enabled: false, required: false, instructions: '', initialScreeningStatus: 'pending', providerName: '' },
  waiverText: 'Guardian accepts the waiver.',
  status: 'draft',
  published: false,
  isOpen: false,
  isClosed: false
} as any;

const auth: AuthState = {
  user: { uid: 'coach-1', email: 'coach@example.com', coachOf: ['team-1'], roles: [] } as any,
  profile: null,
  loading: false,
  error: null,
  roles: ['coach'],
  isParent: false,
  isCoach: true,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teams/team-1/registration-forms']}>
      <Routes>
        <Route path="/teams/:teamId/registration-forms" element={<TeamRegistrationForms auth={auth} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TeamRegistrationForms', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.canManageRegistrationFormsForApp.mockReturnValue(true);
    serviceMocks.listRegistrationFormEditorsForApp.mockResolvedValue([existingDraft]);
    serviceMocks.saveRegistrationFormEditorForApp.mockImplementation(async ({ draft }: any) => ({
      formId: 'form-1',
      created: false,
      payload: {
        teamId: 'team-1',
        title: draft.title,
        programName: draft.title,
        description: draft.description,
        programType: draft.programType,
        season: draft.season,
        feeAmountCents: 12500,
        participantFields: [{ id: 'participant_1', label: 'Player name', type: 'text', required: true }],
        guardianFields: [{ id: 'guardian_1', label: 'Guardian email', type: 'email', required: true }],
        registrationOptions: draft.registrationOptions,
        paymentSettings: draft.paymentSettings,
        installmentPlan: draft.installmentPlan,
        discountRules: draft.discountRules,
        backgroundCheck: draft.backgroundCheck,
        waiverText: draft.waiverText,
        status: draft.status,
        published: draft.status === 'published'
      }
    }));
  });

  it('loads, edits, publishes, and saves a legacy-compatible form through the app service', async () => {
    renderPage();

    expect(await screen.findByDisplayValue('Spring Soccer')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Spring Soccer Updated' } });
    fireEvent.click(screen.getByLabelText('Enable waitlist'));
    fireEvent.click(screen.getByLabelText('Offer payment plan'));
    fireEvent.change(screen.getByLabelText('Installments'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('First due date'), { target: { value: '2027-01-15' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'published' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(serviceMocks.saveRegistrationFormEditorForApp).toHaveBeenCalledWith(expect.objectContaining({
      user: auth.user,
      teamId: 'team-1',
      formId: 'form-1',
      draft: expect.objectContaining({
        title: 'Spring Soccer Updated',
        status: 'published',
        registrationOptions: [expect.objectContaining({ waitlistEnabled: true })],
        installmentPlan: expect.objectContaining({ enabled: true, installmentCount: '2', firstDueDate: '2027-01-15' })
      })
    })));
    expect(await screen.findByText('Registration form saved.')).toBeTruthy();
  });

  it('previews current unsaved parent-visible values without saving or exposing submission controls', async () => {
    serviceMocks.listRegistrationFormEditorsForApp.mockResolvedValue([{
      ...existingDraft,
      registrationOptions: [
        { ...existingDraft.registrationOptions[0], description: 'Original option description.' },
        { id: 'inactive', label: 'Hidden option', description: 'Parents should not see this.', capacityLimit: '', active: false, waitlistEnabled: false }
      ],
      discountRules: [
        { id: 'sibling', type: 'quantity', label: 'Sibling savings', amountType: 'fixed', amountValue: 25, minimumQuantity: 2, active: true },
        { id: 'hidden', type: 'quantity', label: 'Hidden discount', amountType: 'percent', amountValue: 50, minimumQuantity: 2, active: false }
      ]
    }]);
    renderPage();

    expect(await screen.findByDisplayValue('Spring Soccer')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved Summer Clinic' } });
    fireEvent.change(document.querySelector('textarea[aria-label="Description"]')!, { target: { value: 'Current unsaved parent description.' } });
    fireEvent.change(screen.getByLabelText('Season'), { target: { value: 'Summer 2027' } });
    fireEvent.change(screen.getByLabelText('Base fee (USD)'), { target: { value: '240.00' } });
    fireEvent.change(screen.getByLabelText('Option 1 name'), { target: { value: 'Unsaved travel program' } });
    fireEvent.change(screen.getByLabelText('Option 1 description'), { target: { value: 'Includes tournaments and uniforms.' } });
    fireEvent.change(screen.getByLabelText('Participant fields'), { target: { value: 'Player legal name\nJersey size' } });
    fireEvent.change(screen.getByLabelText('Guardian fields'), { target: { value: 'Guardian full name\nGuardian email' } });
    fireEvent.change(screen.getByLabelText('Waiver text'), { target: { value: 'Unsaved waiver terms for the family.' } });
    fireEvent.click(screen.getByLabelText('Offer payment plan'));
    fireEvent.change(screen.getByLabelText('Installments'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('First due date'), { target: { value: '2027-05-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview as parent' }));

    const dialog = await screen.findByRole('dialog', { name: 'Parent registration preview' });
    expect(dialog.textContent).toContain('Preview only. Registration and payment are disabled.');
    expect(dialog.textContent).toContain('Unsaved Summer Clinic');
    expect(dialog.textContent).toContain('Current unsaved parent description.');
    expect(dialog.textContent).toContain('Summer 2027');
    expect(dialog.textContent).toContain('Unsaved travel program');
    expect(dialog.textContent).toContain('Includes tournaments and uniforms.');
    expect(dialog.textContent).not.toContain('Hidden option');
    expect(dialog.textContent).toContain('Player legal name');
    expect(dialog.textContent).toContain('Jersey size');
    expect(dialog.textContent).toContain('Guardian full name');
    expect(dialog.textContent).toContain('Guardian email');
    expect(dialog.textContent).toContain('$240.00');
    expect(dialog.textContent).toContain('Sibling savings');
    expect(dialog.textContent).not.toContain('Hidden discount');
    expect(dialog.textContent).toContain('Pay in full');
    expect(dialog.textContent).toContain('Installment plan');
    expect(dialog.textContent).toContain('4 installments');
    expect(dialog.textContent).toContain('Unsaved waiver terms for the family.');
    expect(screen.queryByRole('button', { name: /submit registration|pay registration/i })).toBeNull();
    expect(serviceMocks.saveRegistrationFormEditorForApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close parent preview' }));
    expect(screen.queryByRole('dialog', { name: 'Parent registration preview' })).toBeNull();
    expect(screen.getByDisplayValue('Unsaved Summer Clinic')).toBeTruthy();
    expect(serviceMocks.saveRegistrationFormEditorForApp).not.toHaveBeenCalled();
  });

  it.each(['draft', 'published', 'closed'] as const)('opens an authorized parent preview for a %s form', async (status) => {
    serviceMocks.listRegistrationFormEditorsForApp.mockResolvedValue([{
      ...existingDraft,
      title: `${status} registration`,
      status,
      published: status === 'published',
      isOpen: status === 'published',
      isClosed: status === 'closed'
    }]);
    renderPage();

    expect(await screen.findByDisplayValue(`${status} registration`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview as parent' }));

    expect(await screen.findByRole('dialog', { name: 'Parent registration preview' })).toBeTruthy();
    expect(serviceMocks.saveRegistrationFormEditorForApp).not.toHaveBeenCalled();
  });

  it('opens an authorized parent preview for a new unsaved form', async () => {
    serviceMocks.listRegistrationFormEditorsForApp.mockResolvedValue([]);
    renderPage();

    await screen.findByText('No saved forms yet.');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Brand new preview' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview as parent' }));

    expect((await screen.findByRole('dialog', { name: 'Parent registration preview' })).textContent).toContain('Brand new preview');
    expect(serviceMocks.saveRegistrationFormEditorForApp).not.toHaveBeenCalled();
  });

  it('blocks save when all registration options are removed', async () => {
    serviceMocks.listRegistrationFormEditorsForApp.mockResolvedValue([]);
    renderPage();

    await screen.findByText('No saved forms yet.');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Clinic' } });
    fireEvent.change(screen.getByLabelText('Waiver text'), { target: { value: 'Guardian accepts.' } });
    fireEvent.click(screen.getByLabelText('Remove option 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));

    expect((await screen.findByRole('alert')).textContent).toContain('At least one registration option is required.');
    expect(serviceMocks.saveRegistrationFormEditorForApp).not.toHaveBeenCalled();
  });

  it('shows an access boundary to non-staff users', async () => {
    serviceMocks.canManageRegistrationFormsForApp.mockReturnValue(false);
    serviceMocks.listRegistrationFormEditorsForApp.mockRejectedValue(new Error('Admin access is required to manage registration forms.'));
    renderPage();

    expect(await screen.findByText('Admin access is required to manage registration forms.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save form' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview as parent' })).toBeNull();
  });
});
