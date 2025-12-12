// Mobile-first basketball tracker, now backed by Firebase like track.html.
import { getTeam, getGame, getPlayers, getConfigs, updateGame, collection, getDocs, deleteDoc, query } from './db.js';
import { db } from './firebase.js';
import { getUrlParams, escapeHtml } from './utils.js?v=8';
import { checkAuth } from './auth.js';
import { writeBatch, doc, setDoc, addDoc } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';

let currentTeamId = null;
let currentGameId = null;
let currentTeam = null;
let currentGame = null;
let currentUser = null;
let currentConfig = null;

let roster = [];

function statDefaults(columns) {
  const stats = { time: 0 };
  columns.forEach(col => {
    stats[col.toLowerCase()] = 0;
  });
  return stats;
}

let state = {
  period: 'Q1',
  clock: 0,
  running: false,
  lastTick: null,
  home: 0,
  away: 0,
  starters: [],
  bench: [],
  onCourt: [],
  stats: {},
  log: [],
  subs: [],
  opp: [],
  pendingOut: null,
  pendingIn: null,
  subQueue: [],
  queueMode: false,
  history: []
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
  saveQueueLater: q('#save-queue-later'),
  queueList: q('#queue-list-mobile'),
  queueClear: q('#clear-queue-mobile'),
  queueDisplay: q('#queue-display'),
  queueCount: q('#queue-count'),
  queueQuickApply: q('#queue-quick-apply'),
  queueCountMain: q('#queue-count-main'),
  applyQueueNow: q('#apply-queue-now'),
  modeQuick: q('#mode-quick'),
  modeQueue: q('#mode-queue'),
  subModeTitle: q('#sub-mode-title'),
  oppInput: q('#opp-input-mobile'),
  oppAdd: q('#opp-add-mobile'),
  oppCards: q('#opp-cards-mobile'),
  homeFinal: q('#home-final'),
  awayFinal: q('#away-final'),
  notesFinal: q('#notes-final'),
  finishPeriod: q('#finish-period'),
  finishClock: q('#finish-clock'),
  finishAI: q('#finish-ai'),
  finishEmail: q('#finish-email'),
  finishSave: q('#finish-save'),
  finishSendEmail: q('#finish-send-email'),
  aiSummaryOutput: q('#ai-summary-output'),
  aiSummaryText: q('#ai-summary-text'),
  closeAiSummary: q('#close-ai-summary'),
  emailOutput: q('#email-output'),
  emailText: q('#email-text'),
  closeEmail: q('#close-email'),
  copyEmail: q('#copy-email'),
  copyStatus: q('#copy-status'),
  finishTimeReport: q('#finish-time-report'),
  finishSubs: q('#finish-subs'),
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

  if (tab === 'finish') {
    renderFinish();
  }
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

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarHtml(player, sizeClass = 'h-5 w-5', textClass = 'text-[9px]') {
  if (!player) return '';
  const url = player.photoUrl;
  if (url) {
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(player.name || '')}" class="${sizeClass} rounded-full object-cover border border-white/30">`;
  }
  const initials = getInitials(player.name || '');
  return `<div class="${sizeClass} rounded-full bg-slate text-white flex items-center justify-center ${textClass} font-semibold border border-white/30">${escapeHtml(initials || '#')}</div>`;
}

