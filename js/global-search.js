import { escapeHtml } from './utils.js?v=8';
import { getTeams } from './db.js?v=13';
import {
    db,
    collectionGroup,
    getDocs,
    query,
    where,
    orderBy,
    limit
} from './firebase.js?v=9';

let cachedTeams = null;
let cachedTeamsLoadedAt = 0;

let currentUser = null;
let keyHandlerInstalled = false;
let modalState = null;

function nowMs() {
    return Date.now();
}

function isTypingTarget(target) {
    if (!target) return false;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return false;
}

function normalizeQuery(q) {
    return (q || '').trim().toLowerCase();
}

function capitalizeFirst(s) {
    const str = (s || '').trim();
    if (!str) return '';
    return str[0].toUpperCase() + str.slice(1);
}

function titleCaseWord(s) {
    const str = (s || '').trim().toLowerCase();
    if (!str) return '';
    return str[0].toUpperCase() + str.slice(1);
}

function splitTokens(q) {
    const norm = normalizeQuery(q);
    if (!norm) return [];
    return norm.split(/\s+/g).filter(Boolean);
}

function scoreText(text, tokens) {
    const hay = (text || '').toLowerCase();
    if (!hay) return 0;

    let score = 0;
    for (const t of tokens) {
        const idx = hay.indexOf(t);
        if (idx === -1) return -1;
        score += idx === 0 ? 50 : 10;
        score += Math.max(0, 20 - idx);
    }
    return score;
}

function buildActions(user) {
    const actions = [
        { kind: 'action', title: 'Browse Teams', subtitle: 'Explore teams on ALL PLAYS', href: 'teams.html' }
    ];

    if (!user) {
        actions.push(
            { kind: 'action', title: 'Sign In', subtitle: 'Log in to your account', href: 'login.html' },
            { kind: 'action', title: 'Get Started', subtitle: 'Create an account', href: 'login.html#signup' }
        );
        return actions;
    }

    actions.push(
        { kind: 'action', title: 'Dashboard', subtitle: 'Go to your teams', href: 'dashboard.html' },
        { kind: 'action', title: 'Profile', subtitle: 'Account settings', href: 'profile.html' }
    );

    if (user.isAdmin) {
        actions.push({ kind: 'action', title: 'Admin Dashboard', subtitle: 'Platform admin tools', href: 'admin.html' });
    }

    return actions;
}

async function loadTeamsOnce() {
    const ttlMs = 10 * 60 * 1000;
    if (cachedTeams && (nowMs() - cachedTeamsLoadedAt) < ttlMs) return cachedTeams;

    const teams = await getTeams();
    cachedTeams = Array.isArray(teams) ? teams : [];
    cachedTeamsLoadedAt = nowMs();
    return cachedTeams;
}

function parseTeamAndPlayerIdFromPath(path) {
    // Expected: teams/{teamId}/players/{playerId}
    const parts = String(path || '').split('/');
    const tIdx = parts.indexOf('teams');
    const pIdx = parts.indexOf('players');
    if (tIdx === -1 || pIdx === -1) return { teamId: '', playerId: '' };
    return { teamId: parts[tIdx + 1] || '', playerId: parts[pIdx + 1] || '' };
}

function renderResultRow(item, isActive) {
    const activeCls = isActive ? 'bg-primary-50 border-primary-200' : 'bg-white border-gray-200 hover:bg-gray-50';
    const title = escapeHtml(item.title || '');
    const subtitle = escapeHtml(item.subtitle || '');

    return `
        <button
            type="button"
            class="w-full text-left px-4 py-3 rounded-lg border ${activeCls} transition"
            data-global-search-result="1"
            data-href="${escapeHtml(item.href || '')}"
        >
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="font-semibold text-gray-900 truncate">${title}</div>
                    ${subtitle ? `<div class="text-sm text-gray-500 truncate">${subtitle}</div>` : ''}
                </div>
                <div class="text-xs font-semibold text-gray-400 pt-1">${escapeHtml(item.kind || '')}</div>
            </div>
        </button>
    `;
}

function closeModal() {
    if (!modalState) return;
    modalState.root.remove();
    document.body.classList.remove('overflow-hidden');
    modalState = null;
}

