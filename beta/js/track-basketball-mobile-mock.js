// Mobile-first mock, reusing the in-memory approach but slimming the UI for thumb reach.

const roster = [
  { id: 'p1', num: '1', name: 'Avery', pos: 'G' },
  { id: 'p2', num: '4', name: 'Sky', pos: 'G' },
  { id: 'p3', num: '7', name: 'Mia', pos: 'F' },
  { id: 'p4', num: '10', name: 'Charlie', pos: 'F' },
  { id: 'p5', num: '12', name: 'Jordan', pos: 'C' },
  { id: 'p6', num: '15', name: 'Reese', pos: 'G' },
  { id: 'p7', num: '20', name: 'Kai', pos: 'F' },
  { id: 'p8', num: '23', name: 'Imani', pos: 'F' },
  { id: 'p9', num: '30', name: 'Tess', pos: 'F' },
  { id: 'p10', num: '33', name: 'Rowan', pos: 'G' }
];

const statDefaults = () => ({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, time: 0 });

let state = {
  period: 'Q1',
  clock: 0,
  running: false,
  lastTick: null,
  home: 0,
  away: 0,
  starters: [],
  bench: roster.map(r => r.id),
  onCourt: [],
  stats: roster.reduce((a, r) => ({ ...a, [r.id]: statDefaults() }), {}),
  log: [],
  subs: [],
  opp: [
    { id: 'o1', name: '#10', stats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 } },
    { id: 'o2', name: '#11', stats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 } },
    { id: 'o3', name: '#12', stats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 } }
  ],
  pendingOut: null,
  pendingIn: null,
  subQueue: []
};

const els = {
  scoreLine: q('#score-line'),
  periodChip: q('#period-chip'),
  clock: q('#clock-mobile'),
  fairness: q('#fairness-mobile'),
  onCourtCount: q('#on-court-count-mobile'),
  startStop: q('#start-stop'),
  undoMini: q('#undo-mini'),
  preTab: q('#pre-game-tab'),
  liveTab: q('#live-tab'),
  oppTab: q('#opponents-tab'),
  finTab: q('#finish-tab'),
  panelLineup: q('#panel-lineup'),
  panelLive: q('#panel-live'),
  panelOpp: q('#panel-opponents'),
  panelFin: q('#panel-finish'),
  starterHelper: q('#starter-helper'),
  lineupStarters: q('#lineup-starters'),
  lineupBench: q('#lineup-bench'),
  livePlayers: q('#live-players'),
  benchToggle: q('#toggle-bench-mobile'),
  benchGrid: q('#bench-mobile'),
  autoFill: q('#auto-fill-mobile'),
  subOpen: q('#sub-open'),
  fullLineSwap: q('#full-line-swap'),
  subModal: q('#sub-modal-mobile'),
  subClose: q('#close-sub-mobile'),
  subOut: q('#sub-out-mobile'),
  subIn: q('#sub-in-mobile'),
  subHint: q('#sub-hint-mobile'),
  subConfirm: q('#confirm-sub-mobile'),
  queueList: q('#queue-list-mobile'),
  queueClear: q('#clear-queue-mobile'),
  oppInput: q('#opp-input-mobile'),
  oppAdd: q('#opp-add-mobile'),
  oppCards: q('#opp-cards-mobile'),
  homeFinal: q('#home-final'),
  awayFinal: q('#away-final'),
  notesFinal: q('#notes-final'),
  finishSave: q('#finish-save'),
  finishAI: q('#finish-ai'),
  finishEmail: q('#finish-email'),
  finishReport: q('#finish-report-mobile'),
  log: q('#log-mobile'),
  clearLog: q('#clear-log-mobile'),
  clearLineup: q('#clear-lineup-mobile')
};

function q(sel) { return document.querySelector(sel); }

function setTab(tab) {
  els.panelLineup.classList.toggle('hidden', tab !== 'lineup');
  els.panelLive.classList.toggle('hidden', tab !== 'live');
  els.panelOpp.classList.toggle('hidden', tab !== 'opp');
  els.panelFin.classList.toggle('hidden', tab !== 'finish');
}

