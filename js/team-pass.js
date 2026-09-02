import { auth } from './firebase.js?v=34';
import { getPrimaryAppCheckHeaders } from './firebase-app-check-rest.js?v=1';
import { hasFullTeamAccess } from './team-access.js?v=44338';
import { PREMIUM_FEATURES, resolvePremiumAccess } from './premium-access-core.js?v=1';
import { readPremiumAccessConfig } from './premium-access.js?v=8';

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
    const requestUrl = `${getFunctionsBaseUrl()}/createStripeTeamPassCheckout`;
    const response = await fetch(requestUrl, {
        method: 'POST',
        headers: await getPrimaryAppCheckHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }, requestUrl),
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
    const checkoutUrl = getCanonicalStripeCheckoutUrl(result.checkoutUrl);
    if (!checkoutUrl) throw new Error('Stripe returned an invalid checkout destination.');
    window.location.href = checkoutUrl;
    return { ...result, checkoutUrl };
}

export function getCanonicalStripeCheckoutUrl(value) {
    if (typeof value !== 'string' || !value || value !== value.trim()) return '';
    try {
        const destination = new URL(value);
        if (
            destination.protocol === 'https:' &&
            destination.hostname === 'checkout.stripe.com' &&
            !destination.username &&
            !destination.password &&
            !destination.port &&
            destination.pathname &&
            destination.pathname !== '/'
        ) return value;
    } catch {
        // Invalid destinations use the same fail-closed result.
    }
    return '';
}

function escapeTeamPassHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(value) {
    return normalizeString(value).toLowerCase();
}

function resolveTeamPassSeasonId(team = {}, now = new Date()) {
    const explicitSeason = team.currentSeasonId || team.seasonId || team.season;
    if (explicitSeason) return String(explicitSeason).trim();
    return String(now.getUTCFullYear());
}

function normalizeDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
    if (typeof value.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : undefined;
    }
    if (typeof value.seconds === 'number') {
        const date = new Date(value.seconds * 1000);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    if (typeof value === 'number' || typeof value === 'string') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
}

function getExpirationDate(data) {
    if (!data || typeof data !== 'object') return null;
    const fields = ['expiresAt', 'validUntil', 'endsAt', 'endAt'];
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(data, field)) {
            return normalizeDateValue(data[field]);
        }
    }
    return null;
}

function getUpdatedDate(data) {
    if (!data || typeof data !== 'object') return null;
    const fields = ['updatedAt', 'lastUpdatedAt', 'createdAt', 'purchasedAt'];
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(data, field)) {
            return normalizeDateValue(data[field]);
        }
    }
    return null;
}

function arrayIncludesTeamId(values, teamId) {
    return Array.isArray(values) && values.some((value) => {
        if (typeof value === 'string') return value === teamId;
        return value?.teamId === teamId || value?.id === teamId;
    });
}

function loadFirebase(deps = {}) {
    if (deps.firebase) return deps.firebase;
    return import('./firebase.js?v=34');
}

function dataFromSnapshot(docSnap) {
    return typeof docSnap?.data === 'function' ? docSnap.data() : null;
}

function compareByUpdatedAtDesc(a, b) {
    const aTime = getUpdatedDate(a)?.getTime?.() || 0;
    const bTime = getUpdatedDate(b)?.getTime?.() || 0;
    return bTime - aTime;
}

export function getTeamPassAccess(user, team) {
    const teamId = team?.id;
    const hasFullAccess = hasFullTeamAccess(user, team);
    const isConfirmedParent = arrayIncludesTeamId(user?.parentOf, teamId) || arrayIncludesTeamId(user?.parentTeamIds, teamId);
    const canPurchase = hasFullAccess || isConfirmedParent;
    const isStaff = hasFullAccess || arrayIncludesTeamId(user?.coachOf, teamId);

    if (isStaff) {
        return { isStaff: true, canPurchase, canReadStatus: true, label: 'Coach/Admin access', mode: 'staff' };
    }

    if (isConfirmedParent) {
        return { isStaff: false, canPurchase: true, canReadStatus: true, label: 'Team member access', mode: 'readonly' };
    }

    return { isStaff: false, canPurchase: false, canReadStatus: false, label: 'Read-only preview', mode: 'readonly' };
}

export function shouldShowTeamPassCheckout({ access, pass } = {}) {
    return access?.canPurchase === true && ['missing', 'expired', 'revoked'].includes(pass?.status);
}

