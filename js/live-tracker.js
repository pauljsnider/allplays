// Mobile-first basketball tracker, now backed by Firebase like track.html.
import { getTeam, getTeams, getGame, getPlayers, getConfigs, updateGame, collection, getDocs, deleteDoc, query, broadcastLiveEvent, subscribeLiveChat, postLiveChatMessage, setGameLiveStatus } from './db.js?v=14';
import { db } from './firebase.js?v=9';
import { getUrlParams, escapeHtml } from './utils.js?v=8';
import { checkAuth } from './auth.js?v=9';
import { writeBatch, doc, setDoc, addDoc, onSnapshot } from './firebase.js?v=9';
import { getAI, getGenerativeModel, GoogleAIBackend } from './vendor/firebase-ai.js';
import { getApp } from './vendor/firebase-app.js';
import { isVoiceRecognitionSupported, normalizeGameNoteText, appendGameSummaryLine, buildGameNoteLogText } from './live-tracker-notes.js?v=1';

let currentTeamId = null;
let currentGameId = null;
let currentTeam = null;
let currentGame = null;
let currentUser = null;
let currentConfig = null;

let roster = [];
let opponentTeam = null;
let opponentRoster = [];
let opponentRosterSelected = new Set();
let allTeamsCache = null;
let isFinishing = false;
let allowNavigation = false;

function statDefaults(columns) {
  const stats = { time: 0, fouls: 0 }; // Always track fouls
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
  history: [],
  voiceListening: false,
  activeVoiceRecognition: null
};

let liveState = {
  isLive: false,
  viewerCount: 0,
  chatExpanded: false,
  unreadChatCount: 0,
  lastChatSeenAt: Date.now(),
  chatInitialized: false,
  eventQueue: [],
  retryAttempt: 0,
  retryTimeout: null,
  unsubscribeChat: null,
  unsubscribeViewers: null,
  lastChatSentAt: 0,
  scoreSyncTimeout: null,
  lastSyncedHome: null,
  lastSyncedAway: null,
  lastClockSyncAt: 0
};

const LIVE_CLOCK_SYNC_INTERVAL_MS = 5000;

let liveSync = {
  playerTimeouts: new Map(),
  opponentTimeout: null,
  liveFlagTimeout: null
};

function scheduleScoreSync() {
  if (!liveState.isLive || !currentTeamId || !currentGameId) return;
  if (liveState.scoreSyncTimeout) return;
  liveState.scoreSyncTimeout = setTimeout(async () => {
    liveState.scoreSyncTimeout = null;
    const homeScore = state.home;
    const awayScore = state.away;
    if (homeScore === liveState.lastSyncedHome && awayScore === liveState.lastSyncedAway) return;
    try {
      await updateGame(currentTeamId, currentGameId, { homeScore, awayScore });
      liveState.lastSyncedHome = homeScore;
      liveState.lastSyncedAway = awayScore;
    } catch (error) {
      console.warn('Failed to sync live scores:', error);
    }
  }, 500);
}

function scheduleLiveHasData() {
  if (!currentTeamId || !currentGameId) return;
  if (currentGame?.liveHasData) return;
  if (liveSync.liveFlagTimeout) return;
  liveSync.liveFlagTimeout = setTimeout(async () => {
    liveSync.liveFlagTimeout = null;
    try {
      await updateGame(currentTeamId, currentGameId, { liveHasData: true });
      if (currentGame) currentGame.liveHasData = true;
    } catch (error) {
      console.warn('Failed to mark live data flag:', error);
    }
  }, 500);
}

function schedulePlayerStatsSync(playerId) {
  if (!currentTeamId || !currentGameId) return;
  if (!playerId) return;
  if (liveSync.playerTimeouts.has(playerId)) return;
  const timeout = setTimeout(async () => {
    liveSync.playerTimeouts.delete(playerId);
    try {
      const player = roster.find(r => r.id === playerId);
      const statsObj = {};
      (currentConfig?.columns || []).forEach(col => {
        const key = col.toLowerCase();
        statsObj[key] = state.stats[playerId]?.[key] || 0;
      });
      statsObj.fouls = state.stats[playerId]?.fouls || 0;
      const statsRef = doc(db, `teams/${currentTeamId}/games/${currentGameId}/aggregatedStats`, playerId);
      await setDoc(statsRef, {
        playerName: player?.name || '',
        playerNumber: player?.num || '',
        stats: statsObj,
        timeMs: state.stats[playerId]?.time || 0
      }, { merge: true });
    } catch (error) {
      console.warn('Failed to sync player stats:', error);
    }
  }, 500);
  liveSync.playerTimeouts.set(playerId, timeout);
}

function buildOpponentStatsSnapshot() {
  const opponentStats = {};
  state.opp.forEach(opp => {
    opponentStats[opp.id] = {
      name: opp.name || '',
      number: opp.number || '',
      playerId: opp.playerId || null,
      photoUrl: opp.photoUrl || ''
    };
    (currentConfig?.columns || []).forEach(col => {
      const key = col.toLowerCase();
      opponentStats[opp.id][key] = opp.stats?.[key] || 0;
    });
    opponentStats[opp.id].fouls = opp.stats?.fouls || 0;
  });
  return opponentStats;
}

function scheduleOpponentStatsSync() {
  if (!currentTeamId || !currentGameId) return;
  if (liveSync.opponentTimeout) return;
  liveSync.opponentTimeout = setTimeout(async () => {
    liveSync.opponentTimeout = null;
    try {
      const opponentStats = buildOpponentStatsSnapshot();
      await updateGame(currentTeamId, currentGameId, { opponentStats });
    } catch (error) {
      console.warn('Failed to sync opponent stats:', error);
    }
  }, 500);
}

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
  oppTeamSection: q('#opp-team-section'),
  oppTeamSearch: q('#opp-team-search'),
  oppTeamResults: q('#opp-team-results'),
  oppTeamLinked: q('#opp-team-linked'),
  oppTeamName: q('#opp-team-name'),
  oppTeamPhoto: q('#opp-team-photo'),
  oppTeamClear: q('#opp-team-clear'),
  oppRosterSection: q('#opp-roster-section'),
  oppRosterList: q('#opp-roster-list'),
  oppRosterAddSelected: q('#opp-roster-add-selected'),
  oppInput: q('#opp-input-mobile'),
  oppAdd: q('#opp-add-mobile'),
  oppCards: q('#opp-cards-mobile'),
  voiceNoteBtn: q('#voice-note-btn'),
  voiceNoteHint: q('#voice-note-hint'),
  liveNoteInput: q('#live-note-input'),
  liveNoteAdd: q('#live-note-add'),
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
  clearLineup: q('#clear-lineup-mobile'),
  chatToggle: q('#chat-toggle'),
  chatContent: q('#chat-content'),
  chatMessages: q('#chat-messages'),
  chatForm: q('#chat-form'),
  chatInput: q('#chat-input'),
  chatUnreadBadge: q('#chat-unread-badge'),
  chatViewerCount: q('#chat-viewer-count'),
  chatChevron: q('#chat-chevron'),
  viewerCount: q('#viewer-count')
};

