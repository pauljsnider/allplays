import {
  getTeam,
  getGame,
  getPlayers,
  subscribeLiveEvents,
  subscribeLiveChat,
  postLiveChatMessage,
  subscribeReactions,
  sendReaction,
  trackViewerPresence,
  getLiveEvents,
  getLiveChatHistory,
  getLiveReactions
} from './db.js';
import { getUrlParams, escapeHtml, renderHeader, renderFooter } from './utils.js?v=8';
import { checkAuth } from './auth.js';

const state = {
  teamId: null,
  gameId: null,
  team: null,
  game: null,
  players: [],
  user: null,
  anonName: null,

  isLive: false,
  isReplay: false,
  events: [],
  eventIds: new Set(),
  stats: {},
  opponentStats: {},
  onCourt: [],
  bench: [],
  homeScore: 0,
  awayScore: 0,
  period: 'Q1',
  gameClockMs: 0,

  chatMessages: [],
  unreadChatCount: 0,
  lastChatSeenAt: Date.now(),
  lastChatSentAt: 0,

  viewerCount: 0,

  replayEvents: [],
  replayChat: [],
  replayReactions: [],
  replayIndex: 0,
  replayChatIndex: 0,
  replayReactionIndex: 0,
  replaySpeed: 1,
  replayPlaying: false,
  replayStartTime: null,
  replayStartAt: null,

  activeTab: 'plays',
  unsubscribers: [],

  lastStatChange: null,
  scoringRun: { team: null, points: 0 },
  lastRunAnnounced: 0
};

const els = {
  homeTeamName: q('#home-team-name'),
  awayTeamName: q('#away-team-name'),
  homeScore: q('#home-score'),
  awayScore: q('#away-score'),
  period: q('#period'),
  clock: q('#clock'),
  liveBadge: q('#live-badge'),
  viewerCount: q('#viewer-count'),
  connectionBanner: q('#connection-banner'),

  playsFeed: q('#plays-feed'),
  statsList: q('#stats-list'),
  opponentStats: q('#opponent-stats'),
  lineupOnCourt: q('#lineup-oncourt'),
  lineupBench: q('#lineup-bench'),

  chatPanel: q('#chat-panel'),
  chatMessages: q('#chat-messages'),
  chatForm: q('#chat-form'),
  chatInput: q('#chat-input'),
  chatBadge: q('#chat-badge'),
  chatAnonNotice: q('#chat-anon-notice'),
  anonName: q('#anon-name'),
  anonChange: q('#anon-change-btn'),
  mentionMenu: q('#mention-menu'),
  mentionAllPlays: q('#mention-allplays'),
  aiThinking: q('#ai-thinking'),

  reactionsBar: q('#reactions-bar'),
  reactionsOverlay: q('#reactions-overlay'),

  replayControls: q('#replay-controls'),
  replayProgress: q('#replay-progress'),
  replayCurrent: q('#replay-current'),
  replayDuration: q('#replay-duration'),
  replayPlay: q('#replay-play'),

  notLiveOverlay: q('#not-live-overlay'),
  endedOverlay: q('#ended-overlay'),
  watchReplayBtn: q('#watch-replay-btn'),
  finalScore: q('#final-score'),
  gameStartTime: q('#game-start-time'),

  mobileTabs: document.querySelectorAll('#mobile-tabs [data-tab]'),
  playsPanel: q('#plays-panel'),
  statsPanel: q('#stats-panel'),
  chatPanelMobile: q('#chat-panel')
};

const mentionState = { active: false, atPos: null };

function q(selector) {
  return document.querySelector(selector);
}

function initTabs() {
  els.mobileTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      state.activeTab = tab.dataset.tab;
      updateTabs();
    });
  });
  window.addEventListener('resize', updateTabs);
  updateTabs();
}

function updateTabs() {
  const isMobile = window.matchMedia('(max-width: 767px)').matches;

  if (!isMobile) {
    els.playsPanel?.classList.remove('hidden');
    els.statsPanel?.classList.remove('hidden');
    els.chatPanel?.classList.remove('hidden');
    return;
  }

  els.mobileTabs.forEach(tab => {
    const active = tab.dataset.tab === state.activeTab;
    tab.classList.toggle('text-teal', active);
    tab.classList.toggle('border-teal', active);
    tab.classList.toggle('text-sand/50', !active);
    tab.classList.toggle('border-transparent', !active);
  });

  if (state.activeTab === 'plays') {
    els.playsPanel?.classList.remove('hidden');
    els.statsPanel?.classList.add('hidden');
    els.chatPanel?.classList.add('hidden');
  } else if (state.activeTab === 'stats') {
    els.playsPanel?.classList.add('hidden');
    els.statsPanel?.classList.remove('hidden');
    els.chatPanel?.classList.add('hidden');
  } else {
    els.playsPanel?.classList.add('hidden');
    els.statsPanel?.classList.add('hidden');
    els.chatPanel?.classList.remove('hidden');
  }
}