function playerChip(id, active) {
  const p = roster.find(r => r.id === id);
  const cls = active ? 'bg-teal text-ink' : 'bg-white';
  return `<button class="pill px-2 py-1.5 border border-slate/10 ${cls}" data-player="${id}" data-active="${active}">
    <div class="flex flex-col items-center gap-0.5 leading-none">
      ${avatarHtml(p, 'h-6 w-6', 'text-[10px]')}
      <span class="text-[10px] font-bold">#${escapeHtml(p?.num || '')}</span>
    </div>
  </button>`;
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
  const cols = (currentConfig?.columns || []).map(c => c.toUpperCase());
  const row1Cols = cols.slice(0, 3);
  const row2Cols = cols.slice(3, 6);
  const row1Pills = row1Cols.map(col => statPill(col, s[col.toLowerCase()] || 0)).join('');
  const row2Pills = row2Cols.map(col => statPill(col, s[col.toLowerCase()] || 0)).join('');

  const btnHtml = cols.map(col => {
    const key = col.toLowerCase();
    if (isPointsColumn(col)) {
      return `${statBtn(id, key, 2, '+2')} ${statBtn(id, key, 3, '+3')} ${statBtn(id, key, 1, '+1')}`;
    }
    return statBtn(id, key, 1, col);
  }).join(' ');
  return `
    <div class="border border-slate/10 rounded-xl p-2 bg-white space-y-1">
      <div class="flex justify-between items-center">
        <div class="flex items-center gap-1 min-w-0">
          ${avatarHtml(p, 'h-5 w-5', 'text-[9px]')}
          <div class="text-xs font-semibold truncate">#${escapeHtml(p?.num || '')} ${escapeHtml(p?.name || '')}</div>
        </div>
        <div class="text-[10px] text-slate-500">${formatClock(s.time)}</div>
      </div>
      <div class="grid grid-cols-3 gap-1 text-[10px] text-center">
        ${row1Pills}
      </div>
      <div class="grid grid-cols-3 gap-1 text-[10px] text-center">
        ${row2Pills}
      </div>
      <div class="grid grid-cols-3 gap-1 text-[11px] font-semibold">
        ${btnHtml}
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
    return `<button class="text-xs px-2 py-2 border border-slate/10 rounded-lg bg-white flex items-center gap-2" data-bench="${id}">
      ${avatarHtml(p, 'h-5 w-5', 'text-[9px]')}
      <span class="truncate">#${escapeHtml(p?.num || '')} ${escapeHtml(p?.name || '')}</span>
    </button>`;
  }).join('') || '<div class="col-span-2 text-xs text-slate-500 text-center py-2">No bench</div>';
  if (forceShow) {
    els.benchGrid.classList.remove('hidden');
    els.benchToggle.textContent = 'Hide bench';
  }
}

function renderOpponents() {
  els.oppCards.innerHTML = state.opp.map((o, idx) => {
    const s = o.stats;
    const cols = (currentConfig?.columns || []).map(c => c.toUpperCase());
    const quickCols = cols.slice(0, 2);
    const quickLine = quickCols.map(col => `${col} ${s[col.toLowerCase()] || 0}`).join(' · ');
    const oppBtns = cols.map(col => {
      const key = col.toLowerCase();
      if (isPointsColumn(col)) {
        return `${oppBtn(o.id, key, 2, '+2')} ${oppBtn(o.id, key, 3, '+3')} ${oppBtn(o.id, key, 1, '+1')}`;
      }
      return oppBtn(o.id, key, 1, col);
    }).join(' ');
    return `
      <div class="border border-slate/10 rounded-xl p-2 bg-white space-y-1">
        <input data-opp-edit="${o.id}" value="${o.name}" class="w-full text-xs px-2 py-1 rounded border border-slate/10 font-semibold">
        <div class="text-[11px] text-slate-500">${quickLine || 'No stats yet'}</div>
        <div class="grid grid-cols-3 gap-1 text-[11px] font-semibold">
          ${oppBtns} <span></span> <button data-opp-del="${o.id}" class="text-[11px] text-red-600">Remove</button>
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

function saveHistory(action) {
  // Deep clone current state for undo
  const snapshot = {
    action,
    period: state.period,
    clock: state.clock,
    home: state.home,
    away: state.away,
    onCourt: [...state.onCourt],
    bench: [...state.bench],
    stats: JSON.parse(JSON.stringify(state.stats)),
    log: [...state.log],
    opp: JSON.parse(JSON.stringify(state.opp))
  };
  state.history.push(snapshot);
  // Keep only last 50 actions
  if (state.history.length > 50) state.history.shift();
}

function undo() {
  if (!state.history.length) {
    addLog('Nothing to undo');
    return;
  }
  const prev = state.history.pop();
  state.period = prev.period;
  state.clock = prev.clock;
  state.home = prev.home;
  state.away = prev.away;
  state.onCourt = prev.onCourt;
  state.bench = prev.bench;
  state.stats = prev.stats;
  state.log = prev.log;
  state.opp = prev.opp;
  renderAll();
  addLog(`Undid: ${prev.action}`);
}

function renderAll() {
  renderHeader();
  renderLineup();
  renderLive();
  renderOpponents();
  renderLog();
  renderFairness();
}

function addLog(text, undoData = null) {
  state.log.unshift({ text, ts: Date.now(), period: state.period, clock: formatClock(state.clock), undoData });
  renderLog();
}

function renderFinish() {
  // Update final scores
  els.homeFinal.value = state.home;
  els.awayFinal.value = state.away;
  els.finishPeriod.textContent = state.period;
  els.finishClock.textContent = formatClock(state.clock);

  // Render playing time snapshot
  const allPlayers = roster.map(r => {
    const time = state.stats[r.id].time;
    const mins = Math.floor(time / 60000);
    const secs = Math.floor((time % 60000) / 1000);
    return {
      num: r.num,
      name: r.name,
      time,
      display: `${mins}:${secs.toString().padStart(2, '0')}`
    };
  }).sort((a, b) => b.time - a.time);

  els.finishTimeReport.innerHTML = allPlayers.map(p => `
    <div class="flex justify-between items-center py-1 border-b border-slate/10">
      <span class="font-medium">#${p.num} ${p.name}</span>
      <span class="font-mono text-slate-600">${p.display}</span>
    </div>
  `).join('');

  // Render substitution history
  if (state.subs.length === 0) {
    els.finishSubs.innerHTML = '<div class="text-slate-500">No substitutions recorded</div>';
  } else {
    els.finishSubs.innerHTML = state.subs.map(s => `
      <div class="flex justify-between items-center py-1 border-b border-slate/10">
        <span>#${getNum(s.out)} ${playerName(s.out)} → #${getNum(s.in)} ${playerName(s.in)}</span>
        <span class="text-slate-500">${s.period} ${s.clock}</span>
      </div>
    `).join('');
  }
}

async function generateAISummary() {
  els.aiSummaryText.textContent = 'Generating AI summary…';
  els.aiSummaryOutput.classList.remove('hidden');

  try {
    const { getAI, getGenerativeModel, GoogleAIBackend } = await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-ai.js');
    const { getApp } = await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js');

    const finalHome = parseInt(els.homeFinal.value) || state.home;
    const finalAway = parseInt(els.awayFinal.value) || state.away;

    let context = `Game: ${currentTeam.name} vs ${currentGame.opponent}\n`;
    context += `Final Score: ${finalHome} - ${finalAway}\n`;
    context += `Date: ${currentGame.date ? new Date(currentGame.date.seconds * 1000).toLocaleDateString() : new Date().toLocaleDateString()}\n`;
    context += `Sport: ${currentTeam.sport || (currentConfig?.baseType || 'Basketball')}\n\n`;

    context += `${currentTeam.name.toUpperCase()} PLAYERS:\n`;
    roster.forEach(player => {
      context += `#${player.num || '-'} ${player.name}: `;
      const stats = [];
      (currentConfig?.columns || []).forEach(col => {
        const key = col.toLowerCase();
        const val = state.stats[player.id]?.[key] || 0;
        stats.push(`${col}:${val}`);
      });
      context += stats.join(', ') + `\n`;
    });

    context += `\nOPPONENT PLAYERS:\n`;
    state.opp.forEach(opp => {
      const hasAny = (currentConfig?.columns || []).some(col => (opp.stats?.[col.toLowerCase()] || 0) > 0);
      if (!opp.name && !hasAny) return;
      context += `${opp.name || 'Opponent'}: `;
      const stats = [];
      (currentConfig?.columns || []).forEach(col => {
        const key = col.toLowerCase();
        const val = opp.stats?.[key] || 0;
        if (val > 0) stats.push(`${col}:${val}`);
      });
      context += stats.join(', ') + `\n`;
    });

    if (state.log.length > 0) {
      context += `\nGAME LOG:\n`;
      state.log.slice().reverse().forEach(ev => {
        context += `${ev.period} ${ev.clock} - ${ev.text}\n`;
      });
    }

    const prompt = `You are a sports reporter writing a match report for a youth sports game. 
Write a comprehensive but concise game summary in paragraph form (2-5 paragraphs).
Make it engaging and professional, as if it would appear in a sports publication. Focus on the narrative, not just listing stats.

GAME DATA:
${context}

Write the match report now:`;

    const firebaseApp = getApp();
    const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, { model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    els.aiSummaryText.textContent = text;
    els.notesFinal.value = text;
    addLog('AI summary generated');
  } catch (error) {
    console.error('AI summary error:', error);
    els.aiSummaryText.textContent = `Error generating AI summary: ${error.message}`;
  }
}

function generateEmailBody(finalHome, finalAway, summary = '') {
  const gameData = {
    opponent: currentGame.opponent || 'Unknown Opponent',
    date: currentGame.date ? new Date(currentGame.date.seconds * 1000).toLocaleDateString() : new Date().toLocaleDateString(),
    gameTime: formatClock(state.clock),
    homeScore: finalHome,
    awayScore: finalAway
  };

  let body = `${currentTeam.name} Game Summary\n`;
  body += `Date: ${gameData.date}\n`;
  body += `Opponent: ${gameData.opponent}\n`;
  body += `Final Score: ${gameData.homeScore} - ${gameData.awayScore}\n`;
  body += `Game Time: ${gameData.gameTime}\n`;

  if (summary) {
    body += `\nSUMMARY:\n`;
    body += `${'='.repeat(40)}\n`;
    body += `${summary}\n`;
  }

  body += `\n${currentTeam.name.toUpperCase()} PLAYER STATS:\n`;
  body += `${'='.repeat(40)}\n`;
  roster.forEach(player => {
    body += `#${player.num || '-'} ${player.name}:\n`;
    (currentConfig?.columns || []).forEach(col => {
      const key = col.toLowerCase();
      const val = state.stats[player.id]?.[key] || 0;
      body += `  ${col}: ${val}\n`;
    });
    body += `\n`;
  });

  body += `\nOPPONENT TEAM STATS:\n`;
  body += `${'='.repeat(40)}\n`;
  state.opp.forEach(opp => {
    const hasStats = opp.stats && Object.values(opp.stats).some(v => v > 0);
    if (!opp.name && !hasStats) return;
    body += `${opp.name || 'Opponent Player'}:\n`;
    (currentConfig?.columns || []).forEach(col => {
      const key = col.toLowerCase();
      const val = opp.stats?.[key] || 0;
      if (val > 0) body += `  ${col}: ${val}\n`;
    });
    body += `\n`;
  });

  if (state.log.length > 0) {
    body += `\nGAME LOG:\n`;
    body += `${'='.repeat(40)}\n`;
    state.log.slice().reverse().forEach(ev => {
      body += `${ev.period} ${ev.clock} - ${ev.text}\n`;
    });
  }

  return body;
}

function generateEmailRecap() {
  const finalHome = parseInt(els.homeFinal.value) || state.home;
  const finalAway = parseInt(els.awayFinal.value) || state.away;
  const summary = els.notesFinal.value.trim();

  const body = generateEmailBody(finalHome, finalAway, summary);
  els.emailText.textContent = body;
  els.emailOutput.classList.remove('hidden');
  addLog('Email recap generated');
}

async function saveAndComplete() {
  const finalHome = parseInt(els.homeFinal.value) || state.home;
  const finalAway = parseInt(els.awayFinal.value) || state.away;
  const summary = els.notesFinal.value.trim();
  const sendEmail = els.finishSendEmail?.checked;

  try {
    const batch = writeBatch(db);

    // 1. Write all game log events
    state.log.forEach(entry => {
      const eventRef = doc(collection(db, `teams/${currentTeamId}/games/${currentGameId}/events`));
      batch.set(eventRef, {
        text: entry.text,
        gameTime: entry.clock,
        period: entry.period,
        timestamp: entry.ts || Date.now(),
        type: entry.undoData?.type || 'game_log',
        playerId: entry.undoData?.playerId || null,
        statKey: entry.undoData?.statKey || null,
        value: entry.undoData?.value || null,
        isOpponent: entry.undoData?.isOpponent || false,
        createdBy: currentUser.uid
      });
    });

    // 2. Write aggregated stats for each player
    roster.forEach(player => {
      const statsObj = {};
      (currentConfig?.columns || []).forEach(col => {
        const key = col.toLowerCase();
        statsObj[key] = state.stats[player.id]?.[key] || 0;
      });
      const statsRef = doc(db, `teams/${currentTeamId}/games/${currentGameId}/aggregatedStats`, player.id);
      batch.set(statsRef, {
        playerName: player.name,
        playerNumber: player.num,
        stats: statsObj
      });
    });

    // 3. Build opponentStats in same shape as track.html
    const opponentStats = {};
    state.opp.forEach(opp => {
      opponentStats[opp.id] = {
        name: opp.name || '',
        number: opp.number || ''
      };
      (currentConfig?.columns || []).forEach(col => {
        const key = col.toLowerCase();
        opponentStats[opp.id][key] = opp.stats?.[key] || 0;
      });
    });

    // 4. Update game doc
    const gameRef = doc(db, `teams/${currentTeamId}/games`, currentGameId);
    batch.update(gameRef, {
      homeScore: finalHome,
      awayScore: finalAway,
      summary,
      status: 'completed',
      opponentStats
    });

    await batch.commit();

    if (sendEmail) {
      const subject = `${currentTeam.name} vs ${currentGame.opponent || 'Unknown Opponent'} - Game Summary`;
      const body = generateEmailBody(finalHome, finalAway, summary);
      const userEmail = currentUser.email || '';
      const mailto = `mailto:${userEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailto;
      setTimeout(() => {
        window.location.href = `game.html#teamId=${currentTeamId}&gameId=${currentGameId}`;
      }, 500);
    } else {
      window.location.href = `game.html#teamId=${currentTeamId}&gameId=${currentGameId}`;
    }
  } catch (error) {
    console.error('Error finishing game:', error);
    alert('Error finishing game: ' + error.message);
  }
}

