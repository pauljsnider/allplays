import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamFees } from './TeamFees';
import type { AuthState } from '../lib/types';

const teamFeesServiceMocks = vi.hoisted(() => ({
  loadTeamFeeManagementModel: vi.fn(),
  recordOfflineTeamFeePayment: vi.fn()
}));

vi.mock('../lib/teamFeesService', () => teamFeesServiceMocks);

const auth: AuthState = {
  user: {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach'
  } as any,
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

function renderTeamFees() {
  return render(
    <MemoryRouter initialEntries={['/teams/team-1/fees/batch-1']}>
      <Routes>
        <Route path="/teams/:teamId/fees/:batchId" element={<TeamFees auth={auth} />} />
        <Route path="/teams/:teamId" element={<div>Team detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TeamFees recipient queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teamFeesServiceMocks.recordOfflineTeamFeePayment.mockResolvedValue(undefined);
    teamFeesServiceMocks.loadTeamFeeManagementModel.mockResolvedValue({
      team: { id: 'team-1', name: 'Bears' },
      batches: [{ id: 'batch-1', title: 'Spring dues', dueDate: '2026-06-01', amountCents: 10000, status: 'open' }],
      selectedBatch: { id: 'batch-1', title: 'Spring dues', dueDate: '2026-06-01', amountCents: 10000, status: 'open' },
      canManageFees: true,
      recipients: [
        {
          id: 'unpaid-1',
          playerName: 'Unpaid Player',
          parentName: 'Una Parent',
          parentEmail: 'una@example.com',
          status: 'unpaid',
          amountDueCents: 10000,
          amountPaidCents: 0,
          remainingBalanceCents: 10000,
          paymentLedger: []
        },
        {
          id: 'partial-1',
          playerName: 'Partial Player',
          parentName: 'Part Parent',
          parentEmail: 'part@example.com',
          status: 'partial',
          amountDueCents: 10000,
          amountPaidCents: 2500,
          remainingBalanceCents: 7500,
          paymentLedger: [{ type: 'offline_payment' }]
        },
        {
          id: 'paid-1',
          playerName: 'Paid Player',
          parentName: 'Pay Parent',
          parentEmail: 'pay@example.com',
          status: 'paid',
          amountDueCents: 10000,
          amountPaidCents: 10000,
          remainingBalanceCents: 0,
          paymentLedger: [{ type: 'offline_payment' }]
        }
      ]
    });
  });

  it('shows only unpaid and partial recipients in the default payment queue', async () => {
    renderTeamFees();

    const queue = await screen.findByLabelText('Actionable recipients');
    expect(within(queue).getByText('Unpaid Player')).toBeInTheDocument();
    expect(within(queue).getByText('Partial Player')).toBeInTheDocument();
    expect(within(queue).queryByText('Paid Player')).not.toBeInTheDocument();
    expect(within(queue).getAllByRole('button', { name: 'Record payment' })).toHaveLength(2);
    expect(screen.getByDisplayValue('100.00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('75.00')).toBeInTheDocument();
  });

  it('renders paid recipients in a secondary review area without payment controls', async () => {
    renderTeamFees();

    const paidSection = await screen.findByText('Paid recipients (1)');
    const reviewCard = paidSection.closest('details');
    expect(reviewCard).not.toBeNull();
    if (!reviewCard) throw new Error('Paid recipients details not found');

    expect(within(reviewCard).getByText('Paid Player')).toBeInTheDocument();
    expect(within(reviewCard).queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(within(reviewCard).queryByLabelText('Payment amount')).not.toBeInTheDocument();
    expect(within(reviewCard).queryByLabelText('Payment date')).not.toBeInTheDocument();
    expect(within(reviewCard).queryByLabelText('Note')).not.toBeInTheDocument();
  });
});