function renderGameInfo() {
  els.homeTeamName.textContent = state.team?.name || 'Home Team';
  els.awayTeamName.textContent = state.game?.opponent || 'Away Team';
  if (state.game?.date) {
    const date = state.game.date.toDate ? state.game.date.toDate() : new Date(state.game.date);
    els.gameStartTime.textContent = `Scheduled: ${date.toLocaleString()}`;
  }
}

function renderScoreboard(animate = false) {
  if (els.homeScore) els.homeScore.textContent = state.homeScore;
  if (els.awayScore) els.awayScore.textContent = state.awayScore;
  if (els.period) els.period.textContent = state.period;
  if (els.clock) els.clock.textContent = formatClock(state.gameClockMs);

  if (animate) {
    els.homeScore?.classList.add('score-pulse');
    els.awayScore?.classList.add('score-pulse');
    setTimeout(() => {
      els.homeScore?.classList.remove('score-pulse');
      els.awayScore?.classList.remove('score-pulse');
    }, 400);
  }
}

function renderPlayByPlay(event, isNew = false) {
  if (!els.playsFeed) return;
  const keepAtTop = els.playsFeed.scrollTop < 10;
  const card = document.createElement('div');
  card.className = `bg-slate/50 rounded-lg p-3 border-l-4 ${getEventBorderColor(event)} ${isNew ? 'event-slide' : ''}`;
  const opponentLabel = [
    event.opponentPlayerNumber ? `#${escapeHtml(event.opponentPlayerNumber)}` : '',
    event.opponentPlayerName ? escapeHtml(event.opponentPlayerName) : ''
  ].filter(Boolean).join(' ');
  card.innerHTML = `
    <div class="flex justify-between items-start">
      <div>
        <span class="text-teal text-xs">${escapeHtml(event.period || state.period)} · ${formatClock(event.gameClockMs || 0)}</span>
        <p class="text-sand font-medium">${escapeHtml(event.description || '')}</p>
        ${event.playerName ? `<p class="text-sand/60 text-sm">#${escapeHtml(event.playerNumber || '')} ${escapeHtml(event.playerName)}</p>` : ''}
        ${event.isOpponent && (event.opponentPlayerName || event.opponentPlayerNumber) ? `<p class="text-sand/60 text-sm">${opponentLabel}</p>` : ''}
      </div>
      ${event.statKey === 'pts' && event.value ? `
        <span class="text-2xl font-bold ${event.value === 3 ? 'text-gold' : 'text-teal'}">+${event.value}</span>
      ` : ''}
    </div>
  `;

  els.playsFeed.insertBefore(card, els.playsFeed.firstChild);
  if (keepAtTop) els.playsFeed.scrollTop = 0;
  while (els.playsFeed.children.length > 60) {
    els.playsFeed.removeChild(els.playsFeed.lastChild);
  }
}

function renderStats() {
  if (!els.opponentStats) return;
  const oppEntries = Object.entries(state.opponentStats || {});
  els.opponentStats.innerHTML = oppEntries.map(([id, player]) => `
    <div class="bg-slate/50 rounded-lg p-2 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="${state.lastStatChange?.isOpponent && state.lastStatChange?.playerId === id ? 'text-teal' : 'text-sand'} text-sm">
          ${[
            player.number ? `#${escapeHtml(player.number)}` : '',
            player.name ? escapeHtml(player.name) : ''
          ].filter(Boolean).join(' ') || 'Opponent'}
        </span>
      </div>
      <div class="flex gap-3 text-xs">
        <span class="${state.lastStatChange?.isOpponent && state.lastStatChange?.playerId === id ? 'text-teal' : 'text-sand'}">${player.pts || 0} PTS</span>
        <span class="text-sand/60">${player.reb || 0} REB</span>
        <span class="text-sand/60">${player.ast || 0} AST</span>
      </div>
    </div>
  `).join('') || '<div class="text-sand/40 text-xs">No opponent stats yet</div>';
}

function renderLineup() {
  if (!els.lineupOnCourt || !els.lineupBench) return;
  const rosterIds = state.players.map(p => p.id);
  const onCourtSet = new Set((state.onCourt || []).filter(id => rosterIds.includes(id)));
  const onCourtIds = rosterIds.filter(id => onCourtSet.has(id));
  const benchIds = rosterIds.filter(id => !onCourtSet.has(id));
  const renderList = (ids, emptyLabel) => {
    if (!ids || !ids.length) {
      return `<div class="text-sand/40 text-xs">${emptyLabel}</div>`;
    }
    return ids.map(id => {
      const player = state.players.find(p => p.id === id);
      const stats = state.stats[id] || {};
      const highlight = state.lastStatChange?.playerId === id && !state.lastStatChange?.isOpponent;
      const nameClass = highlight ? 'text-teal' : 'text-sand';
      const statClass = highlight ? 'text-teal' : 'text-sand';
      return `
        <div class="bg-slate/50 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            ${player?.photoUrl ? `
              <img src="${player.photoUrl}" class="w-6 h-6 rounded-full object-cover" alt="${escapeHtml(player?.name || 'Player')}">
            ` : `
              <div class="w-6 h-6 rounded-full bg-teal/20 text-teal text-[10px] flex items-center justify-center">
                ${escapeHtml((player?.name || 'P')[0])}
              </div>
            `}
            <span class="text-teal font-mono text-xs">#${escapeHtml(player?.num || '')}</span>
            <span class="${nameClass} text-xs truncate">${escapeHtml(player?.name || 'Player')}</span>
          </div>
          <div class="flex gap-3 text-[11px]">
            <span class="${statClass}">${stats.pts || 0} PTS</span>
            <span class="text-sand/60">${stats.reb || 0} REB</span>
            <span class="text-sand/60">${stats.ast || 0} AST</span>
          </div>
        </div>
      `;
    }).join('');
  };

  els.lineupOnCourt.innerHTML = renderList(onCourtIds, 'Lineup not set');
  els.lineupBench.innerHTML = renderList(benchIds, 'Bench not set');
}