function copyEmailToClipboard() {
  const text = els.emailText.textContent;
  navigator.clipboard.writeText(text).then(() => {
    els.copyStatus.classList.remove('hidden');
    setTimeout(() => els.copyStatus.classList.add('hidden'), 2000);
    addLog('Email copied to clipboard');
  }).catch(err => {
    console.error('Copy failed:', err);
  });
}

function formatClock(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function isPointsColumn(colOrKey) {
  const u = (colOrKey || '').toString().toUpperCase();
  return u === 'PTS' || u === 'POINTS' || u === 'GOALS';
}

async function startStop() {
  if (state.running) {
    state.running = false;
    els.startStop.textContent = 'Start';
    els.startStop.classList.remove('bg-red-600', 'border-red-700');
    els.startStop.classList.add('bg-emerald-600', 'border-emerald-700');
    clearInterval(state.tick);
  } else {
    // If no local activity yet, check for existing tracked data and offer to clear
    const hasLocalActivity = state.clock > 0 || state.home > 0 || state.away > 0 || (state.log && state.log.length > 0);
    if (!hasLocalActivity && currentTeamId && currentGameId) {
      const eventsSnap = await getDocs(collection(db, `teams/${currentTeamId}/games/${currentGameId}/events`));
      if (eventsSnap.size > 0) {
        const confirmClear = confirm(`This game already has ${eventsSnap.size} tracked event(s). Starting fresh will clear them. Continue?`);
        if (!confirmClear) return;

        await Promise.all(eventsSnap.docs.map(d => deleteDoc(d.ref)));
        const statsSnap = await getDocs(collection(db, `teams/${currentTeamId}/games/${currentGameId}/aggregatedStats`));
        await Promise.all(statsSnap.docs.map(d => deleteDoc(d.ref)));
        // Reset game doc scores/opponent stats to avoid mixing old data
        await updateGame(currentTeamId, currentGameId, { homeScore: 0, awayScore: 0, opponentStats: {} });
      }
    }

    state.running = true;
    els.startStop.textContent = 'Pause';
    els.startStop.classList.remove('bg-emerald-600', 'border-emerald-700');
    els.startStop.classList.add('bg-red-600', 'border-red-700');
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
  // Prevent stat tracking before game starts
  if (!state.running && state.clock === 0) {
    alert('Please start the game timer before recording stats.');
    return;
  }
  saveHistory(`#${getNum(id)} ${key.toUpperCase()} +${delta}`);
  state.stats[id][key] += delta;
  if (isPointsColumn(key)) state.home += delta;
  addLog(`#${getNum(id)} ${key.toUpperCase()} +${delta}`, {
    type: 'stat',
    playerId: id,
    statKey: key,
    value: delta,
    isOpponent: false
  });
  renderHeader();
  renderLive();
}

function addOppStat(id, key, delta) {
  const opp = state.opp.find(o => o.id === id);
  if (!opp) return;
  if (!state.running && state.clock === 0) {
    alert('Please start the game timer before recording stats.');
    return;
  }
  saveHistory(`Opp ${opp.name} ${key.toUpperCase()} +${delta}`);
  opp.stats[key] += delta;
  if (isPointsColumn(key)) state.away += delta;
  addLog(`Opp ${opp.name} ${key.toUpperCase()} +${delta}`, {
    type: 'stat',
    playerId: id,
    statKey: key,
    value: delta,
    isOpponent: true
  });
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
  els.undoMini.addEventListener('click', undo);
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

  els.modeQuick.addEventListener('click', () => {
    setSubMode('quick');
    state.subQueue = [];
    state.pendingOut = null;
    state.pendingIn = null;
    renderSubPlayers();
    renderQueue();
  });

  els.modeQueue.addEventListener('click', () => {
    setSubMode('queue');
    state.pendingOut = null;
    state.pendingIn = null;
    renderSubPlayers();
    renderQueue();
  });

  els.subOut.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sub-out]');
    if (!btn) return;
    state.pendingOut = btn.dataset.subOut;
    renderSubPlayers();
    updateSubHint();
    updateSubButton();
  });

  els.subIn.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sub-in]');
    if (!btn) return;
    state.pendingIn = btn.dataset.subIn;

    if (state.pendingOut && state.pendingIn) {
      if (state.queueMode) {
        // Queue mode: add to queue and reset
        state.subQueue.push({ out: state.pendingOut, in: state.pendingIn });
        state.pendingOut = null;
        state.pendingIn = null;
        renderSubPlayers();
        renderQueue();
        updateSubHint();
        updateSubButton();
      } else {
        // Quick mode: just update button state
        renderSubPlayers();
        updateSubButton();
      }
    }
  });

  els.subConfirm.addEventListener('click', () => {
    if (state.queueMode) {
      // Add pending swap to queue if exists
      if (state.pendingOut && state.pendingIn) {
        state.subQueue.push({ out: state.pendingOut, in: state.pendingIn });
        state.pendingOut = null;
        state.pendingIn = null;
      }
      applyQueue();
    } else {
      // Quick mode: apply single swap
      if (state.pendingOut && state.pendingIn) {
        saveHistory(`Sub: #${getNum(state.pendingOut)} → #${getNum(state.pendingIn)}`);
        applySub(state.pendingOut, state.pendingIn);
        state.pendingOut = null;
        state.pendingIn = null;
        closeSubModal();
        updateSubsButton();
      }
    }
  });

  els.queueClear.addEventListener('click', () => {
    state.subQueue = [];
    state.pendingOut = null;
    state.pendingIn = null;
    renderSubPlayers();
    renderQueue();
    updateSubButton();
  });

  els.applyQueueNow.addEventListener('click', () => {
    applyQueue(false); // Don't close modal since we're not in modal
  });

  els.saveQueueLater.addEventListener('click', () => {
    closeSubModal();
  });

  els.fullLineSwap.addEventListener('click', () => {
    if (state.bench.length < state.onCourt.length || !state.onCourt.length) return;
    saveHistory('Full line swap');
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
    const stats = statDefaults(currentConfig?.columns || []);
    state.opp.push({ id: `o-${Date.now()}`, name: val, stats });
    els.oppInput.value = '';
    renderOpponents();
  });
  els.finishAI.addEventListener('click', generateAISummary);
  els.finishEmail.addEventListener('click', generateEmailRecap);
  els.finishSave.addEventListener('click', saveAndComplete);
  els.closeAiSummary.addEventListener('click', () => els.aiSummaryOutput.classList.add('hidden'));
  els.closeEmail.addEventListener('click', () => els.emailOutput.classList.add('hidden'));
  els.copyEmail.addEventListener('click', copyEmailToClipboard);
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
    addLog(`#${getNum(id)} ${playerName(id)} removed from court`);
  } else {
    if (state.onCourt.length >= 5) return;
    state.onCourt.push(id);
    state.bench = state.bench.filter(p => p !== id);
    addLog(`#${getNum(id)} ${playerName(id)} added to court`);
  }
  renderLineup();
  renderLive();
  updateSubsButton();
}