function q(sel) { return document.querySelector(sel); }

async function safeGetDocs(ref, label = 'collection') {
  try {
    return await getDocs(ref);
  } catch (error) {
    console.warn(`Failed to read ${label}:`, error);
    return {
      docs: [],
      size: 0,
      forEach() {}
    };
  }
}

function setTab(tab) {
  if (tab !== 'live') {
    stopActiveVoiceRecognition();
  }
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
  updateClockUI();
}

function updateClockUI() {
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

  // Foul pill with warning colors
  const fouls = s.fouls || 0;
  const foulBgClass = fouls >= 5 ? 'bg-red-600 text-white' : fouls >= 4 ? 'bg-amber-500 text-white' : 'bg-sand';
  const foulWarning = fouls >= 5 ? ' ⚠️' : fouls >= 4 ? ' ⚠️' : '';
  const foulPill = `<div class="${foulBgClass} rounded-lg py-1">FLS <span class="font-display text-sm">${fouls}${foulWarning}</span></div>`;

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
        <div class="text-[10px] text-slate-500" data-player-time="${id}">${formatClock(s.time)}</div>
      </div>
      <div class="grid grid-cols-3 gap-1 text-[10px] text-center">
        ${row1Pills}
      </div>
      <div class="grid grid-cols-3 gap-1 text-[10px] text-center">
        ${row2Pills}
      </div>
      <div class="grid grid-cols-3 gap-1 text-[10px] text-center">
        ${foulPill}
      </div>
      <div class="grid grid-cols-3 gap-1 text-[11px] font-semibold">
        ${btnHtml} ${statBtn(id, 'fouls', 1, 'FLS')}
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

    // Add fouls to quick stats display
    const fouls = s.fouls || 0;
    const foulBgClass = fouls >= 5 ? 'bg-red-600 text-white' : fouls >= 4 ? 'bg-amber-500 text-white' : '';
    const foulWarning = fouls >= 5 ? ' ⚠️' : fouls >= 4 ? ' ⚠️' : '';
    const foulDisplay = foulBgClass ? `<span class="${foulBgClass} px-1 rounded">FLS ${fouls}${foulWarning}</span>` : `FLS ${fouls}`;
    const quickLineWithFouls = quickLine ? `${quickLine} · ${foulDisplay}` : foulDisplay;

    const oppBtns = cols.map(col => {
      const key = col.toLowerCase();
      if (isPointsColumn(col)) {
        return `${oppBtn(o.id, key, 2, '+2')} ${oppBtn(o.id, key, 3, '+3')} ${oppBtn(o.id, key, 1, '+1')}`;
      }
      return oppBtn(o.id, key, 1, col);
    }).join(' ');

    return `
      <div class="border border-slate/10 rounded-xl p-2 bg-white space-y-1">
        <div class="flex items-center gap-2 min-w-0">
          ${avatarHtml({ name: o.name, photoUrl: o.photoUrl }, 'h-6 w-6', 'text-[10px]')}
          <span class="text-[10px] font-bold text-slate-500 shrink-0">${o.number ? `#${escapeHtml(o.number)}` : '#--'}</span>
          <input data-opp-edit="${o.id}" value="${o.name}" class="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-slate/10 font-semibold">
        </div>
        <div class="text-[11px] text-slate-500">${quickLineWithFouls || 'No stats yet'}</div>
        <div class="grid grid-cols-3 gap-1 text-[11px] font-semibold">
          ${oppBtns} ${oppBtn(o.id, 'fouls', 1, 'FLS')} <button data-opp-del="${o.id}" class="text-[11px] text-red-600">Remove</button>
        </div>
      </div>
    `;
  }).join('') || '<div class="text-xs text-slate-500 text-center py-4">Add opponent players</div>';

  els.oppCards.querySelectorAll('[data-opp-edit]').forEach(inp => {
    inp.addEventListener('change', () => {
      const target = state.opp.find(o => o.id === inp.dataset.oppEdit);
      if (target) target.name = inp.value.trim() || target.name;
      scheduleOpponentStatsSync();
      scheduleLiveHasData();
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
  updateOpponentLinkVisibility();
}

function updateSubtitle() {
  const subtitle = document.getElementById('game-subtitle');
  if (subtitle) {
    subtitle.textContent = `${currentTeam?.name || 'Team'} vs. ${currentGame?.opponent || 'Opponent'}`;
  }
}

function updateOpponentLinkVisibility() {
  if (!els.oppTeamSection) return;
  const hasOppPlayers = state.opp.some(o => {
    const hasName = (o.name || '').trim().length > 0;
    const hasNumber = (o.number || '').trim().length > 0;
    const hasStats = o.stats && Object.values(o.stats).some(val => val > 0);
    return hasName || hasNumber || hasStats;
  });
  const isLinked = !!currentGame?.opponentTeamId;
  const shouldHide = isLinked && hasOppPlayers;
  els.oppTeamSection.classList.toggle('hidden', shouldHide);
}

async function ensureTeamsCache() {
  if (allTeamsCache) return;
  const teams = await getTeams();
  allTeamsCache = (teams || []).filter(team => team.id !== currentTeamId);
}

function renderOpponentTeamResults(matches) {
  if (!els.oppTeamResults) return;
  if (!matches.length) {
    els.oppTeamResults.innerHTML = `<div class="px-3 py-2 text-slate-500">No teams found. Keep typing.</div>`;
  } else {
    els.oppTeamResults.innerHTML = matches.map(team => `
      <button class="w-full text-left px-3 py-2 hover:bg-sand/60 flex items-center gap-2" data-opp-team="${team.id}">
        ${team.photoUrl ? `<img src="${escapeHtml(team.photoUrl)}" class="w-6 h-6 rounded-full object-cover" alt="">`
          : `<div class="w-6 h-6 rounded-full bg-slate/10 text-slate-600 text-[10px] flex items-center justify-center font-semibold">${escapeHtml((team.name || '?')[0])}</div>`}
        <div>
          <div class="font-semibold text-slate-700">${escapeHtml(team.name || 'Unnamed Team')}</div>
          <div class="text-[10px] text-slate-500">${escapeHtml(team.sport || 'Sport not set')}</div>
        </div>
      </button>
    `).join('');
  }
  els.oppTeamResults.classList.remove('hidden');
  els.oppTeamResults.querySelectorAll('[data-opp-team]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const team = matches.find(t => t.id === btn.dataset.oppTeam);
      if (team) {
        await setLinkedOpponentTeam(team);
        els.oppTeamResults.classList.add('hidden');
      }
    });
  });
}

async function setLinkedOpponentTeam(team) {
  opponentTeam = team || null;
  if (!currentGame) return;
  if (opponentTeam) {
    currentGame.opponent = opponentTeam.name || currentGame.opponent;
    currentGame.opponentTeamId = opponentTeam.id;
    currentGame.opponentTeamName = opponentTeam.name || currentGame.opponent;
    currentGame.opponentTeamPhoto = opponentTeam.photoUrl || null;
    updateSubtitle();
    if (els.oppTeamName) els.oppTeamName.textContent = opponentTeam.name || 'Opponent';
    if (els.oppTeamPhoto) {
      if (opponentTeam.photoUrl) {
        els.oppTeamPhoto.src = opponentTeam.photoUrl;
        els.oppTeamPhoto.classList.remove('hidden');
      } else {
        els.oppTeamPhoto.classList.add('hidden');
      }
    }
    if (els.oppTeamLinked) els.oppTeamLinked.classList.remove('hidden');
    await updateGame(currentTeamId, currentGameId, {
      opponent: currentGame.opponent || 'Opponent',
      opponentTeamId: opponentTeam.id,
      opponentTeamName: opponentTeam.name || currentGame.opponent,
      opponentTeamPhoto: opponentTeam.photoUrl || null
    });
    await loadOpponentRoster(opponentTeam.id);
  } else {
    if (els.oppTeamLinked) els.oppTeamLinked.classList.add('hidden');
    if (els.oppTeamPhoto) els.oppTeamPhoto.classList.add('hidden');
    opponentRoster = [];
    opponentRosterSelected = new Set();
    renderOpponentRoster();
    await updateGame(currentTeamId, currentGameId, {
      opponentTeamId: null,
      opponentTeamName: null,
      opponentTeamPhoto: null
    });
  }
}

function clearLinkedOpponentTeam() {
  opponentTeam = null;
  if (els.oppTeamName) els.oppTeamName.textContent = '';
  if (els.oppTeamPhoto) els.oppTeamPhoto.classList.add('hidden');
  if (els.oppTeamLinked) els.oppTeamLinked.classList.add('hidden');
}

async function loadOpponentRoster(teamId) {
  try {
    const oppPlayers = await getPlayers(teamId);
    opponentRoster = oppPlayers.map(p => ({
      id: p.id,
      name: p.name || '',
      number: p.number || p.num || '',
      photoUrl: p.photoUrl || p.photo || ''
    }));
    opponentRosterSelected = new Set(opponentRoster.map(p => p.id));
    const canAutoPopulate = state.opp.every(o => {
      const hasName = (o.name || '').trim().length > 0;
      const hasNumber = (o.number || '').trim().length > 0;
      const hasStats = o.stats && Object.values(o.stats).some(val => val > 0);
      return !hasName && !hasNumber && !hasStats;
    });
    if (canAutoPopulate) {
      state.opp = opponentRoster.map(player => ({
        id: player.id,
        playerId: player.id,
        name: player.name || '',
        number: player.number || '',
        photoUrl: player.photoUrl || '',
        stats: statDefaults(currentConfig.columns)
      }));
      renderOpponents();
    }
    renderOpponentRoster();
  } catch (e) {
    console.warn('Failed to load opponent roster:', e);
    opponentRoster = [];
    opponentRosterSelected = new Set();
    renderOpponentRoster();
  }
}

function renderOpponentRoster() {
  if (!els.oppRosterSection || !els.oppRosterList) return;
  const hasOppPlayers = state.opp.some(o => {
    const hasName = (o.name || '').trim().length > 0;
    const hasNumber = (o.number || '').trim().length > 0;
    const hasStats = o.stats && Object.values(o.stats).some(val => val > 0);
    return hasName || hasNumber || hasStats;
  });
  if (!opponentTeam || opponentRoster.length === 0 || hasOppPlayers) {
    els.oppRosterSection.classList.add('hidden');
    els.oppRosterList.innerHTML = '';
    return;
  }
  els.oppRosterSection.classList.remove('hidden');
  els.oppRosterList.innerHTML = opponentRoster.map(player => `
    <label class="flex items-center gap-2 border border-slate/10 rounded-lg px-2 py-1 bg-sand/40">
      <input type="checkbox" class="rounded text-red-600" data-opp-roster="${player.id}" ${opponentRosterSelected.has(player.id) ? 'checked' : ''}>
      ${avatarHtml(player, 'h-5 w-5', 'text-[9px]')}
      <span class="text-[10px] font-semibold text-slate-500">${player.number ? `#${escapeHtml(player.number)}` : '#--'}</span>
      <span class="text-[10px] text-slate-700 truncate">${escapeHtml(player.name || 'Player')}</span>
    </label>
  `).join('');

  els.oppRosterList.querySelectorAll('[data-opp-roster]').forEach(input => {
    input.addEventListener('change', () => {
      const id = input.dataset.oppRoster;
      if (input.checked) {
        opponentRosterSelected.add(id);
      } else {
        opponentRosterSelected.delete(id);
      }
    });
  });
}

function addSelectedOpponentRoster() {
  if (!opponentRoster.length) return;
  const selectedIds = Array.from(opponentRosterSelected);
  if (!selectedIds.length) return;
  selectedIds.forEach(id => {
    const player = opponentRoster.find(p => p.id === id);
    if (!player) return;
    const existing = state.opp.find(o => o.id === player.id);
    if (existing) {
      existing.name = existing.name || player.name;
      existing.number = existing.number || player.number;
      existing.photoUrl = existing.photoUrl || player.photoUrl;
      existing.playerId = existing.playerId || player.id;
      return;
    }
    state.opp.push({
      id: player.id,
      playerId: player.id,
      name: player.name || '',
      number: player.number || '',
      photoUrl: player.photoUrl || '',
      stats: statDefaults(currentConfig.columns)
    });
  });
  renderOpponents();
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
  els.log.innerHTML = state.log.slice(0, 40).map((ev, idx) => `
    <div class="flex justify-between items-center border rounded-lg p-2 ${ev.undoData?.isOpponent ? 'border-red-200 bg-red-50/40' : 'border-slate/10 bg-white'}">
      <div class="flex-1">
        <p class="text-xs font-semibold ${ev.undoData?.isOpponent ? 'text-red-700' : 'text-slate-800'}">${ev.text}</p>
        <p class="text-[10px] text-slate-500">${ev.period} · ${ev.clock}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] text-slate-400">${new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <button class="w-5 h-5 flex items-center justify-center rounded-full hover:bg-slate/10 text-slate-400 hover:text-slate-700 transition text-sm" data-remove-log="${idx}" title="Remove event">✕</button>
      </div>
    </div>
  `).join('') || '<div class="text-xs text-slate-500 text-center py-4">No events yet</div>';

  // Add event listeners for remove buttons
  els.log.querySelectorAll('button[data-remove-log]').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.removeLog);
      if (!isNaN(index)) {
        const logEntry = state.log[index];

        // Reverse the stat change if undoData exists
        let scoreChanged = false;
        if (logEntry && logEntry.undoData) {
          const { type, playerId, statKey, value, isOpponent } = logEntry.undoData;

          if (type === 'stat') {
            if (isOpponent) {
              // Reverse opponent stat
              const opp = state.opp.find(o => o.id === playerId);
              if (opp && opp.stats && opp.stats[statKey] !== undefined) {
                opp.stats[statKey] = safeDecrement(opp.stats[statKey], value);
                if (isPointsColumn(statKey)) {
                  state.away = safeDecrement(state.away, value);
                  scoreChanged = true;
                }
              }
            } else {
              // Reverse team player stat
              if (state.stats[playerId] && state.stats[playerId][statKey] !== undefined) {
                state.stats[playerId][statKey] = safeDecrement(state.stats[playerId][statKey], value);
                if (isPointsColumn(statKey)) {
                  state.home = safeDecrement(state.home, value);
                  scoreChanged = true;
                }
              }
            }
          }
        }

        // Remove the log entry
        state.log.splice(index, 1);

        // Re-render everything to reflect the changes
        renderAll();
        if (scoreChanged) scheduleScoreSync();
        if (logEntry?.undoData?.type === 'stat') {
          if (logEntry.undoData.isOpponent) {
            scheduleOpponentStatsSync();
          } else {
            schedulePlayerStatsSync(logEntry.undoData.playerId);
          }
          scheduleLiveHasData();
        }

        if (liveState.isLive) {
          const removeText = logEntry?.text ? `Removed: ${logEntry.text}` : 'Removed event';
          broadcastEvent(baseLiveEvent({
            type: 'log_remove',
            description: removeText
          }));
          if (logEntry?.undoData?.type === 'stat') {
            broadcastEvent(buildStatEvent({
              ...logEntry.undoData,
              value: -(logEntry.undoData.value || 0)
            }, `REMOVE ${logEntry.text || 'stat'}`));
          }
        }
      }
    });
  });
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
  const lastLog = state.log[0];
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
  if (lastLog?.undoData?.type === 'stat' && isPointsColumn(lastLog.undoData.statKey)) {
    scheduleScoreSync();
  }

  if (liveState.isLive) {
    const undoText = lastLog?.text ? `Undo: ${lastLog.text}` : `Undo: ${prev.action}`;
    broadcastEvent(baseLiveEvent({
      type: 'undo',
      description: undoText
    }));

    if (lastLog?.undoData?.type === 'stat') {
      broadcastEvent(buildStatEvent({
        ...lastLog.undoData,
        value: -(lastLog.undoData.value || 0)
      }, `UNDO ${lastLog.text}`));
    }
  }
}

function renderAll() {
  renderHeader();
  renderLineup();
  renderLive();
  renderOpponents();
  renderLog();
  renderFairness();
}

function safeDecrement(currentValue, delta) {
  const base = Number(currentValue || 0);
  const change = Number(delta || 0);
  return Math.max(0, base - change);
}

function addLog(text, undoData = null) {
  state.log.unshift({ text, ts: Date.now(), period: state.period, clock: formatClock(state.clock), undoData });
  renderLog();
}

function setVoiceNoteButtonLabel(isListening) {
  if (!els.voiceNoteBtn) return;
  els.voiceNoteBtn.textContent = isListening ? 'Stop voice note' : 'Start voice note';
}

function setVoiceNoteHint(isListening) {
  if (!els.voiceNoteHint) return;
  els.voiceNoteHint.textContent = isListening
    ? 'Recording... tap Stop voice note when finished.'
    : 'Tap Start voice note, speak, then tap Stop voice note.';
}

function stopActiveVoiceRecognition() {
  if (state.activeVoiceRecognition && state.voiceListening) {
    try { state.activeVoiceRecognition.stop(); } catch (_) {}
  }
  state.voiceListening = false;
  state.activeVoiceRecognition = null;
  setVoiceNoteButtonLabel(false);
  setVoiceNoteHint(false);
}

function appendGameNote(text, type = 'text') {
  const clean = normalizeGameNoteText(text);
  if (!clean) return false;
  if (els.notesFinal) {
    els.notesFinal.value = appendGameSummaryLine(els.notesFinal.value, clean);
  }
  const logText = buildGameNoteLogText(clean, type);
  if (logText) {
    addLog(logText);
    if (liveState.isLive) {
      broadcastEvent(baseLiveEvent({
        type: 'note',
        description: logText,
        note: clean,
        noteType: type
      }));
    }
  }
  return true;
}

function addManualGameNote() {
  if (!els.liveNoteInput) return;
  const text = normalizeGameNoteText(els.liveNoteInput.value);
  if (!text) return;
  if (appendGameNote(text, 'text')) {
    els.liveNoteInput.value = '';
  }
}

function startVoiceNote() {
  if (!isVoiceRecognitionSupported(window)) {
    addLog('Voice notes not supported in this browser');
    return;
  }

  if (state.voiceListening && state.activeVoiceRecognition) {
    try {
      state.activeVoiceRecognition.stop();
    } catch (err) {
      console.warn('Voice stop failed:', err);
    }
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SR();
  state.activeVoiceRecognition = recognition;
  state.voiceListening = true;
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.continuous = false;

  setVoiceNoteButtonLabel(true);
  setVoiceNoteHint(true);

  recognition.onresult = (e) => {
    const transcript = e.results?.[0]?.[0]?.transcript || '';
    if (!appendGameNote(transcript, 'voice')) {
      addLog('No speech detected');
    }
  };
  recognition.onerror = (event) => {
    console.warn('Voice recognition error:', event);
    if (event?.error !== 'no-speech' && event?.error !== 'aborted') {
      addLog('Voice recognition failed');
    }
  };
  recognition.onend = () => {
    state.voiceListening = false;
    state.activeVoiceRecognition = null;
    setVoiceNoteButtonLabel(false);
    setVoiceNoteHint(false);
  };

  recognition.start();
}

async function broadcastEvent(eventData) {
  try {
    await broadcastLiveEvent(currentTeamId, currentGameId, eventData);
  } catch (error) {
    console.error('Broadcast failed (will retry):', error);
    liveState.eventQueue.push(eventData);
    scheduleRetry();
  }
}

function scheduleRetry() {
  if (liveState.retryTimeout) return;
  const delay = Math.min(1000 * Math.pow(2, liveState.retryAttempt), 30000);
  liveState.retryTimeout = setTimeout(async () => {
    liveState.retryTimeout = null;
    const queue = [...liveState.eventQueue];
    liveState.eventQueue = [];

    for (const event of queue) {
      try {
        await broadcastLiveEvent(currentTeamId, currentGameId, event);
        liveState.retryAttempt = 0;
      } catch {
        liveState.eventQueue.push(event);
      }
    }

    if (liveState.eventQueue.length > 0) {
      liveState.retryAttempt += 1;
      scheduleRetry();
    }
  }, delay);
}

function baseLiveEvent(extra = {}) {
  return {
    period: state.period,
    gameClockMs: state.clock,
    homeScore: state.home,
    awayScore: state.away,
    createdBy: currentUser?.uid || null,
    ...extra
  };
}

function lineupSnapshot() {
  return {
    onCourt: [...state.onCourt],
    bench: [...state.bench]
  };
}

function broadcastLineupUpdate(description = 'Lineup updated') {
  if (liveState.isLive) {
    broadcastEvent(baseLiveEvent({
      type: 'lineup',
      description,
      ...lineupSnapshot()
    }));
  }
  updateGame(currentTeamId, currentGameId, { liveLineup: lineupSnapshot() })
    .catch(err => console.warn('Failed to sync live lineup:', err));
}

function buildStatEvent(undoData, description) {
  const playerId = undoData?.playerId || null;
  const isOpponent = !!undoData?.isOpponent;
  const player = !isOpponent ? roster.find(r => r.id === playerId) : null;
  const opponent = isOpponent ? state.opp.find(o => o.id === playerId) : null;

  return baseLiveEvent({
    type: 'stat',
    playerId,
    playerName: player?.name || null,
    playerNumber: player?.num || '',
    statKey: undoData?.statKey || null,
    value: undoData?.value || 0,
    isOpponent,
    opponentPlayerName: opponent?.name || null,
    opponentPlayerNumber: opponent?.number || '',
    opponentPlayerPhoto: opponent?.photoUrl || '',
    description
  });
}

function initChat() {
  if (!els.chatMessages || !els.chatForm) return;
  if (liveState.unsubscribeChat) liveState.unsubscribeChat();

  liveState.unsubscribeChat = subscribeLiveChat(currentTeamId, currentGameId, { limit: 100 }, (messages) => {
    renderChatMessages(messages);
  }, (error) => {
    console.warn('Live chat subscription failed:', error);
  });
}

function renderChatMessages(messages) {
  liveState.chatMessages = messages;
  const container = els.chatMessages;
  if (!container) return;

  container.innerHTML = messages.slice().reverse().map(msg => `
    <div class="${msg.senderId === currentUser?.uid ? 'text-right' : ''}">
      <div class="text-[11px] text-teal/80">${escapeHtml(msg.senderName || 'Fan')}</div>
      <div class="text-sm text-sand">${escapeHtml(msg.text || '')}</div>
    </div>
  `).join('');

  container.scrollTop = container.scrollHeight;
  updateUnread(messages);
}

function updateUnread(messages) {
  if (!messages || !messages.length) return;
  if (!liveState.chatInitialized) {
    liveState.chatInitialized = true;
    liveState.lastChatSeenAt = Date.now();
    liveState.unreadChatCount = 0;
    updateUnreadBadge();
    return;
  }

  if (liveState.chatExpanded) {
    liveState.lastChatSeenAt = Date.now();
    liveState.unreadChatCount = 0;
    updateUnreadBadge();
    return;
  }

  let newlyUnread = 0;
  messages.forEach(msg => {
    const ts = msg.createdAt?.toMillis ? msg.createdAt.toMillis() : null;
    if (!ts || ts > liveState.lastChatSeenAt) newlyUnread += 1;
  });

  if (newlyUnread > 0) {
    liveState.unreadChatCount += newlyUnread;
    updateUnreadBadge();
  }
}

async function sendChatMessage(text) {
  if (!text.trim()) return;
  if (Date.now() - liveState.lastChatSentAt < 1500) {
    if (els.chatInput) {
      const original = els.chatInput.placeholder;
      els.chatInput.placeholder = 'Slow down...';
      setTimeout(() => { els.chatInput.placeholder = original; }, 1200);
    }
    return;
  }
  liveState.lastChatSentAt = Date.now();
  try {
    await postLiveChatMessage(currentTeamId, currentGameId, {
      text: text.trim(),
      senderId: currentUser?.uid || null,
      senderName: currentUser?.displayName || currentUser?.email || 'Stat Keeper',
      senderPhotoUrl: currentUser?.photoURL || null,
      isAnonymous: false
    });
  } catch (error) {
    console.warn('Chat send failed:', error);
  }
}

function toggleChat() {
  liveState.chatExpanded = !liveState.chatExpanded;
  if (els.chatContent) {
    els.chatContent.classList.toggle('hidden', !liveState.chatExpanded);
  }
  if (els.chatChevron) {
    els.chatChevron.classList.toggle('rotate-180', liveState.chatExpanded);
  }
  if (liveState.chatExpanded) {
    liveState.lastChatSeenAt = Date.now();
    liveState.unreadChatCount = 0;
    updateUnreadBadge();
  }
}

function updateUnreadBadge() {
  if (!els.chatUnreadBadge) return;
  if (liveState.unreadChatCount > 0 && !liveState.chatExpanded) {
    els.chatUnreadBadge.textContent = liveState.unreadChatCount > 99 ? '99+' : `${liveState.unreadChatCount}`;
    els.chatUnreadBadge.classList.remove('hidden');
  } else {
    els.chatUnreadBadge.classList.add('hidden');
  }
}

function initViewerCount() {
  if (liveState.unsubscribeViewers) liveState.unsubscribeViewers();
  const gameRef = doc(db, 'teams', currentTeamId, 'games', currentGameId);

  liveState.unsubscribeViewers = onSnapshot(gameRef, (snapshot) => {
    const data = snapshot.data();
    const count = data?.liveViewerCount ?? liveState.viewerCount ?? 0;
    liveState.viewerCount = count;
    if (els.viewerCount) els.viewerCount.textContent = `${count} watching`;
    if (els.chatViewerCount) els.chatViewerCount.textContent = `${count} watching`;
  }, (error) => {
    console.warn('Viewer count subscription failed:', error);
  });
}

async function startLiveBroadcast() {
  if (liveState.isLive) return;
  liveState.isLive = true;
  liveState.lastClockSyncAt = 0;
  try {
    await setGameLiveStatus(currentTeamId, currentGameId, 'live');
  } catch (error) {
    console.warn('Failed to set live status:', error);
  }
  scheduleScoreSync();
  initChat();
  initViewerCount();
  broadcastLineupUpdate('Lineup set');
}

async function endLiveBroadcast() {
  try {
    await setGameLiveStatus(currentTeamId, currentGameId, 'completed');
  } catch (error) {
    console.warn('Failed to set completed status:', error);
  }

  if (liveState.isLive) {
    liveState.isLive = false;
    liveState.lastClockSyncAt = 0;
    if (liveState.unsubscribeChat) liveState.unsubscribeChat();
    if (liveState.unsubscribeViewers) liveState.unsubscribeViewers();
  }
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
      // Always include fouls
      const fouls = state.stats[player.id]?.fouls || 0;
      stats.push(`FOULS:${fouls}`);
      context += stats.join(', ') + `\n`;
    });

    context += `\nOPPONENT PLAYERS:\n`;
    state.opp.forEach(opp => {
      const hasAny = (currentConfig?.columns || []).some(col => (opp.stats?.[col.toLowerCase()] || 0) > 0);
      const hasFouls = (opp.stats?.fouls || 0) > 0;
      if (!opp.name && !hasAny && !hasFouls) return;
      context += `${opp.name || 'Opponent'}: `;
      const stats = [];
      (currentConfig?.columns || []).forEach(col => {
        const key = col.toLowerCase();
        const val = opp.stats?.[key] || 0;
        if (val > 0) stats.push(`${col}:${val}`);
      });
      // Always include fouls if present
      const fouls = opp.stats?.fouls || 0;
      if (fouls > 0) stats.push(`FOULS:${fouls}`);
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
    // Always include fouls
    const fouls = state.stats[player.id]?.fouls || 0;
    body += `  FOULS: ${fouls}\n`;
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
    // Always include fouls if present
    const fouls = opp.stats?.fouls || 0;
    if (fouls > 0) body += `  FOULS: ${fouls}\n`;
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
      // Always include fouls
      statsObj.fouls = state.stats[player.id]?.fouls || 0;
      const statsRef = doc(db, `teams/${currentTeamId}/games/${currentGameId}/aggregatedStats`, player.id);
      batch.set(statsRef, {
        playerName: player.name,
        playerNumber: player.num,
        stats: statsObj,
        timeMs: state.stats[player.id]?.time || 0
      });
    });

    // 3. Build opponentStats in same shape as track.html
    const opponentStats = buildOpponentStatsSnapshot();

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
    await endLiveBroadcast();
    isFinishing = true;

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
    addLog('Game paused');
    broadcastEvent(baseLiveEvent({
      type: 'clock_pause',
      description: 'Game paused'
    }));
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
        await updateGame(currentTeamId, currentGameId, { 
          homeScore: 0, 
          awayScore: 0, 
          opponentStats: {},
          // Preserve opponent fields
          opponent: currentGame.opponent,
          opponentTeamId: currentGame.opponentTeamId,
          opponentTeamName: currentGame.opponentTeamName,
          opponentTeamPhoto: currentGame.opponentTeamPhoto
        });
      }
    }

    state.running = true;
    await startLiveBroadcast();
    els.startStop.textContent = 'Pause';
    els.startStop.classList.remove('bg-emerald-600', 'border-emerald-700');
    els.startStop.classList.add('bg-red-600', 'border-red-700');
    addLog('Game started');
    broadcastEvent(baseLiveEvent({
      type: 'clock_start',
      description: 'Game started'
    }));
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
  updateClockUI();
  updatePlayerTimes();
  renderFairness();

  const wallNow = Date.now();
  if (
    liveState.isLive &&
    currentTeamId &&
    currentGameId &&
    (wallNow - liveState.lastClockSyncAt >= LIVE_CLOCK_SYNC_INTERVAL_MS)
  ) {
    liveState.lastClockSyncAt = wallNow;
    broadcastEvent(baseLiveEvent({
      type: 'clock_sync',
      description: 'Clock sync'
    }));
  }
}

function updatePlayerTimes() {
  if (!els.livePlayers) return;
  state.onCourt.forEach(id => {
    const timeEl = els.livePlayers.querySelector(`[data-player-time="${id}"]`);
    if (timeEl) {
      timeEl.textContent = formatClock(state.stats[id].time);
    }
  });
}

function setPeriod(p) {
  const previousPeriod = state.period;
  state.period = p;
  document.querySelectorAll('.period-btn').forEach(b => {
    // Remove active state from all buttons
    b.classList.remove('bg-teal', 'text-ink', 'border-teal', 'font-bold');
    b.classList.add('bg-white', 'border-slate/10', 'font-semibold');

    // Add active state to selected button
    if (b.dataset.period === p) {
      b.classList.remove('bg-white', 'border-slate/10', 'font-semibold');
      b.classList.add('bg-teal', 'text-ink', 'border-teal', 'font-bold');
    }
  });

  // Log period changes during live game
  if (state.running && previousPeriod !== p) {
    addLog(`Period changed: ${previousPeriod} → ${p}`);
    if (liveState.isLive) {
      broadcastEvent(baseLiveEvent({
        type: 'period_change',
        description: `Period changed: ${previousPeriod} → ${p}`
      }));
    }
  }

  renderHeader();
}

function addStat(id, key, delta) {
  // Prevent stat tracking before game starts
  if (!state.running && state.clock === 0) {
    alert('Please start the game timer before recording stats.');
    return;
  }
  const logText = `#${getNum(id)} ${key.toUpperCase()} +${delta}`;
  saveHistory(logText);
  state.stats[id][key] += delta;
  if (isPointsColumn(key)) {
    state.home += delta;
    scheduleScoreSync();
  }
  addLog(logText, {
    type: 'stat',
    playerId: id,
    statKey: key,
    value: delta,
    isOpponent: false
  });
  schedulePlayerStatsSync(id);
  scheduleLiveHasData();
  if (liveState.isLive) {
    broadcastEvent(buildStatEvent({
      playerId: id,
      statKey: key,
      value: delta,
      isOpponent: false
    }, logText));
  }
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
  const logText = `Opp ${opp.name} ${key.toUpperCase()} +${delta}`;
  saveHistory(logText);
  opp.stats[key] += delta;
  if (isPointsColumn(key)) {
    state.away += delta;
    scheduleScoreSync();
  }
  addLog(logText, {
    type: 'stat',
    playerId: id,
    statKey: key,
    value: delta,
    isOpponent: true
  });
  scheduleOpponentStatsSync();
  scheduleLiveHasData();
  if (liveState.isLive) {
    broadcastEvent(buildStatEvent({
      playerId: id,
      statKey: key,
      value: delta,
      isOpponent: true
    }, logText));
  }
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
    broadcastLineupUpdate('Lineup cleared');
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
    if (liveState.isLive) {
      broadcastEvent(baseLiveEvent({
        type: 'substitution',
        description: 'Full line swap',
        ...lineupSnapshot()
      }));
    }
    renderLineup();
    renderLive();
  });

  if (els.oppTeamSearch) {
    els.oppTeamSearch.addEventListener('input', async () => {
      const term = els.oppTeamSearch.value.trim();
      if (!term) {
        els.oppTeamResults?.classList.add('hidden');
        return;
      }
      await ensureTeamsCache();
      const matches = allTeamsCache
        .filter(team => (team.name || '').toLowerCase().includes(term.toLowerCase()))
        .slice(0, 6);
      renderOpponentTeamResults(matches);
    });
    els.oppTeamSearch.addEventListener('focus', () => {
      if (els.oppTeamResults?.innerHTML.trim()) {
        els.oppTeamResults.classList.remove('hidden');
      }
    });
    els.oppTeamSearch.addEventListener('blur', () => {
      setTimeout(() => els.oppTeamResults?.classList.add('hidden'), 150);
    });
  }

  els.oppTeamClear?.addEventListener('click', async () => {
    clearLinkedOpponentTeam();
    await setLinkedOpponentTeam(null);
  });

  els.oppRosterAddSelected?.addEventListener('click', () => {
    addSelectedOpponentRoster();
  });

  els.oppAdd.addEventListener('click', () => {
    const val = els.oppInput.value.trim();
    if (!val) return;
    let number = '';
    let name = val;
    const match = val.match(/^#?(\d+)\s*(.*)$/);
    if (match) {
      number = match[1] || '';
      name = match[2] ? match[2].trim() : '';
      if (!name) name = val;
    }
    const stats = statDefaults(currentConfig?.columns || []);
    state.opp.push({
      id: `o-${Date.now()}`,
      playerId: null,
      name,
      number,
      photoUrl: '',
      stats
    });
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
  if (els.voiceNoteBtn) {
    els.voiceNoteBtn.addEventListener('click', startVoiceNote);
  }
  if (els.liveNoteAdd) {
    els.liveNoteAdd.addEventListener('click', addManualGameNote);
  }
  if (els.liveNoteInput) {
    els.liveNoteInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addManualGameNote();
      }
    });
  }
  if (els.chatToggle) {
    els.chatToggle.addEventListener('click', toggleChat);
  }
  if (els.chatForm) {
    els.chatForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = els.chatInput?.value || '';
      if (!text.trim()) return;
      els.chatInput.value = '';
      await sendChatMessage(text);
    });
  }
  updateSubsButton();
  if (els.autoFill) {
    els.autoFill.addEventListener('click', autoFillStarters);
  }
}