function openModal({ initialQuery = '' } = {}) {
    if (modalState) return;

    const root = document.createElement('div');
    root.setAttribute('data-global-search-root', '1');
    root.className = 'fixed inset-0 z-[9999]';
    root.innerHTML = `
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" data-global-search-backdrop="1"></div>
        <div class="absolute inset-0 flex items-start justify-center p-4 md:p-8">
            <div class="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
                <div class="p-3 md:p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center border border-primary-200">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1010.5 18a7.5 7.5 0 006.15-3.35z"></path>
                            </svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <input
                                type="text"
                                class="w-full px-3 py-2.5 md:px-4 md:py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 text-[15px] md:text-base"
                                placeholder="Search teams or actions..."
                                autocomplete="off"
                                data-global-search-input="1"
                            />
                            <div class="hidden sm:block text-xs text-gray-500 mt-2">
                                Tip: Use <span class="font-semibold">↑</span>/<span class="font-semibold">↓</span> to navigate, <span class="font-semibold">Enter</span> to open, <span class="font-semibold">Esc</span> to close.
                            </div>
                        </div>
                        <button
                            type="button"
                            class="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition"
                            data-global-search-close="1"
                            aria-label="Close"
                            title="Close"
                        >
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="p-3 md:p-4 max-h-[70vh] overflow-y-auto">
                    <div class="space-y-3" data-global-search-sections="1">
                        <div class="text-sm text-gray-500">Loading teams...</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(root);
    document.body.classList.add('overflow-hidden');

    const input = root.querySelector('[data-global-search-input="1"]');
    const sections = root.querySelector('[data-global-search-sections="1"]');

    modalState = {
        root,
        input,
        sections,
        activeIndex: 0,
        flatResults: [],
        teams: [],
        loadingTeams: true,
        teamsError: ''
        ,
        players: [],
        loadingPlayers: false,
        playersError: '',
        lastPlayersQuery: '',
        playersReqId: 0,
        playersDebounce: null,
        teamsById: new Map()
    };

    const onBackdrop = (e) => {
        const target = e.target;
        if (target && target.matches('[data-global-search-backdrop="1"]')) closeModal();
    };
    root.addEventListener('mousedown', onBackdrop);

    const closeBtn = root.querySelector('[data-global-search-close="1"]');
    closeBtn.addEventListener('click', closeModal);

    const onKeyDown = (e) => {
        if (!modalState) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            modalState.activeIndex = Math.min(modalState.flatResults.length - 1, modalState.activeIndex + 1);
            renderResults();
            scrollActiveIntoView();
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            modalState.activeIndex = Math.max(0, modalState.activeIndex - 1);
            renderResults();
            scrollActiveIntoView();
            return;
        }

        if (e.key === 'Enter') {
            const item = modalState.flatResults[modalState.activeIndex];
            if (item && item.href) {
                e.preventDefault();
                window.location.href = item.href;
            }
        }
    };
    root.addEventListener('keydown', onKeyDown);

    const onClickResult = (e) => {
        const btn = e.target?.closest?.('[data-global-search-result="1"]');
        if (!btn) return;
        const href = btn.getAttribute('data-href');
        if (href) window.location.href = href;
    };
    root.addEventListener('click', onClickResult);

    const renderSection = (label, items, offset) => {
        if (!items.length) return '';
        const rows = items.map((item, idx) => renderResultRow(item, (offset + idx) === modalState.activeIndex)).join('');
        return `
            <div>
                <div class="text-xs uppercase tracking-wider font-bold text-gray-500 mb-2">${escapeHtml(label)}</div>
                <div class="space-y-2">
                    ${rows}
                </div>
            </div>
        `;
    };

    const scrollActiveIntoView = () => {
        const active = root.querySelectorAll('[data-global-search-result="1"]')[modalState.activeIndex];
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    };

    const computeResults = (q, teams, players) => {
        const tokens = splitTokens(q);
        const actions = buildActions(currentUser);

        const matchedActions = tokens.length === 0
            ? actions
            : actions
                .map(a => ({ item: a, score: scoreText(`${a.title} ${a.subtitle}`, tokens) }))
                .filter(x => x.score >= 0)
                .sort((a, b) => b.score - a.score)
                .map(x => x.item);

        const playerItems = (players || []);

        const teamItems = (teams || []).map(t => ({
            kind: 'team',
            title: t.name || 'Team',
            subtitle: [t.sport, t.zip].filter(Boolean).join(' • '),
            href: `team.html#teamId=${encodeURIComponent(t.id)}`
        }));

        const matchedTeams = tokens.length === 0
            ? teamItems.slice(0, 20)
            : teamItems
                .map(t => ({ item: t, score: scoreText(`${t.title} ${t.subtitle}`, tokens) }))
                .filter(x => x.score >= 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 20)
                .map(x => x.item);

        return { matchedActions, matchedPlayers: playerItems.slice(0, 20), matchedTeams };
    };

    const renderResults = () => {
        if (!modalState) return;

        const q = modalState.input.value || '';
        const teams = modalState.teams || [];
        const players = modalState.players || [];
        const { matchedActions, matchedPlayers, matchedTeams } = computeResults(q, teams, players);

        // Order: Actions, Teams, Players
        modalState.flatResults = [...matchedActions, ...matchedTeams, ...matchedPlayers];
        if (modalState.activeIndex >= modalState.flatResults.length) modalState.activeIndex = Math.max(0, modalState.flatResults.length - 1);

        const actionsHtml = renderSection('Actions', matchedActions, 0);
        const teamsOffset = matchedActions.length;
        const teamsRows = matchedTeams.map((item, idx) => renderResultRow(item, (teamsOffset + idx) === modalState.activeIndex)).join('');
        const teamsStatus = modalState.loadingTeams
            ? `<div class="text-sm text-gray-500 px-1 py-2">Loading teams...</div>`
            : modalState.teamsError
                ? `<div class="text-sm text-red-600 px-1 py-2">${escapeHtml(modalState.teamsError)}</div>`
                : (matchedTeams.length === 0 ? `<div class="text-sm text-gray-500 px-1 py-2">No matching teams</div>` : '');

        const teamsHtml = `
            <div>
                <div class="text-xs uppercase tracking-wider font-bold text-gray-500 mb-2">Teams</div>
                <div class="space-y-2">
                    ${teamsRows}
                </div>
                ${teamsStatus}
            </div>
        `;

        const playersOffset = matchedActions.length + matchedTeams.length;
        const playersRows = matchedPlayers.map((item, idx) => renderResultRow(item, (playersOffset + idx) === modalState.activeIndex)).join('');
        const playersStatus = modalState.loadingPlayers
            ? `<div class="text-sm text-gray-500 px-1 py-2">Searching players...</div>`
            : modalState.playersError
                ? `<div class="text-sm text-red-600 px-1 py-2">${escapeHtml(modalState.playersError)}</div>`
                : (q.trim().length < 2 ? `<div class="text-sm text-gray-500 px-1 py-2">Type at least 2 characters to search players</div>` : (matchedPlayers.length === 0 ? `<div class="text-sm text-gray-500 px-1 py-2">No matching players</div>` : ''));

        const playersHtml = `
            <div>
                <div class="text-xs uppercase tracking-wider font-bold text-gray-500 mb-2">Players</div>
                <div class="space-y-2">
                    ${playersRows}
                </div>
                ${playersStatus}
            </div>
        `;

        const emptyHtml = modalState.flatResults.length === 0 && !modalState.loadingTeams
            ? `<div class="text-sm text-gray-500 px-1 py-6 text-center">No results</div>`
            : '';

        modalState.sections.innerHTML = `
            <div class="space-y-5">
                ${actionsHtml}
                ${teamsHtml}
                ${playersHtml}
                ${emptyHtml}
            </div>
        `;
    };

    const runPlayerSearch = async (rawQuery) => {
        const q = (rawQuery || '').trim();
        if (!modalState) return;

        // Avoid blasting reads on single-character queries.
        if (q.length < 2) {
            modalState.players = [];
            modalState.loadingPlayers = false;
            modalState.playersError = '';
            modalState.lastPlayersQuery = q;
            renderResults();
            return;
        }

        const reqId = ++modalState.playersReqId;
        modalState.loadingPlayers = true;
        modalState.playersError = '';
        modalState.lastPlayersQuery = q;
        renderResults();

        const tokens = splitTokens(q);
        const searchTokens = Array.from(new Set(tokens.slice(0, 2)));
        const prefixes = Array.from(new Set(
            searchTokens.flatMap((t) => [t, t.toLowerCase(), titleCaseWord(t)])
        ).values()).filter(Boolean).slice(0, 6);
        const isNumeric = /^[0-9]+$/.test(q);

        try {
            const playersRef = collectionGroup(db, 'players');
            const queries = [];

            for (const prefix of prefixes) {
                queries.push(
                    getDocs(query(
                        playersRef,
                        orderBy('name'),
                        where('name', '>=', prefix),
                        where('name', '<=', `${prefix}\uf8ff`),
                        limit(20)
                    ))
                );
            }

            if (isNumeric) {
                queries.push(
                    getDocs(query(
                        playersRef,
                        orderBy('number'),
                        where('number', '>=', q),
                        where('number', '<=', `${q}\uf8ff`),
                        limit(20)
                    ))
                );
            }

            const snaps = await Promise.allSettled(queries);
            if (!modalState || reqId !== modalState.playersReqId) return;

            const rejected = snaps.filter(s => s.status === 'rejected').map(s => s.reason).filter(Boolean);
            const hasFulfilled = snaps.some(s => s.status === 'fulfilled');
            const anyPermDenied = rejected.some(e => (e?.code || '') === 'permission-denied');
            const anyFailedPre = rejected.some(e => (e?.code || '') === 'failed-precondition');
            const anyIndexBuilding = rejected.some(e => (e?.code || '') === 'failed-precondition' && String(e?.message || '').toLowerCase().includes('not ready yet'));

            const byPath = new Map();
            for (const s of snaps) {
                if (s.status !== 'fulfilled') continue;
                for (const d of s.value.docs || []) {
                    byPath.set(d.ref.path, d);
                }
            }

            if (!hasFulfilled && (anyPermDenied || anyFailedPre)) {
                modalState.players = [];
                modalState.loadingPlayers = false;
                modalState.playersError = anyPermDenied
                    ? 'Player search unavailable (permission denied). Update Firestore rules to allow collection-group reads for players.'
                    : (anyIndexBuilding
                        ? 'Player search index is building. Try again in a few minutes.'
                        : 'Player search unavailable (index required).');
                renderResults();
                return;
            }

            const items = Array.from(byPath.values()).map((d) => {
                const data = d.data() || {};
                const name = data.name || 'Player';
                const number = data.number || '';
                const { teamId, playerId } = parseTeamAndPlayerIdFromPath(d.ref.path);
                const teamName = modalState.teamsById.get(teamId)?.name || teamId || 'Team';

                return {
                    kind: 'player',
                    title: `${number ? `#${number} ` : ''}${name}`,
                    subtitle: teamName,
                    href: `player.html#teamId=${encodeURIComponent(teamId)}&playerId=${encodeURIComponent(playerId)}`
                };
            });

            // Basic ranking: starts-with match on name/number, then shorter strings first.
            const ranked = items
                .map((it) => ({ it, score: scoreText(it.title, tokens) }))
                .filter(x => x.score >= 0)
                .sort((a, b) => (b.score - a.score) || (a.it.title.length - b.it.title.length))
                .slice(0, 20)
                .map(x => x.it);

            modalState.players = ranked;
            modalState.loadingPlayers = false;
            modalState.playersError = '';
            renderResults();
        } catch (e) {
            console.error('[GlobalSearch] Player search failed:', e);
            if (!modalState || reqId !== modalState.playersReqId) return;
            modalState.players = [];
            modalState.loadingPlayers = false;
            modalState.playersError = e?.code === 'permission-denied'
                ? 'Player search unavailable (permission denied).'
                : 'Player search unavailable.';
            renderResults();
        }
    };

    const schedulePlayerSearch = () => {
        if (!modalState) return;
        if (modalState.playersDebounce) clearTimeout(modalState.playersDebounce);
        modalState.playersDebounce = setTimeout(() => {
            if (!modalState) return;
            runPlayerSearch(modalState.input.value || '');
        }, 180);
    };

    input.addEventListener('input', () => {
        modalState.activeIndex = 0;
        schedulePlayerSearch();
        renderResults();
    });

    input.value = initialQuery || '';
    input.focus();
    renderResults();

    // Load teams asynchronously, then render.
    (async () => {
        try {
            const teams = await loadTeamsOnce();
            if (!modalState) return;
            modalState.teams = teams;
            modalState.loadingTeams = false;
            modalState.teamsError = '';
            modalState.teamsById = new Map((teams || []).map(t => [t.id, t]));
            modalState.activeIndex = 0;
            renderResults();
        } catch (e) {
            console.error('[GlobalSearch] Failed to load teams:', e);
            if (!modalState) return;
            modalState.teams = [];
            modalState.loadingTeams = false;
            modalState.teamsError = 'Unable to load teams.';
            modalState.activeIndex = 0;
            renderResults();
        }
    })();
}