function setSubMode(mode) {
  state.queueMode = mode === 'queue';

  // Update mode buttons
  els.modeQuick.classList.toggle('bg-teal', !state.queueMode);
  els.modeQuick.classList.toggle('text-ink', !state.queueMode);
  els.modeQuick.classList.toggle('bg-white', state.queueMode);
  els.modeQuick.classList.toggle('border', state.queueMode);

  els.modeQueue.classList.toggle('bg-teal', state.queueMode);
  els.modeQueue.classList.toggle('text-ink', state.queueMode);
  els.modeQueue.classList.toggle('bg-white', !state.queueMode);
  els.modeQueue.classList.toggle('border', !state.queueMode);

  // Update title and queue display
  els.subModeTitle.textContent = state.queueMode ? 'Queue Multiple' : 'Quick Swap';
  els.queueDisplay.classList.toggle('hidden', !state.queueMode);

  // Update hint and button text
  updateSubHint();
  updateSubButton();
}

function updateSubHint() {
  if (state.queueMode) {
    if (!state.pendingOut) {
      els.subHint.textContent = 'Tap player on court, then tap replacement';
    } else {
      els.subHint.textContent = 'Now tap bench player to complete swap';
    }
  } else {
    if (!state.pendingOut) {
      els.subHint.textContent = 'Tap player on court, then tap replacement';
    } else {
      els.subHint.textContent = 'Now tap bench player to swap in';
    }
  }
}