function renderChat() {
  if (!els.chatMessages) return;
  els.chatMessages.innerHTML = state.chatMessages.slice().reverse().map(msg => `
    <div class="flex gap-2 ${msg.ai ? 'bg-teal/10 -mx-3 px-3 py-2 rounded' : ''}">
      ${msg.senderPhotoUrl ?
        `<img src="${msg.senderPhotoUrl}" class="w-7 h-7 rounded-full" alt="${escapeHtml(msg.senderName || 'Fan')}">` :
        `<div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${msg.ai ? 'bg-teal text-ink' : 'bg-teal/20 text-teal'}">
          ${msg.ai ? 'AP' : escapeHtml((msg.senderName || 'F')[0])}
        </div>`
      }
      <div class="flex-1 min-w-0">
        <span class="text-teal text-xs font-medium">${msg.ai ? 'ALL PLAYS' : escapeHtml(msg.senderName || 'Fan')}</span>
        <p class="text-sand text-sm break-words">${formatChatMessage(msg.text || '')}</p>
      </div>
    </div>
  `).join('');
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  updateChatUnread();
}

function updateChatUnread() {
  if (!state.chatMessages.length) return;
  const isMobile = window.matchMedia('(max-width: 767px)').matches;
  if (!isMobile || state.activeTab === 'chat') {
    state.lastChatSeenAt = Date.now();
    state.unreadChatCount = 0;
    updateChatBadge();
    return;
  }

  let newlyUnread = 0;
  state.chatMessages.forEach(msg => {
    const ts = msg.createdAt?.toMillis ? msg.createdAt.toMillis() : null;
    if (!ts || ts > state.lastChatSeenAt) newlyUnread += 1;
  });

  if (newlyUnread > 0) {
    state.unreadChatCount += newlyUnread;
    updateChatBadge();
  }
}

function updateChatBadge() {
  if (!els.chatBadge) return;
  if (state.unreadChatCount > 0) {
    els.chatBadge.textContent = state.unreadChatCount > 99 ? '99+' : `${state.unreadChatCount}`;
    els.chatBadge.classList.remove('hidden');
  } else {
    els.chatBadge.classList.add('hidden');
  }
}

function initChat() {
  if (!els.chatForm) return;
  if (els.chatInput) {
    els.chatInput.addEventListener('input', handleMentionInput);
    els.chatInput.addEventListener('keydown', handleMentionKeydown);
  }
  if (els.mentionAllPlays) {
    els.mentionAllPlays.addEventListener('click', insertMention);
  }
  document.addEventListener('click', (event) => {
    if (!els.mentionMenu || !els.chatInput) return;
    if (els.mentionMenu.contains(event.target) || event.target === els.chatInput) return;
    hideMentionMenu();
  });
  els.chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.isReplay) return;
    const text = els.chatInput.value.trim();
    if (!text) return;
    if (Date.now() - state.lastChatSentAt < 1500) {
      showFloatingText('Slow down', 'text-sand/70 text-sm');
      return;
    }
    state.lastChatSentAt = Date.now();
    els.chatInput.value = '';
    hideMentionMenu();

    const hasAiMention = /@all\s*plays/i.test(text);
    try {
      await postLiveChatMessage(state.teamId, state.gameId, {
        text,
        senderId: state.user?.uid || null,
        senderName: state.user?.displayName || state.anonName,
        senderPhotoUrl: state.user?.photoURL || null,
        isAnonymous: !state.user
      });
    } catch (error) {
      console.warn('Chat send failed:', error);
      els.chatInput.value = text;
      showFloatingText('Message failed', 'text-sand/70 text-sm');
      return;
    }

    if (hasAiMention) {
      await generateAiResponse(text);
    }
  });
}

