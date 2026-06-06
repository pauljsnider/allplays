import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationDetail } from './RegistrationDetail';
import type { AuthState } from '../lib/types';
import { openPublicUrl } from '../lib/publicActions';

const parentToolsServiceMocks = vi.hoisted(() => ({
  initiateRegistrationCheckout: vi.fn(),
  loadParentRegistrationDetail: vi.fn(),
  loadPublicRegistrationDetail: vi.fn(),
  loadParentRegistrations: vi.fn(),
  releaseCancelledRegistrationCheckout: vi.fn(),
  retryRegistrationCheckout: vi.fn(),
  submitOfflineRegistration: vi.fn()
}));

vi.mock('../lib/parentToolsService', () => parentToolsServiceMocks);
vi.mock('../lib/publicActions', () => ({
  openPublicUrl: vi.fn()
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

function renderPublicRegistration(query = 'teamId=team-1&formId=form-1') {
  return render(
    <MemoryRouter initialEntries={[`/registration?${query}`]}>
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
  });

  it('renders the payment section for public online checkout forms', async () => {
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      paymentNotice: 'Payment will be collected in Stripe before your registration is complete.',
      onlineCheckout: true
    }));

    renderPublicRegistration();

    expect(await screen.findByRole('heading', { name: 'Payment' })).toBeInTheDocument();
    expect(screen.getByText('Payment will be collected in Stripe before your registration is complete.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay registration with Stripe' })).toBeInTheDocument();
  });

  it('hides the payment section when no notice exists for authenticated parent forms', async () => {
    parentToolsServiceMocks.loadParentRegistrationDetail.mockResolvedValue(buildDetail());

    renderParentRegistration();

    expect(await screen.findByRole('button', { name: 'Submit registration' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Payment' })).not.toBeInTheDocument();
    expect(parentToolsServiceMocks.loadParentRegistrationDetail).toHaveBeenCalledWith(auth.user, 'team-1', 'form-1');
  });

  it('shows canceled checkout retry state and releases the canceled attempt', async () => {
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      paymentNotice: 'Payment will be collected in Stripe before your registration is complete.',
      onlineCheckout: true
    }));

    renderPublicRegistration('teamId=team-1&formId=form-1&registrationId=reg-1&checkoutAttemptToken=attempt-token-123456&retryPayment=1&status=cancelled');

    expect(await screen.findByText('Stripe payment was canceled. You can retry payment for your existing registration.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry payment with Stripe' })).toBeInTheDocument();
    await waitFor(() => {
      expect(parentToolsServiceMocks.releaseCancelledRegistrationCheckout).toHaveBeenCalledWith('team-1', 'form-1', 'reg-1', 'attempt-token-123456');
    });
  });

  it('retries checkout without creating a duplicate registration', async () => {
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      onlineCheckout: true
    }));
    parentToolsServiceMocks.retryRegistrationCheckout.mockResolvedValue({
      success: true,
      checkoutUrl: 'https://checkout.stripe.com/retry-session'
    });

    renderPublicRegistration('teamId=team-1&formId=form-1&registrationId=reg-1&checkoutAttemptToken=attempt-token-123456&retryPayment=1&status=cancelled');

    fireEvent.click(await screen.findByRole('button', { name: 'Retry payment with Stripe' }));

    await waitFor(() => {
      expect(parentToolsServiceMocks.retryRegistrationCheckout).toHaveBeenCalledWith('team-1', 'form-1', 'reg-1', 'attempt-token-123456');
      expect(parentToolsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();
      expect(openPublicUrl).toHaveBeenCalledWith('https://checkout.stripe.com/retry-session');
    });
  });

  it('renders success return confirmation instead of the editable registration form', async () => {
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      onlineCheckout: true
    }));

    renderPublicRegistration('teamId=team-1&formId=form-1&registrationId=reg-1&checkoutAttemptToken=attempt-token-123456&status=success');

    expect(await screen.findByRole('heading', { name: 'Payment successful' })).toBeInTheDocument();
    expect(screen.getByText('Your registration payment was received. The program organizer will follow up with next steps.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay registration with Stripe' })).not.toBeInTheDocument();
  });

  it('stores the checkout attempt token when starting a fresh app checkout', async () => {
    let submittedCheckoutAttemptToken = '';
    parentToolsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      onlineCheckout: true
    }));
    parentToolsServiceMocks.submitOfflineRegistration.mockImplementation(async (_teamId, _formId, submission) => {
      submittedCheckoutAttemptToken = submission.checkoutAttemptToken;
      return {
        success: true,
        status: 'pending',
        registrationId: 'reg-1',
        feeSnapshot: {
          finalAmountDueCents: 12500,
          currency: 'USD'
        }
      };
    });
    parentToolsServiceMocks.initiateRegistrationCheckout.mockResolvedValue({
      success: true,
      checkoutUrl: 'https://checkout.stripe.com/fresh-session'
    });

    renderPublicRegistration();

    fireEvent.click(await screen.findByRole('button', { name: 'Pay registration with Stripe' }));

    await waitFor(() => {
      expect(submittedCheckoutAttemptToken).toMatch(/^[a-f0-9]{32}$/);
      expect(parentToolsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
        'team-1',
        'form-1',
        'reg-1',
        '',
        'pay_full',
        1,
        12500,
        'USD',
        { checkoutAttemptToken: submittedCheckoutAttemptToken, returnToApp: true }
      );
      expect(openPublicUrl).toHaveBeenCalledWith('https://checkout.stripe.com/fresh-session');
    });
  });
});