function installKeyHandler() {
    if (keyHandlerInstalled) return;
    keyHandlerInstalled = true;

    window.addEventListener('keydown', (e) => {
        const isModK = (e.key || '').toLowerCase() === 'k' && (e.metaKey || e.ctrlKey);
        if (!isModK) return;
        if (isTypingTarget(e.target)) return;

        e.preventDefault();
        openModal();
    });
}

function injectMobileMenuItem(menuContainer) {
    if (!menuContainer) return;
    if (menuContainer.querySelector('[data-global-search-open="1"]')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-global-search-open', '1');
    btn.setAttribute('aria-label', 'Search');
    btn.className = 'block w-full text-left text-base font-medium text-gray-700 hover:text-primary-700 transition';
    btn.innerHTML = `
        <span class="inline-flex items-center gap-2">
            <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1010.5 18a7.5 7.5 0 006.15-3.35z"></path>
            </svg>
            <span>Search</span>
        </span>
    `;
    btn.addEventListener('click', () => openModal());

    menuContainer.insertAdjacentElement('afterbegin', btn);
}

function injectMobileIconButton(headerContainer) {
    if (!headerContainer) return;
    if (headerContainer.querySelector('[data-global-search-icon="1"]')) return;

    const mobileBtn = headerContainer.querySelector('#mobile-menu-btn');
    if (!mobileBtn || !mobileBtn.parentElement) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-global-search-icon', '1');
    btn.setAttribute('aria-label', 'Search');
    btn.title = 'Search';
    btn.className = 'md:hidden p-2 text-gray-600 hover:text-primary-600 focus:outline-none';
    btn.innerHTML = `
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1010.5 18a7.5 7.5 0 006.15-3.35z"></path>
        </svg>
    `;
    btn.addEventListener('click', () => openModal());

    // Put the magnifier immediately to the left of the hamburger.
    mobileBtn.insertAdjacentElement('beforebegin', btn);
}

function injectCenteredSearchLauncher(headerContainer) {
    if (!headerContainer) return;
    if (headerContainer.querySelector('[data-global-search-launcher="1"]')) return;

    // In renderHeader(): the top row container is the first ".flex.items-center.justify-between".
    const topRow = headerContainer.querySelector('header nav > div.flex.items-center.justify-between');
    if (!topRow) return;

    const desktopActions = headerContainer.querySelector('#nav-auth-actions-desktop');
    if (!desktopActions) return;

    // Create a center "fake input" launcher.
    const wrap = document.createElement('div');
    wrap.className = 'hidden md:flex flex-1 px-4';
    wrap.setAttribute('data-global-search-launcher', '1');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Search');
    btn.title = 'Search (Ctrl+K / Cmd+K)';
    btn.className = [
        'w-full max-w-xl mx-auto',
        'inline-flex items-center justify-between gap-3',
        'px-4 py-2.5 rounded-xl border border-gray-200',
        'bg-white/70 hover:bg-white',
        'text-sm text-gray-600 hover:text-gray-900',
        'shadow-sm hover:shadow transition',
        'focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300'
    ].join(' ');
    btn.innerHTML = `
        <span class="inline-flex items-center gap-2 min-w-0">
            <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1010.5 18a7.5 7.5 0 006.15-3.35z"></path>
            </svg>
            <span class="truncate">Search teams, players, actions...</span>
        </span>
        <span class="hidden lg:inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-[11px] text-gray-500 bg-white">
            <span class="font-semibold">Ctrl</span><span>+</span><span class="font-semibold">K</span>
        </span>
    `;
    btn.addEventListener('click', () => openModal());

    wrap.appendChild(btn);

    // Insert before the right-side action links so it visually centers.
    desktopActions.insertAdjacentElement('beforebegin', wrap);
}

export function setupHeaderSearch({ user, headerContainer } = {}) {
    currentUser = user || null;
    installKeyHandler();

    injectCenteredSearchLauncher(headerContainer);
    injectMobileIconButton(headerContainer);
    injectMobileMenuItem(headerContainer?.querySelector('#nav-auth-actions-mobile'));
}

/**
 * Index-only for now: inject a search launcher into the rendered header and
 * bind Cmd/Ctrl+K to open the search modal.
 */
export function setupIndexSearch({ user } = {}) {
    setupHeaderSearch({
        user,
        headerContainer: document.getElementById('header-container')
    });
}