function renderHeader() {
  els.scoreLine.textContent = `${state.home} — ${state.away}`;
  els.periodChip.textContent = `${state.period} · ${formatClock(state.clock)}`;
  els.clock.textContent = formatClock(state.clock);
}

function renderLineup() {
  els.onCourtCount.textContent = `${state.onCourt.length}/5`;
  els.lineupStarters.innerHTML = state.onCourt.map(id => playerChip(id, true)).join('');
  const bench = state.bench.map(id => playerChip(id, false)).join('');
  els.lineupBench.innerHTML = bench || '<div class="col-span-5 text-[10px] text-slate-500">No bench set</div>';
}

function playerChip(id, active) {
  const p = roster.find(r => r.id === id);
  const cls = active ? 'bg-teal text-ink' : 'bg-white';
  return `<button class="pill px-2 py-2 border border-slate/10 ${cls}" data-player="${id}" data-active="${active}">#${p.num}</button>`;
}

function renderLive() {
  const hasStarters = state.onCourt.length > 0;
  if (els.starterHelper) {
    els.starterHelper.classList.toggle('hidden', hasStarters);
  }
  els.livePlayers.innerHTML = state.onCourt.map(id => liveCard(id)).join('') || '<div class="col-span-2 text-xs text-slate-500 text-center py-4">Add starters to begin</div>';
  renderBench(!hasStarters);
}

function liveCard(id) {
  const p = roster.find(r => r.id === id);
  const s = state.stats[id];
  return `
    <div class="border border-slate/10 rounded-xl p-2 bg-white space-y-1">
      <div class="flex justify-between items-center">
        <div class="text-xs font-semibold">#${p.num} ${p.name}</div>
        <div class="text-[10px] text-slate-500">${formatClock(s.time)}</div>
      </div>
      <div class="grid grid-cols-3 gap-1 text-[10px] text-center">
        ${statPill('PTS', s.pts)}${statPill('REB', s.reb)}${statPill('AST', s.ast)}
      </div>
      <div class="grid grid-cols-3 gap-1 text-[10px] text-center">
        ${statPill('STL', s.stl)}${statPill('BLK', s.blk)}${statPill('TOV', s.tov)}
      </div>
      <div class="grid grid-cols-3 gap-1 text-[11px] font-semibold">
        ${statBtn(id, 'pts', 2, '+2')} ${statBtn(id, 'pts', 3, '+3')} ${statBtn(id, 'pts', 1, '+1')}
        ${statBtn(id, 'reb', 1, 'REB')} ${statBtn(id, 'ast', 1, 'AST')} ${statBtn(id, 'stl', 1, 'STL')}
        ${statBtn(id, 'blk', 1, 'BLK')} ${statBtn(id, 'tov', 1, 'TOV')} ${statBtn(id, 'pf', 1, 'FOUL')}
      </div>
    </div>`;
}

function statPill(label, val) {
  return `<div class="bg-sand rounded-lg py-1">${label} <span class="font-display text-sm">${val}</span></div>`;
}

function statBtn(id, key, delta, label) {
  return `<button class="stat-btn bg-slate text-white rounded-lg py-1" data-stat="${key}" data-delta="${delta}" data-player="${id}">${label}</button>`;
}

function renderBench(forceShow = false) {
  els.benchGrid.innerHTML = state.bench.map(id => {
    const p = roster.find(r => r.id === id);
    return `<button class="text-xs px-2 py-2 border border-slate/10 rounded-lg bg-white" data-bench="${id}">#${p.num} ${p.name}</button>`;
  }).join('') || '<div class="col-span-2 text-xs text-slate-500 text-center py-2">No bench</div>';
  if (forceShow) {
    els.benchGrid.classList.remove('hidden');
    els.benchToggle.textContent = 'Hide bench';
  }
}