function promptAnonNameChange() {
  const current = state.anonName || '';
  const next = window.prompt('Pick a display name (2-20 characters).', current);
  if (next === null) return;
  const cleaned = next.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2) {
    showFloatingText('Name is too short', 'text-sand/70 text-sm');
    return;
  }
  state.anonName = cleaned.slice(0, 20);
  sessionStorage.setItem('liveChatAnonName', state.anonName);
  if (els.anonName) els.anonName.textContent = state.anonName;
  showFloatingText('Name updated', 'text-teal text-sm');
}

function handleMentionInput(event) {
  if (!els.chatInput || !els.mentionMenu) return;
  const text = els.chatInput.value;
  const cursor = els.chatInput.selectionStart || text.length;
  const atPos = text.lastIndexOf('@', cursor - 1);
  if (atPos === -1) {
    hideMentionMenu();
    return;
  }
  const token = text.slice(atPos, cursor);
  if (!/^[^\s@]*$/.test(token.slice(1))) {
    hideMentionMenu();
    return;
  }
  const mentionPrefix = token.slice(1).toLowerCase();
  if (token.length > 1 && !'allplays'.startsWith(mentionPrefix)) {
    hideMentionMenu();
    return;
  }
  if (token.length > 20) {
    hideMentionMenu();
    return;
  }
  mentionState.active = true;
  mentionState.atPos = atPos;
  els.mentionMenu.classList.remove('hidden');
}

function handleMentionKeydown(event) {
  if (!mentionState.active || !els.mentionMenu) return;
  if (event.key === 'Escape') {
    hideMentionMenu();
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    insertMention();
  }
}

function hideMentionMenu() {
  if (!els.mentionMenu) return;
  mentionState.active = false;
  mentionState.atPos = null;
  els.mentionMenu.classList.add('hidden');
}

function insertMention() {
  if (!els.chatInput || mentionState.atPos === null) return;
  const text = els.chatInput.value;
  const cursor = els.chatInput.selectionStart || text.length;
  const before = text.slice(0, mentionState.atPos);
  const after = text.slice(cursor);
  const mentionText = '@ALL PLAYS ';
  els.chatInput.value = `${before}${mentionText}${after}`;
  const newCursor = (before + mentionText).length;
  els.chatInput.setSelectionRange(newCursor, newCursor);
  hideMentionMenu();
  els.chatInput.focus();
}

function initReactions() {
  if (!els.reactionsBar) return;
  els.reactionsBar.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-reaction]');
    if (!btn) return;
    if (btn.disabled) return;

    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, 1000);

    const type = btn.dataset.reaction;
    sendReaction(state.teamId, state.gameId, {
      type,
      senderId: state.user?.uid || state.anonName
    }).catch(err => console.warn('Reaction failed:', err));
  });
}

function showFloatingReaction(reaction) {
  if (!els.reactionsOverlay) return;
  const emoji = getReactionEmoji(reaction.type);
  const el = document.createElement('div');
  el.className = 'absolute text-4xl reaction-float';
  el.style.left = `${Math.random() * 80 + 10}%`;
  el.style.bottom = '100px';
  el.textContent = emoji;
  els.reactionsOverlay.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function showScoreCelebration(event) {
  const flash = document.createElement('div');
  flash.className = 'fixed inset-0 bg-teal/10 pointer-events-none z-40';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 200);

  if (event.value === 3) {
    showFloatingText('+3!', 'text-gold text-4xl font-bold');
  }
}

