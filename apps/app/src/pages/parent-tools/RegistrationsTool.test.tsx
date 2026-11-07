// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../../lib/types';
import { RegistrationsTool } from './RegistrationsTool';

const registrationServiceMocks = vi.hoisted(() => ({
  loadParentRegistrationApplicationsPage: vi.fn(),
  loadParentRegistrations: vi.fn()
}));

vi.mock('../../lib/parentRegistrationsService', () => registrationServiceMocks);
vi.mock('../../lib/publicActions', () => ({
  openPublicUrl: vi.fn(),
  sharePublicUrl: vi.fn()
}));

const auth: AuthState = {
  user: {
    uid: 'parent-1',
    email: 'parent@example.com',
    emailVerified: true,
    displayName: 'Parent One',
    roles: ['parent'],
    parentOf: [{ teamId: 'team-open', playerId: 'player-1' }]
  },
  profile: null,
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn().mockResolvedValue(null),
  signOut: vi.fn().mockResolvedValue(undefined)
};

const emptyPage = {
  applications: [],
  nextCursor: null,
  retryCursor: null,
  hasMore: false,
  errors: []
};

function application(overrides: Record<string, unknown> = {}) {
  const id = String(overrides.id || 'application-1');
  return {
    id,
    registrationKey: String(overrides.registrationKey || `teams/team-closed/registrationForms/form-closed/registrations/${id}`),
    teamId: 'team-closed',
    formId: 'form-closed',
    teamName: 'Closed Form Team',
    programName: 'Closed Spring Program',
    playerName: 'Taylor Player',
    guardianEmail: 'parent@example.com',
    status: 'pending',
    statusLabel: 'Pending review',
    selectedOptionLabel: '',
    submittedAt: '2026-07-07T00:00:00.000Z',
    ...overrides
  };
}

function publishedForm() {
  return {
    id: 'form-open',
    teamId: 'team-open',
    teamName: 'Open Team',
    programName: 'Published Summer Camp',
    description: 'Skills week',
    season: 'Summer',
    feeLabel: '$75.00',
    paymentNotice: '',
    onlineCheckout: true,
    options: [],
    url: 'https://allplays.ai/register.html#teamId=team-open&formId=form-open',
    appUrl: 'https://allplays.ai/app/#/registration?teamId=team-open&formId=form-open'
  };
}

function renderTool() {
  return render(
    <MemoryRouter>
      <RegistrationsTool auth={auth} refreshVersion={0} />
    </MemoryRouter>
  );
}

