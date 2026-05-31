// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamFees } from './TeamFees';
import type { AuthState } from '../lib/types';

const teamFeesServiceMocks = vi.hoisted(() => ({
  loadTeamFeeManagementModel: vi.fn(),
  recordOfflineTeamFeePayment: vi.fn(),
  recordTeamFeeBalanceAdjustment: vi.fn()
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
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    teamFeesServiceMocks.recordOfflineTeamFeePayment.mockReset();
    teamFeesServiceMocks.recordTeamFeeBalanceAdjustment.mockReset();
    teamFeesServiceMocks.loadTeamFeeManagementModel.mockReset();
    teamFeesServiceMocks.recordOfflineTeamFeePayment.mockResolvedValue(undefined);
    teamFeesServiceMocks.recordTeamFeeBalanceAdjustment.mockResolvedValue(undefined);
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
    expect(within(queue).getByText('Unpaid Player')).toBeTruthy();
    expect(within(queue).getByText('Partial Player')).toBeTruthy();
    expect(within(queue).queryByText('Paid Player')).toBeNull();
    expect(within(queue).getAllByRole('button', { name: 'Record payment' })).toHaveLength(2);
    expect(within(queue).getAllByRole('button', { name: 'Save adjustment' })).toHaveLength(2);
    expect(screen.getByDisplayValue('100.00')).toBeTruthy();
    expect(screen.getByDisplayValue('75.00')).toBeTruthy();
    expect(screen.getAllByText('Positive credits reduce what is owed. Negative charges increase it.')).toHaveLength(3);
  });

  it('renders paid recipients in a secondary review area with adjustment-only controls', async () => {
    renderTeamFees();

    const paidSection = await screen.findByText('Paid recipients (1)');
    const reviewCard = paidSection.closest('details');
    expect(reviewCard).not.toBeNull();
    if (!reviewCard) throw new Error('Paid recipients details not found');

    expect(within(reviewCard).getByText('Paid Player')).toBeTruthy();
    expect(within(reviewCard).queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(within(reviewCard).queryByText('Record offline payment')).toBeNull();
    expect(within(reviewCard).getByRole('button', { name: 'Save adjustment' })).toBeTruthy();
    expect(within(reviewCard).getByText('Positive credits reduce what is owed. Negative charges increase it.')).toBeTruthy();
  });

  it('submits one recipient adjustment and refreshes the totals in place', async () => {
    teamFeesServiceMocks.loadTeamFeeManagementModel
      .mockResolvedValueOnce({
        team: { id: 'team-1', name: 'Bears' },
        batches: [{ id: 'batch-1', title: 'Spring dues', dueDate: '2026-06-01', amountCents: 10000, status: 'open' }],
        selectedBatch: { id: 'batch-1', title: 'Spring dues', dueDate: '2026-06-01', amountCents: 10000, status: 'open' },
        canManageFees: true,
        recipients: [{
          id: 'recipient-1',
          playerName: 'Pat Star',
          parentName: 'Pat Parent',
          parentEmail: 'pat@example.com',
          status: 'unpaid',
          amountDueCents: 10000,
          amountPaidCents: 0,
          remainingBalanceCents: 10000,
          paymentLedger: []
        }]
      })
      .mockResolvedValueOnce({
        team: { id: 'team-1', name: 'Bears' },
        batches: [{ id: 'batch-1', title: 'Spring dues', dueDate: '2026-06-01', amountCents: 10000, status: 'open' }],
        selectedBatch: { id: 'batch-1', title: 'Spring dues', dueDate: '2026-06-01', amountCents: 10000, status: 'open' },
        canManageFees: true,
        recipients: [{
          id: 'recipient-1',
          playerName: 'Pat Star',
          parentName: 'Pat Parent',
          parentEmail: 'pat@example.com',
          status: 'unpaid',
          amountDueCents: 7500,
          amountPaidCents: 0,
          remainingBalanceCents: 7500,
          paymentLedger: [{ type: 'balance_adjustment', reason: 'Scholarship credit' }]
        }]
      });

    renderTeamFees();

    const recipientCard = (await screen.findByText('Pat Star')).closest('section');
    if (!recipientCard) throw new Error('Recipient card not found');
    fireEvent.change(within(recipientCard).getByPlaceholderText('25.00 or -10.00'), { target: { value: '25.00' } });
    fireEvent.change(within(recipientCard).getByPlaceholderText('Scholarship credit, late fee, correction...'), { target: { value: 'Scholarship credit' } });
    fireEvent.click(within(recipientCard).getByRole('button', { name: 'Save adjustment' }));

    expect(await screen.findByText('Adjusted Pat Star by +$25.00.')).toBeTruthy();
    expect(teamFeesServiceMocks.recordTeamFeeBalanceAdjustment).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      batchId: 'batch-1',
      amount: '25.00',
      note: 'Scholarship credit'
    }));
    expect((await screen.findAllByText('$75.00')).length).toBeGreaterThan(0);
  });

  it('shows the access guard instead of rendering adjustment controls for unauthorized users', async () => {
    teamFeesServiceMocks.loadTeamFeeManagementModel.mockResolvedValue({
      team: { id: 'team-1', name: 'Bears' },
      batches: [],
      selectedBatch: null,
      canManageFees: false,
      recipients: []
    });

    renderTeamFees();

    expect(await screen.findByText('Admin access required')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save adjustment' })).toBeNull();
  });
});
