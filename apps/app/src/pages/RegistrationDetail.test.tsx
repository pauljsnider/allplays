// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationDetail } from './RegistrationDetail';
import type { AuthState } from '../lib/types';

const parentToolsServiceMocks = vi.hoisted(() => ({
  cancelRegistrationCheckout: vi.fn(),
  initiateRegistrationCheckout: vi.fn(),
  loadParentRegistrationDetail: vi.fn(),
  loadPublicRegistrationDetail: vi.fn(),
  loadParentRegistrations: vi.fn(),
  submitOfflineRegistration: vi.fn()
}));
const openPublicUrlMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/parentToolsService', () => parentToolsServiceMocks);
vi.mock('../lib/publicActions', () => ({
  openPublicUrl: openPublicUrlMock
}));

const auth: AuthState = {
  user: {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Parent One',
    roles: ['parent'],
    parentOf: []
  },
  profile: null,
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

function buildDetail(overrides: Record<string, any> = {}) {
  return {
    teamName: 'Bears',
    paymentNotice: '',
    onlineCheckout: false,
    legacyUrl: '',
    options: [],
    paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }],
    feeSnapshot: {
      originalFeeAmountCents: 12500,
      finalAmountDueCents: 12500,
      currency: 'USD'
    },
    isPublished: true,
    form: {
      programName: 'Summer Camp',
      description: '',
      season: '2026',
      currency: 'USD',
      participantFields: [],
      guardianFields: [],
      registrationOptionCounts: {},
      feeAmountCents: 12500,
      ...overrides.form
    },
    ...overrides
  };
}