function showFloatingText(text, classes) {
  const el = document.createElement('div');
  el.className = `fixed top-1/3 left-1/2 -translate-x-1/2 pointer-events-none z-50 ${classes}`;
  el.textContent = text;
  el.style.animation = 'float-up 1.5s ease-out forwards';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function updateMomentum(event) {
  const scoringTeam = event.isOpponent ? 'away' : 'home';
  if (state.scoringRun.team !== scoringTeam) {
    state.scoringRun.team = scoringTeam;
    state.scoringRun.points = 0;
    state.lastRunAnnounced = 0;
  }

  state.scoringRun.points += Math.abs(event.value || 0);

  if (state.scoringRun.points >= 5 && state.scoringRun.points !== state.lastRunAnnounced) {
    state.lastRunAnnounced = state.scoringRun.points;
    showFloatingText(`${state.scoringRun.points}-0 Run!`, 'text-coral text-3xl font-bold');
  }
}

function processNewEvents(events) {
  const newEvents = events.filter(ev => !state.eventIds.has(ev.id));
  newEvents.forEach(event => {
    state.eventIds.add(event.id);
    if (Array.isArray(event.onCourt)) state.onCourt = event.onCourt;
    if (Array.isArray(event.bench)) state.bench = event.bench;
    if (Array.isArray(event.onCourt) || Array.isArray(event.bench)) {
      renderLineup();
    }
    if (event.type === 'lineup') {
      return;
    }
    state.events.push(event);

    if (event.homeScore !== undefined) state.homeScore = event.homeScore;
    if (event.awayScore !== undefined) state.awayScore = event.awayScore;
    if (event.period) state.period = event.period;
    if (event.gameClockMs !== undefined) state.gameClockMs = event.gameClockMs;

    if (event.type === 'stat' && event.playerId && event.statKey) {
      if (event.isOpponent) {
        const existing = state.opponentStats[event.playerId] || {};
        state.opponentStats[event.playerId] = {
          ...existing,
          name: event.opponentPlayerName || existing.name || '',
          number: event.opponentPlayerNumber || existing.number || ''
        };
        state.opponentStats[event.playerId][event.statKey] =
          (state.opponentStats[event.playerId][event.statKey] || 0) + (event.value || 0);
      } else {
        state.stats[event.playerId] = state.stats[event.playerId] || {};
        state.stats[event.playerId][event.statKey] =
          (state.stats[event.playerId][event.statKey] || 0) + (event.value || 0);
      }
      state.lastStatChange = { playerId: event.playerId, statKey: event.statKey, isOpponent: !!event.isOpponent };
      renderLineup();
    }

    renderScoreboard(event.type === 'stat' && event.statKey === 'pts');
    renderPlayByPlay(event, true);
    renderStats();

    if (event.type === 'stat' && event.statKey === 'pts') {
      showScoreCelebration(event);
      updateMomentum(event);
    }
  });
}

function startLiveMode() {
  state.isLive = true;
  els.liveBadge?.classList.remove('hidden');

  const unsubEvents = subscribeLiveEvents(state.teamId, state.gameId, (events) => {
    setConnectionBanner(false);
    processNewEvents(events);
  }, (error) => {
    console.warn('Live events subscription failed:', error);
    setConnectionBanner(true, formatFirestoreError(error));
  });
  state.unsubscribers.push(unsubEvents);

  const unsubChat = subscribeLiveChat(state.teamId, state.gameId, { limit: 100 }, (messages) => {
    setConnectionBanner(false);
    state.chatMessages = messages;
    renderChat();
  }, (error) => {
    console.warn('Live chat subscription failed:', error);
    setConnectionBanner(true, formatFirestoreError(error));
  });
  state.unsubscribers.push(unsubChat);

  const unsubReactions = subscribeReactions(state.teamId, state.gameId, (reaction) => {
    setConnectionBanner(false);
    showFloatingReaction(reaction);
  }, (error) => {
    console.warn('Live reactions subscription failed:', error);
    setConnectionBanner(true, formatFirestoreError(error));
  });
  state.unsubscribers.push(unsubReactions);

  const unsubPresence = trackViewerPresence(state.teamId, state.gameId, (count) => {
    state.viewerCount = count;
    if (els.viewerCount) els.viewerCount.textContent = `${count} watching`;
  });
  state.unsubscribers.push(unsubPresence);
  setConnectionBanner(false);
}

function showNotLiveOverlay() {
  els.notLiveOverlay?.classList.remove('hidden');
  els.endedOverlay?.classList.add('hidden');
}

function showEndedOverlay() {
  els.notLiveOverlay?.classList.add('hidden');
  els.endedOverlay?.classList.remove('hidden');
  if (els.finalScore) {
    els.finalScore.textContent = `${state.game?.homeScore || state.homeScore} - ${state.game?.awayScore || state.awayScore}`;
  }
}

async function startReplay() {
  state.isReplay = true;
  state.isLive = false;

  state.replayEvents = await getLiveEvents(state.teamId, state.gameId);
  state.replayChat = await getLiveChatHistory(state.teamId, state.gameId);
  state.replayReactions = await getLiveReactions(state.teamId, state.gameId);

  state.replayEvents.sort((a, b) => (a.gameClockMs || 0) - (b.gameClockMs || 0));
  state.replayChat.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));

  state.events = [];
  state.eventIds = new Set();
  state.stats = {};
  state.opponentStats = {};
  state.homeScore = 0;
  state.awayScore = 0;
  state.period = 'Q1';
  state.gameClockMs = 0;
  state.replayIndex = 0;
  state.replayChatIndex = 0;
  state.replayReactionIndex = 0;
  state.replayStartAt = getReplayStartAt();

  els.replayControls?.classList.remove('hidden');
  els.reactionsBar?.classList.add('hidden');
  els.endedOverlay?.classList.add('hidden');
  els.chatInput?.setAttribute('disabled', 'disabled');

  renderScoreboard();
  if (els.playsFeed) els.playsFeed.innerHTML = '';
  if (els.chatMessages) els.chatMessages.innerHTML = '';

  const totalDuration = state.replayEvents[state.replayEvents.length - 1]?.gameClockMs || 0;
  if (els.replayDuration) els.replayDuration.textContent = formatClock(totalDuration);

  playReplay();
}