export function normalizeTeamPassStatus(record, { team = {}, now = new Date() } = {}) {
    if (!record || typeof record !== 'object') {
        return { status: 'missing', label: 'Missing', record: null, expiresAt: null, updatedAt: null };
    }

    const rawStatus = normalizeStatus(record.status);
    const expiresAt = getExpirationDate(record);
    const updatedAt = getUpdatedDate(record);
    const entitlementTeamId = normalizeString(record.teamId);
    const isWrongTeam = entitlementTeamId && team?.id && entitlementTeamId !== team.id;
    const isRevoked = rawStatus === 'revoked' || rawStatus === 'deleted' || record.revoked === true || record.isRevoked === true || Boolean(normalizeDateValue(record.revokedAt));
    const isExpired = rawStatus === 'expired' || (expiresAt instanceof Date && expiresAt <= now);

    if (isWrongTeam) {
        return { status: 'missing', label: 'Missing', record: null, expiresAt: null, updatedAt: null };
    }

    if (isRevoked) {
        return { status: 'revoked', label: 'Revoked', record, expiresAt, updatedAt };
    }

    if (isExpired) {
        return { status: 'expired', label: 'Expired', record, expiresAt, updatedAt };
    }

    if (rawStatus === 'active') {
        return { status: 'active', label: 'Active', record, expiresAt, updatedAt };
    }

    return { status: 'missing', label: 'Missing', record: null, expiresAt: null, updatedAt: null };
}

export function selectTeamPassRecord(records = [], { team = {}, now = new Date() } = {}) {
    const currentSeasonId = resolveTeamPassSeasonId(team, now);
    const candidates = (Array.isArray(records) ? records : [])
        .filter((record) => {
            if (!record || typeof record !== 'object') return false;
            const tier = normalizeString(record.tier);
            const entitlementTeamId = normalizeString(record.teamId);
            const seasonId = normalizeString(record.seasonId || record.season);
            return (!tier || tier === 'team-pass') &&
                (!entitlementTeamId || entitlementTeamId === team?.id) &&
                (!currentSeasonId || seasonId === currentSeasonId);
        })
        .sort(compareByUpdatedAtDesc);

    const normalized = candidates.map((record) => normalizeTeamPassStatus(record, { team, now }));
    return normalized[0] || normalizeTeamPassStatus(null, { team, now });
}

export async function readTeamPassStatus({ team, access, deps = {}, configReader = readPremiumAccessConfig } = {}) {
    const config = await configReader({ deps });
    const globalAccess = resolvePremiumAccess({ feature: PREMIUM_FEATURES.TEAM_ANALYTICS, config });
    if (globalAccess.state === 'unlocked') {
        return { status: 'open', label: 'Open to everyone', record: null, expiresAt: null, updatedAt: null };
    }
    if (globalAccess.state === 'unavailable' || globalAccess.state === 'loading') {
        return { status: 'unavailable', label: 'Unavailable', record: null, expiresAt: null, updatedAt: null };
    }
    if (!team?.id || !access?.canReadStatus) {
        return { status: 'readonly', label: 'Read-only', record: null, expiresAt: null, updatedAt: null };
    }

    try {
        const { db, collection, getDocs } = await loadFirebase(deps);
        const snapshot = await getDocs(collection(db, `teams/${team.id}/entitlements`));
        return selectTeamPassRecord(snapshot.docs.map(dataFromSnapshot), { team });
    } catch (error) {
        console.error('Unable to read Team Pass status:', error);
        return { status: 'unavailable', label: 'Unavailable', record: null, expiresAt: null, updatedAt: null };
    }
}

