// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationDetail } from './RegistrationDetail';
import { TeamRegistrationReview } from './TeamRegistrationReview';
import type { AuthState } from '../lib/types';

const parentRegistrationsServiceMocks = vi.hoisted(() => ({
  acceptTeamRegistrationOfferForApp: vi.fn(),
  approveTeamRegistrationForApp: vi.fn(),
  cancelRegistrationCheckout: vi.fn(),
  extendTeamRegistrationOfferForApp: vi.fn(),
  initiateRegistrationCheckout: vi.fn(),
  loadParentRegistrationDetail: vi.fn(),
  loadPublicRegistrationDetail: vi.fn(),
  loadParentRegistrations: vi.fn(),
  loadStaffRegistrationDetail: vi.fn(),
  loadTeamRegistrationQueuePage: vi.fn(),
  loadTeamRegistrationRosterPlayers: vi.fn(),
  rejectTeamRegistrationForApp: vi.fn(),
  submitOfflineRegistration: vi.fn()
}));
const openPublicUrlMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/parentRegistrationsService', () => parentRegistrationsServiceMocks);
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

function renderStaffRegistrationReview() {
  return render(
    <MemoryRouter initialEntries={['/teams/team-1/registrations/form-1/review']}>
      <Routes>
        <Route path="/teams/:teamId/registrations/:formId/review" element={<TeamRegistrationReview auth={{ ...auth, user: { ...auth.user!, roles: ['coach'], coachOf: ['team-1'] } as any, roles: ['coach'], isParent: false, isCoach: true }} />} />
        <Route path="/teams/:teamId" element={<div>Team detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function buildReview(overrides: Record<string, any> = {}) {
  return {
    id: 'review-1',
    status: 'pending',
    participantName: 'Pat Star',
    guardianLabel: 'Parent One',
    participant: { name: 'Pat Star' },
    guardian: { email: 'parent@example.com' },
    selectedOption: { id: 'opt-1' },
    selectedOptionLabel: 'Full week',
    paymentLabel: '$75.00',
    waiverAccepted: true,
    linkedPlayerId: '',
    decisionNote: '',
    ...overrides
  };
}

function RouteSwapButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>Swap route</button>;
}

function renderParentRegistrationWithRouteSwap() {
  return render(
    <MemoryRouter initialEntries={['/parent-tools/registrations/team-1/form-1']}>
      <Routes>
        <Route
          path="/parent-tools/registrations/:teamId/:formId"
          element={(
            <>
              <RouteSwapButton to="/parent-tools/registrations/team-1/form-2" />
              <RegistrationDetail auth={auth} />
            </>
          )}
        />
        <Route path="/parent-tools/registrations" element={<div>Registrations</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RegistrationDetail registration description', () => {
  beforeEach(() => {
    Object.values(parentRegistrationsServiceMocks).forEach((mock) => mock.mockReset());
    openPublicUrlMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a trimmed public registration description before participant fields', async () => {
    parentRegistrationsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      form: {
        description: '  Open to players ages 9–12.\nBring a water bottle.  ',
        participantFields: [{ id: 'name', label: 'Player name', type: 'text', required: true }]
      }
    }));

    renderPublicRegistration();

    const description = await screen.findByLabelText('Registration description');
    const participantHeading = screen.getByRole('heading', { name: 'Participant information' });

    expect(description).toHaveTextContent('Open to players ages 9–12. Bring a water bottle.');
    expect(description.compareDocumentPosition(participantHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits whitespace-only descriptions and preserves the parent submit flow', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrationDetail.mockResolvedValue(buildDetail({
      form: {
        description: '  \n\t ',
        participantFields: [{ id: 'name', label: 'Player name', type: 'text', required: false }]
      }
    }));
    parentRegistrationsServiceMocks.submitOfflineRegistration.mockResolvedValue({
      status: 'pending',
      registrationId: 'registration-1'
    });

    renderParentRegistration();

    const submitButton = await screen.findByRole('button', { name: 'Submit registration' });
    expect(screen.queryByLabelText('Registration description')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Participant information' })).toBeTruthy();

    fireEvent.click(submitButton);

    await waitFor(() => expect(parentRegistrationsServiceMocks.submitOfflineRegistration).toHaveBeenCalledTimes(1));
  });
});