function playReplay() {
  state.replayPlaying = true;
  state.replayStartTime = Date.now();
  requestAnimationFrame(replayTick);
}

function replayTick() {
  if (!state.replayPlaying) return;
  const elapsed = (Date.now() - state.replayStartTime) * state.replaySpeed;

  while (
    state.replayIndex < state.replayEvents.length &&
    (state.replayEvents[state.replayIndex].gameClockMs || 0) <= elapsed
  ) {
    const event = state.replayEvents[state.replayIndex];
    processNewEvents([event]);
    state.replayIndex += 1;
  }

  state.gameClockMs = elapsed;
  renderScoreboard();
  advanceReplayStreams(elapsed);
  if (els.replayCurrent) els.replayCurrent.textContent = formatClock(elapsed);

  const totalDuration = state.replayEvents[state.replayEvents.length - 1]?.gameClockMs || 0;
  if (els.replayProgress && totalDuration > 0) {
    els.replayProgress.value = (elapsed / totalDuration) * 100;
  }

  if (state.replayIndex < state.replayEvents.length) {
    requestAnimationFrame(replayTick);
  } else {
    state.replayPlaying = false;
  }
}

function getReplayStartAt() {
  const timestamps = [];
  state.replayEvents.forEach(ev => {
    const ts = getTimestampMs(ev.createdAt);
    if (ts) timestamps.push(ts);
  });
  state.replayChat.forEach(msg => {
    const ts = getTimestampMs(msg.createdAt);
    if (ts) timestamps.push(ts);
  });
  state.replayReactions.forEach(rx => {
    const ts = getTimestampMs(rx.createdAt);
    if (ts) timestamps.push(ts);
  });
  return timestamps.length ? Math.min(...timestamps) : Date.now();
}

function advanceReplayStreams(elapsed) {
  const replayTime = state.replayStartAt + elapsed;

  while (state.replayChatIndex < state.replayChat.length) {
    const msg = state.replayChat[state.replayChatIndex];
    const ts = getTimestampMs(msg.createdAt);
    if (!ts || ts <= replayTime) {
      state.chatMessages.push(msg);
      state.replayChatIndex += 1;
    } else {
      break;
    }
  }

  while (state.replayReactionIndex < state.replayReactions.length) {
    const reaction = state.replayReactions[state.replayReactionIndex];
    const ts = getTimestampMs(reaction.createdAt);
    if (!ts || ts <= replayTime) {
      showFloatingReaction(reaction);
      state.replayReactionIndex += 1;
    } else {
      break;
    }
  }

  if (state.chatMessages.length) {
    renderChat();
  }
}

function seekReplay(targetMs) {
  state.events = [];
  state.eventIds = new Set();
  state.stats = {};
  state.opponentStats = {};
  state.homeScore = 0;
  state.awayScore = 0;
  state.period = 'Q1';
  state.gameClockMs = targetMs;
  state.replayIndex = 0;
  state.replayChatIndex = 0;
  state.replayReactionIndex = 0;
  state.chatMessages = [];

  if (els.playsFeed) els.playsFeed.innerHTML = '';
  if (els.chatMessages) els.chatMessages.innerHTML = '';

  while (
    state.replayIndex < state.replayEvents.length &&
    (state.replayEvents[state.replayIndex].gameClockMs || 0) <= targetMs
  ) {
    const event = state.replayEvents[state.replayIndex];
    processNewEvents([event]);
    state.replayIndex += 1;
  }

  advanceReplayStreams(targetMs);
  renderScoreboard();
  if (els.replayCurrent) els.replayCurrent.textContent = formatClock(targetMs);
}