function renderOpponents() {
  els.oppCards.innerHTML = state.opp.map((o, idx) => {
    const s = o.stats;
    return `
      <div class="border border-slate/10 rounded-xl p-2 bg-white space-y-1">
        <input data-opp-edit="${o.id}" value="${o.name}" class="w-full text-xs px-2 py-1 rounded border border-slate/10 font-semibold">
        <div class="text-[11px] text-slate-500">PTS ${s.pts} · REB ${s.reb}</div>
        <div class="grid grid-cols-3 gap-1 text-[11px] font-semibold">
          ${oppBtn(o.id, 'pts', 2, '+2')} ${oppBtn(o.id, 'pts', 3, '+3')} ${oppBtn(o.id, 'pts', 1, '+1')}
          ${oppBtn(o.id, 'reb', 1, 'REB')} ${oppBtn(o.id, 'ast', 1, 'AST')} ${oppBtn(o.id, 'stl', 1, 'STL')}
          ${oppBtn(o.id, 'blk', 1, 'BLK')} <span></span> <button data-opp-del="${o.id}" class="text-[11px] text-red-600">Remove</button>
        </div>
      </div>
    `;
  }).join('') || '<div class="text-xs text-slate-500 text-center py-4">Add opponent players</div>';

  els.oppCards.querySelectorAll('[data-opp-edit]').forEach(inp => {
    inp.addEventListener('change', () => {
      const target = state.opp.find(o => o.id === inp.dataset.oppEdit);
      if (target) target.name = inp.value.trim() || target.name;
    });
  });
  els.oppCards.querySelectorAll('[data-opp-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.opp = state.opp.filter(o => o.id !== btn.dataset.oppDel);
      renderOpponents();
    });
  });
  els.oppCards.querySelectorAll('[data-opp-stat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { opp, stat, delta } = btn.dataset;
      addOppStat(opp, stat, Number(delta));
    });
  });
}

function oppBtn(id, key, delta, label) {
  return `<button class="stat-btn bg-red-600 text-white rounded-lg py-1" data-opp="${id}" data-opp-stat data-stat="${key}" data-delta="${delta}">${label}</button>`;
}

function renderFairness() {
  const times = state.onCourt.map(id => state.stats[id].time);
  if (!times.length || !state.clock) {
    els.fairness.textContent = 'Needs data';
    els.fairness.className = 'pill px-2 py-1 bg-white/10 text-white font-semibold text-xs';
    return;
  }
  const max = Math.max(...times);
  const min = Math.min(...times);
  const spread = max ? (max - min) / max : 0;
  const balanced = spread <= 0.35;
  els.fairness.textContent = balanced ? 'Balanced' : 'Spread wide';
  els.fairness.className = `pill px-2 py-1 font-semibold text-xs ${balanced ? 'bg-white text-ink' : 'bg-accent text-ink'}`;
}

function renderLog() {
  els.log.innerHTML = state.log.slice(0, 40).map(ev => `
    <div class="flex justify-between items-center border border-slate/10 rounded-lg p-2 bg-white">
      <div>
        <p class="text-xs font-semibold">${ev.text}</p>
        <p class="text-[10px] text-slate-500">${ev.period} · ${ev.clock}</p>
      </div>
      <span class="text-[10px] text-slate-400">${new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  `).join('') || '<div class="text-xs text-slate-500 text-center py-4">No events yet</div>';
}

function addLog(text) {
  state.log.unshift({ text, ts: Date.now(), period: state.period, clock: formatClock(state.clock) });
  renderLog();
}

function formatClock(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function startStop() {
  if (state.running) {
    state.running = false;
    els.startStop.textContent = 'Start';
    clearInterval(state.tick);
  } else {
    state.running = true;
    els.startStop.textContent = 'Pause';
    state.lastTick = performance.now();
    state.tick = setInterval(tick, 500);
  }
}

function tick() {
  if (!state.running) return;
  const now = performance.now();
  const delta = now - state.lastTick;
  state.lastTick = now;
  state.clock += delta;
  state.onCourt.forEach(id => state.stats[id].time += delta);
  renderHeader();
  renderLive();
  renderFairness();
}

function setPeriod(p) {
  state.period = p;
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.toggle('bg-teal', b.dataset.period === p);
    b.classList.toggle('text-ink', b.dataset.period === p);
  });
  renderHeader();
}

function addStat(id, key, delta) {
  state.stats[id][key] += delta;
  if (key === 'pts') state.home += delta;
  addLog(`#${getNum(id)} ${key.toUpperCase()} +${delta}`);
  renderHeader();
  renderLive();
}

