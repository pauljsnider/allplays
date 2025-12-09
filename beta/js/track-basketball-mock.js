const demoRoster = [
    { id: 'p1', number: '1', name: 'Avery', position: 'PG' },
    { id: 'p2', number: '4', name: 'Sky', position: 'SG' },
    { id: 'p3', number: '7', name: 'Mia', position: 'SF' },
    { id: 'p4', number: '10', name: 'Charlie', position: 'PF' },
    { id: 'p5', number: '12', name: 'Jordan', position: 'C' },
    { id: 'p6', number: '15', name: 'Reese', position: 'G' },
    { id: 'p7', number: '20', name: 'Kai', position: 'F' },
    { id: 'p8', number: '23', name: 'Imani', position: 'F' }
];

const defaultStats = () => ({
    pts: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
    playingTimeMs: 0
});

let gameState = {
    phase: 'pregame',
    period: 'Q1',
    clockMs: 0,
    running: false,
    lastTick: null,
    homeScore: 0,
    awayScore: 0,
    players: demoRoster.map(p => ({ ...p, status: 'bench' })), // bench | starter | absent
    lineup: {
        starters: [],
        bench: [],
        absent: [],
        onCourt: []
    },
    stats: demoRoster.reduce((acc, p) => ({ ...acc, [p.id]: defaultStats() }), {}),
    substitutions: [],
    log: []
};

let tickHandle = null;
let pendingOut = null;
let pendingIn = null;
let undoStack = [];
let pendingQueue = [];

