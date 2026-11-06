// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../../lib/types';
import { RegistrationsTool } from './RegistrationsTool';

const parentRegistrationsServiceMocks = vi.hoisted(() => ({
  loadParentRegistrationApplicationsPage: vi.fn(),
  loadParentRegistrations: vi.fn()
}));
const publicActionMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn(),
  sharePublicUrl: vi.fn()
}));

vi.mock('../../lib/parentRegistrationsService', () => parentRegistrationsServiceMocks);
vi.mock('../../lib/publicActions', () => publicActionMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    AlertCircle: Icon,
    CheckCircle2: Icon,
    Copy: Icon,
    ExternalLink: Icon,
    Link2: Icon,
    Loader2: Icon,
    RefreshCw: Icon,
    Share2: Icon,
    Ticket: Icon
  };
});

const auth: AuthState = {
  user: {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Parent One',
    roles: ['parent']
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

const openForm = {
  id: 'open-form',
  teamId: 'team-open',
  teamName: 'Open Team',
  programName: 'Open Program',
  description: 'Still accepting registrations',
  season: 'Fall 2026',
  feeLabel: '$50.00',
  paymentNotice: '',
  onlineCheckout: true,
  options: [],
  url: 'https://allplays.ai/register.html?teamId=team-open&formId=open-form',
  appUrl: '/app/#/register/team-open/open-form'
};

function application(id: string, status: string, statusLabel: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    registrationKey: `teams/team-closed/registrationForms/closed-form/registrations/${id}`,
    teamId: 'team-closed',
    formId: 'closed-form',
    teamName: 'Closed Team',
    programName: 'Closed Program',
    playerName: `Player ${id}`,
    guardianEmail: 'parent@example.com',
    status,
    statusLabel,
    selectedOptionLabel: '',
    submittedAt: { seconds: 10 },
    ...overrides
  };
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    applications: [],
    nextCursor: null,
    retryCursor: null,
    hasMore: false,
    errors: [],
    ...overrides
  };
}

function renderTool(refreshVersion = 0) {
  return render(
    <MemoryRouter>
      <RegistrationsTool auth={auth} refreshVersion={refreshVersion} />
    </MemoryRouter>
  );
}

describe('RegistrationsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValue([openForm]);
    parentRegistrationsServiceMocks.loadParentRegistrationApplicationsPage.mockResolvedValue(page());
  });

  it('keeps published forms visible while submitted applications are loading', async () => {
    let resolveApplications!: (value: ReturnType<typeof page>) => void;
    parentRegistrationsServiceMocks.loadParentRegistrationApplicationsPage.mockReturnValue(
      new Promise((resolve) => {
        resolveApplications = resolve;
      })
    );

    renderTool();

    expect(await screen.findByText('Open Program')).toBeTruthy();
    expect(screen.getByText('Loading submitted applications')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review' })).toBeTruthy();

    await act(async () => resolveApplications(page()));
    expect(await screen.findByText('No submitted applications')).toBeTruthy();
  });

  it('renders closed-form submitted applications with every normalized status and keeps open-form actions', async () => {
    const statuses = [
      ['pending', 'Pending Review'],
      ['waitlisted', 'Waitlisted'],
      ['offer-extended', 'Offer Extended'],
      ['offer-accepted', 'Offer Accepted'],
      ['enrolled', 'Enrolled'],
      ['released', 'Released'],
      ['rejected', 'Rejected']
    ];
    parentRegistrationsServiceMocks.loadParentRegistrationApplicationsPage.mockResolvedValue(
      page({
        applications: statuses.map(([status, label], index) =>
          application(String(index), status, label, {
            selectedOptionLabel: index === 0 ? 'U12 Select' : ''
          })
        )
      })
    );

    renderTool();

    expect(await screen.findAllByText('Closed Program')).toHaveLength(7);
    expect(screen.getAllByText('Closed Team')).toHaveLength(7);
    expect(screen.getByText('Option: U12 Select')).toBeTruthy();
    for (const [, label] of statuses) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    const availableSection = screen.getByRole('heading', { name: 'Available registrations' }).closest('section')!;
    expect(within(availableSection.parentElement!).getByRole('link', { name: 'Review' })).toBeTruthy();
    expect(within(availableSection.parentElement!).getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve|reject|release|enroll|extend offer/i })).toBeNull();
  });

  it('shows independent empty state and loads another page without replacing existing applications', async () => {
    const nextCursor = { guardianEmail: { id: 'next' }, submittedByUserId: null };
    parentRegistrationsServiceMocks.loadParentRegistrationApplicationsPage
      .mockResolvedValueOnce(
        page({
          applications: [application('newer', 'pending', 'Pending Review')],
          nextCursor,
          hasMore: true
        })
      )
      .mockResolvedValueOnce(
        page({
          applications: [application('older', 'enrolled', 'Enrolled')]
        })
      );

    renderTool();

    expect(await screen.findByText('Player newer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more applications' }));
    expect(await screen.findByText('Player older')).toBeTruthy();
    expect(screen.getByText('Player newer')).toBeTruthy();
    expect(parentRegistrationsServiceMocks.loadParentRegistrationApplicationsPage).toHaveBeenLastCalledWith(auth.user, {
      cursor: nextCursor
    });

    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([]);
    parentRegistrationsServiceMocks.loadParentRegistrationApplicationsPage.mockResolvedValueOnce(page());
    const view = renderTool();
    expect(await screen.findByText('No submitted applications')).toBeTruthy();
    expect(await screen.findByText('No open registrations')).toBeTruthy();
    view.unmount();
  });

  it('retains successful cards and retries partial failures from the retry cursor', async () => {
    const retryCursor = { guardianEmail: null, submittedByUserId: { id: 'retry' } };
    parentRegistrationsServiceMocks.loadParentRegistrationApplicationsPage
      .mockResolvedValueOnce(
        page({
          applications: [application('retained', 'waitlisted', 'Waitlisted')],
          retryCursor,
          errors: [{ message: 'Some application details could not be loaded.', retryable: true }]
        })
      )
      .mockResolvedValueOnce(
        page({
          applications: [application('recovered', 'enrolled', 'Enrolled')]
        })
      );

    renderTool();

    expect(await screen.findByText('Player retained')).toBeTruthy();
    expect(screen.getByText('Some application details could not be loaded.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry applications' }));
    expect(await screen.findByText('Player recovered')).toBeTruthy();
    expect(screen.getByText('Player retained')).toBeTruthy();
    expect(parentRegistrationsServiceMocks.loadParentRegistrationApplicationsPage).toHaveBeenLastCalledWith(auth.user, {
      cursor: retryCursor
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry applications' })).toBeNull());
  });
});