function addOppStat(id, key, delta) {
  const opp = state.opp.find(o => o.id === id);
  if (!opp) return;
  opp.stats[key] += delta;
  if (key === 'pts') state.away += delta;
  addLog(`Opp ${opp.name} ${key.toUpperCase()} +${delta}`);
  renderHeader();
  renderOpponents();
}

function getNum(id) {
  return roster.find(r => r.id === id)?.num || '';
}

function attachEvents() {
  els.preTab.addEventListener('click', () => setTab('lineup'));
  els.liveTab.addEventListener('click', () => setTab('live'));
  els.oppTab.addEventListener('click', () => setTab('opp'));
  els.finTab.addEventListener('click', () => setTab('finish'));
  els.startStop.addEventListener('click', startStop);
  els.undoMini.addEventListener('click', () => {
    state.log.shift();
    renderLog();
  });
  els.lineupStarters.addEventListener('click', handleLineupClick);
  els.lineupBench.addEventListener('click', handleLineupClick);
  els.clearLineup.addEventListener('click', () => {
    state.onCourt = [];
    state.bench = roster.map(r => r.id);
    renderLineup();
    renderLive();
  });
  document.querySelectorAll('.period-btn').forEach(b => b.addEventListener('click', () => setPeriod(b.dataset.period)));
  els.livePlayers.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-stat]');
    if (!btn) return;
    addStat(btn.dataset.player, btn.dataset.stat, Number(btn.dataset.delta));
  });
  els.benchGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bench]');
    if (!btn) return;
    subIn(btn.dataset.bench);
  });
  els.benchToggle.addEventListener('click', () => {
    const hidden = els.benchGrid.classList.toggle('hidden');
    els.benchToggle.textContent = hidden ? 'Bench / Add starters' : 'Hide bench';
  });
  els.subOpen.addEventListener('click', openSubModal);
  els.subClose.addEventListener('click', closeSubModal);
  els.subOut.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sub-out]');
    if (!btn) return;
    state.pendingOut = btn.dataset.subOut;
    els.subHint.textContent = 'Pick who comes in';
    checkSubReady();
  });
  els.subIn.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sub-in]');
    if (!btn) return;
    state.pendingIn = btn.dataset.subIn;
    if (state.pendingOut && state.pendingIn) {
      state.subQueue.push({ out: state.pendingOut, in: state.pendingIn });
      state.pendingOut = null;
      state.pendingIn = null;
      els.subHint.textContent = 'Pick who comes out';
      renderQueue();
    }
  });
  els.subConfirm.addEventListener('click', () => {
    if (state.pendingOut && state.pendingIn) {
      state.subQueue.push({ out: state.pendingOut, in: state.pendingIn });
      state.pendingOut = null;
      state.pendingIn = null;
    }
    applyQueue();
  });
  els.queueClear.addEventListener('click', () => {
    state.subQueue = [];
    renderQueue();
  });
  els.fullLineSwap.addEventListener('click', () => {
    if (state.bench.length < state.onCourt.length || !state.onCourt.length) return;
    const starters = [...state.onCourt];
    const newOn = state.bench.slice(0, starters.length);
    const remainder = state.bench.slice(starters.length);
    state.onCourt = newOn;
    state.bench = [...starters, ...remainder];
    addLog('Full line swap');
    renderLineup();
    renderLive();
  });
  els.oppAdd.addEventListener('click', () => {
    const val = els.oppInput.value.trim();
    if (!val) return;
    state.opp.push({ id: `o-${Date.now()}`, name: val, stats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 } });
    els.oppInput.value = '';
    renderOpponents();
  });
  els.finishSave.addEventListener('click', () => addLog('Mock save finished game'));
  els.finishAI.addEventListener('click', () => addLog('Mock AI summary requested'));
  els.finishEmail.addEventListener('click', () => addLog('Mock email sent'));
  els.clearLog.addEventListener('click', () => { state.log = []; renderLog(); });
  updateSubsButton();
  if (els.autoFill) {
    els.autoFill.addEventListener('click', autoFillStarters);
  }
}