const els = {
    starterCount: document.getElementById('starter-count'),
    startersGrid: document.getElementById('starters-grid'),
    rosterGrid: document.getElementById('roster-grid'),
    startBtn: document.getElementById('start-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    finishBtn: document.getElementById('finish-btn'),
    clock: document.getElementById('clock'),
    periodLabel: document.getElementById('period-label'),
    gamePhase: document.getElementById('game-phase'),
    onCourtGrid: document.getElementById('on-court-grid'),
    benchGrid: document.getElementById('bench-grid'),
    benchPanel: document.getElementById('bench-panel'),
    toggleBench: document.getElementById('toggle-bench'),
    gameLog: document.getElementById('game-log'),
    fairPlay: document.getElementById('fair-play'),
    timeReport: document.getElementById('time-report'),
    subsHistory: document.getElementById('subs-history'),
    fairnessLabel: document.getElementById('fairness-label'),
    onCourtCount: document.getElementById('on-court-count'),
    homeScore: document.getElementById('home-score'),
    awayScore: document.getElementById('away-score'),
    subModal: document.getElementById('sub-modal'),
    subOutList: document.getElementById('sub-out-list'),
    subInList: document.getElementById('sub-in-list'),
    subHint: document.getElementById('sub-hint'),
    confirmSub: document.getElementById('confirm-sub'),
    selectedOut: document.getElementById('selected-out'),
    selectedIn: document.getElementById('selected-in'),
    swapLine: document.getElementById('swap-line'),
    subQueue: document.getElementById('sub-queue'),
    clearQueue: document.getElementById('clear-queue'),
    pregamePanel: document.getElementById('pregame-panel'),
    livePanel: document.getElementById('live-panel'),
    postPanel: document.getElementById('post-panel'),
    undoBtn: document.getElementById('undo-btn'),
    restartBtn: document.getElementById('restart-btn'),
    autoFill: document.getElementById('quick-fill'),
    clearLineup: document.getElementById('clear-lineup'),
    subBtn: document.getElementById('sub-btn'),
    autosavePill: document.getElementById('autosave-pill'),
    gameHealthCount: document.getElementById('on-court-count'),
    subClose: document.getElementById('close-sub'),
    subModalContainer: document.getElementById('sub-modal'),
    postFairness: document.getElementById('fairness-label'),
    quickReportBtn: document.getElementById('show-report'),
    clearDraft: document.getElementById('clear-draft'),
    addOpponent: document.getElementById('add-opponent'),
    oppNameInput: document.getElementById('opp-name'),
    opponentGrid: document.getElementById('opponent-grid'),
    reportModal: document.getElementById('report-modal'),
    closeReport: document.getElementById('close-report'),
    reportBody: document.getElementById('report-body'),
    reportFairness: document.getElementById('report-fairness'),
    finishModal: document.getElementById('finish-modal'),
    closeFinish: document.getElementById('close-finish'),
    finalHome: document.getElementById('final-home'),
    finalAway: document.getElementById('final-away'),
    finishPeriod: document.getElementById('finish-period'),
    finishClock: document.getElementById('finish-clock'),
    finishTimeReport: document.getElementById('finish-time-report'),
    finishSubs: document.getElementById('finish-subs'),
    coachNotes: document.getElementById('coach-notes'),
    mockAi: document.getElementById('mock-ai'),
    mockEmail: document.getElementById('mock-email'),
    mockSave: document.getElementById('mock-save')
};

function formatClock(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function setPhase(phase) {
    gameState.phase = phase;
    els.gamePhase.textContent = phase === 'pregame' ? 'Pre-game' : phase === 'live' ? 'Live' : 'Finished';
    els.pregamePanel.classList.toggle('hidden', phase !== 'pregame');
    els.livePanel.classList.toggle('hidden', phase !== 'live');
    els.postPanel.classList.toggle('hidden', phase !== 'finished');
}

function renderPregame() {
    const starters = gameState.players.filter(p => p.status === 'starter');
    const bench = gameState.players.filter(p => p.status === 'bench');
    const absent = gameState.players.filter(p => p.status === 'absent');

    els.starterCount.textContent = starters.length;

    els.startersGrid.innerHTML = starters.length
        ? starters.map(cardMarkup).join('')
        : '<div class="col-span-2 text-court-300 text-sm">Pick five to start. Bench and absent stay hidden until you need them.</div>';

    els.rosterGrid.innerHTML = [...bench, ...absent].map(cardMarkup).join('');

    els.startBtn.disabled = gameState.phase === 'pregame' && starters.length !== 5;
}

function cardMarkup(player) {
    const palette = {
        starter: 'bg-white text-court-900 border-2 border-court-500',
        bench: 'bg-court-50 text-court-900 border border-court-100',
        absent: 'bg-court-900 text-white border border-court-800 opacity-70'
    };
    const badge = player.status === 'starter' ? 'Starter' : player.status === 'bench' ? 'Bench' : 'Absent';
    return `
        <div class="p-3 rounded-xl ${palette[player.status]} flex items-center justify-between">
            <div>
                <p class="text-xs uppercase tracking-[0.18em] font-semibold opacity-70">${badge}</p>
                <p class="text-lg font-display font-bold">${player.number} • ${player.name}</p>
                <p class="text-xs opacity-70">${player.position}</p>
            </div>
            <div class="flex flex-col gap-1 text-xs">
                <button data-id="${player.id}" data-action="starter" class="px-3 py-1 rounded-lg bg-court-900 text-white font-semibold hover:bg-court-700">Starter</button>
                <button data-id="${player.id}" data-action="bench" class="px-3 py-1 rounded-lg bg-court-100 text-court-900 font-semibold hover:bg-court-200">Bench</button>
                <button data-id="${player.id}" data-action="absent" class="px-3 py-1 rounded-lg bg-accent text-court-900 font-semibold hover:brightness-95">Absent</button>
            </div>
        </div>
    `;
}

function updatePlayerStatus(id, status) {
    const starters = gameState.players.filter(p => p.status === 'starter');
    if (status === 'starter' && starters.length >= 5 && !gameState.players.find(p => p.id === id && p.status === 'starter')) {
        return;
    }
    gameState.players = gameState.players.map(p => p.id === id ? { ...p, status } : p);
    renderPregame();
}

function phaseIsLive() {
    return gameState.phase !== 'pregame';
}

function hydrateLineup() {
    const starters = gameState.players.filter(p => p.status === 'starter');
    const bench = gameState.players.filter(p => p.status === 'bench');
    const absent = gameState.players.filter(p => p.status === 'absent');
    gameState.lineup = {
        starters: starters.map(p => p.id),
        bench: bench.map(p => p.id),
        absent: absent.map(p => p.id),
        onCourt: starters.map(p => p.id)
    };
    els.onCourtCount.textContent = `${gameState.lineup.onCourt.length} / 5`;
    els.swapLine.disabled = gameState.lineup.bench.length < gameState.lineup.onCourt.length;
}

function startClock() {
    if (gameState.running) return;
    gameState.running = true;
    gameState.lastTick = performance.now();
    els.pauseBtn.disabled = false;
    els.finishBtn.disabled = false;
    tickHandle = setInterval(syncClock, 500);
}

function pauseClock() {
    if (!gameState.running) return;
    syncClock();
    gameState.running = false;
    clearInterval(tickHandle);
    els.pauseBtn.disabled = true;
}

function syncClock() {
    if (!gameState.running) return;
    const now = performance.now();
    const delta = now - gameState.lastTick;
    gameState.clockMs += delta;
    gameState.lastTick = now;
    gameState.lineup.onCourt.forEach(id => {
        gameState.stats[id].playingTimeMs += delta;
    });
    renderClock();
    renderOnCourt();
}

function renderClock() {
    els.clock.textContent = formatClock(gameState.clockMs);
}

function renderOnCourt() {
    const cards = gameState.lineup.onCourt.map(pid => playerLiveCard(pid)).join('');
    els.onCourtGrid.innerHTML = cards || '<div class="text-court-500 text-sm">No one on court. Add starters to begin.</div>';
    renderBench();
    renderLog();
    renderFairness();
}

function playerLiveCard(playerId) {
    const player = gameState.players.find(p => p.id === playerId);
    const stats = gameState.stats[playerId] || defaultStats();
    const time = formatClock(stats.playingTimeMs);
    return `
        <div class="p-3 rounded-xl border border-court-100 bg-white shadow-sm">
            <div class="flex items-center justify-between mb-2">
                <div>
                    <p class="text-xs uppercase tracking-[0.18em] text-court-600 font-semibold">${player.position}</p>
                    <p class="text-lg font-display font-bold text-court-900">#${player.number} ${player.name}</p>
                </div>
                <div class="text-right">
                    <p class="text-xs text-court-500">Playing time</p>
                    <p class="text-lg font-display font-bold text-court-900">🕐 ${time}</p>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-2 text-center text-sm">
                ${statChip('PTS', stats.pts)}
                ${statChip('REB', stats.reb)}
                ${statChip('AST', stats.ast)}
                ${statChip('STL', stats.stl)}
                ${statChip('BLK', stats.blk)}
                ${statChip('TOV', stats.tov)}
            </div>
            <div class="grid grid-cols-3 gap-2 mt-3">
                ${statButton(playerId, 'pts', '+2 PTS', 2, 'bg-court-900 text-white')}
                ${statButton(playerId, 'pts', '+3 PTS', 3, 'bg-court-100 text-court-900')}
                ${statButton(playerId, 'pts', '+1 FT', 1, 'bg-white border border-court-200 text-court-900')}
                ${statButton(playerId, 'reb', '+REB', 1)}
                ${statButton(playerId, 'ast', '+AST', 1)}
                ${statButton(playerId, 'stl', '+STL', 1)}
                ${statButton(playerId, 'blk', '+BLK', 1)}
                ${statButton(playerId, 'tov', '+TOV', 1)}
                ${statButton(playerId, 'pf', '+FOUL', 1, 'bg-accent text-court-900')}
            </div>
        </div>
    `;
}

function statChip(label, value) {
    return `<div class="bg-court-50 rounded-lg py-2 font-semibold text-court-900">${label}<div class="text-xl font-display">${value}</div></div>`;
}

function statButton(pid, key, label, delta, classes = 'bg-court-900 text-white') {
    return `<button class="stat-btn px-3 py-2 rounded-lg ${classes} font-semibold text-sm" data-player="${pid}" data-stat="${key}" data-delta="${delta}">${label}</button>`;
}

function renderBench() {
    els.benchGrid.innerHTML = gameState.lineup.bench.map(pid => {
        const p = gameState.players.find(pl => pl.id === pid);
        return `
            <button class="px-3 py-2 rounded-lg bg-court-50 border border-court-100 text-left hover:bg-court-100 transition" data-bench="${pid}">
                <p class="text-sm font-semibold text-court-900">#${p.number} ${p.name}</p>
                <p class="text-xs text-court-600">Ready to sub in</p>
            </button>
        `;
    }).join('') || '<div class="text-court-500 text-sm">Bench is empty.</div>';
}

function addEvent(entry) {
    gameState.log.unshift(entry);
    if (gameState.log.length > 80) gameState.log.pop();
    renderLog();
}

function renderLog() {
    if (!gameState.log.length) {
        els.gameLog.innerHTML = '<div class="text-court-500 text-center py-8 bg-court-50 rounded-lg">Actions will appear here</div>';
        return;
    }
    els.gameLog.innerHTML = gameState.log.map((ev, idx) => `
        <div class="p-2 rounded-lg border border-court-100 bg-white flex justify-between items-center">
            <div>
                <p class="font-semibold text-court-900">${ev.text}</p>
                <p class="text-xs text-court-500">${ev.period} • ${ev.clock}</p>
            </div>
            <div class="flex items-center gap-2">
                <button class="text-xs px-2 py-1 rounded bg-court-900 text-white" data-remove-log="${idx}">Remove</button>
                <span class="text-xs text-court-500">${new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        </div>
    `).join('');

    els.gameLog.querySelectorAll('button[data-remove-log]').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = Number(btn.dataset.removeLog);
            if (Number.isNaN(index)) return;
            gameState.log.splice(index, 1);
            renderLog();
        });
    });
}

