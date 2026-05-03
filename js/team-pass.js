import { auth } from './firebase.js?v=11';
import { hasFullTeamAccess } from './team-access.js';

function getFunctionsBaseUrl() {
    const configured = window.__ALLPLAYS_CONFIG__?.functionsBaseUrl || window.__ALLPLAYS_CONFIG__?.functions?.baseUrl;
    if (configured) return String(configured).replace(/\/$/, '');

    const projectId = auth.app?.options?.projectId;
    if (!projectId) {
        throw new Error('Firebase project ID is not configured.');
    }
    return `https://us-central1-${projectId}.cloudfunctions.net`;
}

export async function createTeamPassCheckout({ teamId, seasonId, tier = 'team-pass' } = {}) {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('Sign in before purchasing a Team Pass.');
    }

    const token = await user.getIdToken();
    const response = await fetch(`${getFunctionsBaseUrl()}/createStripeTeamPassCheckout`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ data: { teamId, seasonId, tier } })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
        throw new Error(payload.error?.message || 'Unable to start Team Pass checkout.');
    }

    return payload.result || payload.data || payload;
}

export async function redirectToTeamPassCheckout(options) {
    const result = await createTeamPassCheckout(options);
    if (!result.checkoutUrl) {
        throw new Error('Checkout URL was not returned.');
    }
    window.location.href = result.checkoutUrl;
    return result;
}

function escapeTeamPassHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function arrayIncludesTeamId(values, teamId) {
    return Array.isArray(values) && values.some((value) => {
        if (typeof value === 'string') return value === teamId;
        return value?.teamId === teamId || value?.id === teamId;
    });
}

export function getTeamPassAccess(user, team) {
    const teamId = team?.id;
    const isCoachOrAdmin = hasFullTeamAccess(user, team) || arrayIncludesTeamId(user?.coachOf, teamId);
    const isConfirmedParent = arrayIncludesTeamId(user?.parentOf, teamId);
    const isEligible = Boolean(user && teamId && (isCoachOrAdmin || isConfirmedParent));

    if (isCoachOrAdmin) {
        return { isEligible, label: 'Coach/Admin access', mode: 'eligible' };
    }

    if (isConfirmedParent) {
        return { isEligible, label: 'Confirmed parent access', mode: 'eligible' };
    }

    return { isEligible: false, label: 'Read-only preview', mode: 'readonly' };
}

export function buildTeamPassMarkup({ team = {}, access = { isEligible: false, label: 'Read-only preview' } } = {}) {
    const teamName = escapeTeamPassHtml(team?.name || 'this team');
    const ctaText = access.isEligible ? 'Buy Team Pass' : 'Purchase unavailable';
    const ctaClasses = access.isEligible
        ? 'bg-primary-600 text-white hover:bg-primary-700 cursor-not-allowed'
        : 'bg-gray-200 text-gray-500 cursor-not-allowed';
    const helperText = access.isEligible
        ? 'Checkout is not connected yet, so this button is intentionally disabled.'
        : 'Sign in as a coach, admin, or confirmed parent to start purchase when checkout is configured.';

    return `
        <section id="team-pass" class="mb-8 bg-white rounded-2xl shadow-lg border border-primary-200 overflow-hidden">
            <div class="p-6 md:p-8 bg-gradient-to-br from-primary-50 via-white to-amber-50">
                <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                    <div class="max-w-3xl">
                        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-200 mb-4">
                            Team-wide fan access
                        </div>
                        <h2 class="text-2xl md:text-3xl font-bold text-gray-900 mb-3">Buy Team Pass for ${teamName}</h2>
                        <p class="text-gray-600 leading-relaxed">
                            A Team Pass will cover fan-facing Plus or Premium features for the whole team for the selected season. One team purchase keeps families on the same access level without per-parent setup.
                        </p>
                        <div class="mt-4 flex flex-wrap gap-2 text-sm">
                            <span class="inline-flex px-3 py-1 rounded-full bg-white border border-primary-100 text-primary-700 font-semibold">Season-scoped coverage</span>
                            <span class="inline-flex px-3 py-1 rounded-full bg-white border border-primary-100 text-primary-700 font-semibold">Applies team-wide</span>
                            <span class="inline-flex px-3 py-1 rounded-full bg-white border border-primary-100 text-primary-700 font-semibold">No charges today</span>
                        </div>
                    </div>
                    <div class="lg:w-72 bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Your access</div>
                        <div class="text-lg font-bold text-gray-900">${escapeTeamPassHtml(access.label)}</div>
                        <button type="button" disabled aria-disabled="true" class="mt-4 w-full inline-flex justify-center items-center px-4 py-2.5 rounded-lg text-sm font-bold transition ${ctaClasses}">
                            ${ctaText}
                        </button>
                        <p class="mt-2 text-xs text-gray-500 leading-relaxed">${helperText}</p>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                    <div class="bg-white rounded-xl border border-gray-200 p-5">
                        <h3 class="text-lg font-bold text-gray-900 mb-2">Plus Team Pass</h3>
                        <p class="text-sm text-gray-600 leading-relaxed">Designed for core fan features such as enhanced live following, replay convenience, and season access for families.</p>
                        <div class="mt-4 text-sm font-semibold text-gray-500">Checkout pending backend configuration</div>
                    </div>
                    <div class="bg-white rounded-xl border border-amber-200 p-5">
                        <h3 class="text-lg font-bold text-gray-900 mb-2">Premium Team Pass</h3>
                        <p class="text-sm text-gray-600 leading-relaxed">Designed for the full fan experience, including Premium fan capabilities when entitlement support is added later.</p>
                        <div class="mt-4 text-sm font-semibold text-gray-500">Checkout pending backend configuration</div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

export function renderTeamPassCard(container, { user, team } = {}) {
    if (!container) return;
    const access = getTeamPassAccess(user, team);
    container.innerHTML = buildTeamPassMarkup({ team, access });
}