function updateSubButton() {
  if (state.queueMode) {
    const hasQueue = state.subQueue.length > 0;
    els.subConfirm.disabled = !hasQueue && !(state.pendingOut && state.pendingIn);
    els.subConfirm.textContent = hasQueue ? `Apply ${state.subQueue.length} Swap${state.subQueue.length > 1 ? 's' : ''}` : 'Make Swap';

    // Show "Save for Later" button if there's a queue
    if (hasQueue) {
      els.saveQueueLater.classList.remove('hidden');
      els.subConfirm.classList.remove('w-full');
    } else {
      els.saveQueueLater.classList.add('hidden');
      els.subConfirm.classList.add('w-full');
    }
  } else {
    els.subConfirm.disabled = !(state.pendingOut && state.pendingIn);
    els.subConfirm.textContent = 'Make Swap';
    els.saveQueueLater.classList.add('hidden');
    els.subConfirm.classList.add('w-full');
  }
}

function openSubModal() {
  state.pendingIn = null;
  state.pendingOut = null;

  // If there's a queue, automatically switch to queue mode
  if (state.subQueue.length > 0) {
    state.queueMode = true;
  }

  setSubMode(state.queueMode ? 'queue' : 'quick');
  renderSubPlayers();
  els.subModal.classList.remove('hidden');
  els.subModal.classList.add('flex');
  renderQueue();
  updateSubsButton();
}