function addStat(playerId, key, delta) {
    if (gameState.phase === 'pregame') return;
    syncClock();
    const prev = gameState.stats[playerId][key];
    gameState.stats[playerId][key] += delta;
    if (key === 'pts') {
        gameState.homeScore += delta;
    }
    const entry = {
        type: 'stat',
        playerId,
        key,
        delta,
        prev,
        period: gameState.period,
        clock: formatClock(gameState.clockMs),
        ts: Date.now(),
        text: `${getName(playerId)} +${delta} ${key.toUpperCase()}`
    };
    addEvent(entry);
    undoStack.push(entry);
    renderScores();
    renderOnCourt();
}

function renderScores() {
    els.homeScore.textContent = gameState.homeScore;
    els.awayScore.textContent = gameState.awayScore;
    if (els.finalHome && els.finalAway) {
        els.finalHome.value = gameState.homeScore;
        els.finalAway.value = gameState.awayScore;
    }
}

function getName(id) {
    return gameState.players.find(p => p.id === id)?.name || 'Player';
}

function openSubModal() {
    pendingOut = null;
    pendingIn = null;
    els.subHint.textContent = 'Select a player to come out.';
    els.confirmSub.disabled = true;
    els.selectedOut.textContent = 'Out: none';
    els.selectedIn.textContent = 'In: none';
    pendingQueue = [];
    renderQueue();
    els.subOutList.innerHTML = gameState.lineup.onCourt.map(pid => subOption(pid, 'out')).join('');
    els.subInList.innerHTML = gameState.lineup.bench.map(pid => subOption(pid, 'in')).join('') || '<div class="text-court-500 text-sm">Bench empty</div>';
    els.subModal.classList.remove('hidden');
    els.subModal.classList.add('flex');
}

