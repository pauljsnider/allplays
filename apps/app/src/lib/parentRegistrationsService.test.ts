import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyParentToolsMocks = vi.hoisted(() => ({
  acceptTeamRegistrationOffer: vi.fn(),
  approveTeamRegistration: vi.fn(),
  calculateRegistrationFeeSnapshot: vi.fn(),
  cancelStripeRegistrationCheckout: vi.fn(),
  createRegistrationCheckoutSession: vi.fn(),
  db: {},
  doc: vi.fn(),
  extendTeamRegistrationOffer: vi.fn(),
  functions: {},
  getActiveRegistrationOptions: vi.fn(),
  getDoc: vi.fn(),
  getPaymentPlanChoices: vi.fn(),
  getPlayers: vi.fn(),
  getRegistrationGuardianDrafts: vi.fn(),
  getRegistrationPaymentNotice: vi.fn(),
  getRegistrationPlayerDraft: vi.fn(),
  getRegistrationSubmittedData: vi.fn(),
  getTeam: vi.fn(),
  getTeamRegistrationForm: vi.fn(),
  hasOnlineRegistrationCheckout: vi.fn(),
  httpsCallable: vi.fn(),
  listParentRegistrationApplicationsPage: vi.fn(),
  listPublishedTeamRegistrationForms: vi.fn(),
  listTeamRegistrationReviewsPage: vi.fn(),
  normalizeRegistrationForm: vi.fn(),
  normalizeRegistrationStatus: vi.fn(),
  rejectTeamRegistration: vi.fn()
}));

vi.mock('./adapters/legacyParentTools', () => legacyParentToolsMocks);

import { loadParentRegistrationApplicationsPage } from './parentRegistrationsService';
import type { AuthUser } from './types';

const user: AuthUser = {
  uid: 'parent-1',
  email: 'parent@example.com',
  displayName: 'Parent One',
  roles: ['parent']
};

describe('loadParentRegistrationApplicationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates authenticated identity and cursor while preserving the complete page contract', async () => {
    const cursor = { guardianEmail: { id: 'guardian-cursor' }, submittedByUserId: { id: 'uid-cursor' } };
    const nextCursor = { guardianEmail: { id: 'next-guardian' }, submittedByUserId: { id: 'next-uid' } };
    const retryCursor = { guardianEmail: { id: 'retry-guardian' }, submittedByUserId: null };
    const page = {
      applications: [
        {
          id: 'application-2',
          registrationKey: 'teams/team-1/forms/form-1/registrations/application-2',
          teamId: 'team-1',
          formId: 'form-1',
          teamName: 'Falcons',
          programName: 'Fall Soccer',
          playerName: 'Taylor Player',
          guardianEmail: 'parent@example.com',
          status: 'enrolled',
          statusLabel: 'Enrolled',
          selectedOptionLabel: 'U12',
          submittedAt: { seconds: 20 }
        },
        {
          id: 'application-1',
          registrationKey: 'teams/team-1/forms/form-1/registrations/application-1',
          teamId: 'team-1',
          formId: 'form-1',
          teamName: 'Falcons',
          programName: 'Fall Soccer',
          playerName: 'Jordan Player',
          guardianEmail: 'parent@example.com',
          status: 'pending',
          statusLabel: 'Pending Review',
          selectedOptionLabel: '',
          submittedAt: { seconds: 10 }
        }
      ],
      nextCursor,
      retryCursor,
      hasMore: true,
      errors: [
        {
          code: 'parent-registration-enrichment-failed',
          retryable: true,
          message: 'Some registration application details could not be loaded.'
        }
      ]
    };
    legacyParentToolsMocks.listParentRegistrationApplicationsPage.mockResolvedValue(page);

    await expect(loadParentRegistrationApplicationsPage(user, { cursor })).resolves.toEqual(page);
    expect(legacyParentToolsMocks.listParentRegistrationApplicationsPage).toHaveBeenCalledWith(
      { uid: user.uid, email: user.email },
      { cursor }
    );
  });

  it('returns an empty terminal page without issuing an unscoped query', async () => {
    await expect(loadParentRegistrationApplicationsPage(null)).resolves.toEqual({
      applications: [],
      nextCursor: null,
      retryCursor: null,
      hasMore: false,
      errors: []
    });
    expect(legacyParentToolsMocks.listParentRegistrationApplicationsPage).not.toHaveBeenCalled();
  });
});