describe('RegistrationsTool submitted applications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registrationServiceMocks.loadParentRegistrations.mockResolvedValue([]);
    registrationServiceMocks.loadParentRegistrationApplicationsPage.mockResolvedValue(emptyPage);
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps published forms visible while history loads, then shows a distinct empty state', async () => {
    let resolveHistory: ((page: typeof emptyPage) => void) | undefined;
    registrationServiceMocks.loadParentRegistrations.mockResolvedValue([publishedForm()]);
    registrationServiceMocks.loadParentRegistrationApplicationsPage.mockImplementationOnce(
      () =>
        new Promise<typeof emptyPage>((resolve) => {
          resolveHistory = resolve;
        })
    );

    renderTool();

    expect(await screen.findByText('Published Summer Camp')).toBeTruthy();
    expect(screen.getByText('Loading submitted applications')).toBeTruthy();
    expect(screen.queryByText('No submitted applications')).toBeNull();

    resolveHistory?.(emptyPage);

    expect(await screen.findByText('No submitted applications')).toBeTruthy();
    expect(screen.queryByText('Loading submitted applications')).toBeNull();
  });

  it('shows closed-form applications, every normalized status, and unchanged published-form actions', async () => {
    registrationServiceMocks.loadParentRegistrations.mockResolvedValue([publishedForm()]);
    const statuses = [
      ['pending', 'Pending review'],
      ['waitlisted', 'Waitlisted'],
      ['offer-extended', 'Offer extended'],
      ['offer-accepted', 'Offer accepted'],
      ['enrolled', 'Enrolled'],
      ['released', 'Released'],
      ['rejected', 'Rejected']
    ];
    registrationServiceMocks.loadParentRegistrationApplicationsPage.mockResolvedValue({
      ...emptyPage,
      applications: statuses.map(([status, statusLabel], index) =>
        application({
          id: `application-${index}`,
          registrationKey: `closed/application-${index}`,
          playerName: `Player ${index}`,
          status,
          statusLabel,
          selectedOptionLabel: index === 0 ? 'Goalkeeper clinic' : ''
        })
      )
    });

    renderTool();

    expect(await screen.findAllByText('Closed Spring Program')).toHaveLength(statuses.length);
    expect(screen.getAllByText('Closed Form Team')).toHaveLength(statuses.length);
    expect(screen.getByText('Option: Goalkeeper clinic')).toBeTruthy();
    statuses.forEach(([, label]) => {
      expect(screen.getByText(label)).toBeTruthy();
    });

    const publishedCard = screen.getByText('Published Summer Camp').closest('section');
    expect(publishedCard).not.toBeNull();
    expect(within(publishedCard as HTMLElement).getByRole('link', { name: 'Review' })).toBeTruthy();
    expect(within(publishedCard as HTMLElement).getByRole('button', { name: 'Legacy form' })).toBeTruthy();
    expect(within(publishedCard as HTMLElement).getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve|decline|reject|waitlist|enroll|change status/i })).toBeNull();
  });

  it('loads more applications newer-first without duplicating overlapping results', async () => {
    const nextCursor = { guardianEmail: { id: 'guardian-page-1' }, submittedByUserId: null };
    registrationServiceMocks.loadParentRegistrationApplicationsPage
      .mockResolvedValueOnce({
        ...emptyPage,
        applications: [
          application({
            id: 'newer',
            registrationKey: 'registrations/newer',
            playerName: 'Newer Player',
            submittedAt: '2026-07-07T00:00:00.000Z'
          })
        ],
        nextCursor,
        hasMore: true
      })
      .mockResolvedValueOnce({
        ...emptyPage,
        applications: [
          application({
            id: 'newer',
            registrationKey: 'registrations/newer',
            playerName: 'Newer Player Updated',
            submittedAt: '2026-07-07T00:00:00.000Z'
          }),
          application({
            id: 'older',
            registrationKey: 'registrations/older',
            playerName: 'Older Player',
            submittedAt: '2026-07-01T00:00:00.000Z'
          })
        ]
      });

    renderTool();

    expect(await screen.findByText('Newer Player')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Older Player')).toBeTruthy();
    expect(screen.queryByText('Newer Player')).toBeNull();
    expect(screen.getAllByText('Newer Player Updated')).toHaveLength(1);
    expect(registrationServiceMocks.loadParentRegistrationApplicationsPage).toHaveBeenNthCalledWith(2, auth.user, { cursor: nextCursor });
    const playerNames = screen.getAllByText(/Player/).map((element) => element.textContent);
    expect(playerNames.indexOf('Newer Player Updated')).toBeLessThan(playerNames.indexOf('Older Player'));
  });

  it('preserves successful applications and retries partial enrichment failures at the retry cursor', async () => {
    const retryCursor = { guardianEmail: { id: 'retry-guardian' }, submittedByUserId: null };
    let resolveRetry: ((page: typeof emptyPage) => void) | undefined;
    registrationServiceMocks.loadParentRegistrationApplicationsPage
      .mockResolvedValueOnce({
        ...emptyPage,
        applications: [application({ playerName: 'Retained Player' })],
        nextCursor: retryCursor,
        retryCursor,
        hasMore: true,
        errors: [
          {
            code: 'parent-registration-enrichment-failed',
            identity: 'form:closed',
            retryable: true,
            message: 'Some application details could not be loaded.'
          }
        ]
      })
      .mockImplementationOnce(
        () =>
          new Promise<typeof emptyPage>((resolve) => {
            resolveRetry = resolve;
          })
      );

    renderTool();

    expect(await screen.findByText('Retained Player')).toBeTruthy();
    expect(screen.getByText('Some application details could not be loaded.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Retained Player')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retrying...' })).toHaveProperty('disabled', true);
    expect(registrationServiceMocks.loadParentRegistrationApplicationsPage).toHaveBeenNthCalledWith(2, auth.user, { cursor: retryCursor });

    resolveRetry?.(emptyPage);

    await waitFor(() => {
      expect(screen.queryByText('Some application details could not be loaded.')).toBeNull();
    });
    expect(screen.getByText('Retained Player')).toBeTruthy();
  });

  it('preserves loaded cards when a later page throws and retries that cursor', async () => {
    const nextCursor = { guardianEmail: null, submittedByUserId: { id: 'next-page' } };
    registrationServiceMocks.loadParentRegistrations.mockResolvedValue([publishedForm()]);
    registrationServiceMocks.loadParentRegistrationApplicationsPage
      .mockResolvedValueOnce({
        ...emptyPage,
        applications: [application({ playerName: 'Retained After Load Failure' })],
        nextCursor,
        hasMore: true
      })
      .mockRejectedValueOnce(new Error('Application history is unavailable.'))
      .mockResolvedValueOnce({
        ...emptyPage,
        applications: [
          application({
            id: 'recovered',
            registrationKey: 'registrations/recovered',
            playerName: 'Recovered Player',
            submittedAt: '2026-07-01T00:00:00.000Z'
          })
        ]
      });

    renderTool();

    expect(await screen.findByText('Retained After Load Failure')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Application history is unavailable.')).toBeTruthy();
    expect(screen.getByText('Retained After Load Failure')).toBeTruthy();
    expect(screen.getByText('Published Summer Camp')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Recovered Player')).toBeTruthy();
    expect(screen.getByText('Retained After Load Failure')).toBeTruthy();
    expect(registrationServiceMocks.loadParentRegistrationApplicationsPage).toHaveBeenNthCalledWith(3, auth.user, { cursor: nextCursor });
  });
});