function closeSubModal() {
    els.subModal.classList.add('hidden');
    els.subModal.classList.remove('flex');
}

function subOption(pid, side) {
    const player = gameState.players.find(p => p.id === pid);
    return `
        <button class="px-3 py-2 rounded-lg border border-court-100 text-left hover:bg-court-50 transition" data-sub-${side}="${pid}">
            <p class="text-sm font-semibold text-court-900">#${player.number} ${player.name}</p>
            <p class="text-xs text-court-600">${player.position}</p>
        </button>
    `;
}

function handleSubSelection(pid, side) {
    if (side === 'out') {
        pendingOut = pid;
        els.subHint.textContent = 'Now tap who is coming in.';
        els.selectedOut.textContent = `Out: #${getNumber(pid)} ${getName(pid)}`;
    } else {
        pendingIn = pid;
        els.selectedIn.textContent = `In: #${getNumber(pid)} ${getName(pid)}`;
    }
    if (pendingOut && pendingIn) {
        pendingQueue.push({ out: pendingOut, in: pendingIn });
        pendingOut = null;
        pendingIn = null;
        els.selectedOut.textContent = 'Out: none';
        els.selectedIn.textContent = 'In: none';
        renderQueue();
    }
    els.confirmSub.disabled = pendingQueue.length === 0;
}

function executeSubstitution() {
    if (!pendingQueue.length && !(pendingOut && pendingIn)) return;
    if (pendingOut && pendingIn) {
        pendingQueue.push({ out: pendingOut, in: pendingIn });
    }
    const applied = [];
    const undoEntries = [];
    syncClock();
    pendingQueue.forEach(pair => {
        const previousOnCourt = [...gameState.lineup.onCourt];
        const previousBench = [...gameState.lineup.bench];
        const idx = gameState.lineup.onCourt.indexOf(pair.out);
        if (idx === -1) return;
        const benchHas = gameState.lineup.bench.includes(pair.in);
        if (!benchHas) return;
        gameState.lineup.onCourt[idx] = pair.in;
        gameState.lineup.bench = gameState.lineup.bench.filter(id => id !== pair.in);
        gameState.lineup.bench.push(pair.out);
        const subEvent = {
            out: pair.out,
            in: pair.in,
            period: gameState.period,
            clock: formatClock(gameState.clockMs),
            ts: Date.now()
        };
        gameState.substitutions.push(subEvent);
        addEvent({
            ...subEvent,
            type: 'sub',
            text: `Sub: ${getName(pair.out)} → ${getName(pair.in)}`
        });
        undoEntries.push({
            type: 'sub',
            previousOnCourt,
            previousBench,
            subEvent
        });
        applied.push(pair);
    });
    undoStack.push(...undoEntries);
    pendingQueue = [];
    pendingOut = null;
    pendingIn = null;
    renderQueue();
    closeSubModal();
    renderOnCourt();
}

