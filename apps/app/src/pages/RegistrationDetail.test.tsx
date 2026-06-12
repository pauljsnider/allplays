// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationDetail } from './RegistrationDetail';
import type { AuthState } from '../lib/types';

const parentToolsServiceMocks = vi.hoisted(() => ({
  initiateRegistrationCheckout: vi.fn(),
  loadParentRegistrationDetail: vi.fn(),
  loadPublicRegistrationDetail: vi.fn(),
  loadParentRegistrations: vi.fn(),
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

function renderPublicRegistration() {
  return render(
    <MemoryRouter initialEntries={['/registration?teamId=team-1&formId=form-1']}>
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
});
