/**
 * Parent Incentives & Rewards
 *
 * Allows parents to set cash incentives for their child's game performance.
 * Examples: $1 per point, >3 rebounds = $2 bonus, turnover = -$2 penalty.
 *
 * Data is private to the parent (stored in /users/{userId}/incentiveRules and
 * /users/{userId}/incentivePaidGames). Players and coaches cannot see these.
 */

import {
    db,
    collection,
    getDocs,
    getDoc,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    setDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
} from './firebase.js';

// Normalizes a stat column name (e.g. 'PTS', 'POINTS') to Firestore key (e.g. 'pts').
// Matches the map used in live-game.js for consistency.
const STAT_KEY_MAP = {
    'PTS': 'pts', 'POINTS': 'pts',
    'REB': 'reb', 'REBOUNDS': 'reb',
    'AST': 'ast', 'ASSISTS': 'ast',
    'STL': 'stl', 'STEALS': 'stl',
    'BLK': 'blk', 'BLOCKS': 'blk',
    'TO': 'to', 'TOV': 'to', 'TURNOVERS': 'to',
    'FOULS': 'fouls', 'FLS': 'fouls',
};

export function normalizeStatKey(columnName) {
    if (!columnName) return columnName;
    const upper = String(columnName).toUpperCase();
    return STAT_KEY_MAP[upper] || upper.toLowerCase();
}

/**
 * Returns display label for a stat key (e.g. 'pts' → 'PTS').
 */
export function statKeyLabel(key) {
    const labels = {
        pts: 'PTS', reb: 'REB', ast: 'AST',
        stl: 'STL', blk: 'BLK', to: 'TO', fouls: 'FOULS',
    };
    return labels[key] || key.toUpperCase();
}

/**
 * Fetch the stat options (key + label) available for a team based on their
 * statTrackerConfigs. Falls back to basketball defaults if no configs exist.
 */
export async function getStatOptionsForTeam(teamId) {
    try {
        const snap = await getDocs(
            query(collection(db, `teams/${teamId}/statTrackerConfigs`), orderBy('name'))
        );
        const configs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Collect all unique columns across all configs
        const seen = new Set();
        const options = [];

        for (const config of configs) {
            const columns = Array.isArray(config.columns) ? config.columns : [];
            for (const col of columns) {
                const key = normalizeStatKey(col);
                if (!seen.has(key)) {
                    seen.add(key);
                    options.push({ key, label: statKeyLabel(key) });
                }
            }
            // Basketball always tracks fouls even if not in columns
            if (config.baseType === 'Basketball' && !seen.has('fouls')) {
                seen.add('fouls');
                options.push({ key: 'fouls', label: 'FOULS' });
            }
        }

        // Fallback: if no configs found, use common basketball stats
        if (options.length === 0) {
            return [
                { key: 'pts', label: 'PTS' },
                { key: 'reb', label: 'REB' },
                { key: 'ast', label: 'AST' },
                { key: 'stl', label: 'STL' },
                { key: 'blk', label: 'BLK' },
                { key: 'to', label: 'TO' },
                { key: 'fouls', label: 'FOULS' },
            ];
        }

        return options;
    } catch (e) {
        console.warn('getStatOptionsForTeam: failed to fetch configs, using defaults', e);
        return [
            { key: 'pts', label: 'PTS' },
            { key: 'reb', label: 'REB' },
            { key: 'ast', label: 'AST' },
            { key: 'stl', label: 'STL' },
            { key: 'blk', label: 'BLK' },
            { key: 'to', label: 'TO' },
            { key: 'fouls', label: 'FOULS' },
        ];
    }
}

// ─── Firestore CRUD ──────────────────────────────────────────────────────────

/**
 * Fetch all incentive rules for a specific player (for a parent).
 * Returns array of rule objects with id fields.
 */