function swapFullLine() {
    syncClock();
    const benchCount = gameState.lineup.bench.length;
    const startersCount = gameState.lineup.onCourt.length;
    if (benchCount < startersCount || startersCount === 0) return;

    const previousOnCourt = [...gameState.lineup.onCourt];
    const previousBench = [...gameState.lineup.bench];

    const newOnCourt = gameState.lineup.bench.slice(0, startersCount);
    const newBench = [...previousOnCourt, ...gameState.lineup.bench.slice(startersCount)];

    gameState.lineup.onCourt = newOnCourt;
    gameState.lineup.bench = newBench;

    gameState.substitutions.push({
        out: 'line',
        in: 'line',
        period: gameState.period,
        clock: formatClock(gameState.clockMs),
        ts: Date.now()
    });

    addEvent({
        type: 'sub',
        out: 'line',
        in: 'line',
        period: gameState.period,
        clock: formatClock(gameState.clockMs),
        ts: Date.now(),
        text: 'Full line change (bench ↔ on-court)'
    });

    undoStack.push({
        type: 'line',
        previousOnCourt,
        previousBench
    });

    renderOnCourt();
    els.swapLine.disabled = gameState.lineup.bench.length < gameState.lineup.onCourt.length;
}

function renderFairness() {
    const playingTimes = gameState.players
        .filter(p => gameState.stats[p.id].playingTimeMs > 0)
        .map(p => gameState.stats[p.id].playingTimeMs);
    if (!playingTimes.length || gameState.clockMs === 0) {
        els.fairPlay.textContent = 'Needs data';
        els.fairPlay.className = 'px-2 py-1 pill bg-court-100 text-court-900 text-xs font-semibold';
        return;
    }
    const max = Math.max(...playingTimes);
    const min = Math.min(...playingTimes);
    const spread = max ? Math.round(((max - min) / max) * 100) : 0;
    const balanced = spread <= 35;
    els.fairPlay.textContent = balanced ? 'Balanced rotation' : 'Spread wide';
    els.fairPlay.className = `px-2 py-1 pill text-xs font-semibold ${balanced ? 'bg-court-100 text-court-900' : 'bg-accent text-court-900'}`;
}

function finishGame() {
    pauseClock();
    if (els.finalHome && els.finalAway) {
        const h = parseInt(els.finalHome.value, 10);
        const a = parseInt(els.finalAway.value, 10);
        if (!Number.isNaN(h)) gameState.homeScore = h;
        if (!Number.isNaN(a)) gameState.awayScore = a;
        renderScores();
    }
    setPhase('finished');
    renderReport();
}

function renderReport() {
    const totals = gameState.players.map(p => ({
        ...p,
        time: gameState.stats[p.id].playingTimeMs
    })).sort((a, b) => b.time - a.time);

    const max = totals[0]?.time || 0;
    const min = totals[totals.length - 1]?.time || 0;
    const balanced = max ? ((max - min) / max) <= 0.35 : true;
    els.fairnessLabel.textContent = balanced ? 'Balanced minutes' : 'Uneven minutes';
    els.fairnessLabel.className = `px-2 py-1 pill text-xs font-semibold ${balanced ? 'bg-court-100 text-court-900' : 'bg-accent text-court-900'}`;

    els.timeReport.innerHTML = totals.map(t => `
        <div class="flex items-center justify-between p-2 rounded-lg border border-court-100 bg-white">
            <div>
                <p class="font-semibold text-court-900">#${t.number} ${t.name}</p>
                <p class="text-xs text-court-500">${t.position}</p>
            </div>
            <div class="text-right">
                <p class="font-display font-bold text-lg text-court-900">${formatClock(t.time)}</p>
                <p class="text-xs text-court-500">${Math.round((t.time / (gameState.clockMs || 1)) * 100)}% of game</p>
            </div>
        </div>
    `).join('') || '<div class="text-court-500 text-sm">No minutes recorded.</div>';

    els.subsHistory.innerHTML = gameState.substitutions.length
        ? gameState.substitutions.map(s => `
            <div class="p-2 rounded-lg border border-court-100 bg-white flex justify-between">
                <div>
                    <p class="font-semibold text-court-900">${getName(s.out)} → ${getName(s.in)}</p>
                    <p class="text-xs text-court-500">${s.period} • ${s.clock}</p>
                </div>
                <span class="text-xs text-court-500">${new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        `).join('')
        : '<div class="text-court-500 text-sm">No substitutions recorded.</div>';
}

