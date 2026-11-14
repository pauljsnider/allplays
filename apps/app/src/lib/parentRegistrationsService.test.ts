import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyParentToolsMocks = vi.hoisted(() => ({
  listParentRegistrationApplicationsPage: vi.fn()
}));

vi.mock('./adapters/legacyParentTools', () => legacyParentToolsMocks);

import { loadParentRegistrationApplicationsPage } from './parentRegistrationsService';
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