export async function getIncentiveRules(userId, playerId) {
    const snap = await getDocs(
        query(
            collection(db, `users/${userId}/incentiveRules`),
            where('playerId', '==', playerId),
            orderBy('createdAt', 'asc')
        )
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Save (create or update) an incentive rule.
 * ruleData should include: { teamId, playerId, playerName, statKey, type, amountCents,
 *                            threshold (null|number), thresholdOp (null|'gt'|'gte'), active }
 * Returns the ruleId.
 */
export async function saveIncentiveRule(userId, ruleData) {
    const now = serverTimestamp();
    if (ruleData.id) {
        // Update existing
        const { id, ...data } = ruleData;
        await updateDoc(doc(db, `users/${userId}/incentiveRules`, id), {
            ...data,
            updatedAt: now,
        });
        return id;
    } else {
        // Create new
        const docRef = await addDoc(collection(db, `users/${userId}/incentiveRules`), {
            ...ruleData,
            active: ruleData.active !== false,  // default active
            createdAt: now,
            updatedAt: now,
        });
        return docRef.id;
    }
}

/**
 * Toggle a rule's active state.
 */
export async function toggleIncentiveRule(userId, ruleId, active) {
    await updateDoc(doc(db, `users/${userId}/incentiveRules`, ruleId), {
        active,
        updatedAt: serverTimestamp(),
    });
}

/**
 * Delete an incentive rule permanently.
 */
export async function deleteIncentiveRule(userId, ruleId) {
    await deleteDoc(doc(db, `users/${userId}/incentiveRules`, ruleId));
}

// ─── Cap Settings ────────────────────────────────────────────────────────────

/**
 * Get the global per-game earnings cap for a player (in cents).
 * Returns null if no cap is set.
 */
export async function getCapSetting(userId, playerId) {
    const snap = await getDoc(doc(db, `users/${userId}/incentiveRules`, `_cap_${playerId}`));
    if (!snap.exists()) return null;
    const data = snap.data();
    return typeof data.maxPerGameCents === 'number' ? data.maxPerGameCents : null;
}

/**
 * Save the global per-game earnings cap for a player.
 * Pass null to remove the cap.
 */
export async function saveCapSetting(userId, playerId, maxPerGameCents) {
    const docRef = doc(db, `users/${userId}/incentiveRules`, `_cap_${playerId}`);
    if (maxPerGameCents === null) {
        await deleteDoc(docRef);
    } else {
        await setDoc(docRef, { maxPerGameCents, updatedAt: serverTimestamp() });
    }
}

// ─── Payment Tracking ────────────────────────────────────────────────────────

/**
 * Mark a game as paid for a player.
 * docId is `${gameId}__${playerId}` for uniqueness.
 */
export async function markGamePaid(userId, gameId, playerId, teamId, amountCents) {
    const recordId = `${gameId}__${playerId}`;
    await setDoc(doc(db, `users/${userId}/incentivePaidGames`, recordId), {
        gameId,
        playerId,
        teamId,
        amountCents,
        paidAt: serverTimestamp(),
    });
}

/**
 * Unmark a game as paid (if parent made a mistake).
 */
export async function unmarkGamePaid(userId, gameId, playerId) {
    const recordId = `${gameId}__${playerId}`;
    await deleteDoc(doc(db, `users/${userId}/incentivePaidGames`, recordId));
}

/**
 * Get all paid game records for a player.
 * Returns a Map: gameId → { amountCents, paidAt }
 */
export async function getPaidGames(userId, playerId) {
    const snap = await getDocs(
        query(
            collection(db, `users/${userId}/incentivePaidGames`),
            where('playerId', '==', playerId)
        )
    );
    const map = new Map();
    snap.docs.forEach(d => {
        const data = d.data();
        map.set(data.gameId, { amountCents: data.amountCents, paidAt: data.paidAt });
    });
    return map;
}

// ─── Earnings Calculation ────────────────────────────────────────────────────

/**
 * Calculate earnings for a single game given the player's stats and active rules.
 *
 * @param {Array} activeRules - Rules with active === true
 * @param {Object} stats - { pts: 12, reb: 5, to: 2, ... } from aggregatedStats
 * @returns {{ totalCents: number, breakdown: Array }}
 */
export function calculateEarnings(activeRules, stats, maxPerGameCents = null) {
    let totalCents = 0;
    const breakdown = [];

    for (const rule of activeRules) {
        if (!rule.active) continue;
        const statValue = typeof stats[rule.statKey] === 'number' ? stats[rule.statKey] : 0;
        let earned = 0;

        if (rule.type === 'per_unit') {
            earned = statValue * rule.amountCents;
        } else if (rule.type === 'threshold') {
            const met = rule.thresholdOp === 'gte'
                ? statValue >= rule.threshold
                : statValue > rule.threshold;
            earned = met ? rule.amountCents : 0;
        }

        breakdown.push({ rule, statValue, earned });
        totalCents += earned;
    }

    const uncappedTotalCents = totalCents;
    // Cap only applies to positive earnings (not penalties)
    if (maxPerGameCents !== null && totalCents > maxPerGameCents) {
        totalCents = maxPerGameCents;
    }

    return { totalCents, uncappedTotalCents, wasCapped: totalCents !== uncappedTotalCents, breakdown };
}

/**
 * Format cents as a dollar string (e.g. 150 → '+$1.50', -200 → '-$2.00').
 */
export function formatCents(cents, { sign = true } = {}) {
    const abs = Math.abs(cents);
    const dollars = (abs / 100).toFixed(2);
    if (!sign) return `$${dollars}`;
    return cents >= 0 ? `+$${dollars}` : `-$${dollars}`;
}

/**
 * Format a rule as a human-readable description.
 * e.g. 'per_unit PTS $1.00/pt' or 'threshold REB >3 = +$2.00'
 */
export function formatRuleLabel(rule) {
    const label = statKeyLabel(rule.statKey);
    const amt = formatCents(rule.amountCents, { sign: true });
    if (rule.type === 'per_unit') {
        const perLabel = rule.amountCents >= 0 ? amt : amt;
        return `${label}: ${perLabel} per ${label.toLowerCase()}`;
    } else {
        const op = rule.thresholdOp === 'gte' ? '≥' : '>';
        return `${label} ${op} ${rule.threshold} → ${amt}`;
    }
}

/**
 * Format a breakdown line for display in the earnings panel.
 * e.g. '12 PTS × $1.00 = +$12.00'
 */
export function formatBreakdownLine({ rule, statValue, earned }) {
    const label = statKeyLabel(rule.statKey);
    const earnedStr = formatCents(earned, { sign: true });
    if (rule.type === 'per_unit') {
        const rate = formatCents(rule.amountCents, { sign: false });
        return `${statValue} ${label} × ${rate} = ${earnedStr}`;
    } else {
        const op = rule.thresholdOp === 'gte' ? '≥' : '>';
        const met = rule.thresholdOp === 'gte'
            ? statValue >= rule.threshold
            : statValue > rule.threshold;
        const check = met ? '✓' : '✗';
        return `${label} ${op} ${rule.threshold}: ${statValue} ${check} → ${earnedStr}`;
    }
}

// ─── UI Rendering ─────────────────────────────────────────────────────────────

/**
 * Render the full incentives panel content (to be injected into the slide-out).
 * @param {Object} opts
 * @param {Object} opts.player - { id, name, number, teamId }
 * @param {Array} opts.rules - all rules (active + inactive)
 * @param {Map} opts.paidGames - gameId → { amountCents, paidAt }
 * @param {Array} opts.recentGameStats - [{ game: {...}, stats: {...}|null }]
 * @param {Array} opts.statOptions - [{ key, label }]
 * @param {string} opts.userId
 */
export function renderIncentivesPanel({ player, rules, paidGames, recentGameStats, statOptions, userId, maxPerGameCents = null }) {
    const activeRules = rules.filter(r => r.active);

    // Calculate season totals
    let totalEarnedCents = 0;
    let totalPaidCents = 0;
    const gameEarnings = [];

    for (const { game, stats } of recentGameStats) {
        if (!stats) continue;
        const { totalCents, uncappedTotalCents, wasCapped, breakdown } = calculateEarnings(activeRules, stats, maxPerGameCents);
        const paid = paidGames.get(game.id);
        totalEarnedCents += totalCents;
        if (paid) totalPaidCents += paid.amountCents;
        gameEarnings.push({ game, stats, totalCents, uncappedTotalCents, wasCapped, breakdown, paid: !!paid });
    }

    const unpaidCents = totalEarnedCents - totalPaidCents;

    return `
        <div class="space-y-6">
            <!-- Season Balance -->
            <div class="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
                <p class="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Season Balance</p>
                <div class="flex gap-6">
                    <div>
                        <p class="text-2xl font-bold text-green-800">${formatCents(totalEarnedCents, { sign: false })}</p>
                        <p class="text-xs text-green-600">total earned</p>
                    </div>
                    ${unpaidCents !== 0 ? `
                    <div class="border-l border-green-200 pl-6">
                        <p class="text-2xl font-bold ${unpaidCents > 0 ? 'text-orange-600' : 'text-gray-500'}">${formatCents(unpaidCents, { sign: false })}</p>
                        <p class="text-xs ${unpaidCents > 0 ? 'text-orange-500' : 'text-gray-400'}">unpaid</p>
                    </div>` : ''}
                </div>
            </div>

            <!-- Rules -->
            <div>
                <div class="flex items-center justify-between mb-3">
                    <p class="text-sm font-bold text-gray-900">My Rules</p>
                    <button onclick="window.openIncentiveRuleBuilder('${player.teamId}', '${player.id}')"
                        class="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 bg-primary-50 px-3 py-1.5 rounded-lg hover:bg-primary-100 transition border border-primary-200">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/>
                        </svg>
                        Add Rule
                    </button>
                </div>
                ${rules.length === 0 ? renderEmptyRules() : renderRuleList(rules, userId)}
                <!-- Global per-game cap -->
                <div class="mt-4 pt-3 border-t border-gray-100">
                    <p class="text-xs font-semibold text-gray-600 mb-1.5">Max earned per game (cap)</p>
                    <div class="flex items-center gap-2">
                        <span class="text-gray-500 font-semibold text-sm">$</span>
                        <input type="number" id="incentive-cap-input" step="1" min="0" inputmode="decimal"
                            placeholder="No cap"
                            value="${maxPerGameCents !== null ? (maxPerGameCents / 100).toFixed(0) : ''}"
                            class="w-24 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400">
                        <button onclick="window.saveIncentiveCap('${userId}', '${player.id}')"
                            class="text-xs font-semibold text-primary-600 bg-primary-50 px-3 py-1.5 rounded-lg hover:bg-primary-100 transition border border-primary-200">
                            Save
                        </button>
                        ${maxPerGameCents !== null ? `<button onclick="window.removeIncentiveCap('${userId}', '${player.id}')" class="text-xs text-gray-400 hover:text-red-400 transition">Remove</button>` : ''}
                    </div>
                    ${maxPerGameCents !== null ? `<p class="text-xs text-gray-400 mt-1">Earnings capped at $${(maxPerGameCents / 100).toFixed(0)} per game</p>` : ''}
                </div>
            </div>

            <!-- Rule Builder placeholder (inserted dynamically) -->
            <div id="incentive-rule-builder" class="hidden"></div>

            <!-- Recent Game Earnings -->
            ${gameEarnings.length > 0 ? `
            <div>
                <p class="text-sm font-bold text-gray-900 mb-3">Game Earnings</p>
                <div class="space-y-3">
                    ${gameEarnings.map(g => renderGameEarningsCard(g, userId, player.id, player.teamId)).join('')}
                </div>
            </div>` : (activeRules.length > 0 ? `
            <div class="text-center py-6 text-gray-400">
                <p class="text-sm">No completed games yet.</p>
                <p class="text-xs mt-1">Earnings will appear here after games are tracked.</p>
            </div>` : '')}
        </div>
    `;
}

function renderEmptyRules() {
    return `
        <div class="text-center py-8 text-gray-400 border border-dashed border-gray-200 rounded-xl">
            <div class="text-3xl mb-2">💰</div>
            <p class="text-sm font-medium text-gray-500">No rules yet</p>
            <p class="text-xs mt-1 text-gray-400">Add your first incentive rule above</p>
        </div>
    `;
}

function renderRuleList(rules, userId) {
    return `
        <div class="space-y-2">
            ${rules.map(rule => `
                <div class="flex items-center justify-between gap-3 p-3 rounded-xl border ${rule.active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'}">
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-semibold ${rule.active ? (rule.amountCents < 0 ? 'text-red-600' : 'text-gray-900') : 'text-gray-400'} truncate">
                            ${formatRuleLabel(rule)}
                        </p>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <!-- Toggle -->
                        <button onclick="window.toggleIncentiveRule('${userId}', '${rule.id}', ${!rule.active})"
                            class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${rule.active ? 'bg-primary-600' : 'bg-gray-200'}"
                            title="${rule.active ? 'Disable rule' : 'Enable rule'}">
                            <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${rule.active ? 'translate-x-4.5' : 'translate-x-0.5'}"></span>
                        </button>
                        <!-- Delete -->
                        <button onclick="window.deleteIncentiveRule('${userId}', '${rule.id}')"
                            class="text-gray-300 hover:text-red-400 transition p-1"
                            title="Delete rule">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderGameEarningsCard({ game, totalCents, uncappedTotalCents, wasCapped, breakdown, paid }, userId, playerId, teamId) {
    const gameDate = game.date && game.date.toDate ? game.date.toDate() : (game.date ? new Date(game.date) : null);
    const dateStr = gameDate ? gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const opponent = game.opponent || game.title || 'Game';
    const totalStr = formatCents(totalCents, { sign: false });
    const isPositive = totalCents >= 0;

    return `
        <div class="border border-gray-200 rounded-xl overflow-hidden">
            <div class="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
                <div>
                    <p class="text-sm font-semibold text-gray-900">${escapeHtml(opponent)}</p>
                    <p class="text-xs text-gray-500">${dateStr}${wasCapped ? ` · <span class="text-amber-600 font-medium">capped at ${formatCents(totalCents, { sign: false })} (would have been ${formatCents(uncappedTotalCents, { sign: false })})</span>` : ''}</p>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-base font-bold ${isPositive ? 'text-green-700' : 'text-red-600'}">${isPositive ? '+' : ''}${totalStr}</span>
                    ${paid
                        ? `<span class="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                               <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                               Paid
                           </span>`
                        : `<button onclick="window.markGamePaid('${userId}', '${game.id}', '${playerId}', '${teamId}', ${totalCents})"
                               class="text-xs font-semibold text-white bg-green-600 px-3 py-1 rounded-full hover:bg-green-700 transition">
                               Mark Paid
                           </button>`
                    }
                </div>
            </div>
            <div class="px-4 py-2.5 space-y-1">
                ${breakdown.map(line => `
                    <p class="text-xs ${line.earned < 0 ? 'text-red-500' : line.earned > 0 ? 'text-gray-700' : 'text-gray-400'}">${formatBreakdownLine(line)}</p>
                `).join('')}
                ${breakdown.length === 0 ? '<p class="text-xs text-gray-400 italic">No earnings this game</p>' : ''}
            </div>
        </div>
    `;
}

/**
 * Render the inline rule builder form.
 * @param {Array} statOptions - [{ key, label }]
 * @param {string} teamId
 * @param {string} playerId
 */
export function renderRuleBuilder(statOptions, teamId, playerId) {
    return `
        <div class="border border-primary-200 rounded-xl p-4 bg-primary-50 space-y-4">
            <p class="text-sm font-bold text-primary-800">New Rule</p>

            <!-- Stat selector -->
            <div>
                <p class="text-xs font-semibold text-gray-600 mb-2">Stat</p>
                <div id="incentive-stat-pills" class="flex flex-wrap gap-2">
                    ${statOptions.map(opt => `
                        <button type="button"
                            onclick="selectIncentiveStat('${opt.key}')"
                            data-stat="${opt.key}"
                            class="stat-pill px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-primary-400 hover:text-primary-700 transition">
                            ${escapeHtml(opt.label)}
                        </button>
                    `).join('')}
                </div>
                <input type="hidden" id="incentive-stat-key" value="">
            </div>

            <!-- Rule type toggle -->
            <div>
                <p class="text-xs font-semibold text-gray-600 mb-2">Type</p>
                <div class="flex rounded-lg border border-gray-200 overflow-hidden w-fit">
                    <button type="button" id="type-per-unit" onclick="selectIncentiveType('per_unit')"
                        class="px-3 py-1.5 text-xs font-semibold bg-primary-600 text-white transition">Per unit</button>
                    <button type="button" id="type-threshold" onclick="selectIncentiveType('threshold')"
                        class="px-3 py-1.5 text-xs font-semibold bg-white text-gray-600 hover:bg-gray-50 transition">Goal bonus</button>
                </div>
                <input type="hidden" id="incentive-type" value="per_unit">
            </div>

            <!-- Per-unit amount -->
            <div id="field-per-unit">
                <p class="text-xs font-semibold text-gray-600 mb-1">Amount per stat</p>
                <div class="flex items-center gap-2">
                    <span class="text-gray-500 font-semibold">$</span>
                    <input type="number" id="incentive-amount" step="0.25" min="-100" max="100" placeholder="1.00"
                        class="w-24 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400">
                    <span class="text-xs text-gray-400">(negative = penalty)</span>
                </div>
            </div>

            <!-- Threshold fields -->
            <div id="field-threshold" class="hidden space-y-3">
                <div>
                    <p class="text-xs font-semibold text-gray-600 mb-1">Condition</p>
                    <div class="flex items-center gap-2">
                        <select id="incentive-threshold-op"
                            class="px-2 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400">
                            <option value="gt">&gt; (greater than)</option>
                            <option value="gte">≥ (at least)</option>
                        </select>
                        <input type="number" id="incentive-threshold" step="1" min="0" placeholder="3"
                            class="w-20 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400">
                        <span id="incentive-threshold-stat-label" class="text-xs text-gray-500 font-medium"></span>
                    </div>
                </div>
                <div>
                    <p class="text-xs font-semibold text-gray-600 mb-1">Bonus amount</p>
                    <div class="flex items-center gap-2">
                        <span class="text-gray-500 font-semibold">$</span>
                        <input type="number" id="incentive-bonus-amount" step="0.25" min="-100" max="100" placeholder="2.00"
                            class="w-24 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400">
                    </div>
                </div>
            </div>

            <!-- Live preview -->
            <div id="incentive-preview" class="hidden text-xs text-primary-700 font-medium bg-white border border-primary-200 rounded-lg px-3 py-2"></div>

            <!-- Actions -->
            <div class="flex gap-2 pt-1">
                <button type="button" onclick="window.saveIncentiveRuleFromBuilder('${teamId}', '${playerId}')"
                    class="flex-1 bg-primary-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-primary-700 transition">
                    Save Rule
                </button>
                <button type="button" onclick="window.closeIncentiveRuleBuilder()"
                    class="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition">
                    Cancel
                </button>
            </div>
        </div>
    `;
}

/** Tiny HTML escaper reused from utils.js concept (avoids import cycle). */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