function getTimestampMs(ts) {
  if (!ts) return null;
  if (typeof ts === 'number') return ts;
  if (ts.toMillis) return ts.toMillis();
  return null;
}

function initReplayControls() {
  if (!els.replayPlay || !els.replayProgress) return;

  els.replayPlay.addEventListener('click', () => {
    state.replayPlaying = !state.replayPlaying;
    if (state.replayPlaying) {
      state.replayStartTime = Date.now() - (state.gameClockMs / state.replaySpeed);
      requestAnimationFrame(replayTick);
    }
  });

  document.querySelectorAll('[data-speed]').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = Number(btn.dataset.speed);
      state.replaySpeed = speed;
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('bg-teal', 'text-ink'));
      btn.classList.add('bg-teal', 'text-ink');
    });
  });

  els.replayProgress.addEventListener('input', (event) => {
    const totalDuration = state.replayEvents[state.replayEvents.length - 1]?.gameClockMs || 0;
    const ratio = Number(event.target.value) / 100;
    const target = totalDuration * ratio;
    seekReplay(target);
  });
}

async function generateAiResponse(question) {
  showAiThinking();
  try {
    const { getAI, getGenerativeModel, GoogleAIBackend } = await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-ai.js');
    const { getApp } = await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js');
    const app = getApp();
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });

    const prompt = buildAiPrompt(question);
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    await postLiveChatMessage(state.teamId, state.gameId, {
      text,
      senderId: null,
      senderName: 'ALL PLAYS',
      senderPhotoUrl: null,
      isAnonymous: false,
      ai: true,
      aiQuestion: question
    });
  } catch (error) {
    console.warn('AI response failed:', error);
    await postLiveChatMessage(state.teamId, state.gameId, {
      text: 'ALL PLAYS is unavailable right now.',
      senderId: null,
      senderName: 'ALL PLAYS',
      senderPhotoUrl: null,
      isAnonymous: false,
      ai: true,
      aiQuestion: question
    });
  } finally {
    hideAiThinking();
  }
}

function buildAiPrompt(question) {
  const recentEvents = state.events.slice(-20).map(ev => `${ev.period || ''} ${formatClock(ev.gameClockMs || 0)} - ${ev.description}`).join('\n');
  const statLines = state.players.map(p => {
    const stats = state.stats[p.id] || {};
    return `#${p.num || ''} ${p.name}: ${stats.pts || 0} PTS, ${stats.reb || 0} REB, ${stats.ast || 0} AST`;
  }).join('\n');
  const chatContext = state.chatMessages.slice(-10).map(m => `${m.senderName || 'Fan'}: ${m.text}`).join('\n');

  return `You are ALL PLAYS, a helpful game assistant for a live basketball broadcast.\n\nCurrent score: ${state.homeScore} - ${state.awayScore}\nPeriod: ${state.period}\nClock: ${formatClock(state.gameClockMs)}\n\nRecent plays:\n${recentEvents || 'No events yet.'}\n\nPlayer stats:\n${statLines || 'No stats yet.'}\n\nRecent chat:\n${chatContext || 'No chat yet.'}\n\nQuestion: ${question}\n\nRespond in a concise, friendly broadcast tone.`;
}

function showAiThinking() {
  if (els.aiThinking) {
    els.aiThinking.classList.remove('hidden');
    return;
  }
}

function hideAiThinking() {
  if (els.aiThinking) {
    els.aiThinking.classList.add('hidden');
    return;
  }
}

function getEventBorderColor(event) {
  if (event.type === 'stat' && event.statKey === 'pts') {
    return event.value === 3 ? 'border-gold' : 'border-teal';
  }
  if (event.type === 'substitution') return 'border-sand/30';
  if (event.type === 'period_change') return 'border-coral';
  if (event.type === 'undo') return 'border-coral';
  return 'border-slate';
}

function getReactionEmoji(type) {
  const map = {
    fire: '\u{1F525}',
    clap: '\u{1F44F}',
    wow: '\u{1F632}',
    heart: '\u2764\uFE0F',
    hundred: '\u{1F4AF}'
  };
  return map[type] || '\u{1F525}';
}

