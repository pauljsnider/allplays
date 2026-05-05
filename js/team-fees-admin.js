import { escapeHtml, getUrlParams, renderFooter, renderHeader } from './utils.js?v=8';

export const OFFLINE_TEAM_FEE_LABEL = 'Offline/manual collection only';
export const OFFLINE_TEAM_FEE_INSTRUCTIONS = 'Collect payment outside ALL PLAYS. No online payment is processed.';

const STATUS_LABELS = {
    paid: 'Paid',
    unpaid: 'Unpaid',
    adjusted: 'Adjusted',
    canceled: 'Canceled'
};

function normalizeString(value) {
    return String(value || '').trim();
}

export function parseTeamFeeAmountToCents(value) {
    const normalized = normalizeString(value).replace(/[$,]/g, '');
    if (!normalized) return null;

    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    return Math.round(amount * 100);
}

export function toFeeCents(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = normalizeString(value).replace(/[$,]/g, '');
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100);
}

export function isTeamFeeAdmin(team, user = {}) {
    if (!team || !user) return false;
    if (user.isAdmin === true) return true;
    if (team.ownerId && user.uid && team.ownerId === user.uid) return true;

    const email = normalizeString(user.email || user.profileEmail).toLowerCase();
    if (!email) return false;

    return (team.adminEmails || [])
        .map((adminEmail) => normalizeString(adminEmail).toLowerCase())
        .includes(email);
}

export function normalizeTeamFeeDraft(formValues = {}) {
    const title = normalizeString(formValues.title);
    const amountCents = parseTeamFeeAmountToCents(formValues.amount);
    const dueDate = normalizeString(formValues.dueDate);
    const notes = normalizeString(formValues.notes);
    const recipientIds = Array.from(new Set((formValues.recipientIds || [])
        .map((id) => normalizeString(id))
        .filter(Boolean)));

    if (!title) throw new Error('Fee title is required.');
    if (!amountCents) throw new Error('Enter an amount greater than $0.');
    if (!dueDate) throw new Error('Due date is required.');
    if (recipientIds.length === 0) throw new Error('Select at least one roster recipient.');

    return {
        title,
        amountCents,
        dueDate,
        notes,
        recipientIds,
        collectionMode: 'offline_manual',
        offlinePaymentInstructions: OFFLINE_TEAM_FEE_INSTRUCTIONS
    };
}

export function buildTeamFeeRecipientRecords(draft, players = [], teamId = '') {
    const selectedIds = new Set(draft.recipientIds || []);
    return (players || [])
        .filter((player) => selectedIds.has(player.id))
        .map((player) => ({
            teamId,
            playerId: player.id,
            playerKey: teamId && player.id ? `${teamId}::${player.id}` : '',
            playerName: player.name || player.displayName || 'Roster member',
            playerNumber: player.number || '',
            feeTitle: draft.title,
            amountCents: draft.amountCents,
            dueDate: draft.dueDate,
            notes: draft.notes || '',
            status: 'unpaid',
            collectionMode: 'offline_manual',
            offlinePaymentInstructions: draft.offlinePaymentInstructions || OFFLINE_TEAM_FEE_INSTRUCTIONS
        }));
}

export function normalizeFeeStatus(status) {
    const normalized = normalizeString(status || 'unpaid').toLowerCase();
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, normalized) ? normalized : 'unpaid';
}

export function getRecipientBalanceCents(recipient) {
    if (recipient?.status === 'canceled') return 0;
    const raw = recipient?.amountDueCents ?? recipient?.adjustedAmountCents ?? recipient?.amountCents ?? 0;
    const cents = Number(raw);
    return Number.isFinite(cents) ? Math.max(0, cents) : 0;
}

export function getRecipientPaidCents(recipient) {
    if (recipient?.status === 'canceled') return 0;
    if (recipient?.status === 'paid') {
        const paid = Number(recipient?.amountPaidCents ?? recipient?.paidAmountCents);
        return Number.isFinite(paid) ? Math.max(0, paid) : getRecipientBalanceCents(recipient);
    }
    const paid = Number(recipient?.amountPaidCents ?? recipient?.paidAmountCents ?? 0);
    return Number.isFinite(paid) ? Math.max(0, paid) : 0;
}