function restartDemo() {
    clearInterval(tickHandle);
    undoStack = [];
    gameState = {
        phase: 'pregame',
        period: 'Q1',
        clockMs: 0,
        running: false,
        lastTick: null,
        homeScore: 0,
        awayScore: 0,
        players: demoRoster.map(p => ({ ...p, status: 'bench' })),
        lineup: { starters: [], bench: [], absent: [], onCourt: [] },
        stats: demoRoster.reduce((acc, p) => ({ ...acc, [p.id]: defaultStats() }), {}),
        substitutions: [],
        log: []
    };
    renderPregame();
    renderScores();
    renderClock();
    setPhase('pregame');
    setActivePeriod('Q1');
    els.startBtn.textContent = 'Start Game';
    els.pauseBtn.disabled = true;
    els.finishBtn.disabled = true;
    els.gameLog.innerHTML = '<div class="text-court-500 text-center py-8 bg-court-50 rounded-lg">Actions will appear here</div>';
    pendingQueue = [];
}

function setupEventListeners() {
    els.rosterGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        updatePlayerStatus(btn.dataset.id, btn.dataset.action);
    });

    els.startersGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        updatePlayerStatus(btn.dataset.id, btn.dataset.action);
    });

    els.startBtn.addEventListener('click', () => {
        if (gameState.phase === 'pregame') {
            hydrateLineup();
            setPhase('live');
            els.startBtn.textContent = 'Resume';
            startClock();
            renderOnCourt();
        } else {
            startClock();
        }
    });

    els.pauseBtn.addEventListener('click', pauseClock);
    els.finishBtn.addEventListener('click', showFinishModal);
    els.restartBtn.addEventListener('click', restartDemo);
    els.autoFill.addEventListener('click', () => {
        gameState.players = gameState.players.map((p, idx) => ({ ...p, status: idx < 5 ? 'starter' : 'bench' }));
        renderPregame();
    });
    els.clearLineup.addEventListener('click', () => {
        gameState.players = gameState.players.map(p => ({ ...p, status: 'bench' }));
        renderPregame();
    });

    els.toggleBench.addEventListener('click', () => {
        const hidden = els.benchPanel.classList.toggle('hidden');
        els.toggleBench.textContent = hidden ? 'Show Bench' : 'Hide Bench';
    });

    els.onCourtGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-stat]');
        if (!btn) return;
        addStat(btn.dataset.player, btn.dataset.stat, Number(btn.dataset.delta));
    });

    els.undoBtn.addEventListener('click', () => {
        const last = undoStack.pop();
        if (!last) return;
        if (last.type === 'stat') {
            gameState.stats[last.playerId][last.key] = last.prev;
            if (last.key === 'pts') gameState.homeScore -= last.delta;
            gameState.log.shift();
            renderScores();
            renderOnCourt();
        } else if (last.type === 'sub') {
            gameState.lineup.onCourt = last.previousOnCourt;
            gameState.lineup.bench = last.previousBench;
            gameState.substitutions.pop();
            gameState.log.shift();
            renderOnCourt();
        } else if (last.type === 'line') {
            gameState.lineup.onCourt = last.previousOnCourt;
            gameState.lineup.bench = last.previousBench;
            gameState.substitutions.pop();
            gameState.log.shift();
            renderOnCourt();
        }
    });

    els.subBtn.addEventListener('click', openSubModal);
    els.subClose.addEventListener('click', closeSubModal);
    els.subModalContainer.addEventListener('click', (e) => {
        if (e.target === els.subModalContainer) closeSubModal();
    });

    els.subOutList.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-sub-out]');
        if (!btn) return;
        handleSubSelection(btn.dataset.subOut, 'out');
    });
    els.subInList.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-sub-in]');
        if (!btn) return;
        handleSubSelection(btn.dataset.subIn, 'in');
    });
    els.confirmSub.addEventListener('click', executeSubstitution);
    els.swapLine.addEventListener('click', swapFullLine);
    els.clearQueue.addEventListener('click', () => {
        pendingQueue = [];
        renderQueue();
    });

    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setActivePeriod(btn.dataset.period);
        });
    });

    els.quickReportBtn.addEventListener('click', () => {
        renderLiveReport();
        els.reportModal.classList.remove('hidden');
        els.reportModal.classList.add('flex');
    });
    els.closeReport.addEventListener('click', () => {
        els.reportModal.classList.add('hidden');
        els.reportModal.classList.remove('flex');
    });
    els.clearDraft.addEventListener('click', restartDemo);

    els.closeFinish.addEventListener('click', () => {
        els.finishModal.classList.add('hidden');
        els.finishModal.classList.remove('flex');
    });
    els.mockAi.addEventListener('click', () => {
        addEvent({ text: 'Mock AI summary generated', ts: Date.now(), period: gameState.period, clock: formatClock(gameState.clockMs) });
        alert('Mock AI summary would appear here.');
    });
    els.mockEmail.addEventListener('click', () => alert('Mock email sent to parents/coaches.'));
    els.mockSave.addEventListener('click', () => {
        finishGame();
        els.finishModal.classList.add('hidden');
        els.finishModal.classList.remove('flex');
    });

    els.addOpponent.addEventListener('click', addOpponentFromInput);
    // opponent add stays inline
}

