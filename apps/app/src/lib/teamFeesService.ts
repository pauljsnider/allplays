import { createTeamFeeBatch, getPlayers, getTeam, listTeamFeeBatches, listTeamFeeRecipients, updateTeamFeeRecipient } from '../../../../js/db.js';
import { initiateTeamFeeCheckout } from '../../../../js/stripe-service.js';
import { hasFullTeamAccess } from '../../../../js/team-access.js';
import type { AuthUser } from './types';

export type TeamFeeBatchSummary = {
  id: string;
  title: string;
  dueDate: string;
  amountCents: number;
  status: string;
};

export type TeamFeeRecipientSummary = {
  id: string;
  playerName: string;
  parentName: string;
  parentEmail: string;
  status: string;
  collectionMode: string;
  checkoutUrl: string;
  checkoutStatus: string;
  amountDueCents: number;
  amountPaidCents: number;
  remainingBalanceCents: number;
  paymentLedger: Array<Record<string, unknown>>;
};

export type TeamFeeManagementModel = {
  team: {
    id: string;
    name: string;
  };
  batches: TeamFeeBatchSummary[];
  selectedBatch: TeamFeeBatchSummary | null;
  recipients: TeamFeeRecipientSummary[];
  rosterPlayers: TeamFeeRosterPlayer[];
  canManageFees: boolean;
};

export type TeamFeeRosterPlayer = {
  id: string;
  name: string;
  number: string;
};

export type CreateTeamFeeBatchInput = {
  teamId: string;
  title: string;
  amount: string | number;
  dueDate: string;
  recipientIds?: string[];
  applyToWholeRoster?: boolean;
  user: AuthUser | null;
};

export type ManualTeamFeePaymentInput = {
  amount: string | number;
  date: string;
  note?: string;
  actorId?: string;
  currentBalanceCents?: string | number | null;
  currentPaidCents?: string | number | null;
};

export type TeamFeeBalanceAdjustmentInput = {
  amount: string | number;
  note?: string;
  actorId?: string;
  currentBalanceCents?: string | number | null;
  currentPaidCents?: string | number | null;
};

export type OfflineTeamFeeRefundInput = {
  refundType?: string;
  amount?: string | number;
  method?: string;
  note?: string;
  actorId?: string;
  currentBalanceCents?: string | number | null;
  currentPaidCents?: string | number | null;
};

const REFUND_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check'
};

const OFFLINE_TEAM_FEE_INSTRUCTIONS = 'Collect payment outside ALL PLAYS. No online payment is processed.';