export function summarizeFeeRecipients(recipients = []) {
    const summary = {
        totalAssignedCents: 0,
        totalPaidCents: 0,
        totalOutstandingCents: 0,
        counts: {
            paid: 0,
            unpaid: 0,
            adjusted: 0,
            canceled: 0
        }
    };

    recipients.forEach((recipient) => {
        const status = normalizeFeeStatus(recipient?.status);
        const balance = getRecipientBalanceCents(recipient);
        const paid = getRecipientPaidCents(recipient);
        summary.counts[status] += 1;
        summary.totalAssignedCents += status === 'canceled' ? 0 : balance;
        summary.totalPaidCents += paid;
        summary.totalOutstandingCents += status === 'paid' || status === 'canceled' ? 0 : Math.max(0, balance - paid);
    });

    return summary;
}

export function formatFeeCurrency(cents) {
    const amount = Number(cents);
    if (!Number.isFinite(amount)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount / 100);
}

export function buildManualPaymentUpdate({ amount, date, note, actorId }) {
    const amountPaidCents = toFeeCents(amount);
    if (amountPaidCents === null || amountPaidCents <= 0) {
        throw new Error('Enter a manual payment amount greater than $0.');
    }
    if (!date) throw new Error('Enter a manual payment date.');

    return {
        status: 'paid',
        amountPaidCents,
        paidAt: date,
        manualPayment: {
            amountPaidCents,
            paidAt: date,
            note: normalizeString(note),
            recordedBy: actorId || null
        }
    };
}

export function buildBalanceAdjustmentUpdate({ amount, note, actorId }) {
    const amountDueCents = toFeeCents(amount);
    if (amountDueCents === null) {
        throw new Error('Enter a valid adjusted balance.');
    }

    return {
        status: amountDueCents === 0 ? 'paid' : 'adjusted',
        amountDueCents,
        adjustment: {
            amountDueCents,
            note: normalizeString(note),
            adjustedBy: actorId || null
        }
    };
}

export function buildCancelRecipientUpdate({ note, actorId }) {
    return {
        status: 'canceled',
        amountDueCents: 0,
        canceled: {
            note: normalizeString(note),
            canceledBy: actorId || null
        }
    };
}

export function getRecipientDisplayName(recipient) {
    return recipient?.playerName || recipient?.childName || recipient?.name || recipient?.parentName || recipient?.parentEmail || 'Recipient';
}

export function getStatusLabel(status) {
    return STATUS_LABELS[normalizeFeeStatus(status)];
}