function renderSubPlayers() {
  // Render on-court players
  els.subOut.innerHTML = state.onCourt.map(id => {
    const selected = state.pendingOut === id;
    const cls = selected ? 'bg-teal text-ink border-teal' : 'bg-white border-slate/10';
    const p = roster.find(r => r.id === id);
    return `<button class="w-full px-3 py-2 text-left border-2 rounded-lg font-medium ${cls} flex items-center gap-2" data-sub-out="${id}">
      ${avatarHtml(p, 'h-5 w-5', 'text-[9px]')}
      <span class="truncate">#${escapeHtml(p?.num || '')} ${escapeHtml(p?.name || '')}</span>
    </button>`;
  }).join('') || '<div class="text-xs text-slate-500 text-center py-2">No players on court</div>';

  // Render bench players
  els.subIn.innerHTML = state.bench.map(id => {
    const selected = state.pendingIn === id;
    const cls = selected ? 'bg-teal text-ink border-teal' : 'bg-white border-slate/10';
    const p = roster.find(r => r.id === id);
    return `<button class="w-full px-3 py-2 text-left border-2 rounded-lg font-medium ${cls} flex items-center gap-2" data-sub-in="${id}">
      ${avatarHtml(p, 'h-5 w-5', 'text-[9px]')}
      <span class="truncate">#${escapeHtml(p?.num || '')} ${escapeHtml(p?.name || '')}</span>
    </button>`;
  }).join('') || '<div class="text-xs text-slate-500 text-center py-2">No bench players</div>';
}