export function toFeeCents(value: string | number | null | undefined) {
  const normalized = String(value ?? '').replace(/[$,]/g, '').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

function toSignedFeeCents(value: string | number | null | undefined) {
  const normalized = String(value ?? '').replace(/[$,]/g, '').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

function normalizeString(value: unknown) {
  return String(value || '').trim();
}

function normalizeLedgerStatus(balanceCents: number, amountPaidCents: number) {
  if (amountPaidCents >= balanceCents) return 'paid';
  return amountPaidCents > 0 ? 'partial' : 'unpaid';
}

function assertManualPaymentWithinRemainingBalance(paymentAmountCents: number, balanceCents: number, priorPaidCents: number) {
  if (!Number.isFinite(balanceCents)) return;
  const remainingBalanceCents = Math.max(0, balanceCents - priorPaidCents);
  if (paymentAmountCents > remainingBalanceCents) {
    throw new Error('Manual payment amount cannot exceed the remaining balance.');
  }
}

export function buildManualPaymentUpdate({ amount, date, note, actorId, currentBalanceCents, currentPaidCents }: ManualTeamFeePaymentInput) {
  const paymentAmountCents = toFeeCents(amount);
  if (paymentAmountCents === null || paymentAmountCents <= 0) {
    throw new Error('Enter a manual payment amount greater than $0.');
  }
  if (!date) throw new Error('Enter a manual payment date.');

  const currentBalance = Number(currentBalanceCents);
  const balanceCents = Number.isFinite(currentBalance) ? Math.max(0, currentBalance) : Number.MAX_SAFE_INTEGER;
  const priorPaid = Number(currentPaidCents);
  const priorPaidCents = Number.isFinite(priorPaid) ? Math.max(0, priorPaid) : 0;
  assertManualPaymentWithinRemainingBalance(paymentAmountCents, balanceCents, priorPaidCents);
  const amountPaidCents = priorPaidCents + paymentAmountCents;
  const remainingBalanceCents = Math.max(0, balanceCents - amountPaidCents);
  const status = normalizeLedgerStatus(balanceCents, amountPaidCents);
  const noteText = normalizeString(note);
  const ledgerEntry = {
    type: 'offline_payment',
    amountCents: paymentAmountCents,
    paymentDate: date,
    note: noteText,
    recordedBy: actorId || null
  };

  return {
    status,
    amountPaidCents,
    remainingBalanceCents,
    paidAt: status === 'paid' ? date : null,
    manualPayment: {
      amountPaidCents: paymentAmountCents,
      paidAt: date,
      note: noteText,
      recordedBy: actorId || null
    },
    ledgerEntries: [ledgerEntry]
  };
}

export function buildBalanceAdjustmentUpdate({ amount, note, actorId, currentBalanceCents, currentPaidCents }: TeamFeeBalanceAdjustmentInput) {
  const adjustmentCents = toSignedFeeCents(amount);
  const reason = normalizeString(note);
  if (adjustmentCents === null || adjustmentCents === 0) {
    throw new Error('Enter a positive or negative adjustment amount.');
  }
  if (!reason) throw new Error('Enter an adjustment reason.');

  const currentBalance = Number(currentBalanceCents);
  const priorBalanceCents = Number.isFinite(currentBalance) ? Math.max(0, currentBalance) : 0;
  const paid = Number(currentPaidCents);
  const amountPaidCents = Number.isFinite(paid) ? Math.max(0, paid) : 0;
  const amountDueCents = Math.max(0, priorBalanceCents - adjustmentCents);
  const remainingBalanceCents = Math.max(0, amountDueCents - amountPaidCents);
  const status = normalizeLedgerStatus(amountDueCents, amountPaidCents);
  const ledgerEntry = {
    type: 'balance_adjustment',
    amountCents: adjustmentCents,
    previousAmountDueCents: priorBalanceCents,
    amountDueCents,
    reason,
    adjustedBy: actorId || null
  };

  return {
    status,
    amountDueCents,
    remainingBalanceCents,
    adjustment: {
      amountCents: adjustmentCents,
      previousAmountDueCents: priorBalanceCents,
      amountDueCents,
      note: reason,
      adjustedBy: actorId || null
    },
    ledgerEntries: [ledgerEntry]
  };
}

export function buildOfflineTeamFeeRefundUpdate({ refundType = 'full', amount, method, note, actorId, currentBalanceCents, currentPaidCents }: OfflineTeamFeeRefundInput) {
  const priorPaid = Number(currentPaidCents);
  const priorPaidCents = Number.isFinite(priorPaid) ? Math.max(0, priorPaid) : 0;
  if (priorPaidCents <= 0) {
    throw new Error('Only recipients with recorded payments can be refunded.');
  }

  const normalizedType = normalizeString(refundType).toLowerCase() === 'partial' ? 'partial' : 'full';
  const refundAmountCents = normalizedType === 'full' ? priorPaidCents : toFeeCents(amount);
  if (refundAmountCents === null || refundAmountCents <= 0) {
    throw new Error('Enter a refund amount greater than $0.');
  }
  if (refundAmountCents > priorPaidCents) {
    throw new Error('Refund amount cannot exceed the recorded paid amount.');
  }

  const refundMethod = normalizeString(method).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(REFUND_METHOD_LABELS, refundMethod)) {
    throw new Error('Select cash or check as the refund method.');
  }

  const adminNote = normalizeString(note);
  if (!adminNote) throw new Error('Enter an admin note for the refund.');

  const currentBalance = Number(currentBalanceCents);
  const balanceCents = Number.isFinite(currentBalance) ? Math.max(0, currentBalance) : 0;
  const amountPaidCents = Math.max(0, priorPaidCents - refundAmountCents);
  const remainingBalanceCents = Math.max(0, balanceCents - amountPaidCents);
  const status = normalizeLedgerStatus(balanceCents, amountPaidCents);
  const ledgerEntry = {
    type: 'offline_refund',
    amountCents: -refundAmountCents,
    refundAmountCents,
    refundType: normalizedType,
    refundMethod,
    methodLabel: REFUND_METHOD_LABELS[refundMethod],
    note: adminNote,
    recordedBy: actorId || null
  };

  return {
    status,
    amountPaidCents,
    remainingBalanceCents,
    ...(status === 'paid' ? {} : { paidAt: null }),
    refunded: {
      amountCents: refundAmountCents,
      refundType: normalizedType,
      refundMethod,
      note: adminNote,
      recordedBy: actorId || null
    },
    ledgerEntries: [ledgerEntry]
  };
}

export async function loadTeamFeeManagementModel(teamId: string, batchId: string | undefined, user: AuthUser | null): Promise<TeamFeeManagementModel> {
  if (!teamId) throw new Error('Missing team context.');
  const team = await Promise.resolve(getTeam(teamId));
  if (!team?.id) throw new Error('Team not found.');

  const canManageFees = hasFullTeamAccess(user, team);
  if (!canManageFees) {
    return {
      team: { id: team.id, name: team.name || 'Team' },
      batches: [],
      selectedBatch: null,
      recipients: [],
      rosterPlayers: [],
      canManageFees: false
    };
  }

  const [rawBatches, rawPlayers] = await Promise.all([
    Promise.resolve(listTeamFeeBatches(teamId)),
    Promise.resolve(getPlayers(teamId))
  ]);
  const batches = ((rawBatches || []) as any[]).map(toBatchSummary);
  const selectedBatch = batches.find((batch) => batch.id === batchId) || batches[0] || null;
  const recipients = selectedBatch
    ? ((await Promise.resolve(listTeamFeeRecipients(teamId, selectedBatch.id))) as any[]).map(toRecipientSummary)
    : [];
  const rosterPlayers = ((rawPlayers || []) as any[])
    .filter((player) => player?.active !== false)
    .map(toRosterPlayer)
    .filter((player) => player.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    team: { id: team.id, name: team.name || 'Team' },
    batches,
    selectedBatch,
    recipients,
    rosterPlayers,
    canManageFees: true
  };
}

export async function createTeamFeeBatchForApp({ teamId, title, amount, dueDate, recipientIds = [], applyToWholeRoster = false, user }: CreateTeamFeeBatchInput) {
  if (!teamId) throw new Error('Missing team context.');
  const team = await Promise.resolve(getTeam(teamId));
  if (!hasFullTeamAccess(user, team)) throw new Error('You do not have access to create team fees.');

  const cleanTitle = normalizeString(title);
  if (!cleanTitle) throw new Error('Enter a fee name.');
  const amountCents = toFeeCents(amount);
  if (amountCents === null || amountCents <= 0) throw new Error('Enter an amount greater than $0.');
  if (!normalizeString(dueDate)) throw new Error('Enter a due date.');

  const activePlayers = ((await Promise.resolve(getPlayers(teamId))) as any[])
    .filter((player) => player?.active !== false)
    .map(toRosterPlayer)
    .filter((player) => player.id);
  const selectedPlayers = applyToWholeRoster
    ? activePlayers
    : activePlayers.filter((player) => new Set((recipientIds || []).map(normalizeString).filter(Boolean)).has(player.id));

  if (!selectedPlayers.length) throw new Error('Select at least one roster recipient.');
  if (!applyToWholeRoster && selectedPlayers.length !== new Set((recipientIds || []).map(normalizeString).filter(Boolean)).size) {
    throw new Error('One or more selected recipients are no longer on the active roster.');
  }

  const draft = {
    title: cleanTitle,
    amountCents,
    dueDate: normalizeString(dueDate),
    notes: '',
    recipientIds: selectedPlayers.map((player) => player.id),
    lineItems: [],
    installments: [],
    collectionMode: 'offline_manual',
    offlinePaymentInstructions: OFFLINE_TEAM_FEE_INSTRUCTIONS
  };
  const recipients = selectedPlayers.map((player) => ({
    teamId,
    playerId: player.id,
    playerKey: `${teamId}::${player.id}`,
    playerName: player.name,
    playerNumber: player.number,
    feeTitle: cleanTitle,
    amountCents,
    dueDate: draft.dueDate,
    notes: '',
    status: 'unpaid',
    collectionMode: 'offline_manual',
    offlinePaymentInstructions: OFFLINE_TEAM_FEE_INSTRUCTIONS,
    lineItems: [],
    installments: []
  }));

  return createTeamFeeBatch(teamId, draft, recipients, user || {});
}

export async function recordOfflineTeamFeePayment({ teamId, batchId, recipient, amount, date, note, user }: {
  teamId: string;
  batchId: string;
  recipient: TeamFeeRecipientSummary;
  amount: string;
  date: string;
  note?: string;
  user: AuthUser | null;
}) {
  if (!teamId || !batchId || !recipient?.id) throw new Error('Missing fee recipient context.');
  const team = await Promise.resolve(getTeam(teamId));
  if (!hasFullTeamAccess(user, team)) throw new Error('You do not have access to record team fee payments.');

  const updates = buildManualPaymentUpdate({
    amount,
    date,
    note,
    actorId: user?.uid,
    currentBalanceCents: recipient.amountDueCents,
    currentPaidCents: recipient.amountPaidCents
  });

  await Promise.resolve(updateTeamFeeRecipient(teamId, batchId, recipient.id, updates));
  return updates;
}

export async function recordTeamFeeBalanceAdjustment({ teamId, batchId, recipient, amount, note, user }: {
  teamId: string;
  batchId: string;
  recipient: TeamFeeRecipientSummary;
  amount: string;
  note: string;
  user: AuthUser | null;
}) {
  if (!teamId || !batchId || !recipient?.id) throw new Error('Missing fee recipient context.');
  const team = await Promise.resolve(getTeam(teamId));
  if (!hasFullTeamAccess(user, team)) throw new Error('You do not have access to adjust team fee balances.');

  const updates = buildBalanceAdjustmentUpdate({
    amount,
    note,
    actorId: user?.uid,
    currentBalanceCents: recipient.amountDueCents,
    currentPaidCents: recipient.amountPaidCents
  });

  await Promise.resolve(updateTeamFeeRecipient(teamId, batchId, recipient.id, updates));
  return updates;
}

export async function recordOfflineTeamFeeRefund({ teamId, batchId, recipient, refundType, amount, method, note, user }: {
  teamId: string;
  batchId: string;
  recipient: TeamFeeRecipientSummary;
  refundType: string;
  amount?: string;
  method: string;
  note: string;
  user: AuthUser | null;
}) {
  if (!teamId || !batchId || !recipient?.id) throw new Error('Missing fee recipient context.');
  const team = await Promise.resolve(getTeam(teamId));
  if (!hasFullTeamAccess(user, team)) throw new Error('You do not have access to record team fee refunds.');

  const updates = buildOfflineTeamFeeRefundUpdate({
    refundType,
    amount,
    method,
    note,
    actorId: user?.uid,
    currentBalanceCents: recipient.amountDueCents,
    currentPaidCents: recipient.amountPaidCents
  });

  await Promise.resolve(updateTeamFeeRecipient(teamId, batchId, recipient.id, updates));
  return updates;
}

export async function initiateStaffTeamFeeCheckout({ teamId, batchId, recipientId, user }: {
  teamId: string;
  batchId: string;
  recipientId: string;
  user: AuthUser | null;
}) {
  if (!teamId || !batchId || !recipientId) {
    throw new Error('Missing required fields for team fee checkout.');
  }

  const team = await Promise.resolve(getTeam(teamId));
  if (!hasFullTeamAccess(user, team)) {
    throw new Error('You do not have access to generate team fee checkout links.');
  }

  const checkoutUrl = await initiateTeamFeeCheckout({ teamId, batchId, recipientId });
  if (!checkoutUrl) {
    throw new Error('Failed to get checkout URL.');
  }

  return { success: true as const, checkoutUrl };
}

function toBatchSummary(batch: any): TeamFeeBatchSummary {
  return {
    id: String(batch?.id || ''),
    title: normalizeString(batch?.title) || 'Team fee',
    dueDate: normalizeString(batch?.dueDate),
    amountCents: Number(batch?.amountCents ?? batch?.amountDueCents ?? 0) || 0,
    status: normalizeString(batch?.status) || 'open'
  };
}

function toRecipientSummary(recipient: any): TeamFeeRecipientSummary {
  const amountDueCents = Number(recipient?.amountDueCents ?? recipient?.amountCents ?? 0) || 0;
  const amountPaidCents = Number(recipient?.amountPaidCents ?? recipient?.paidAmountCents ?? 0) || 0;
  const explicitBalance = Number(recipient?.remainingBalanceCents ?? recipient?.balanceDueCents);
  return {
    id: String(recipient?.id || recipient?.recipientId || recipient?.playerId || ''),
    playerName: normalizeString(recipient?.playerName || recipient?.childName) || 'Recipient',
    parentName: normalizeString(recipient?.parentName),
    parentEmail: normalizeString(recipient?.parentEmail),
    status: normalizeString(recipient?.status) || 'unpaid',
    collectionMode: normalizeString(recipient?.collectionMode || recipient?.paymentMode),
    checkoutUrl: normalizeString(recipient?.checkoutUrl || recipient?.paymentLink || recipient?.paymentUrl),
    checkoutStatus: normalizeString(recipient?.checkoutStatus),
    amountDueCents,
    amountPaidCents,
    remainingBalanceCents: Number.isFinite(explicitBalance) ? Math.max(0, explicitBalance) : Math.max(0, amountDueCents - amountPaidCents),
    paymentLedger: Array.isArray(recipient?.paymentLedger) ? recipient.paymentLedger : []
  };
}

function toRosterPlayer(player: any): TeamFeeRosterPlayer {
  return {
    id: String(player?.id || ''),
    name: normalizeString(player?.name || player?.displayName) || 'Roster member',
    number: normalizeString(player?.number)
  };
}