function handleLineupClick(e) {
  const btn = e.target.closest('[data-player]');
  if (!btn) return;
  const id = btn.dataset.player;
  const active = btn.dataset.active === 'true';
  if (active) {
    state.onCourt = state.onCourt.filter(p => p !== id);
    state.bench.push(id);
  } else {
    if (state.onCourt.length >= 5) return;
    state.onCourt.push(id);
    state.bench = state.bench.filter(p => p !== id);
  }
  renderLineup();
  renderLive();
  updateSubsButton();
}

function openSubModal() {
  state.pendingIn = null;
  state.pendingOut = null;
  els.subHint.textContent = 'Pick who comes out';
  els.subConfirm.disabled = true;
  els.subOut.innerHTML = state.onCourt.map(id => `<button class="w-full px-2 py-2 text-left border border-slate/10 rounded-lg" data-sub-out="${id}">#${getNum(id)} ${playerName(id)}</button>`).join('') || '<div class="text-xs text-slate-500">No players</div>';
  els.subIn.innerHTML = state.bench.map(id => `<button class="w-full px-2 py-2 text-left border border-slate/10 rounded-lg" data-sub-in="${id}">#${getNum(id)} ${playerName(id)}</button>`).join('') || '<div class="text-xs text-slate-500">No bench</div>';
  els.subModal.classList.remove('hidden');
  els.subModal.classList.add('flex');
  renderQueue();
  updateSubsButton();
}

function closeSubModal() {
  els.subModal.classList.add('hidden');
  els.subModal.classList.remove('flex');
}

function checkSubReady() {
  const ready = state.pendingIn && state.pendingOut;
  els.subConfirm.disabled = !ready && state.subQueue.length === 0;
}

function applySub(outId, inId) {
  const idx = state.onCourt.indexOf(outId);
  if (idx === -1) return;
  state.onCourt[idx] = inId;
  state.bench = state.bench.filter(id => id !== inId);
  state.bench.push(outId);
  state.subs.push({ out: outId, in: inId, period: state.period, clock: formatClock(state.clock) });
  addLog(`Sub: #${getNum(outId)} → #${getNum(inId)}`);
  renderLineup();
  renderLive();
}

function applyQueue() {
  if (!state.subQueue.length) {
    renderQueue();
    return;
  }
  state.subQueue.forEach(pair => applySub(pair.out, pair.in));
  state.subQueue = [];
  renderQueue();
  closeSubModal();
  updateSubsButton();
}

function subIn(id) {
  if (state.onCourt.length >= 5) return;
  state.onCourt.push(id);
  state.bench = state.bench.filter(p => p !== id);
  renderLineup();
  renderLive();
  updateSubsButton();
}

function renderQueue() {
  if (!els.queueList) return;
  if (!state.subQueue.length) {
    els.queueList.innerHTML = '<span class="text-slate-500">Tap Out then In to build queue.</span>';
    els.subConfirm.disabled = !(state.pendingIn && state.pendingOut);
    updateSubsButton();
    return;
  }
  els.subConfirm.disabled = false;
  updateSubsButton();
  els.queueList.innerHTML = state.subQueue.map((p, idx) => {
    return `<span class="pill px-2 py-1 bg-slate text-white font-semibold">#${getNum(p.out)} → #${getNum(p.in)} (${idx + 1})</span>`;
  }).join(' ');
}

function autoFillStarters() {
  const needed = 5 - state.onCourt.length;
  if (needed <= 0) return;
  const add = state.bench.slice(0, needed);
  state.onCourt = [...state.onCourt, ...add];
  state.bench = state.bench.filter(id => !add.includes(id));
  renderLineup();
  renderLive();
  updateSubsButton();
}

function playerName(id) {
  return roster.find(r => r.id === id)?.name || '';
}

function init() {
  setTab('live');
  setPeriod('Q1');
  renderHeader();
  renderLineup();
  renderLive();
  renderOpponents();
  renderLog();
  renderQueue();
  attachEvents();
  updateSubsButton();
}

function updateSubsButton() {
  if (!els.subOpen) return;
  if (state.subQueue.length) {
    els.subOpen.textContent = `Subs (${state.subQueue.length} queued)`;
    els.subOpen.classList.add('bg-teal');
    els.subOpen.disabled = false;
  } else {
    els.subOpen.textContent = 'Subs';
    els.subOpen.classList.remove('bg-teal');
    els.subOpen.disabled = false;
  }
}

init();