function closeSubModal() {
  els.subModal.classList.add('hidden');
  els.subModal.classList.remove('flex');
  state.pendingOut = null;
  state.pendingIn = null;
}

function applySub(outId, inId) {
  const idx = state.onCourt.indexOf(outId);
  if (idx === -1) return;
  state.onCourt[idx] = inId;
  state.bench = state.bench.filter(id => id !== inId);
  state.bench.push(outId);
  state.subs.push({ out: outId, in: inId, period: state.period, clock: formatClock(state.clock) });
  addLog(`Sub: #${getNum(outId)} ${playerName(outId)} → #${getNum(inId)} ${playerName(inId)}`);
  renderLineup();
  renderLive();
}

function applyQueue(closeModal = true) {
  if (!state.subQueue.length) {
    return;
  }
  saveHistory(`Applied ${state.subQueue.length} sub${state.subQueue.length > 1 ? 's' : ''}`);

  // Log each individual swap for clarity
  state.subQueue.forEach(pair => {
    const idx = state.onCourt.indexOf(pair.out);
    if (idx !== -1) {
      state.onCourt[idx] = pair.in;
      state.bench = state.bench.filter(id => id !== pair.in);
      state.bench.push(pair.out);
      state.subs.push({ out: pair.out, in: pair.in, period: state.period, clock: formatClock(state.clock) });
      // Log each swap individually
      addLog(`Sub: #${getNum(pair.out)} ${playerName(pair.out)} → #${getNum(pair.in)} ${playerName(pair.in)}`);
    }
  });

  state.subQueue = [];
  renderQueue();
  if (closeModal) {
    closeSubModal();
  }
  renderLineup();
  renderLive();
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
  if (!els.queueList || !els.queueCount) return;

  els.queueCount.textContent = state.subQueue.length;

  // Update main UI quick apply button
  if (els.queueQuickApply && els.queueCountMain) {
    if (state.subQueue.length > 0) {
      els.queueQuickApply.classList.remove('hidden');
      els.queueCountMain.textContent = state.subQueue.length;
    } else {
      els.queueQuickApply.classList.add('hidden');
    }
  }

  if (!state.subQueue.length) {
    els.queueList.innerHTML = '<span class="text-slate-500">Build your queue...</span>';
  } else {
    els.queueList.innerHTML = state.subQueue.map(p => {
      return `<span class="pill px-2 py-1 bg-teal text-ink font-semibold">#${getNum(p.out)} → #${getNum(p.in)}</span>`;
    }).join(' ');
  }

  updateSubsButton();
}