function hasUnsavedActivity() {
  return !isFinishing && state.clock > 0;
}

function setupNavigationWarning() {
  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedActivity()) return;
    event.preventDefault();
    event.returnValue = '';
    return '';
  });

  try {
    history.replaceState({ trackingPage: true }, '', window.location.href);
    history.pushState({ trackingPage: true }, '', window.location.href);
  } catch {
    // ignore
  }

  window.addEventListener('popstate', () => {
    if (allowNavigation) {
      allowNavigation = false;
      return;
    }

    if (!hasUnsavedActivity()) return;

    const confirmLeave = confirm('Game in progress. Leaving now will lose unsaved changes. Leave this page?');
    if (!confirmLeave) {
      try {
        history.pushState({ trackingPage: true }, '', window.location.href);
      } catch {
        // ignore
      }
      return;
    }

    allowNavigation = true;
    history.back();
  });
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
  broadcastLineupUpdate();
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
  const logText = `Sub: #${getNum(outId)} ${playerName(outId)} → #${getNum(inId)} ${playerName(inId)}`;
  addLog(logText);
  if (liveState.isLive) {
    broadcastEvent(baseLiveEvent({
      type: 'substitution',
      description: logText,
      ...lineupSnapshot()
    }));
  }
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
      const logText = `Sub: #${getNum(pair.out)} ${playerName(pair.out)} → #${getNum(pair.in)} ${playerName(pair.in)}`;
      addLog(logText);
      if (liveState.isLive) {
        broadcastEvent(baseLiveEvent({
          type: 'substitution',
          description: logText,
          ...lineupSnapshot()
        }));
      }
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
  broadcastLineupUpdate();
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
    updateSubtitle();
    opponentTeam = null;
    if (els.oppTeamName) els.oppTeamName.textContent = '';
    if (els.oppTeamPhoto) els.oppTeamPhoto.classList.add('hidden');
    if (els.oppTeamLinked) els.oppTeamLinked.classList.add('hidden');
    updateOpponentLinkVisibility();

    if (game.opponentTeamId) {
      try {
        const linkedTeam = await getTeam(game.opponentTeamId);
        opponentTeam = linkedTeam || {
          id: game.opponentTeamId,
          name: game.opponentTeamName || game.opponent || 'Opponent',
          photoUrl: game.opponentTeamPhoto || ''
        };
        if (els.oppTeamName) els.oppTeamName.textContent = opponentTeam.name || 'Opponent';
        if (els.oppTeamPhoto) {
          if (opponentTeam.photoUrl) {
            els.oppTeamPhoto.src = opponentTeam.photoUrl;
            els.oppTeamPhoto.classList.remove('hidden');
          } else {
            els.oppTeamPhoto.classList.add('hidden');
          }
        }
        if (els.oppTeamLinked) els.oppTeamLinked.classList.remove('hidden');
        updateOpponentLinkVisibility();
      } catch (e) {
        console.warn('Failed to load linked opponent team:', e);
      }
    }

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
    state.voiceListening = false;
    state.activeVoiceRecognition = null;
    setVoiceNoteButtonLabel(false);
    setVoiceNoteHint(false);

    let shouldResume = true;
    const hasOpponentStats = !!(game.opponentStats && Object.keys(game.opponentStats).length > 0);

    try {
      const hasScores = (game.homeScore || 0) > 0 || (game.awayScore || 0) > 0;
      const hasLiveFlag = !!game.liveHasData || game.liveStatus === 'live';
      const shouldPromptResume = hasLiveFlag || hasScores || hasOpponentStats;

      if (shouldPromptResume) {
        shouldResume = confirm('This game already has tracked data. Continue where you left off?\n\nClick Cancel to start over and clear previous stats.');
      }

      if (!shouldResume) {
        const [eventsSnapshot, statsSnapshot, liveEventsSnapshot] = await Promise.all([
          safeGetDocs(collection(db, `teams/${teamId}/games/${gameId}/events`), 'events'),
          safeGetDocs(collection(db, `teams/${teamId}/games/${gameId}/aggregatedStats`), 'aggregatedStats'),
          safeGetDocs(collection(db, `teams/${teamId}/games/${gameId}/liveEvents`), 'liveEvents')
        ]);
        const deletions = [
          ...eventsSnapshot.docs.map(d => deleteDoc(d.ref)),
          ...statsSnapshot.docs.map(d => deleteDoc(d.ref)),
          ...liveEventsSnapshot.docs.map(d => deleteDoc(d.ref))
        ];
        const results = await Promise.allSettled(deletions);
        const failedDeletes = results.filter(r => r.status === 'rejected');
        if (failedDeletes.length) {
          console.warn('Some live data could not be deleted:', failedDeletes);
        }
        try {
          await updateGame(teamId, gameId, {
            homeScore: 0,
            awayScore: 0,
            opponentStats: {},
            liveStatus: 'scheduled',
            liveHasData: false,
            liveLineup: { onCourt: [], bench: roster.map(r => r.id) },
            // Preserve opponent fields
            opponent: game.opponent,
            opponentTeamId: game.opponentTeamId,
            opponentTeamName: game.opponentTeamName,
            opponentTeamPhoto: game.opponentTeamPhoto
          });
          currentGame.liveStatus = 'scheduled';
          currentGame.liveHasData = false;
        } catch (error) {
          console.warn('Failed to reset game metadata:', error);
        }
        state.home = 0;
        state.away = 0;
      }

      if (shouldResume) {
        const statsSnapshot = await safeGetDocs(collection(db, `teams/${teamId}/games/${gameId}/aggregatedStats`), 'aggregatedStats');
        const hasAggregatedStats = statsSnapshot.size > 0;
        let liveEvents = [];

        if (!hasAggregatedStats || !hasOpponentStats) {
          const liveEventsSnapshot = await safeGetDocs(collection(db, `teams/${teamId}/games/${gameId}/liveEvents`), 'liveEvents');
          liveEvents = liveEventsSnapshot.docs.map(d => d.data());
        }

        // Load existing aggregated stats
        statsSnapshot.forEach(d => {
          if (!state.stats[d.id]) state.stats[d.id] = statDefaults(currentConfig.columns);
          const existing = d.data().stats || {};
          Object.assign(state.stats[d.id], existing);
          if (typeof d.data().timeMs === 'number') {
            state.stats[d.id].time = d.data().timeMs;
          }
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

        if (!hasAggregatedStats && liveEvents.length) {
          liveEvents.forEach(ev => {
            if (ev.type !== 'stat' || ev.isOpponent) return;
            const playerId = ev.playerId;
            const key = (ev.statKey || '').toLowerCase();
            const value = Number(ev.value || 0);
            if (!playerId || !key) return;
            if (!state.stats[playerId]) state.stats[playerId] = statDefaults(currentConfig.columns);
            state.stats[playerId][key] = (state.stats[playerId][key] || 0) + value;
          });
          if (pointsCol) {
            const pointsKey = pointsCol.toLowerCase();
            state.home = roster.reduce((sum, r) => sum + (state.stats[r.id]?.[pointsKey] || 0), 0);
          }
        }

        if (!hasOpponentStats && liveEvents.length) {
          const oppMap = new Map();
          liveEvents.forEach(ev => {
            if (ev.type !== 'stat' || !ev.isOpponent) return;
            const playerId = ev.playerId || `opp-${oppMap.size + 1}`;
            if (!oppMap.has(playerId)) {
              oppMap.set(playerId, {
                id: playerId,
                playerId,
                name: ev.opponentPlayerName || '',
                number: ev.opponentPlayerNumber || '',
                photoUrl: ev.opponentPlayerPhoto || '',
                stats: statDefaults(currentConfig.columns)
              });
            }
            const opp = oppMap.get(playerId);
            const key = (ev.statKey || '').toLowerCase();
            const value = Number(ev.value || 0);
            if (key) opp.stats[key] = (opp.stats[key] || 0) + value;
          });
          if (oppMap.size) {
            state.opp = Array.from(oppMap.values());
            if (pointsCol) {
              const pointsKey = pointsCol.toLowerCase();
              state.away = state.opp.reduce((sum, o) => sum + (o.stats?.[pointsKey] || 0), 0);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Resume/reset flow failed:', error);
    }

    // Initialize opponents from game or fresh
    if (shouldResume && hasOpponentStats) {
      state.opp = Object.entries(game.opponentStats).map(([id, data]) => {
        const stats = statDefaults(currentConfig.columns);
        (currentConfig.columns || []).forEach(col => {
          const key = col.toLowerCase();
          if (data[key] !== undefined) stats[key] = data[key];
        });
        return {
          id,
          playerId: data.playerId || null,
          name: data.name || '',
          number: data.number || '',
          photoUrl: data.photoUrl || '',
          stats
        };
      });
    }

    if (!state.opp.length) {
      state.opp = [1, 2, 3].map(i => ({
        id: `opp${i}`,
        name: '',
        number: '',
        photoUrl: '',
        playerId: null,
        stats: statDefaults(currentConfig.columns)
      }));
    }

    if (opponentTeam?.id) {
      await loadOpponentRoster(opponentTeam.id);
    }

    updateSubtitle();

    setTab('live');
    setPeriod('Q1');
    renderAll();
    renderQueue();
    attachEvents();
    updateSubsButton();
    initChat();
    updateGame(currentTeamId, currentGameId, { liveLineup: lineupSnapshot() })
      .catch(err => console.warn('Failed to sync initial lineup:', err));
    if (currentGame.liveStatus === 'live') {
      await startLiveBroadcast();
    }
    setupNavigationWarning();
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