function init() {
    renderPregame();
    renderScores();
    renderClock();
    setPhase('pregame');
    setActivePeriod('Q1');
    setupEventListeners();
    initOpponents();
    renderOpponents();
}

function setActivePeriod(period) {
    gameState.period = period;
    els.periodLabel.textContent = period;
    document.querySelectorAll('.period-btn').forEach(b => {
        b.classList.remove('bg-court-100', 'text-court-900');
        b.classList.add('bg-white', 'text-court-700');
        if (b.dataset.period === period) {
            b.classList.add('bg-court-100', 'text-court-900');
            b.classList.remove('bg-white', 'text-court-700');
        }
    });
}

function renderLiveReport() {
    const totals = gameState.players.map(p => ({
        ...p,
        time: gameState.stats[p.id].playingTimeMs
    })).sort((a, b) => b.time - a.time);
    const max = totals[0]?.time || 0;
    const min = totals[totals.length - 1]?.time || 0;
    const balanced = max ? ((max - min) / max) <= 0.35 : false;
    els.reportFairness.textContent = balanced ? 'Balanced' : 'Spread wide';
    els.reportFairness.className = `px-2 py-1 pill text-xs font-semibold ${balanced ? 'bg-court-100 text-court-900' : 'bg-accent text-court-900'}`;
    els.reportBody.innerHTML = totals.map(t => `
        <div class="p-2 rounded-lg border border-court-100 bg-white flex items-center justify-between">
            <div>
                <p class="font-semibold text-court-900">#${t.number} ${t.name}</p>
                <p class="text-xs text-court-500">${t.position}</p>
            </div>
            <div class="text-right">
                <p class="font-display font-bold text-lg text-court-900">${formatClock(t.time)}</p>
                <p class="text-xs text-court-500">${gameState.clockMs ? Math.round((t.time / gameState.clockMs) * 100) : 0}%</p>
            </div>
        </div>
    `).join('') || '<div class="text-court-500 text-sm">No minutes yet.</div>';
}

function showFinishModal() {
    pauseClock();
    if (els.finalHome && els.finalAway) {
        els.finalHome.value = gameState.homeScore;
        els.finalAway.value = gameState.awayScore;
    }
    els.finishPeriod.textContent = gameState.period;
    els.finishClock.textContent = formatClock(gameState.clockMs);
    renderReport();
    els.finishModal.classList.remove('hidden');
    els.finishModal.classList.add('flex');
    els.finishTimeReport.innerHTML = els.timeReport.innerHTML;
    els.finishSubs.innerHTML = els.subsHistory.innerHTML;
}

function getNumber(id) {
    return gameState.players.find(p => p.id === id)?.number || '';
}

function renderQueue() {
    if (!pendingQueue.length) {
        els.subQueue.innerHTML = '<span class="text-court-500">Pick pairs to build a batch, then confirm.</span>';
        els.confirmSub.disabled = true;
        return;
    }
    els.confirmSub.disabled = false;
    els.subQueue.innerHTML = pendingQueue.map((p, idx) => {
        return `<span class="px-2 py-1 rounded bg-court-900 text-white font-semibold">#${getNumber(p.out)} → #${getNumber(p.in)} (${idx + 1})</span>`;
    }).join(' ');
}

// Opponent tracking (simple, no subs)
let opponentRoster = [];
const opponentStats = {};

