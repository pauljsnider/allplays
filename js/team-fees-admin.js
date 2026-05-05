import { escapeHtml, getUrlParams, renderFooter, renderHeader } from './utils.js?v=8';

export const OFFLINE_TEAM_FEE_LABEL = 'Offline/manual collection only';
export const OFFLINE_TEAM_FEE_INSTRUCTIONS = 'Collect payment outside ALL PLAYS. No online payment is processed.';

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

    if (!title) {
        throw new Error('Fee title is required.');
    }
    if (!amountCents) {
        throw new Error('Enter an amount greater than $0.');
    }
    if (!dueDate) {
        throw new Error('Due date is required.');
    }
    if (recipientIds.length === 0) {
        throw new Error('Select at least one roster recipient.');
    }

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

async function initTeamFeesAdminPage() {
    if (typeof document === 'undefined') return;

    const container = document.getElementById('team-fees-admin-root');
    if (!container) return;

    renderFooter(document.getElementById('footer-container'));

    const [{ getTeam, getPlayers, getUserProfile, createTeamFeeBatch }, { requireAuth }] = await Promise.all([
        import('./db.js?v=16'),
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

        const { teamId } = getUrlParams();
        if (!teamId) {
            container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Missing teamId.</div>';
            return;
        }

        const team = await getTeam(teamId, { includeInactive: true });
        if (!team) {
            container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Team not found.</div>';
            return;
        }

        if (!isTeamFeeAdmin(team, user)) {
            container.innerHTML = `
                <div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
                    <h1 class="mb-2 text-2xl font-bold">Fees are admin-only</h1>
                    <p>Only team owners, team admins, and global admins can create or edit offline fee batches.</p>
                </div>
            `;
            return;
        }

        const players = await getPlayers(teamId);
        container.innerHTML = `
            <div class="mb-6">
                <a href="dashboard.html" class="text-sm font-semibold text-primary-600 hover:text-primary-700">← Back to My Teams</a>
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

                await createTeamFeeBatch(teamId, draft, recipients, user);
                form.reset();
                showMessage('Fee batch saved with unpaid recipient records.', 'success');
            } catch (error) {
                showMessage(error?.message || 'Unable to save fee batch.', 'error');
            } finally {
                button.disabled = false;
                button.textContent = 'Save unpaid fee records';
            }
        });
    } catch (error) {
        console.error('[team-fees] init failed:', error);
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', initTeamFeesAdminPage);
}