function renderPublicRegistration(path = '/registration?teamId=team-1&formId=form-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/registration" element={<RegistrationDetail auth={auth} publicAccess />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderParentRegistration() {
  return render(
    <MemoryRouter initialEntries={['/parent-tools/registrations/team-1/form-1']}>
      <Routes>
        <Route path="/parent-tools/registrations/:teamId/:formId" element={<RegistrationDetail auth={auth} />} />
        <Route path="/parent-tools/registrations" element={<div>Registrations</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RegistrationDetail payment notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openPublicUrlMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the payment section for public online checkout forms', async () => {
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      paymentNotice: 'Payment will be collected in Stripe before your registration is complete.',
      onlineCheckout: true
    }));

    renderPublicRegistration();

    expect(await screen.findByRole('heading', { name: 'Payment' })).toBeTruthy();
    expect(screen.getByText('Payment will be collected in Stripe before your registration is complete.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay registration with Stripe' })).toBeTruthy();
  });

  it('hides the payment section when no notice exists for authenticated parent forms', async () => {
    parentToolsServiceMocks.loadParentRegistrationDetail.mockResolvedValue(buildDetail());

    renderParentRegistration();

    expect(await screen.findByRole('button', { name: 'Submit registration' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Payment' })).toBeNull();
    expect(parentToolsServiceMocks.loadParentRegistrationDetail).toHaveBeenCalledWith(auth.user, 'team-1', 'form-1');
  });

  it('shows retry guidance and releases cancelled checkout attempts on Stripe cancel returns', async () => {
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      paymentNotice: 'Payment will be collected in Stripe before your registration is complete.',
      onlineCheckout: true
    }));
    parentToolsServiceMocks.cancelRegistrationCheckout.mockResolvedValue({ released: true, nextPublicCheckoutCapability: 'cap-2' });

    renderPublicRegistration('/registration?teamId=team-1&formId=form-1&publicCheckoutCapability=cap-1&retryPayment=1&status=cancelled');

    expect(await screen.findByText('Stripe payment was cancelled. You can retry payment for this registration.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry payment with Stripe' })).toBeTruthy();
    await waitFor(() => expect(parentToolsServiceMocks.cancelRegistrationCheckout).toHaveBeenCalledWith('team-1', 'form-1', '', '', 'cap-1'));
  });

  it('retries Stripe checkout without creating a duplicate registration', async () => {
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      onlineCheckout: true,
      paymentNotice: 'Pay online.'
    }));
    parentToolsServiceMocks.cancelRegistrationCheckout.mockResolvedValue({ released: true, nextPublicCheckoutCapability: 'cap-2' });
    parentToolsServiceMocks.initiateRegistrationCheckout.mockResolvedValue({ success: true, checkoutUrl: 'https://stripe.example/checkout' });

    renderPublicRegistration('/registration?teamId=team-1&formId=form-1&publicCheckoutCapability=cap-1&retryPayment=1&status=cancelled');

    fireEvent.click(await screen.findByRole('button', { name: 'Retry payment with Stripe' }));

    await waitFor(() => expect(parentToolsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      '',
      '',
      'pay_full',
      1,
      12500,
      'USD',
      {
        checkoutAttemptToken: '',
        retryPayment: true,
        publicCheckoutCapability: 'cap-2'
      }
    ));
    expect(parentToolsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();
    expect(openPublicUrlMock).toHaveBeenCalledWith('https://stripe.example/checkout');
  });

  it('shows the first installment due now plus the remaining schedule before checkout', async () => {
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      onlineCheckout: true,
      paymentNotice: 'Pay online.',
      paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }, { id: 'installments', title: 'Monthly installments' }],
      form: {
        installmentPlan: {
          enabled: true,
          title: 'Monthly installments',
          installmentCount: 3,
          firstDueDate: '2026-07-01',
          intervalDays: 30
        }
      }
    }));

    renderPublicRegistration();

    const paymentPlan = await screen.findByLabelText('Payment plan');
    fireEvent.change(paymentPlan, { target: { value: 'installments' } });

    expect(await screen.findByLabelText('Installment payment summary')).toBeTruthy();
    expect(screen.getByText('Amount due now')).toBeTruthy();
    expect(screen.getAllByText('$41.66')).toHaveLength(2);
    expect(screen.getByText('Installment 2 · Due Jul 31, 2026')).toBeTruthy();
    expect(screen.getByText('Installment 3 · Due Aug 30, 2026')).toBeTruthy();
  });

  it('replaces the form with a success confirmation after Stripe success returns', async () => {
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      onlineCheckout: true,
      paymentNotice: 'Pay online.'
    }));

    renderPublicRegistration('/registration?teamId=team-1&formId=form-1&publicCheckoutCapability=cap-1&retryPayment=1&status=success');

    expect(await screen.findByRole('heading', { name: 'Payment successful' })).toBeTruthy();
    expect(screen.getByText('Your registration payment was received. The program organizer will follow up with next steps.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry payment with Stripe' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pay registration with Stripe' })).toBeNull();
  });

  it('shows remaining installments after a successful installment payment', async () => {
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      onlineCheckout: true,
      paymentNotice: 'Pay online.',
      paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }, { id: 'installments', title: 'Monthly installments' }],
      form: {
        installmentPlan: {
          enabled: true,
          title: 'Monthly installments',
          installmentCount: 3,
          firstDueDate: '2026-07-01',
          intervalDays: 30
        }
      }
    }));

    renderPublicRegistration('/registration?teamId=team-1&formId=form-1&publicCheckoutCapability=cap-1&retryPayment=1&paymentPlanId=installments&paidInstallmentCount=2&status=success');

    expect(await screen.findByRole('heading', { name: 'Payment successful' })).toBeTruthy();
    expect(screen.getByText('Your installment payment was received. Here is what remains on your payment schedule.')).toBeTruthy();
    const remainingSchedule = screen.getByLabelText('Remaining installment schedule');
    expect(remainingSchedule).toBeTruthy();
    expect(screen.getByText('Remaining balance')).toBeTruthy();
    expect(within(remainingSchedule).getAllByText('$41.68')).toHaveLength(2);
    expect(screen.queryByText('Installment 2 · Due Jul 31, 2026')).toBeNull();
    expect(screen.getByText('Installment 3 · Due Aug 30, 2026')).toBeTruthy();
  });
});