function initOpponents() {
    opponentRoster = [
        { id: 'opp-10', name: '#10' },
        { id: 'opp-11', name: '#11' },
        { id: 'opp-12', name: '#12' }
    ];
    opponentRoster.forEach(p => opponentStats[p.id] = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 });
}

function addOpponentFromInput() {
    const value = (els.oppNameInput?.value || '').trim();
    addOpponent(value);
    if (els.oppNameInput) els.oppNameInput.value = '';
}

function addOpponent(label) {
    if (!label) return;
    const id = `opp-${Date.now()}`;
    opponentRoster.push({ id, name: label });
    opponentStats[id] = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 };
    renderOpponents();
}

function addOppStat(id, key, delta) {
    const stat = opponentStats[id];
    if (!stat) return;
    stat[key] += delta;
    if (key === 'pts') {
        gameState.awayScore += delta;
        renderScores();
    }
    addEvent({
        type: 'opp-stat',
        playerId: id,
        key,
        delta,
        period: gameState.period,
        clock: formatClock(gameState.clockMs),
        ts: Date.now(),
        text: `Opp: ${opponentRoster.find(o => o.id === id)?.name || 'Player'} +${delta} ${key.toUpperCase()}`
    });
    renderOpponents();
}

function renderOpponents() {
    if (!els.opponentGrid) return;
    if (!opponentRoster.length) {
        els.opponentGrid.innerHTML = '<div class="text-court-500 text-sm">Add opponent players to track their scoring.</div>';
        return;
    }
    els.opponentGrid.innerHTML = opponentRoster.map((p, idx) => {
        const s = opponentStats[p.id] || { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 };
        const editable = idx < 3;
        const nameBlock = editable
            ? `<label class="text-xs text-court-500 block mb-1">Opponent ${idx + 1}</label><input data-opp-edit="${p.id}" value="${p.name}" class="w-full px-2 py-1 rounded border border-court-200 text-sm font-semibold text-court-900">`
            : `<p class="text-sm font-semibold text-court-900">${p.name}</p><p class="text-xs text-court-500">Opponent</p>`;
        return `
            <div class="p-3 rounded-lg border border-court-100 bg-white space-y-2">
                <div class="flex items-center justify-between">
                    <div class="w-full mr-2">${nameBlock}</div>
                    <div class="text-lg font-display font-bold text-court-900">${s.pts} pts</div>
                </div>
                <div class="grid grid-cols-3 gap-2 text-xs">
                    <span class="px-2 py-1 bg-court-50 rounded">REB ${s.reb}</span>
                    <span class="px-2 py-1 bg-court-50 rounded">AST ${s.ast}</span>
                    <span class="px-2 py-1 bg-court-50 rounded">STL ${s.stl}</span>
                    <span class="px-2 py-1 bg-court-50 rounded">BLK ${s.blk}</span>
                </div>
                <div class="grid grid-cols-3 gap-2 text-xs font-semibold">
                    <button class="px-2 py-1 rounded bg-red-600 text-white" data-opp="${p.id}" data-stat="pts" data-delta="2">+2</button>
                    <button class="px-2 py-1 rounded bg-red-500 text-white" data-opp="${p.id}" data-stat="pts" data-delta="3">+3</button>
                    <button class="px-2 py-1 rounded bg-red-400 text-white" data-opp="${p.id}" data-stat="pts" data-delta="1">+1</button>
                    <button class="px-2 py-1 rounded bg-white border border-court-200" data-opp="${p.id}" data-stat="reb" data-delta="1">+REB</button>
                    <button class="px-2 py-1 rounded bg-white border border-court-200" data-opp="${p.id}" data-stat="ast" data-delta="1">+AST</button>
                    <button class="px-2 py-1 rounded bg-white border border-court-200" data-opp="${p.id}" data-stat="stl" data-delta="1">+STL</button>
                    <button class="px-2 py-1 rounded bg-white border border-court-200" data-opp="${p.id}" data-stat="blk" data-delta="1">+BLK</button>
                </div>
            </div>
        `;
    }).join('');

    els.opponentGrid.querySelectorAll('button[data-opp]').forEach(btn => {
        btn.addEventListener('click', () => {
            addOppStat(btn.dataset.opp, btn.dataset.stat, Number(btn.dataset.delta));
        });
    });
    els.opponentGrid.querySelectorAll('input[data-opp-edit]').forEach(input => {
        input.addEventListener('change', () => {
            const oppId = input.dataset.oppEdit;
            const val = input.value.trim();
            const target = opponentRoster.find(o => o.id === oppId);
            if (target && val) {
                target.name = val;
                renderOpponents();
            }
        });
    });
}

init();