function autoFillStarters() {
  const needed = 5 - state.onCourt.length;
  if (needed <= 0) return;
  const add = state.bench.slice(0, needed);
  state.onCourt = [...state.onCourt, ...add];
  state.bench = state.bench.filter(id => !add.includes(id));
  add.forEach(id => addLog(`#${getNum(id)} ${playerName(id)} auto-added to court`));
  renderLineup();
  renderLive();
  updateSubsButton();
}

function playerName(id) {
  return roster.find(r => r.id === id)?.name || '';
}

checkAuth(async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  await init();
});

async function init() {
  const { teamId, gameId } = getUrlParams();
  if (!teamId || !gameId) {
    window.location.href = 'dashboard.html';
    return;
  }
  currentTeamId = teamId;
  currentGameId = gameId;

  try {
    const [team, game, playersList] = await Promise.all([
      getTeam(teamId),
      getGame(teamId, gameId),
      getPlayers(teamId)
    ]);

    if (!game) {
      alert('Game not found');
      window.location.href = 'dashboard.html';
      return;
    }

    if (game.type === 'practice') {
      alert('Practice events cannot be tracked.');
      window.location.href = `edit-schedule.html#teamId=${teamId}`;
      return;
    }

    currentTeam = team;
    currentGame = game;

    roster = (playersList || []).map(p => ({
      id: p.id,
      num: p.number || '',
      name: p.name || '',
      pos: p.position || p.pos || '',
      photoUrl: p.photoUrl || p.photo || ''
    }));

    if (game.statTrackerConfigId) {
      const configs = await getConfigs(teamId);
      currentConfig = configs.find(c => c.id === game.statTrackerConfigId) || null;
    }
    if (!currentConfig) {
      currentConfig = {
        name: 'Default',
        baseType: 'Basketball',
        columns: ['PTS', 'REB', 'AST', 'STL', 'TO']
      };
    }

    // Reset base state
    state.period = 'Q1';
    state.clock = 0;
    state.running = false;
    state.lastTick = null;
    state.home = game.homeScore || 0;
    state.away = game.awayScore || 0;
    state.starters = [];
    state.bench = roster.map(r => r.id);
    state.onCourt = [];
    state.stats = roster.reduce((acc, r) => {
      acc[r.id] = statDefaults(currentConfig.columns);
      return acc;
    }, {});
    state.log = [];
    state.subs = [];
    state.history = [];
    state.subQueue = [];
    state.queueMode = false;

    // Load existing aggregated stats
    const statsSnapshot = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/aggregatedStats`));
    statsSnapshot.forEach(d => {
      if (!state.stats[d.id]) state.stats[d.id] = statDefaults(currentConfig.columns);
      const existing = d.data().stats || {};
      Object.assign(state.stats[d.id], existing);
    });

    // Recalculate home score if needed based on points column
    const pointsCol = (currentConfig.columns || []).find(isPointsColumn);
    if (pointsCol) {
      const pointsKey = pointsCol.toLowerCase();
      const totalPoints = roster.reduce((sum, r) => sum + (state.stats[r.id]?.[pointsKey] || 0), 0);
      if (totalPoints > 0 && state.home === 0) {
        state.home = totalPoints;
      }
    }

    // Initialize opponents from game or fresh
    if (game.opponentStats && Object.keys(game.opponentStats).length > 0) {
      state.opp = Object.entries(game.opponentStats).map(([id, data]) => {
        const stats = statDefaults(currentConfig.columns);
        (currentConfig.columns || []).forEach(col => {
          const key = col.toLowerCase();
          if (data[key] !== undefined) stats[key] = data[key];
        });
        return { id, name: data.name || '', number: data.number || '', stats };
      });
    } else {
      state.opp = [1, 2, 3].map(i => ({
        id: `opp${i}`,
        name: '',
        stats: statDefaults(currentConfig.columns)
      }));
    }

    const subtitle = document.getElementById('game-subtitle');
    if (subtitle) {
      subtitle.textContent = `${currentTeam.name} vs. ${currentGame.opponent || 'Opponent'}`;
    }

    setTab('live');
    setPeriod('Q1');
    renderAll();
    renderQueue();
    attachEvents();
    updateSubsButton();
  } catch (error) {
    console.error(error);
    alert('Error loading game data.');
    window.location.href = `edit-schedule.html#teamId=${teamId}`;
  }
}

function updateSubsButton() {
  if (!els.subOpen) return;
  if (state.subQueue.length) {
    els.subOpen.textContent = `Subs (${state.subQueue.length} queued)`;
    els.subOpen.classList.add('ring-2', 'ring-purple-300');
    els.subOpen.disabled = false;
  } else {
    els.subOpen.textContent = 'Subs';
    els.subOpen.classList.remove('ring-2', 'ring-purple-300');
    els.subOpen.disabled = false;
  }
}