describe('RegistrationDetail payment notice', () => {
  beforeEach(() => {
    Object.values(parentRegistrationsServiceMocks).forEach((mock) => mock.mockReset());
    openPublicUrlMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the payment section for public online checkout forms', async () => {
    parentRegistrationsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      paymentNotice: 'Payment will be collected in Stripe before your registration is complete.',
      onlineCheckout: true
    }));

    renderPublicRegistration();

    expect(await screen.findByRole('heading', { name: 'Payment' })).toBeTruthy();
    expect(screen.getByText('Payment will be collected in Stripe before your registration is complete.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay registration with Stripe' })).toBeTruthy();
  });

  it('hides the payment section when no notice exists for authenticated parent forms', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrationDetail.mockResolvedValue(buildDetail());

    renderParentRegistration();

    expect(await screen.findByRole('button', { name: 'Submit registration' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Payment' })).toBeNull();
    expect(parentRegistrationsServiceMocks.loadParentRegistrationDetail).toHaveBeenCalledWith(auth.user, 'team-1', 'form-1');
  });

  it('shows retry guidance and releases cancelled checkout attempts on Stripe cancel returns', async () => {
    parentRegistrationsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      paymentNotice: 'Payment will be collected in Stripe before your registration is complete.',
      onlineCheckout: true
    }));
    parentRegistrationsServiceMocks.cancelRegistrationCheckout.mockResolvedValue({ released: true, nextPublicCheckoutCapability: 'cap-2' });

    renderPublicRegistration('/registration?teamId=team-1&formId=form-1&publicCheckoutCapability=cap-1&retryPayment=1&status=cancelled');

    expect(await screen.findByText('Stripe payment was cancelled. You can retry payment for this registration.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry payment with Stripe' })).toBeTruthy();
    await waitFor(() => expect(parentRegistrationsServiceMocks.cancelRegistrationCheckout).toHaveBeenCalledWith('team-1', 'form-1', '', '', 'cap-1'));
  });

  it('retries Stripe checkout without creating a duplicate registration', async () => {
    parentRegistrationsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
      onlineCheckout: true,
      paymentNotice: 'Pay online.'
    }));
    parentRegistrationsServiceMocks.cancelRegistrationCheckout.mockResolvedValue({ released: true, nextPublicCheckoutCapability: 'cap-2' });
    parentRegistrationsServiceMocks.initiateRegistrationCheckout.mockResolvedValue({ success: true, checkoutUrl: 'https://stripe.example/checkout' });

    renderPublicRegistration('/registration?teamId=team-1&formId=form-1&publicCheckoutCapability=cap-1&retryPayment=1&status=cancelled');

    fireEvent.click(await screen.findByRole('button', { name: 'Retry payment with Stripe' }));

    await waitFor(() => expect(parentRegistrationsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
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
    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();
    expect(openPublicUrlMock).toHaveBeenCalledWith('https://stripe.example/checkout');
  });

  it('hides the registration option selector when exactly one active option exists and still submits that option', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrationDetail.mockResolvedValue(buildDetail({
      options: [{ id: 'option-1', title: 'Varsity', capacity: 12, active: true }],
      form: {
        registrationOptionCounts: {
          'option-1': { enrolled: 4 }
        }
      }
    }));
    parentRegistrationsServiceMocks.submitOfflineRegistration.mockResolvedValue({
      status: 'pending',
      registrationId: 'registration-1'
    });

    renderParentRegistration();

    expect(await screen.findByLabelText('Selected registration option')).toBeTruthy();
    expect(screen.getByText('Varsity')).toBeTruthy();
    expect(screen.getByText('8 spots left')).toBeTruthy();
    expect(screen.queryByLabelText('Registration option')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

    await waitFor(() => expect(parentRegistrationsServiceMocks.submitOfflineRegistration).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      expect.objectContaining({
        selectedOptionId: 'option-1',
        selectedOption: expect.objectContaining({ id: 'option-1', title: 'Varsity' })
      })
    ));
  });

  it('keeps the selector for multiple active options', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrationDetail.mockResolvedValue(buildDetail({
      options: [
        { id: 'option-1', title: 'Varsity', capacity: 12, active: true },
        { id: 'option-2', title: 'Junior Varsity', capacity: 12, active: true }
      ],
      form: {
        registrationOptionCounts: {
          'option-1': { enrolled: 4 },
          'option-2': { enrolled: 6 }
        }
      }
    }));

    renderParentRegistration();

    const optionSelect = await screen.findByLabelText('Registration option');
    expect(optionSelect).toBeTruthy();
    expect(screen.queryByLabelText('Selected registration option')).toBeNull();
    expect(screen.getByRole('option', { name: 'Varsity' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Junior Varsity' })).toBeTruthy();
  });

  it('resets a reused route to the new single active option before submit', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrationDetail
      .mockResolvedValueOnce(buildDetail({
        options: [{ id: 'option-1', title: 'Varsity', capacity: 12, active: true }],
        form: {
          registrationOptionCounts: {
            'option-1': { enrolled: 4 }
          }
        }
      }))
      .mockResolvedValueOnce(buildDetail({
        form: {
          programName: 'Fall Camp',
          registrationOptionCounts: {
            'option-2': { enrolled: 2 }
          }
        },
        options: [{ id: 'option-2', title: 'Junior Varsity', capacity: 10, active: true }]
      }));
    parentRegistrationsServiceMocks.submitOfflineRegistration.mockResolvedValue({
      status: 'pending',
      registrationId: 'registration-2'
    });

    renderParentRegistrationWithRouteSwap();

    expect(await screen.findByText('Varsity')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Swap route' }));

    expect(await screen.findByText('Fall Camp')).toBeTruthy();
    expect(screen.getByText('Junior Varsity')).toBeTruthy();
    expect(screen.queryByLabelText('Registration option')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

    await waitFor(() => expect(parentRegistrationsServiceMocks.submitOfflineRegistration).toHaveBeenCalledWith(
      'team-1',
      'form-2',
      expect.objectContaining({
        selectedOptionId: 'option-2',
        selectedOption: expect.objectContaining({ id: 'option-2', title: 'Junior Varsity' })
      })
    ));
  });

  it('shows the first installment due now plus the remaining schedule before checkout', async () => {
    parentRegistrationsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
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
    parentRegistrationsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
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
    parentRegistrationsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue(buildDetail({
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

  it('loads the staff review workflow from the focused registration service and approves a pending registration', async () => {
    parentRegistrationsServiceMocks.loadStaffRegistrationDetail.mockResolvedValue(buildDetail({
      form: {
        registrationOptionCounts: {
          'opt-1': { enrolled: 4, waitlisted: 0 }
        }
      },
      options: [{ id: 'opt-1', title: 'Full week', capacityLimit: 20, waitlistEnabled: true }]
    }));
    parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage
      .mockResolvedValueOnce({
        reviews: [{
          id: 'review-1',
          status: 'pending',
          participantName: 'Pat Star',
          guardianLabel: 'Parent One',
          participant: { name: 'Pat Star' },
          guardian: { email: 'parent@example.com' },
          selectedOption: { id: 'opt-1' },
          selectedOptionLabel: 'Full week',
          paymentLabel: '$75.00',
          waiverAccepted: true,
          linkedPlayerId: '',
          decisionNote: ''
        }],
        lastDoc: null,
        hasMore: false
      })
      .mockResolvedValueOnce({ reviews: [], lastDoc: null, hasMore: false });
    parentRegistrationsServiceMocks.loadTeamRegistrationRosterPlayers.mockResolvedValue([
      { id: 'player-1', name: 'Pat Star', number: '9' }
    ]);
    parentRegistrationsServiceMocks.approveTeamRegistrationForApp.mockResolvedValue({ success: true });

    renderStaffRegistrationReview();

    expect(await screen.findByText('Applications')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Pat Star' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Approve application' }));

    await waitFor(() => expect(parentRegistrationsServiceMocks.approveTeamRegistrationForApp).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'parent-1' }),
      'team-1',
      'form-1',
      'review-1',
      { playerId: undefined }
    ));
  });

  it('paginates applications and waitlisted applicants with separate cursors', async () => {
    parentRegistrationsServiceMocks.loadStaffRegistrationDetail.mockResolvedValue(buildDetail({
      form: {
        registrationOptionCounts: {
          'opt-1': { enrolled: 4, waitlisted: 27 }
        }
      },
      options: [{ id: 'opt-1', title: 'Full week', capacityLimit: 20, waitlistEnabled: true }]
    }));
    parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage
      .mockResolvedValueOnce({
        reviews: [buildReview({ id: 'review-1', participantName: 'Pat Star' })],
        lastDoc: 'main-cursor-1',
        hasMore: true
      })
      .mockResolvedValueOnce({
        reviews: [buildReview({ id: 'waitlist-1', status: 'waitlisted', participantName: 'Wendy Waitlist' })],
        lastDoc: 'waitlist-cursor-1',
        hasMore: true
      })
      .mockResolvedValueOnce({
        reviews: [buildReview({ id: 'review-2', participantName: 'Alex Applicant' })],
        lastDoc: null,
        hasMore: false
      })
      .mockResolvedValueOnce({
        reviews: [buildReview({ id: 'waitlist-2', status: 'waitlisted', participantName: 'Page Two Waitlist' })],
        lastDoc: null,
        hasMore: false
      });
    parentRegistrationsServiceMocks.loadTeamRegistrationRosterPlayers.mockResolvedValue([]);

    renderStaffRegistrationReview();

    expect(await screen.findAllByText('Pat Star')).not.toHaveLength(0);
    expect(screen.getByText('Wendy Waitlist')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Wendy Waitlist Parent One waitlisted Full week · $75.00' }));
    expect(await screen.findByRole('heading', { name: 'Wendy Waitlist' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Alex Applicant')).toBeTruthy();
    expect(screen.queryByText('Page Two Waitlist')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Wendy Waitlist' })).toBeTruthy();
    expect(parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage).toHaveBeenNthCalledWith(3, 'team-1', 'form-1', { afterDoc: 'main-cursor-1' });

    fireEvent.click(screen.getByRole('button', { name: 'Load more waitlisted applicants' }));

    expect(await screen.findByText('Page Two Waitlist')).toBeTruthy();
    expect(screen.getByText('Alex Applicant')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Wendy Waitlist' })).toBeTruthy();
    expect(parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage).toHaveBeenNthCalledWith(4, 'team-1', 'form-1', { status: 'waitlisted', afterDoc: 'waitlist-cursor-1' });
  });
});