function formatDateForPanel(value) {
    if (!(value instanceof Date)) return 'Not set';
    return value.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getStatusClasses(status) {
    if (status === 'open') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    if (status === 'active') return 'bg-green-50 text-green-700 border-green-200';
    if (status === 'expired') return 'bg-amber-50 text-amber-800 border-amber-200';
    if (status === 'revoked') return 'bg-red-50 text-red-700 border-red-200';
    if (status === 'unavailable') return 'bg-gray-50 text-gray-700 border-gray-200';
    return 'bg-gray-50 text-gray-700 border-gray-200';
}

function getPanelCopy(status, access) {
    if (status === 'open') {
        return 'Premium features are currently open to everyone. No Team Pass purchase is needed while global access is enabled.';
    }
    if (!access?.isStaff) {
        return 'Team Pass access is managed by team staff. You can view team content normally when your team access allows it.';
    }
    if (status === 'missing') {
        return 'No Team Pass is configured for this team yet. Checkout is not available, so staff will need to configure the pass later.';
    }
    if (status === 'expired') {
        return 'This Team Pass has expired. Checkout is not available, so renewal must be configured later.';
    }
    if (status === 'revoked') {
        return 'This Team Pass has been revoked. This panel is informational only and does not grant or revoke access.';
    }
    if (status === 'active') {
        return 'This team has an active Team Pass. This panel is informational only and does not grant or revoke access.';
    }
    return 'Team Pass status could not be verified right now. No entitlement changes were made.';
}

export function buildTeamPassMarkup({ team = {}, access = getTeamPassAccess(null, team), pass = { status: 'readonly', label: 'Read-only' } } = {}) {
    const teamName = escapeTeamPassHtml(team?.name || 'this team');
    const status = pass?.status || 'readonly';
    const label = escapeTeamPassHtml(pass?.label || 'Read-only');
    const statusClasses = getStatusClasses(status);
    const showStaffMetadata = access?.isStaff;
    const showCheckout = shouldShowTeamPassCheckout({ access, pass });

    return `
        <section id="team-pass" class="mb-8 bg-white rounded-2xl shadow-lg border border-primary-200 overflow-hidden">
            <div class="p-6 md:p-8 bg-gradient-to-br from-primary-50 via-white to-amber-50">
                <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                    <div class="max-w-3xl">
                        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-200 mb-4">
                            Team Pass management
                        </div>
                        <h2 class="text-2xl md:text-3xl font-bold text-gray-900 mb-3">Team Pass for ${teamName}</h2>
                        <p class="text-gray-600 leading-relaxed">${escapeTeamPassHtml(getPanelCopy(status, access))}</p>
                    </div>
                    <div class="lg:w-80 bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Current status</div>
                        <div class="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold border ${statusClasses}">${label}</div>
                        <dl class="mt-4 space-y-3 text-sm">
                            <div>
                                <dt class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Covered team</dt>
                                <dd class="mt-1 font-semibold text-gray-900">${teamName}</dd>
                            </div>
                            ${showStaffMetadata ? `
                            <div>
                                <dt class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Expiration</dt>
                                <dd class="mt-1 text-gray-700">${escapeTeamPassHtml(formatDateForPanel(pass?.expiresAt))}</dd>
                            </div>
                            <div>
                                <dt class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Last updated</dt>
                                <dd class="mt-1 text-gray-700">${escapeTeamPassHtml(formatDateForPanel(pass?.updatedAt))}</dd>
                            </div>
                            ` : ''}
                        </dl>
                        ${showCheckout ? '<div class="mt-4"><button type="button" data-team-pass-checkout class="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2">Buy Team Pass</button><p data-team-pass-checkout-feedback class="mt-2 text-xs text-red-700" aria-live="polite"></p></div>' : ''}
                        ${showStaffMetadata && status === 'missing' && !showCheckout ? '<div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">Checkout is not available yet. Configure this Team Pass later when entitlement setup is ready.</div>' : ''}
                        ${status === 'open' ? '<div class="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs font-semibold text-indigo-800">Global premium access is on. Existing entitlements stay saved for later enforcement.</div>' : ''}
                    </div>
                </div>
            </div>
        </section>
    `;
}

export function bindTeamPassCheckoutButton(container, { team = {}, deps = {} } = {}) {
    const button = container?.querySelector?.('[data-team-pass-checkout]');
    if (!button) return;

    const feedback = container.querySelector('[data-team-pass-checkout-feedback]');
    const originalLabel = button.textContent;
    let inFlight = false;

    button.addEventListener('click', async () => {
        if (inFlight) return;
        inFlight = true;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Starting checkout...';
        if (feedback) feedback.textContent = '';
        try {
            const redirect = deps.redirectToTeamPassCheckout || redirectToTeamPassCheckout;
            await redirect({ teamId: team.id, seasonId: resolveTeamPassSeasonId(team) });
        } catch (error) {
            inFlight = false;
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.textContent = originalLabel;
            if (feedback) {
                const message = error?.message || 'Unable to start Team Pass checkout.';
                feedback.textContent = `${message} Please try again.`;
            }
        }
    });
}

export async function renderTeamPassCard(container, { user, team, deps = {} } = {}) {
    if (!container) return;
    const access = getTeamPassAccess(user, team);
    container.innerHTML = buildTeamPassMarkup({ team, access, pass: { status: 'loading', label: 'Loading' } });
    const pass = await readTeamPassStatus({ team, access, deps });
    container.innerHTML = buildTeamPassMarkup({ team, access, pass });
    bindTeamPassCheckoutButton(container, { team, deps });
}
