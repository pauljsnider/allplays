import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyParentToolsMocks = vi.hoisted(() => ({
  calculateRegistrationFeeSnapshot: vi.fn(() => ({ finalAmountDueCents: 0 })),
  getActiveRegistrationOptions: vi.fn(() => []),
  getRegistrationPaymentNotice: vi.fn(() => ''),
  getTeam: vi.fn(),
  hasOnlineRegistrationCheckout: vi.fn(() => false),
  listParentRegistrationApplicationsPage: vi.fn(),
  listPublishedTeamRegistrationForms: vi.fn(),
  normalizeRegistrationForm: vi.fn((form, context) => ({
    ...form,
    id: form.id || context.formId,
    teamId: form.teamId || context.teamId,
    programName: form.programName || form.title || '',
    description: form.description || '',
    season: form.season || '',
    status: form.status || 'open'
  }))
}));
const profileServiceMocks = vi.hoisted(() => ({
  hydrateParentAccessUser: vi.fn()
}));

vi.mock('./adapters/legacyParentTools', () => legacyParentToolsMocks);
vi.mock('./profileService', () => profileServiceMocks);

import {
  loadParentRegistrationApplicationsPage,
  loadParentRegistrationDetail,
  loadParentRegistrations
} from './parentRegistrationsService';
import type { AuthUser } from './types';

function parentUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    uid: 'parent-1',
    email: 'Parent@Example.com',
    emailVerified: true,
    displayName: 'Parent One',
    roles: ['parent'],
    ...overrides
  };
}

describe('parent registration application history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileServiceMocks.hydrateParentAccessUser.mockImplementation(async (user) => user);
  });

  it('delegates with UID and verified email while preserving pagination and partial errors', async () => {
    const cursor = {
      guardianEmail: { id: 'guardian-cursor' },
      submittedByUserId: { id: 'submitter-cursor' }
    };
    const nextCursor = {
      guardianEmail: { id: 'next-guardian' },
      submittedByUserId: { id: 'next-submitter' }
    };
    const retryCursor = { ...cursor };
    const page = {
      applications: [
        {
          id: 'registration-1',
          registrationKey: 'teams/team-1/registrationForms/form-1/registrations/registration-1',
          teamId: 'team-1',
          formId: 'form-1',
          teamName: 'Falcons',
          programName: 'Spring League',
          playerName: 'Player One',
          guardianEmail: 'parent@example.com',
          status: 'pending',
          statusLabel: 'Pending Review',
          selectedOptionLabel: 'Standard',
          submittedAt: { seconds: 1, nanoseconds: 0 }
        }
      ],
      nextCursor,
      retryCursor,
      hasMore: true,
      errors: [
        {
          code: 'parent-registration-query-failed',
          identity: 'submitter-uid',
          retryable: true,
          message: 'Some registration applications could not be loaded. Retry this registration page.'
        }
      ]
    };
    legacyParentToolsMocks.listParentRegistrationApplicationsPage.mockResolvedValue(page);

    const result = await loadParentRegistrationApplicationsPage(parentUser(), { cursor });

    expect(legacyParentToolsMocks.listParentRegistrationApplicationsPage).toHaveBeenCalledWith(
      { uid: 'parent-1', email: 'Parent@Example.com' },
      { cursor }
    );
    expect(result).toBe(page);
    expect(result).toMatchObject({ nextCursor, retryCursor, hasMore: true, errors: page.errors });
  });

  it('uses the UID without exposing an unverified email to the legacy query', async () => {
    const page = { applications: [], nextCursor: null, retryCursor: null, hasMore: false, errors: [] };
    legacyParentToolsMocks.listParentRegistrationApplicationsPage.mockResolvedValue(page);

    await loadParentRegistrationApplicationsPage(parentUser({ emailVerified: false }));

    expect(legacyParentToolsMocks.listParentRegistrationApplicationsPage).toHaveBeenCalledWith(
      { uid: 'parent-1', email: '' },
      { cursor: null }
    );
  });

  it('rejects unauthenticated loads before delegation', async () => {
    await expect(loadParentRegistrationApplicationsPage(null)).rejects.toThrow('Sign in to load registration applications.');
    expect(legacyParentToolsMocks.listParentRegistrationApplicationsPage).not.toHaveBeenCalled();
  });
});

describe('parent registration scope hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileServiceMocks.hydrateParentAccessUser.mockImplementation(async (user) => user);
  });

  it('lists forms from a parent link added after sign-in', async () => {
    profileServiceMocks.hydrateParentAccessUser.mockResolvedValue(parentUser({
      parentOf: [{ teamId: 'team-new', playerId: 'player-new' }]
    }));
    legacyParentToolsMocks.getTeam.mockResolvedValue({ id: 'team-new', name: 'New Team' });
    legacyParentToolsMocks.listPublishedTeamRegistrationForms.mockResolvedValue([
      { id: 'form-1', title: 'Spring League', published: true }
    ]);

    const cards = await loadParentRegistrations(parentUser({ parentOf: [] }));

    expect(profileServiceMocks.hydrateParentAccessUser).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'parent-1', parentOf: [] })
    );
    expect(legacyParentToolsMocks.listPublishedTeamRegistrationForms).toHaveBeenCalledWith(
      'team-new',
      { pageSize: 50 }
    );
    expect(cards).toEqual([
      expect.objectContaining({ id: 'form-1', teamId: 'team-new', teamName: 'New Team' })
    ]);
  });

  it('rejects a detail route when live hydration removes a revoked snapshot link', async () => {
    profileServiceMocks.hydrateParentAccessUser.mockResolvedValue(parentUser({
      parentOf: [],
      parentTeamIds: [],
      parentPlayerKeys: []
    }));

    await expect(loadParentRegistrationDetail(
      parentUser({ parentOf: [{ teamId: 'team-old', playerId: 'player-old' }] }),
      'team-old',
      'form-1'
    )).rejects.toThrow('Registration is not linked to your family.');

    expect(legacyParentToolsMocks.getTeam).not.toHaveBeenCalled();
  });
});