function renderRosterOptions(players) {
    if (!players.length) {
        return '<p class="text-sm text-gray-500">No active roster members found for this team.</p>';
    }

    return players.map((player) => `
        <label class="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 hover:border-primary-300">
            <input type="checkbox" name="recipients" value="${escapeHtml(player.id)}" class="h-4 w-4 rounded border-gray-300 text-primary-600" checked>
            <span class="flex-1">
                <span class="block font-semibold text-gray-900">${escapeHtml(player.name || player.displayName || 'Roster member')}</span>
                ${player.number ? `<span class="text-xs text-gray-500">#${escapeHtml(player.number)}</span>` : ''}
            </span>
        </label>
    `).join('');
}

function showMessage(message, type = 'info') {
    const el = document.getElementById('fee-message');
    if (!el) return;

    const colors = type === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : type === 'success'
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-blue-200 bg-blue-50 text-blue-700';

    el.className = `rounded-xl border p-4 text-sm ${colors}`;
    el.textContent = message;
    el.classList.remove('hidden');
}

function collectFormValues(form) {
    return {
        title: form.elements.title.value,
        amount: form.elements.amount.value,
        dueDate: form.elements.dueDate.value,
        notes: form.elements.notes.value,
        recipientIds: Array.from(form.querySelectorAll('input[name="recipients"]:checked')).map((input) => input.value)
    };
}

function renderSummary(container, recipients) {
    const summary = summarizeFeeRecipients(recipients);
    const cards = [
        ['Total assigned', formatFeeCurrency(summary.totalAssignedCents)],
        ['Total paid', formatFeeCurrency(summary.totalPaidCents)],
        ['Outstanding', formatFeeCurrency(summary.totalOutstandingCents)],
        ['Status counts', `${summary.counts.paid} paid · ${summary.counts.unpaid} unpaid · ${summary.counts.adjusted} adjusted · ${summary.counts.canceled} canceled`]
    ];
    container.innerHTML = cards.map(([label, value]) => `
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">${label}</div>
            <div class="mt-1 text-xl font-bold text-gray-900">${value}</div>
        </div>
    `).join('');
}

function renderRecipients(container, countEl, recipients) {
    countEl.textContent = `${recipients.length} assigned recipient${recipients.length === 1 ? '' : 's'}`;
    if (recipients.length === 0) {
        container.innerHTML = '<div class="p-6 text-sm text-gray-500">No recipients are assigned to this fee batch.</div>';
        return;
    }

    container.innerHTML = recipients.map((recipient) => {
        const name = escapeHtml(getRecipientDisplayName(recipient));
        const status = getStatusLabel(recipient.status);
        const balance = formatFeeCurrency(getRecipientBalanceCents(recipient));
        const paid = formatFeeCurrency(getRecipientPaidCents(recipient));
        const note = recipient.manualPayment?.note || recipient.adjustment?.note || recipient.canceled?.note || recipient.notes || '';
        return `
            <article class="p-5" data-recipient-id="${escapeHtml(recipient.id)}">
                <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <h3 class="font-bold text-gray-900">${name}</h3>
                            <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">${status}</span>
                        </div>
                        <div class="mt-1 text-sm text-gray-500">Balance ${balance} · Paid ${paid}</div>
                        ${note ? `<p class="mt-2 text-sm text-gray-600">${escapeHtml(note)}</p>` : ''}
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 w-full lg:max-w-4xl">
                        <form data-action="paid" class="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                            <div class="text-xs font-bold uppercase tracking-wide text-gray-500">Manual payment</div>
                            <input name="amount" type="number" min="0" step="0.01" value="${(getRecipientBalanceCents(recipient) / 100).toFixed(2)}" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Payment amount">
                            <input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Payment date">
                            <input name="note" type="text" placeholder="Optional note" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Payment note">
                            <button class="w-full rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700">Mark paid</button>
                        </form>
                        <form data-action="adjust" class="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                            <div class="text-xs font-bold uppercase tracking-wide text-gray-500">Adjust balance</div>
                            <input name="amount" type="number" min="0" step="0.01" value="${(getRecipientBalanceCents(recipient) / 100).toFixed(2)}" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Adjusted balance">
                            <input name="note" type="text" placeholder="Reason" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Adjustment note">
                            <button class="w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700">Save adjustment</button>
                        </form>
                        <form data-action="cancel" class="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                            <div class="text-xs font-bold uppercase tracking-wide text-gray-500">Cancel recipient</div>
                            <input name="note" type="text" placeholder="Reason" class="w-full rounded-lg border-gray-300 text-sm" aria-label="Cancellation note">
                            <button class="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800">Cancel balance</button>
                        </form>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

function canManageTeamFees(team, user, canModerateChat) {
    return isTeamFeeAdmin(team, user) || canModerateChat(user, team);
}

async function renderCreateMode({ container, teamId, team, user, getPlayers, createTeamFeeBatch }) {
    const players = await getPlayers(teamId);
    container.innerHTML = `
        <div class="mb-6">
            <a href="dashboard.html" class="text-sm font-semibold text-primary-600 hover:text-primary-700">Back to My Teams</a>
            <h1 class="mt-3 text-3xl font-bold text-gray-900">Create offline team fee</h1>
            <p class="mt-2 text-gray-600">${escapeHtml(team.name || 'Team')} fee batches are for manual collection only.</p>
        </div>

        <div class="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
            <p class="font-bold">${OFFLINE_TEAM_FEE_LABEL}</p>
            <p class="mt-1 text-sm">No credit card, Stripe, checkout, email, push, or SMS workflow is created. This only records unpaid roster fee assignments.</p>
        </div>

        <form id="team-fee-form" class="rounded-2xl border border-gray-200 bg-white p-6 shadow-md">
            <div id="fee-message" class="hidden"></div>
            <div class="mt-4 grid gap-4 md:grid-cols-2">
                <label class="block">
                    <span class="text-sm font-semibold text-gray-700">Title</span>
                    <input name="title" type="text" required placeholder="Tournament dues" class="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none">
                </label>
                <label class="block">
                    <span class="text-sm font-semibold text-gray-700">Amount</span>
                    <input name="amount" type="number" min="0.01" step="0.01" required placeholder="25.00" class="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none">
                </label>
                <label class="block">
                    <span class="text-sm font-semibold text-gray-700">Due date</span>
                    <input name="dueDate" type="date" required class="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none">
                </label>
                <label class="block md:col-span-2">
                    <span class="text-sm font-semibold text-gray-700">Notes <span class="font-normal text-gray-500">optional</span></span>
                    <textarea name="notes" rows="3" placeholder="Cash/check instructions, what this covers, or who to contact." class="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none"></textarea>
                </label>
            </div>

            <div class="mt-6">
                <div class="mb-3 flex items-center justify-between gap-3">
                    <h2 class="text-lg font-bold text-gray-900">Recipients</h2>
                    <span class="text-sm text-gray-500">Selected recipients will be saved as unpaid.</span>
                </div>
                <div class="grid gap-3 md:grid-cols-2">${renderRosterOptions(players)}</div>
            </div>

            <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <a href="dashboard.html" class="rounded-xl border border-gray-300 px-5 py-3 text-center font-semibold text-gray-700 hover:bg-gray-50">Cancel</a>
                <button type="submit" class="rounded-xl bg-primary-600 px-5 py-3 font-semibold text-white shadow hover:bg-primary-700">Save unpaid fee records</button>
            </div>
        </form>
    `;

    const form = document.getElementById('team-fee-form');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = 'Saving...';

        try {
            const draft = normalizeTeamFeeDraft(collectFormValues(form));
            const recipients = buildTeamFeeRecipientRecords(draft, players, teamId);
            if (recipients.length !== draft.recipientIds.length) {
                throw new Error('One or more selected recipients are no longer on the active roster.');
            }

            const batch = await createTeamFeeBatch(teamId, draft, recipients, user);
            form.reset();
            showMessage(`Fee batch saved with unpaid recipient records. Batch ID: ${batch.id}`, 'success');
        } catch (error) {
            showMessage(error?.message || 'Unable to save fee batch.', 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Save unpaid fee records';
        }
    });
}

async function renderManageMode({ container, teamId, batchId, team, user, getTeamFeeBatch, listTeamFeeRecipients, updateTeamFeeRecipient }) {
    container.innerHTML = `
        <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
                <a href="team.html?id=${encodeURIComponent(teamId)}" class="text-sm font-semibold text-primary-600 hover:text-primary-700">Back to team</a>
                <h1 id="page-title" class="mt-2 text-3xl font-bold text-gray-900">Manage team fee</h1>
                <p id="page-subtitle" class="mt-1 text-sm text-gray-600">Review assigned recipients, record offline payments, and adjust balances.</p>
            </div>
            <button id="refresh-btn" type="button" class="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-700 border border-gray-200 shadow-sm hover:bg-gray-50">Refresh</button>
        </div>

        <div id="fee-message" class="mb-4 hidden rounded-xl border px-4 py-3 text-sm"></div>
        <section id="summary-cards" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"></section>
        <section class="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
            <div class="px-5 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                    <h2 class="text-lg font-bold text-gray-900">Recipients</h2>
                    <p id="recipient-count" class="text-sm text-gray-500">Loading recipients...</p>
                </div>
            </div>
            <div id="recipients-list" class="divide-y divide-gray-100">
                <div class="p-6 text-sm text-gray-500">Loading...</div>
            </div>
        </section>
    `;

    const title = document.getElementById('page-title');
    const subtitle = document.getElementById('page-subtitle');
    const summary = document.getElementById('summary-cards');
    const count = document.getElementById('recipient-count');
    const list = document.getElementById('recipients-list');

    async function loadBatch() {
        const batch = await getTeamFeeBatch(teamId, batchId);
        if (!batch) throw new Error('Fee batch not found.');
        title.textContent = batch.title || batch.feeTitle || batch.name || 'Manage team fee';
        subtitle.textContent = `${team.name || 'Team'} · Offline payment tracking`;
        const recipients = await listTeamFeeRecipients(teamId, batchId);
        renderSummary(summary, recipients);
        renderRecipients(list, count, recipients);
    }

    list.addEventListener('submit', async (event) => {
        const form = event.target.closest('form[data-action]');
        if (!form) return;
        event.preventDefault();

        const article = form.closest('[data-recipient-id]');
        const recipientId = article?.dataset?.recipientId;
        const data = Object.fromEntries(new FormData(form).entries());
        let updates;

        try {
            if (form.dataset.action === 'paid') {
                updates = buildManualPaymentUpdate({ ...data, actorId: user.uid });
            } else if (form.dataset.action === 'adjust') {
                updates = buildBalanceAdjustmentUpdate({ ...data, actorId: user.uid });
            } else {
                updates = buildCancelRecipientUpdate({ ...data, actorId: user.uid });
            }
            await updateTeamFeeRecipient(teamId, batchId, recipientId, updates);
            showMessage('Fee recipient updated.', 'success');
            await loadBatch();
        } catch (error) {
            showMessage(error?.message || 'Unable to update fee recipient.', 'error');
        }
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadBatch().catch((error) => showMessage(error?.message || 'Unable to load fee batch.', 'error'));
    });

    await loadBatch();
}

async function initTeamFeesAdminPage() {
    if (typeof document === 'undefined') return;

    const container = document.getElementById('team-fees-admin-root');
    if (!container) return;

    renderFooter(document.getElementById('footer-container'));

    const [{ getTeam, getPlayers, getUserProfile, createTeamFeeBatch, getTeamFeeBatch, listTeamFeeRecipients, updateTeamFeeRecipient, canModerateChat }, { requireAuth }] = await Promise.all([
        import('./db.js?v=22'),
        import('./auth.js?v=12')
    ]);

    try {
        const user = await requireAuth();
        let profile = null;
        try {
            profile = await getUserProfile(user.uid);
            if (profile?.isAdmin) user.isAdmin = true;
            if (profile?.email) user.profileEmail = profile.email;
        } catch (error) {
            console.warn('[team-fees] Unable to load profile:', error);
        }

        renderHeader(document.getElementById('header-container'), user);

        const params = getUrlParams();
        const teamId = params.teamId || '';
        const batchId = params.batchId || params.feeBatchId || '';
        if (!teamId) {
            container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Missing teamId.</div>';
            return;
        }

        const team = await getTeam(teamId, { includeInactive: true });
        if (!team) {
            container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Team not found.</div>';
            return;
        }

        if (!canManageTeamFees(team, user, canModerateChat)) {
            container.innerHTML = `
                <div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
                    <h1 class="mb-2 text-2xl font-bold">Fees are admin-only</h1>
                    <p>Only team owners, team admins, and global admins can create or edit offline fee batches.</p>
                </div>
            `;
            return;
        }

        if (batchId) {
            await renderManageMode({ container, teamId, batchId, team, user, getTeamFeeBatch, listTeamFeeRecipients, updateTeamFeeRecipient });
        } else {
            await renderCreateMode({ container, teamId, team, user, getPlayers, createTeamFeeBatch });
        }
    } catch (error) {
        console.error('[team-fees] init failed:', error);
        container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Unable to load team fees.</div>';
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', initTeamFeesAdminPage);
}