function formatClock(ms) {
  const totalSeconds = Math.floor((ms || 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatChatMessage(text) {
  let formatted = escapeHtml(text);

  formatted = formatted.replace(
    /(^|\n)\s*[-*]\s+(?=\S)/g,
    '$1&bull; '
  );

  formatted = formatted.replace(
    /@all\s*plays/gi,
    '<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal/20 text-teal font-semibold text-xs">@ALL PLAYS</span>'
  );

  formatted = formatted.replace(
    /(\bhttps?:\/\/[^\s<]+[^\s<.,;:!?"'\])>]|\bwww\.[^\s<]+[^\s<.,;:!?"'\])>])/gi,
    (url) => {
      const href = url.startsWith('www.') ? `https://${url}` : url;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-teal underline">${url}</a>`;
    }
  );

  formatted = formatted.replace(
    /`([^`]+)`/g,
    '<code class="bg-slate/70 text-sand px-1 py-0.5 rounded text-xs font-mono">$1</code>'
  );

  formatted = formatted.replace(
    /\*([^*]+)\*/g,
    '<strong>$1</strong>'
  );

  formatted = formatted.replace(
    /\b_([^_]+)_\b/g,
    '<em>$1</em>'
  );

  formatted = formatted.replace(
    /~([^~]+)~/g,
    '<del class="text-sand/60">$1</del>'
  );

  return formatted;
}

function setConnectionBanner(show, message = 'Connection lost. Reconnecting...') {
  if (!els.connectionBanner) return;
  els.connectionBanner.textContent = message;
  els.connectionBanner.classList.toggle('hidden', !show);
}

function formatFirestoreError(error) {
  if (!error) return 'Connection lost. Reconnecting...';
  const code = error.code || '';
  if (code === 'permission-denied') return 'Live data unavailable (permission denied).';
  if (code === 'unavailable') return 'Live data unavailable (network).';
  return error.message || 'Connection lost. Reconnecting...';
}

function updateStickyOffsets() {
  const header = document.getElementById('header-container');
  const scoreboard = document.getElementById('scoreboard');
  if (!header || !scoreboard) return;
  const navHeight = header.offsetHeight || 0;
  const boardHeight = scoreboard.offsetHeight || 0;
  document.documentElement.style.setProperty('--nav-height', `${navHeight}px`);
  document.documentElement.style.setProperty('--scoreboard-height', `${boardHeight}px`);
}

async function init() {
  renderFooter(document.getElementById('footer-container'));
  window.addEventListener('resize', updateStickyOffsets);

  const params = getUrlParams();
  state.teamId = params.teamId;
  state.gameId = params.gameId;
  state.isReplay = params.replay === 'true';

  if (!state.teamId || !state.gameId) {
    if (els.playsFeed) els.playsFeed.innerHTML = '<div class="text-sand/60 text-center py-6">Invalid game link.</div>';
    return;
  }

  const [team, game, players] = await Promise.all([
    getTeam(state.teamId),
    getGame(state.teamId, state.gameId),
    getPlayers(state.teamId)
  ]);

  if (!game) {
    if (els.playsFeed) els.playsFeed.innerHTML = '<div class="text-sand/60 text-center py-6">Game not found.</div>';
    return;
  }

  state.team = team;
  state.game = game;
  state.players = players || [];
  state.opponentStats = game.opponentStats || {};
  if (game.liveLineup) {
    state.onCourt = Array.isArray(game.liveLineup.onCourt) ? game.liveLineup.onCourt : [];
    state.bench = Array.isArray(game.liveLineup.bench) ? game.liveLineup.bench : [];
  }
  state.homeScore = game.homeScore || 0;
  state.awayScore = game.awayScore || 0;
  state.period = game.period || 'Q1';

  renderGameInfo();
  renderScoreboard();
  renderLineup();
  updateStickyOffsets();
  initTabs();
  initChat();
  initReactions();
  initReplayControls();

  checkAuth((user) => {
    state.user = user;
    renderHeader(document.getElementById('header-container'), user);
    updateStickyOffsets();
    if (!user) {
      const saved = sessionStorage.getItem('liveChatAnonName');
      state.anonName = saved || `Fan${Math.floor(1000 + Math.random() * 9000)}`;
      sessionStorage.setItem('liveChatAnonName', state.anonName);
      if (els.anonName) els.anonName.textContent = state.anonName;
      if (els.chatAnonNotice) els.chatAnonNotice.classList.remove('hidden');
      if (els.anonChange && !els.anonChange.dataset.bound) {
        els.anonChange.dataset.bound = 'true';
        els.anonChange.addEventListener('click', promptAnonNameChange);
      }
    } else {
      if (els.chatAnonNotice) els.chatAnonNotice.classList.add('hidden');
    }
  }, { skipEmailVerificationCheck: true });

  if (state.isReplay && game.liveStatus === 'completed') {
    await startReplay();
    return;
  }

  if (game.liveStatus === 'live') {
    startLiveMode();
  } else if (game.liveStatus === 'completed') {
    showEndedOverlay();
  } else {
    showNotLiveOverlay();
  }

  if (els.watchReplayBtn) {
    els.watchReplayBtn.addEventListener('click', () => {
      window.location.href = `live-game.html?teamId=${state.teamId}&gameId=${state.gameId}&replay=true`;
    });
  }
}

init();
