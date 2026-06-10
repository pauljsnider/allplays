// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamFees } from './TeamFees';
import type { AuthState } from '../lib/types';

const teamFeesServiceMocks = vi.hoisted(() => ({
  createTeamFeeBatchForApp: vi.fn(),
  initiateStaffTeamFeeCheckout: vi.fn(),
  loadTeamFeeManagementModel: vi.fn(),
  recordOfflineTeamFeePayment: vi.fn(),
  recordTeamFeeBalanceAdjustment: vi.fn(),
  recordOfflineTeamFeeRefund: vi.fn()
}));

const publicActionMocks = vi.hoisted(() => ({
  copyPublicText: vi.fn(),
  sharePublicUrl: vi.fn()
}));

vi.mock('../lib/teamFeesService', () => teamFeesServiceMocks);
vi.mock('../lib/publicActions', () => publicActionMocks);

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

function renderTeamFees(initialEntry = '/teams/team-1/fees/batch-1') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/teams/:teamId/fees" element={<TeamFees auth={auth} />} />
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
    teamFeesServiceMocks.recordOfflineTeamFeeRefund.mockReset();
    teamFeesServiceMocks.createTeamFeeBatchForApp.mockReset();
    teamFeesServiceMocks.initiateStaffTeamFeeCheckout.mockReset();
    teamFeesServiceMocks.loadTeamFeeManagementModel.mockReset();
    teamFeesServiceMocks.recordOfflineTeamFeePayment.mockResolvedValue(undefined);
    teamFeesServiceMocks.recordTeamFeeBalanceAdjustment.mockResolvedValue(undefined);
    teamFeesServiceMocks.recordOfflineTeamFeeRefund.mockResolvedValue(undefined);
    teamFeesServiceMocks.createTeamFeeBatchForApp.mockResolvedValue({ id: 'batch-2' });
    teamFeesServiceMocks.initiateStaffTeamFeeCheckout.mockResolvedValue({ success: true, checkoutUrl: 'https://checkout.stripe.test/generated' });
    publicActionMocks.copyPublicText.mockResolvedValue('copied');
    publicActionMocks.sharePublicUrl.mockResolvedValue('shared');
    teamFeesServiceMocks.loadTeamFeeManagementModel.mockResolvedValue({
      team: { id: 'team-1', name: 'Bears' },
      batches: [{ id: 'batch-1', title: 'Spring dues', dueDate: '2026-06-01', amountCents: 10000, status: 'open' }],
      selectedBatch: { id: 'batch-1', title: 'Spring dues', dueDate: '2026-06-01', amountCents: 10000, status: 'open' },
      canManageFees: true,
      rosterPlayers: [
        { id: 'unpaid-1', name: 'Unpaid Player', number: '4' },
        { id: 'partial-1', name: 'Partial Player', number: '8' },
        { id: 'paid-1', name: 'Paid Player', number: '12' }
      ],
      recipients: [
        {
          id: 'unpaid-1',
          playerName: 'Unpaid Player',
          parentName: 'Una Parent',
          parentEmail: 'una@example.com',
          status: 'unpaid',
          collectionMode: 'online_stripe',
          checkoutUrl: '',
          checkoutStatus: '',
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
          collectionMode: 'offline_manual',
          checkoutUrl: '',
          checkoutStatus: '',
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
          collectionMode: 'online_stripe',
          checkoutUrl: '',
          checkoutStatus: 'paid',
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
    expect(within(queue).getByRole('button', { name: 'Record refund' })).toBeTruthy();
    expect(screen.getByDisplayValue('100.00')).toBeTruthy();
    expect(screen.getByDisplayValue('75.00')).toBeTruthy();
    expect(screen.getAllByText('Positive credits reduce what is owed. Negative charges increase it.')).toHaveLength(3);
    expect(within(queue).getByRole('button', { name: 'Generate & share link' })).toBeTruthy();
    expect(within(queue).getByText('This fee is marked for offline collection only, so no Stripe checkout link can be generated from the app.')).toBeTruthy();
  });

  it('generates and shares a staff checkout link with the public URL only', async () => {
    teamFeesServiceMocks.loadTeamFeeManagementModel
      .mockResolvedValueOnce({
        team: { id: 'team-1', name: 'Bears' },
        batches: [{ id: 'batch-1', title: 'Spring dues', dueDate: '2026-06-01', amountCents: 10000, status: 'open' }],
        selectedBatch: { id: 'batch-1', title: 'Spring dues', dueDate: '2026-06-01', amountCents: 10000, status: 'open' },
        canManageFees: true,
        rosterPlayers: [],
        recipients: [{
          id: 'recipient-1',
          playerName: 'Pat Star',
          parentName: 'Pat Parent',
          parentEmail: 'pat@example.com',
          status: 'unpaid',
          collectionMode: 'online_stripe',
          checkoutUrl: '',
          checkoutStatus: '',
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
        rosterPlayers: [],
        recipients: [{
          id: 'recipient-1',
          playerName: 'Pat Star',
          parentName: 'Pat Parent',
          parentEmail: 'pat@example.com',
          status: 'unpaid',
          collectionMode: 'online_stripe',
          checkoutUrl: 'https://checkout.stripe.test/generated',
          checkoutStatus: 'open',
          amountDueCents: 10000,
          amountPaidCents: 0,
          remainingBalanceCents: 10000,
          paymentLedger: []
        }]
      });

    renderTeamFees();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate & share link' }));

    expect(await screen.findByText('Shared checkout link for Pat Star.')).toBeTruthy();
    expect(teamFeesServiceMocks.initiateStaffTeamFeeCheckout).toHaveBeenCalledWith({
      teamId: 'team-1',
      batchId: 'batch-1',
      recipientId: 'recipient-1',
      user: auth.user
    });
    expect(publicActionMocks.sharePublicUrl).toHaveBeenCalledWith({
      title: 'Pat Star fee checkout',
      text: '',
      url: 'https://checkout.stripe.test/generated',
      clipboardText: 'https://checkout.stripe.test/generated'
    });
  });

  it('creates a fee batch from the native form using selected roster recipients', async () => {
    teamFeesServiceMocks.loadTeamFeeManagementModel.mockResolvedValue({
      team: { id: 'team-1', name: 'Bears' },
      batches: [],
      selectedBatch: null,
      canManageFees: true,
      rosterPlayers: [
        { id: 'player-1', name: 'Pat Star', number: '12' },
        { id: 'player-2', name: 'Chris Doe', number: '7' }
      ],
      recipients: []
    });

    renderTeamFees('/teams/team-1/fees');

    fireEvent.change(await screen.findByPlaceholderText('Tournament dues'), { target: { value: 'Bus fee' } });
    fireEvent.change(screen.getByPlaceholderText('25.00'), { target: { value: '15.00' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Charge the whole roster/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Pat Star · #12' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create fee batch' }));

    expect(await screen.findByText('Created fee batch Bus fee.')).toBeTruthy();
    expect(teamFeesServiceMocks.createTeamFeeBatchForApp).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      title: 'Bus fee',
      amount: '15.00',
      applyToWholeRoster: false,
      recipientIds: ['player-1']
    }));
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
    expect(within(reviewCard).getByRole('button', { name: 'Record refund' })).toBeTruthy();
    expect(within(reviewCard).getByText('Positive credits reduce what is owed. Negative charges increase it.')).toBeTruthy();
  });

  it('submits a recipient refund and refreshes the totals in place', async () => {
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
          status: 'paid',
          amountDueCents: 10000,
          amountPaidCents: 10000,
          remainingBalanceCents: 0,
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
          status: 'partial',
          amountDueCents: 10000,
          amountPaidCents: 7500,
          remainingBalanceCents: 2500,
          paymentLedger: [{ type: 'offline_refund' }]
        }]
      });

    renderTeamFees();

    const refundTrigger = await screen.findByRole('button', { name: 'Record refund' });
    fireEvent.click(refundTrigger);
    fireEvent.change(screen.getByDisplayValue('Full refund'), { target: { value: 'partial' } });
    fireEvent.change(screen.getByPlaceholderText('100.00'), { target: { value: '25.00' } });
    fireEvent.change(screen.getByDisplayValue('Select method'), { target: { value: 'cash' } });
    fireEvent.change(screen.getByPlaceholderText('Why this was refunded and how it was handled'), { target: { value: 'Refunded at the field' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit refund' }));

    expect(await screen.findByText('Recorded partial refund for Pat Star.')).toBeTruthy();
    expect(teamFeesServiceMocks.recordOfflineTeamFeeRefund).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      batchId: 'batch-1',
      refundType: 'partial',
      amount: '25.00',
      method: 'cash',
      note: 'Refunded at the field'
    }));
    expect((await screen.findAllByText('$25.00')).length).toBeGreaterThan(0);
  });

  it('keeps the refund form open and shows validation errors when a refund is invalid', async () => {
    teamFeesServiceMocks.recordOfflineTeamFeeRefund.mockRejectedValue(new Error('Select cash or check as the refund method.'));

    renderTeamFees();

    const recipientCard = (await screen.findByText('Partial Player')).closest('section');
    if (!recipientCard) throw new Error('Recipient card not found');

    fireEvent.click(within(recipientCard).getByRole('button', { name: 'Record refund' }));
    fireEvent.change(within(recipientCard).getByPlaceholderText('Why this was refunded and how it was handled'), { target: { value: 'Need to fix overcollection' } });
    fireEvent.click(within(recipientCard).getByRole('button', { name: 'Submit refund' }));

    expect(await screen.findByText('Select cash or check as the refund method.')).toBeTruthy();
    expect(within(recipientCard).getByRole('button', { name: 'Submit refund' })).toBeTruthy();
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

  it('disables both payment and adjustment controls while a recipient payment is submitting', async () => {
    let resolvePayment: (() => void) | null = null;
    teamFeesServiceMocks.recordOfflineTeamFeePayment.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolvePayment = resolve;
      })
    );

    renderTeamFees();

    const recipientCard = (await screen.findByText('Unpaid Player')).closest('section');
    if (!recipientCard) throw new Error('Recipient card not found');

    fireEvent.click(within(recipientCard).getByRole('button', { name: 'Record payment' }));

    expect((await within(recipientCard).findByRole('button', { name: 'Recording...' })).hasAttribute('disabled')).toBe(true);
    expect(within(recipientCard).getByRole('button', { name: 'Save adjustment' }).hasAttribute('disabled')).toBe(true);
    expect(within(recipientCard).getByDisplayValue('100.00').hasAttribute('disabled')).toBe(true);
    expect(within(recipientCard).getByPlaceholderText('25.00 or -10.00').hasAttribute('disabled')).toBe(true);

    await act(async () => {
      resolvePayment?.();
      await Promise.resolve();
    });
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
