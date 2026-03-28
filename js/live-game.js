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
  getLiveReactions,
  getConfigs,
  subscribeGame,
  updateGame
} from './db.js?v=15';
import { getUrlParams, escapeHtml, renderHeader, renderFooter, formatShortDate, formatTime, shareOrCopy } from './utils.js?v=9';
import { computePanelVisibility } from './live-stream-utils.js?v=1';
import { checkAuth } from './auth.js?v=10';
import { isViewerChatEnabled } from './live-game-chat.js?v=1';
import {
  buildReplaySessionState,
  collectReplayEventWindow,
  collectReplayStreamWindow,
  getReplayElapsedMs,
  getReplayStartTimeAfterSpeedChange,
  getReplayTimestampMs
} from './live-game-replay.js?v=3';
import { MAX_HIGHLIGHT_CLIP_MS, buildHighlightShareUrl, createHighlightClipDraft, resolveReplayVideoOptions, shouldReloadVideoPlayback } from './live-game-video.js?v=2';
import { getAI, getGenerativeModel, GoogleAIBackend } from './vendor/firebase-ai.js';
import { getApp } from './vendor/firebase-app.js';
import { resolveOpponentDisplayName, normalizeLiveStatColumns, resolveLiveStatColumns, renderViewerLineupSections, applyResetEventState, applyViewerEventToState, shouldResetViewerFromGameDoc, collectVisibleLiveEventsSequentially } from './live-game-state.js?v=5';
import { getDefaultLivePeriod } from './live-sport-config.js?v=1';

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
  statColumns: [],
  homeScore: 0,
  awayScore: 0,
  period: getDefaultLivePeriod(),
  gameClockMs: 0,
  sport: null,
  periods: null,

  chatMessages: [],
  unreadChatCount: 0,
  lastChatSeenAt: Date.now(),
  lastChatSentAt: 0,

  viewerCount: 0,
  engagementsActive: false,
  liveEventsActive: false,
  chatEnabled: false,

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
  lastRunAnnounced: 0,
  hasVideoStream: false,
  lastResetAt: 0,
  videoPlayback: null,
  clipStartMs: null,
  clipEndMs: null
};

const els = {
  homeTeamName: q('#home-team-name'),
  awayTeamName: q('#away-team-name'),
  homeTeamPhoto: q('#home-team-photo'),
  awayTeamPhoto: q('#away-team-photo'),
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
  anonEdit: q('#anon-edit'),
  anonInput: q('#anon-input'),
  anonSave: q('#anon-save'),
  anonCancel: q('#anon-cancel'),
  chatLockedNotice: q('#chat-locked-notice'),
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
  replayGameLink: q('#replay-game-link'),
  replayReportLink: q('#replay-report-link'),
  shareGameBtn: q('#share-game-btn'),

  notLiveOverlay: q('#not-live-overlay'),
  endedOverlay: q('#ended-overlay'),
  watchReplayBtn: q('#watch-replay-btn'),
  finalScore: q('#final-score'),
  gameStartTime: q('#game-start-time'),

  mobileTabs: document.querySelectorAll('#mobile-tabs [data-tab]'),
  videoPanel: q('#video-panel'),
  playsPanel: q('#plays-panel'),
  statsPanel: q('#stats-panel'),
  chatPanelMobile: q('#chat-panel'),
  recordedReplayVideo: q('#recorded-replay-video'),
  recordedReplayTools: q('#recorded-replay-tools'),
  recordedReplayMeta: q('#recorded-replay-meta'),
  highlightStartInput: q('#highlight-start-input'),
  highlightEndInput: q('#highlight-end-input'),
  highlightTitleInput: q('#highlight-title-input'),
  highlightSetStart: q('#highlight-set-start'),
  highlightSetEnd: q('#highlight-set-end'),
  highlightShareBtn: q('#highlight-share-btn'),
  highlightSaveBtn: q('#highlight-save-btn'),
  savedHighlightsList: q('#saved-highlights-list')
};

const mentionState = { active: false, atPos: null };
const statKeyMap = {
  PTS: 'pts',
  POINTS: 'pts',
  REB: 'reb',
  AST: 'ast',
  STL: 'stl',
  BLK: 'blk',
  BLOCK: 'blk',
  TO: 'to',
  TOV: 'to',
  FOUL: 'fouls',
  FOULS: 'fouls',
  FLS: 'fouls'
};

function q(selector) {
  return document.querySelector(selector);
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function buildShareText(mode, url) {
  const teamName = state.team?.name || 'Team';
  const opponent = resolveOpponentDisplayName(state.game);
  const dateLabel = formatShortDate(state.game?.date);
  const timeLabel = formatTime(state.game?.date);
  if (mode === 'report') {
    return `Game report: ${teamName} vs ${opponent}${dateLabel ? ` — ${dateLabel}` : ''}\n${url}`;
  }
  const when = dateLabel ? `${dateLabel}${timeLabel ? ` at ${timeLabel}` : ''}` : '';
  return `Watch ${teamName} vs ${opponent}${when ? ` — ${when}` : ''}\n${url}`;
}

function updateShareButton() {
  if (!els.shareGameBtn) return;
  const isReport = state.isReplay || state.game?.status === 'completed' || state.game?.liveStatus === 'completed';
  els.shareGameBtn.textContent = isReport ? 'Share Report' : 'Share';
  if (els.replayReportLink) {
    const reportUrl = `game.html#teamId=${state.teamId}&gameId=${state.gameId}`;
    els.replayReportLink.href = reportUrl;
    els.replayReportLink.classList.toggle('hidden', !state.isReplay);
  }
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
  const visibility = computePanelVisibility({
    isMobile,
    activeTab: state.activeTab,
    hasVideoStream: state.hasVideoStream
  });
  state.activeTab = visibility.activeTab;

  els.videoPanel?.classList.toggle('hidden', visibility.videoHidden);
  els.playsPanel?.classList.toggle('hidden', visibility.playsHidden);
  els.statsPanel?.classList.toggle('hidden', visibility.statsHidden);
  els.chatPanel?.classList.toggle('hidden', visibility.chatHidden);

  if (!isMobile) return;

  els.mobileTabs.forEach(tab => {
    const active = tab.dataset.tab === state.activeTab;
    tab.classList.toggle('text-teal', active);
    tab.classList.toggle('border-teal', active);
    tab.classList.toggle('text-sand/50', !active);
    tab.classList.toggle('border-transparent', !active);
  });
}

function resolveVideoPlayback() {
  return resolveReplayVideoOptions({
    team: state.team,
    game: state.game,
    isReplay: state.isReplay,
    clipStartMs: state.clipStartMs,
    clipEndMs: state.clipEndMs
  });
}

function refreshVideoPanel({ force = false } = {}) {
  const nextPlayback = resolveVideoPlayback();
  if (!force && !shouldReloadVideoPlayback(state.videoPlayback, nextPlayback)) {
    return false;
  }
  setupVideoPanel(nextPlayback);
  return true;
}

function setupVideoPanel(nextPlayback = resolveVideoPlayback()) {
  const videoTab = document.querySelector('#mobile-tabs [data-tab="video"]');
  const extLink = document.getElementById('stream-external-link');
  const iframe = document.getElementById('youtube-stream-iframe');
  const recordedVideo = els.recordedReplayVideo;
  const previousPlayback = state.videoPlayback;
  const shouldReloadPlayback = shouldReloadVideoPlayback(previousPlayback, nextPlayback);
  state.videoPlayback = nextPlayback;
  state.hasVideoStream = Boolean(state.videoPlayback?.hasVideo);

  if (state.videoPlayback?.mode === 'recorded') {
    if (iframe) {
      if (iframe.getAttribute('src')) iframe.src = '';
      iframe.classList.add('hidden');
    }
    if (recordedVideo) {
      if (shouldReloadPlayback) {
        recordedVideo.src = state.videoPlayback.sourceUrl || '';
      }
      recordedVideo.poster = state.videoPlayback.posterUrl || '';
      recordedVideo.classList.remove('hidden');
    }
    renderRecordedReplayTools();
    if (videoTab) videoTab.classList.remove('hidden');
    if (extLink && state.videoPlayback.publicUrl) {
      extLink.href = state.videoPlayback.publicUrl;
      extLink.textContent = state.videoPlayback.publicLabel || 'Open replay video ↗';
      extLink.classList.remove('hidden');
    } else if (extLink) {
      extLink.classList.add('hidden');
      extLink.removeAttribute('href');
    }
  } else if (state.videoPlayback?.mode === 'embed') {
    if (recordedVideo) {
      recordedVideo.pause();
      if (recordedVideo.currentSrc || recordedVideo.getAttribute('src')) {
        recordedVideo.removeAttribute('src');
        recordedVideo.load();
      }
      recordedVideo.classList.add('hidden');
    }
    els.recordedReplayTools?.classList.add('hidden');
    if (iframe) {
      if (shouldReloadPlayback) {
        iframe.src = state.videoPlayback.sourceUrl || '';
      }
      iframe.classList.remove('hidden');
    }
    if (videoTab) videoTab.classList.remove('hidden');
    if (extLink && state.videoPlayback.publicUrl) {
      extLink.href = state.videoPlayback.publicUrl;
      extLink.textContent = state.videoPlayback.publicLabel || '';
      extLink.classList.remove('hidden');
    }
  } else {
    if (recordedVideo) {
      recordedVideo.pause();
      if (recordedVideo.currentSrc || recordedVideo.getAttribute('src')) {
        recordedVideo.removeAttribute('src');
        recordedVideo.load();
      }
      recordedVideo.classList.add('hidden');
    }
    if (iframe) {
      if (iframe.getAttribute('src')) iframe.src = '';
      iframe.classList.add('hidden');
    }
    els.recordedReplayTools?.classList.add('hidden');
    els.videoPanel?.classList.add('hidden');
    if (videoTab) videoTab.classList.add('hidden');
    if (extLink) {
      extLink.classList.add('hidden');
      extLink.removeAttribute('href');
    }
    if (state.activeTab === 'video') state.activeTab = 'plays';
  }

  updateTabs();
}

function formatVideoTimestamp(ms) {
  const totalSeconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getCurrentReplayVideoDurationMs() {
  const video = els.recordedReplayVideo;
  if (video && Number.isFinite(video.duration) && video.duration > 0) {
    return Math.round(video.duration * 1000);
  }
  return state.videoPlayback?.durationMs ?? null;
}

function getHighlightDraftFromInputs() {
  return createHighlightClipDraft({
    startMs: Number(els.highlightStartInput?.value || 0) * 1000,
    endMs: Number(els.highlightEndInput?.value || 0) * 1000,
    durationMs: getCurrentReplayVideoDurationMs(),
    title: els.highlightTitleInput?.value || ''
  });
}

function syncHighlightUrl(startMs, endMs) {
  const url = new URL(window.location.href);
  url.searchParams.set('teamId', state.teamId);
  url.searchParams.set('gameId', state.gameId);
  url.searchParams.set('replay', state.isReplay ? 'true' : 'false');
  if (Number.isFinite(startMs)) {
    url.searchParams.set('clipStart', `${Math.max(0, Math.round(startMs))}`);
  } else {
    url.searchParams.delete('clipStart');
  }
  if (Number.isFinite(endMs)) {
    url.searchParams.set('clipEnd', `${Math.max(0, Math.round(endMs))}`);
  } else {
    url.searchParams.delete('clipEnd');
  }
  window.history.replaceState({}, '', url.toString());
}

function applyHighlightSelection(clip, { updateHistory = true, autoplay = false } = {}) {
  if (!clip) return;
  state.clipStartMs = clip.startMs;
  state.clipEndMs = clip.endMs;
  state.videoPlayback = {
    ...(state.videoPlayback || {}),
    clipStartMs: clip.startMs,
    clipEndMs: clip.endMs
  };
  if (els.highlightStartInput) els.highlightStartInput.value = `${Math.round(clip.startMs / 1000)}`;
  if (els.highlightEndInput) els.highlightEndInput.value = `${Math.round(clip.endMs / 1000)}`;
  if (updateHistory) {
    syncHighlightUrl(clip.startMs, clip.endMs);
  }
  const video = els.recordedReplayVideo;
  if (video) {
    const nextTime = clip.startMs / 1000;
    if (Math.abs(video.currentTime - nextTime) > 0.5) {
      video.currentTime = nextTime;
    }
    if (autoplay) {
      video.play().catch(() => {});
    }
  }
}

function renderSavedHighlights() {
  if (!els.savedHighlightsList) return;
  const clips = state.videoPlayback?.savedHighlights || [];
  if (!clips.length) {
    els.savedHighlightsList.innerHTML = '<div class="rounded-lg border border-dashed border-teal/20 px-3 py-3 text-sm text-sand/50">No saved highlights yet.</div>';
    return;
  }

  els.savedHighlightsList.innerHTML = clips.map((clip, index) => `
    <button
      type="button"
      data-highlight-index="${index}"
      class="flex w-full items-center justify-between rounded-lg border border-teal/20 bg-ink/50 px-3 py-2 text-left hover:bg-ink/80"
    >
      <span>
        <span class="block text-sm font-medium text-sand">${escapeHtml(clip.title || `Highlight ${index + 1}`)}</span>
        <span class="block text-xs text-sand/55">${formatVideoTimestamp(clip.startMs)} - ${formatVideoTimestamp(clip.endMs)}</span>
      </span>
      <span class="text-xs text-teal">Load</span>
    </button>
  `).join('');
}

function renderRecordedReplayTools() {
  if (state.videoPlayback?.mode !== 'recorded') {
    els.recordedReplayTools?.classList.add('hidden');
    return;
  }

  const durationMs = getCurrentReplayVideoDurationMs();
  const defaultClipEndMs = Number.isFinite(durationMs)
    ? Math.min(durationMs, MAX_HIGHLIGHT_CLIP_MS)
    : MAX_HIGHLIGHT_CLIP_MS;

  if (els.recordedReplayMeta) {
    const pieces = ['Create a highlight clip up to 60 seconds.'];
    if (state.videoPlayback.title) {
      pieces.unshift(state.videoPlayback.title);
    }
    if (Number.isFinite(durationMs)) {
      pieces.push(`Replay length ${formatVideoTimestamp(durationMs)}.`);
    }
    els.recordedReplayMeta.textContent = pieces.join(' ');
  }

  if (els.highlightStartInput && document.activeElement !== els.highlightStartInput) {
    els.highlightStartInput.value = `${Math.round((state.videoPlayback.clipStartMs ?? 0) / 1000)}`;
  }
  if (els.highlightEndInput && document.activeElement !== els.highlightEndInput) {
    els.highlightEndInput.value = `${Math.round((state.videoPlayback.clipEndMs ?? defaultClipEndMs) / 1000)}`;
  }
  if (els.recordedReplayTools) {
    els.recordedReplayTools.classList.remove('hidden');
  }

  renderSavedHighlights();
}

async function shareHighlightClip(clip) {
  const url = buildHighlightShareUrl({
    origin: window.location.origin,
    teamId: state.teamId,
    gameId: state.gameId,
    startMs: clip.startMs,
    endMs: clip.endMs
  });
  const result = await shareOrCopy({
    title: clip.title || 'Game highlight',
    text: clip.title || 'Watch this highlight',
    url,
    clipboardText: `${clip.title || 'Game highlight'}\n${url}`
  });
  if (result.status === 'shared') showToast('Clip share sheet opened!');
  if (result.status === 'copied') showToast('Clip link copied!');
  if (result.status === 'failed') showToast('Failed to share clip.');
  return url;
}

async function saveHighlightClip() {
  const draft = getHighlightDraftFromInputs();
  if (!draft) {
    showToast('Pick a valid highlight range.');
    return;
  }

  applyHighlightSelection(draft);
  if (!state.user) {
    await shareHighlightClip(draft);
    showToast('Sign in to save highlights. Clip link copied instead.');
    return;
  }

  const nextHighlights = [
    ...(state.videoPlayback?.savedHighlights || []).filter(clip => clip.startMs !== draft.startMs || clip.endMs !== draft.endMs || clip.title !== draft.title),
    draft
  ]
    .sort((a, b) => a.startMs - b.startMs)
    .slice(-12);

  try {
    await updateGame(state.teamId, state.gameId, {
      highlightClips: nextHighlights
    });
    state.game = {
      ...state.game,
      highlightClips: nextHighlights
    };
    state.videoPlayback = {
      ...state.videoPlayback,
      savedHighlights: nextHighlights
    };
    renderRecordedReplayTools();
    showToast('Highlight saved.');
  } catch (error) {
    console.warn('Failed to save highlight clip:', error);
    await shareHighlightClip(draft);
    showToast('Save unavailable for this account. Clip link copied.');
  }
}

function initRecordedReplayControls() {
  if (els.recordedReplayVideo && !els.recordedReplayVideo.dataset.bound) {
    els.recordedReplayVideo.dataset.bound = 'true';
    els.recordedReplayVideo.addEventListener('loadedmetadata', () => {
      renderRecordedReplayTools();
      if (Number.isFinite(state.videoPlayback?.clipStartMs)) {
        applyHighlightSelection({
          title: els.highlightTitleInput?.value || '',
          startMs: state.videoPlayback.clipStartMs,
          endMs: state.videoPlayback.clipEndMs ?? Math.min(getCurrentReplayVideoDurationMs() || MAX_HIGHLIGHT_CLIP_MS, MAX_HIGHLIGHT_CLIP_MS)
        }, { updateHistory: false });
      }
    });
    els.recordedReplayVideo.addEventListener('timeupdate', () => {
      if (!Number.isFinite(state.videoPlayback?.clipEndMs)) return;
      const clipEndSeconds = state.videoPlayback.clipEndMs / 1000;
      if (els.recordedReplayVideo.currentTime >= clipEndSeconds) {
        els.recordedReplayVideo.pause();
        els.recordedReplayVideo.currentTime = clipEndSeconds;
      }
    });
  }

  if (els.highlightSetStart && !els.highlightSetStart.dataset.bound) {
    els.highlightSetStart.dataset.bound = 'true';
    els.highlightSetStart.addEventListener('click', () => {
      const currentSeconds = Math.floor(els.recordedReplayVideo?.currentTime || 0);
      if (els.highlightStartInput) els.highlightStartInput.value = `${currentSeconds}`;
    });
  }
  if (els.highlightSetEnd && !els.highlightSetEnd.dataset.bound) {
    els.highlightSetEnd.dataset.bound = 'true';
    els.highlightSetEnd.addEventListener('click', () => {
      const currentSeconds = Math.ceil(els.recordedReplayVideo?.currentTime || 0);
      if (els.highlightEndInput) els.highlightEndInput.value = `${currentSeconds}`;
    });
  }
  if (els.highlightShareBtn && !els.highlightShareBtn.dataset.bound) {
    els.highlightShareBtn.dataset.bound = 'true';
    els.highlightShareBtn.addEventListener('click', async () => {
      const draft = getHighlightDraftFromInputs();
      if (!draft) {
        showToast('Pick a valid highlight range.');
        return;
      }
      applyHighlightSelection(draft);
      await shareHighlightClip(draft);
    });
  }
  if (els.highlightSaveBtn && !els.highlightSaveBtn.dataset.bound) {
    els.highlightSaveBtn.dataset.bound = 'true';
    els.highlightSaveBtn.addEventListener('click', saveHighlightClip);
  }
  if (els.savedHighlightsList && !els.savedHighlightsList.dataset.bound) {
    els.savedHighlightsList.dataset.bound = 'true';
    els.savedHighlightsList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-highlight-index]');
      if (!button) return;
      const clip = state.videoPlayback?.savedHighlights?.[Number(button.dataset.highlightIndex)];
      if (!clip) return;
      if (els.highlightTitleInput) {
        els.highlightTitleInput.value = clip.title || '';
      }
      applyHighlightSelection(clip, { autoplay: false });
    });
  }
}

function renderGameInfo() {
  els.homeTeamName.textContent = state.team?.name || 'Home Team';
  els.awayTeamName.textContent = resolveOpponentDisplayName(state.game);
  if (els.homeTeamPhoto) {
    if (state.team?.photoUrl) {
      els.homeTeamPhoto.src = state.team.photoUrl;
      els.homeTeamPhoto.classList.remove('hidden');
    } else {
      els.homeTeamPhoto.classList.add('hidden');
    }
  }
  if (els.awayTeamPhoto) {
    if (state.game?.opponentTeamPhoto) {
      els.awayTeamPhoto.src = state.game.opponentTeamPhoto;
      els.awayTeamPhoto.classList.remove('hidden');
    } else {
      els.awayTeamPhoto.classList.add('hidden');
    }
  }
  if (state.game?.date) {
    const date = state.game.date.toDate ? state.game.date.toDate() : new Date(state.game.date);
    els.gameStartTime.textContent = `Scheduled: ${date.toLocaleString()}`;
  }
  updateShareButton();
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
  const placeholder = els.playsFeed.querySelector('[data-placeholder="plays"]');
  if (placeholder) placeholder.remove();
  const keepAtTop = els.playsFeed.scrollTop < 10;
  const card = document.createElement('div');

  // System events (clock, period changes) don't have a side
  const isSystemEvent = ['clock_pause', 'clock_start', 'period_change', 'undo', 'log_remove', 'clock_sync'].includes(event.type);
  const sideClass = isSystemEvent ? 'border-slate' : (event.isOpponent ? 'event-away' : 'event-home');
  card.className = `bg-slate/50 rounded-lg p-3 border-l-4 ${sideClass} ${isNew ? 'event-slide' : ''}`;
  const opponentLabel = [
    event.opponentPlayerNumber ? `#${escapeHtml(event.opponentPlayerNumber)}` : '',
    event.opponentPlayerName ? escapeHtml(event.opponentPlayerName) : ''
  ].filter(Boolean).join(' ');

  // Only show side badge for stat/substitution events, not system events
  let sideBadge = '';
  if (!isSystemEvent) {
    sideBadge = event.isOpponent
      ? '<span class="event-side-tag away-color">AWAY</span>'
      : '<span class="event-side-tag home-color">HOME</span>';
  }
  card.innerHTML = `
    <div class="flex justify-between items-start">
      <div>
        <div class="flex items-center gap-2">
          <span class="text-teal text-xs">${escapeHtml(event.period || state.period)} · ${formatClock(event.gameClockMs || 0)}</span>
          ${sideBadge}
        </div>
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
  const columns = normalizeLiveStatColumns(state.statColumns);
  els.opponentStats.innerHTML = oppEntries.map(([id, player]) => {
    const highlight = state.lastStatChange?.isOpponent && state.lastStatChange?.playerId === id;
    const nameClass = highlight ? 'text-coral' : 'text-sand';
    const statClass = highlight ? 'text-coral' : 'text-sand';
    const statItems = columns.map(col => {
      const key = statKeyMap[col] || col.toLowerCase();
      const val = player[key] || 0;
      return `<span class="${statClass}">${val} ${escapeHtml(col)}</span>`;
    }).join('');
    const initial = escapeHtml((player.name || 'O')[0]);
    const avatar = player.photoUrl
      ? `<img src="${escapeHtml(player.photoUrl)}" class="w-6 h-6 rounded-full object-cover" alt="">`
      : `<div class="w-6 h-6 rounded-full bg-coral/20 text-coral text-[10px] flex items-center justify-center">${initial}</div>`;
    return `
      <div class="bg-slate/50 rounded-lg px-3 py-2">
        <div class="flex items-center gap-2 min-w-0">
          ${avatar}
          <span class="text-coral font-mono text-xs">#${escapeHtml(player.number || '')}</span>
          <span class="${nameClass} text-xs truncate">${escapeHtml(player.name || 'Opponent')}</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-sand/70">
          ${statItems}
        </div>
      </div>
    `;
  }).join('') || '<div class="text-sand/40 text-xs">No opponent stats yet</div>';
}

function renderLineup() {
  if (!els.lineupOnCourt || !els.lineupBench) return;
  const rendered = renderViewerLineupSections({
    players: state.players,
    stats: state.stats,
    statColumns: state.statColumns,
    onCourt: state.onCourt,
    bench: state.bench,
    lastStatChange: state.lastStatChange
  });
  els.lineupOnCourt.innerHTML = rendered.onCourtHtml;
  els.lineupBench.innerHTML = rendered.benchHtml;
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

  const newlyUnread = state.chatMessages.reduce((count, msg) => {
    const ts = msg.createdAt?.toMillis ? msg.createdAt.toMillis() : null;
    if (!ts || ts > state.lastChatSeenAt) return count + 1;
    return count;
  }, 0);

  state.unreadChatCount = newlyUnread;
  updateChatBadge();
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
    if (!state.chatEnabled) {
      showFloatingText('Chat is disabled', 'text-sand/70 text-sm');
      return;
    }
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

function openAnonNameEditor() {
  if (!els.anonEdit || !els.anonInput) return;
  els.anonEdit.classList.remove('hidden');
  els.anonInput.value = state.anonName || '';
  els.anonInput.focus();
}

function closeAnonNameEditor() {
  if (!els.anonEdit) return;
  els.anonEdit.classList.add('hidden');
}

function saveAnonName() {
  if (!els.anonInput) return;
  const cleaned = els.anonInput.value.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2) {
    showFloatingText('Name is too short', 'text-sand/70 text-sm');
    return;
  }
  state.anonName = cleaned.slice(0, 20);
  sessionStorage.setItem('liveChatAnonName', state.anonName);
  if (els.anonName) els.anonName.textContent = state.anonName;
  closeAnonNameEditor();
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

    if (state.chatEnabled) {
      const emoji = getReactionEmoji(type);
      postLiveChatMessage(state.teamId, state.gameId, {
        text: emoji,
        senderId: state.user?.uid || null,
        senderName: state.user?.displayName || state.anonName,
        senderPhotoUrl: state.user?.photoURL || null,
        isAnonymous: !state.user
      }).catch(err => console.warn('Reaction chat failed:', err));
    }
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

function showEventCelebration(event) {
  if (!event) return;
  if (event.type === 'stat' && event.statKey === 'pts') return;

  const type = event.type;
  const key = (event.statKey || '').toLowerCase();
  let text = '';
  let classes = event.isOpponent ? 'text-coral text-2xl font-semibold' : 'text-teal text-2xl font-semibold';

  if (type === 'stat') {
    if (key === 'reb') text = 'Board!';
    else if (key === 'ast') text = 'Dime!';
    else if (key === 'stl') text = 'Steal!';
    else if (key === 'blk' || key === 'block') text = 'Swat!';
    else if (key === 'to' || key === 'turnover') {
      text = 'Turnover';
      classes = 'text-coral text-2xl font-semibold';
    } else if (key === 'fouls' || key === 'foul') {
      text = 'Foul';
      classes = 'text-coral text-2xl font-semibold';
    } else {
      text = `${key.toUpperCase()}!`;
    }
  } else if (type === 'substitution') {
    text = 'Sub!';
    classes = 'text-gold text-2xl font-semibold';
  } else if (type === 'period_change') {
    text = `New ${event.period || 'Period'}`;
    classes = 'text-gold text-2xl font-semibold';
  } else if (type === 'clock_pause') {
    text = 'Paused';
    classes = 'text-sand text-xl font-semibold';
  } else if (type === 'clock_start') {
    text = 'Game On';
    classes = 'text-teal text-2xl font-semibold';
  } else if (type === 'undo') {
    text = 'Undo';
    classes = 'text-coral text-2xl font-semibold';
  } else if (type === 'log_remove') {
    text = 'Removed';
    classes = 'text-coral text-2xl font-semibold';
  }

  if (text) {
    showFloatingText(text, classes);
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

function resetViewerStateFromGameDoc(gameDoc, placeholder = 'Game reset. Waiting for plays...') {
  const liveLineup = gameDoc?.liveLineup || {};
  const next = applyResetEventState(state, {
    period: gameDoc?.period || getDefaultLivePeriod({ game: gameDoc, team: state.team }),
    homeScore: gameDoc?.homeScore || 0,
    awayScore: gameDoc?.awayScore || 0,
    gameClockMs: Number.isFinite(gameDoc?.liveClockMs) ? gameDoc.liveClockMs : 0,
    sport: gameDoc?.sport || state.sport,
    onCourt: Array.isArray(liveLineup.onCourt) ? liveLineup.onCourt : [],
    bench: Array.isArray(liveLineup.bench) ? liveLineup.bench : []
  });
  Object.assign(state, next);
  if (els.playsFeed) {
    els.playsFeed.innerHTML = `<div data-placeholder="plays" class="text-center text-sand/40 py-8">${placeholder}</div>`;
  }
  renderScoreboard();
  renderStats();
  renderLineup();
}

function processNewEvents(events) {
  const newEvents = collectVisibleLiveEventsSequentially(events, {
    seenIds: state.eventIds,
    resetBoundaryMs: state.lastResetAt
  });
  newEvents.forEach(event => {
    state.eventIds.add(event.id);
    if (event.type === 'reset') {
      const resetAt = getTimestampMs(event.createdAt) || Date.now();
      if (resetAt > (state.lastResetAt || 0)) {
        state.lastResetAt = resetAt;
      }
      const next = applyResetEventState(state, event);
      Object.assign(state, next);
      state.eventIds.add(event.id);
      if (els.playsFeed) {
        els.playsFeed.innerHTML = '<div data-placeholder="plays" class="text-center text-sand/40 py-8">Game reset. Waiting for plays...</div>';
      }
      renderScoreboard();
      renderStats();
      renderLineup();
      return;
    }
    const transition = applyViewerEventToState(state, event);
    Object.assign(state, transition.state);

    if (transition.shouldRenderLineup) {
      renderLineup();
    }
    if (transition.shouldRenderScoreboard) {
      renderScoreboard(transition.animateScoreboard);
    }
    if (transition.shouldRenderPlayByPlay) {
      renderPlayByPlay(event, true);
    }
    if (transition.shouldRenderStats) {
      renderStats();
    }

    if (transition.shouldCelebrateScore) {
      showScoreCelebration(event);
      updateMomentum(event);
    } else if (transition.shouldCelebrateEvent) {
      showEventCelebration(event);
    }
  });
}

function startLiveMode() {
  state.isLive = true;
  els.liveBadge?.classList.remove('hidden');

  startEngagements();
  startLiveEvents();
  setConnectionBanner(false);
}

function startEngagements() {
  if (state.engagementsActive) return;
  state.engagementsActive = true;

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
}

function startLiveEvents() {
  if (state.liveEventsActive) return;
  state.liveEventsActive = true;
  state.liveEventsFirstLoad = true;
  const unsubEvents = subscribeLiveEvents(state.teamId, state.gameId, (events) => {
    setConnectionBanner(false);
    if (state.liveEventsFirstLoad && events.length === 0) {
      // Show a message while waiting for first events
      const placeholder = els.playsFeed?.querySelector?.('[data-placeholder="plays"]');
      if (placeholder) placeholder.textContent = 'Connected. Waiting for plays...';
    }
    if (!state.liveEventsFirstLoad && events.length === 0) {
      const hadLiveState = state.events.length > 0 ||
        Object.keys(state.stats || {}).length > 0 ||
        Object.keys(state.opponentStats || {}).length > 0;
      if (hadLiveState) {
        resetViewerStateFromGameDoc(state.game, 'Game reset. Waiting for plays...');
      }
    }
    state.liveEventsFirstLoad = false;
    processNewEvents(events);
  }, (error) => {
    console.warn('Live events subscription failed:', error);
    setConnectionBanner(true, formatFirestoreError(error));
    // Also show error in plays feed if no events have loaded yet
    if (state.events.length === 0 && els.playsFeed) {
      const placeholder = els.playsFeed?.querySelector?.('[data-placeholder="plays"]');
      if (placeholder) placeholder.textContent = 'Unable to connect to live data. Try refreshing.';
    }
  });
  state.unsubscribers.push(unsubEvents);
}

function showNotLiveOverlay() {
  els.notLiveOverlay?.classList.remove('hidden');
  els.endedOverlay?.classList.add('hidden');
  els.liveBadge?.classList.add('hidden');
}

function showEndedOverlay() {
  els.notLiveOverlay?.classList.add('hidden');
  els.endedOverlay?.classList.remove('hidden');
  els.liveBadge?.classList.add('hidden');
  // Use game doc scores as authoritative for completed games
  const homeScore = state.game?.homeScore ?? state.homeScore;
  const awayScore = state.game?.awayScore ?? state.awayScore;
  state.homeScore = homeScore;
  state.awayScore = awayScore;
  renderScoreboard();
  if (els.finalScore) {
    els.finalScore.textContent = `${homeScore} - ${awayScore}`;
  }
}

async function startReplay() {
  state.isReplay = true;
  state.isLive = false;
  state.unsubscribers.forEach(unsub => {
    try {
      unsub();
    } catch {
      // ignore
    }
  });
  state.unsubscribers = [];
  state.engagementsActive = false;
  state.liveEventsActive = false;
  updateChatAvailability();

  // Show REPLAY badge instead of LIVE
  if (els.liveBadge) {
    els.liveBadge.classList.remove('hidden');
    const dot = document.getElementById('live-badge-dot');
    const text = document.getElementById('live-badge-text');
    if (dot) { dot.classList.remove('bg-red-500', 'animate-pulse'); dot.classList.add('bg-teal'); }
    if (text) { text.textContent = 'REPLAY'; text.classList.remove('text-red-400'); text.classList.add('text-teal'); }
  }

  if (els.playsFeed) els.playsFeed.innerHTML = '<div data-placeholder="plays" class="text-center text-sand/40 py-8">Loading replay data...</div>';

  let replayEvents, replayChat, replayReactions;
  try {
    [replayEvents, replayChat, replayReactions] = await Promise.all([
      getLiveEvents(state.teamId, state.gameId),
      getLiveChatHistory(state.teamId, state.gameId),
      getLiveReactions(state.teamId, state.gameId)
    ]);
  } catch (error) {
    console.warn('Failed to load replay data:', error);
    if (els.playsFeed) els.playsFeed.innerHTML = '<div class="text-center text-sand/60 py-8">Failed to load replay data. Try refreshing the page.</div>';
    return;
  }

  const replaySession = buildReplaySessionState({
    teamId: state.teamId,
    gameId: state.gameId,
    game: state.game,
    defaultPeriod: getDefaultLivePeriod({ game: state.game, team: state.team }),
    replayEvents,
    replayChat,
    replayReactions
  });

  state.replayEvents = replaySession.replayEvents;
  state.replayChat = replaySession.replayChat;
  state.replayReactions = replaySession.replayReactions;
  state.homeScore = replaySession.scoreboard.homeScore;
  state.awayScore = replaySession.scoreboard.awayScore;
  state.period = replaySession.scoreboard.period;
  state.gameClockMs = replaySession.scoreboard.gameClockMs;
  state.replayIndex = 0;
  state.replayChatIndex = 0;
  state.replayReactionIndex = 0;
  state.replayStartAt = replaySession.replayStartAt;

  els.replayControls?.classList.toggle('hidden', !replaySession.showReplayControls);
  els.reactionsBar?.classList.toggle('hidden', replaySession.hideReactionsBar);
  els.endedOverlay?.classList.toggle('hidden', replaySession.hideEndedOverlay);
  if (els.replayGameLink) {
    els.replayGameLink.href = replaySession.replayGameHref;
  }
  updateChatAvailability();

  if (!replaySession.hasReplayEvents) {
    if (els.playsFeed) els.playsFeed.innerHTML = `<div class="text-center text-sand/60 py-8">${replaySession.emptyStateMessage}</div>`;
    if (els.chatMessages) els.chatMessages.innerHTML = '';
    if (els.replayDuration) els.replayDuration.textContent = formatClock(0);
    if (els.replayCurrent) els.replayCurrent.textContent = formatClock(0);
    renderScoreboard();
    return;
  }

  state.events = [];
  state.eventIds = new Set();
  state.stats = {};
  state.opponentStats = {};

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
  const elapsed = getReplayElapsedMs(Date.now(), state.replayStartTime, state.replaySpeed);
  const replayWindow = collectReplayEventWindow({
    replayEvents: state.replayEvents,
    replayIndex: state.replayIndex,
    elapsedMs: elapsed
  });
  if (replayWindow.events.length) {
    processNewEvents(replayWindow.events);
  }
  state.replayIndex = replayWindow.nextReplayIndex;

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

function advanceReplayStreams(elapsed) {
  const replayWindow = collectReplayStreamWindow({
    replayChat: state.replayChat,
    replayReactions: state.replayReactions,
    replayChatIndex: state.replayChatIndex,
    replayReactionIndex: state.replayReactionIndex,
    replayStartAt: state.replayStartAt
  }, elapsed);

  if (replayWindow.chatMessages.length) {
    state.chatMessages.push(...replayWindow.chatMessages);
  }
  state.replayChatIndex = replayWindow.nextReplayChatIndex;

  replayWindow.reactions.forEach((reaction) => {
    showFloatingReaction(reaction);
  });
  state.replayReactionIndex = replayWindow.nextReplayReactionIndex;

  if (state.chatMessages.length) {
    renderChat();
  }
}

function seekReplay(targetMs) {
  if (!Array.isArray(state.replayEvents) || state.replayEvents.length === 0) {
    state.gameClockMs = targetMs;
    renderScoreboard();
    if (els.replayCurrent) els.replayCurrent.textContent = formatClock(targetMs);
    return;
  }
  state.events = [];
  state.eventIds = new Set();
  state.stats = {};
  state.opponentStats = {};
  state.homeScore = 0;
  state.awayScore = 0;
  state.period = getDefaultLivePeriod({ game: state.game, team: state.team });
  state.gameClockMs = targetMs;
  state.replayIndex = 0;
  state.replayChatIndex = 0;
  state.replayReactionIndex = 0;
  state.chatMessages = [];

  if (els.playsFeed) els.playsFeed.innerHTML = '';
  if (els.chatMessages) {
    els.chatMessages.innerHTML = '';
  }

  const replayWindow = collectReplayEventWindow({
    replayEvents: state.replayEvents,
    replayIndex: state.replayIndex,
    elapsedMs: targetMs
  });
  if (replayWindow.events.length) {
    processNewEvents(replayWindow.events);
  }
  state.replayIndex = replayWindow.nextReplayIndex;

  advanceReplayStreams(targetMs);
  renderScoreboard();
  if (els.replayCurrent) els.replayCurrent.textContent = formatClock(targetMs);
}

function getTimestampMs(ts) {
  return getReplayTimestampMs(ts);
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
      if (!Number.isFinite(speed) || speed <= 0) return;
      if (state.replayPlaying) {
        const nowMs = Date.now();
        const currentElapsedMs = Number.isFinite(state.replayStartTime) && Number.isFinite(state.replaySpeed) && state.replaySpeed > 0
          ? getReplayElapsedMs(nowMs, state.replayStartTime, state.replaySpeed)
          : state.gameClockMs;
        state.gameClockMs = currentElapsedMs;
        if (els.replayCurrent) {
          els.replayCurrent.textContent = formatClock(currentElapsedMs);
        }
        state.replayStartTime = getReplayStartTimeAfterSpeedChange(
          nowMs,
          state.replayStartTime,
          state.replaySpeed,
          speed,
          currentElapsedMs
        );
      }
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
      if (!isSafeUrl(href)) return url;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="text-teal underline">${url}</a>`;
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

function isSafeUrl(href) {
  try {
    const url = new URL(href, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
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

function handleGameUpdate(gameDoc) {
  if (!gameDoc) return;
  state.game = gameDoc;
  refreshVideoPanel();
  renderGameInfo();
  const resetAt = getTimestampMs(gameDoc.liveResetAt) || 0;
  if (resetAt > state.lastResetAt) {
    state.lastResetAt = resetAt;
    resetViewerStateFromGameDoc(gameDoc, 'Game reset. Waiting for plays...');
  }
  if (shouldResetViewerFromGameDoc(gameDoc, state)) {
    resetViewerStateFromGameDoc(gameDoc, 'Game reset. Waiting for plays...');
  }
  if (gameDoc.liveLineup) {
    state.onCourt = Array.isArray(gameDoc.liveLineup.onCourt) ? gameDoc.liveLineup.onCourt : state.onCourt;
    state.bench = Array.isArray(gameDoc.liveLineup.bench) ? gameDoc.liveLineup.bench : state.bench;
    renderLineup();
  }
  if (!state.events.length) {
    state.homeScore = gameDoc.homeScore || state.homeScore;
    state.awayScore = gameDoc.awayScore || state.awayScore;
    state.period = gameDoc.period || state.period;
    if (Number.isFinite(gameDoc.liveClockMs)) {
      state.gameClockMs = gameDoc.liveClockMs;
    } else if (Number.isFinite(gameDoc.gameClockMs)) {
      state.gameClockMs = gameDoc.gameClockMs;
    }
    renderScoreboard();
  }

  if (!state.isReplay) {
    startEngagements();
  }

  if (gameDoc.liveStatus === 'live') {
    if (!state.isLive && !state.isReplay) {
      els.notLiveOverlay?.classList.add('hidden');
      els.endedOverlay?.classList.add('hidden');
      startLiveMode();
    }
  } else if (gameDoc.liveStatus === 'completed') {
    showEndedOverlay();
  } else {
    showNotLiveOverlay();
  }

  updateChatAvailability();
}

function updateChatAvailability() {
  state.chatEnabled = isViewerChatEnabled(state.game, { isReplay: state.isReplay });

  if (els.chatInput) {
    if (state.chatEnabled) {
      els.chatInput.removeAttribute('disabled');
      els.chatInput.placeholder = 'Send a message...';
    } else {
      els.chatInput.setAttribute('disabled', 'disabled');
      els.chatInput.placeholder = 'Chat disabled';
    }
  }
  if (els.chatLockedNotice) {
    els.chatLockedNotice.classList.toggle('hidden', state.chatEnabled);
  }
}

async function init() {
  renderFooter(document.getElementById('footer-container'));

  const params = getUrlParams();
  state.teamId = params.teamId;
  state.gameId = params.gameId;
  state.isReplay = params.replay === 'true';
  state.clipStartMs = Number.isFinite(Number(params.clipStart)) ? Number(params.clipStart) : null;
  state.clipEndMs = Number.isFinite(Number(params.clipEnd)) ? Number(params.clipEnd) : null;

  if (!state.teamId || !state.gameId) {
    if (els.playsFeed) els.playsFeed.innerHTML = '<div class="text-sand/60 text-center py-6">Invalid game link.</div>';
    return;
  }

  let team, game, players, configs;
  try {
    const playersPromise = (state.isReplay
      ? getPlayers(state.teamId, { includeInactive: true })
      : getPlayers(state.teamId)
    ).catch((error) => {
      if (error?.code === 'permission-denied') {
        console.warn('Failed to load public roster for live game viewer:', error);
        return [];
      }
      throw error;
    });
    [team, game, players, configs] = await Promise.all([
      // Replay/live links should still load team metadata for inactive teams.
      getTeam(state.teamId, { includeInactive: true }),
      getGame(state.teamId, state.gameId),
      playersPromise,
      getConfigs(state.teamId)
    ]);
  } catch (error) {
    console.warn('Failed to load game data:', error);
    if (els.playsFeed) els.playsFeed.innerHTML = '<div class="text-sand/60 text-center py-6">Failed to load game data. Check your connection and try refreshing.</div>';
    return;
  }

  if (!game) {
    if (els.playsFeed) els.playsFeed.innerHTML = '<div class="text-sand/60 text-center py-6">Game not found.</div>';
    return;
  }

  state.team = team;
  state.game = game;
  state.players = players || [];
  state.sport = game?.sport || team?.sport || null;
  state.periods = null;
  state.statColumns = resolveLiveStatColumns({
    columns: state.statColumns,
    configs,
    game,
    team
  });
  state.opponentStats = game.opponentStats || {};
  if (game.liveLineup) {
    state.onCourt = Array.isArray(game.liveLineup.onCourt) ? game.liveLineup.onCourt : [];
    state.bench = Array.isArray(game.liveLineup.bench) ? game.liveLineup.bench : [];
  }
  state.homeScore = game.homeScore || 0;
  state.awayScore = game.awayScore || 0;
  state.period = game.period || getDefaultLivePeriod({ game, team });
  state.lastResetAt = getTimestampMs(game.liveResetAt) || 0;

  refreshVideoPanel({ force: true });
  renderGameInfo();
  renderScoreboard();
  renderLineup();
  initTabs();
  initChat();
  initReactions();
  initReplayControls();
  initRecordedReplayControls();
  if (els.shareGameBtn) {
    els.shareGameBtn.addEventListener('click', async () => {
      const isReport = state.isReplay || state.game?.status === 'completed' || state.game?.liveStatus === 'completed';
      const url = isReport
        ? `${window.location.origin}/game.html#teamId=${state.teamId}&gameId=${state.gameId}`
        : `${window.location.origin}/live-game.html?teamId=${state.teamId}&gameId=${state.gameId}`;
      const shareText = buildShareText(isReport ? 'report' : 'live', url);
      const result = await shareOrCopy({
        title: isReport ? 'Game report' : 'Watch game',
        text: shareText.split('\n')[0],
        url,
        clipboardText: shareText
      });
      if (result.status === 'shared') showToast('Share sheet opened!');
      if (result.status === 'copied') showToast('Share text copied!');
      if (result.status === 'failed') showToast('Failed to share.');
    });
  }

  checkAuth((user) => {
    state.user = user;
    renderHeader(document.getElementById('header-container'), user);
    if (!user) {
      const saved = sessionStorage.getItem('liveChatAnonName');
      state.anonName = saved || `Fan${Math.floor(1000 + Math.random() * 9000)}`;
      sessionStorage.setItem('liveChatAnonName', state.anonName);
      if (els.anonName) els.anonName.textContent = state.anonName;
      if (els.chatAnonNotice) els.chatAnonNotice.classList.remove('hidden');
      if (els.anonChange && !els.anonChange.dataset.bound) {
        els.anonChange.dataset.bound = 'true';
        els.anonChange.addEventListener('click', openAnonNameEditor);
      }
      if (els.anonSave && !els.anonSave.dataset.bound) {
        els.anonSave.dataset.bound = 'true';
        els.anonSave.addEventListener('click', saveAnonName);
      }
      if (els.anonCancel && !els.anonCancel.dataset.bound) {
        els.anonCancel.dataset.bound = 'true';
        els.anonCancel.addEventListener('click', closeAnonNameEditor);
      }
    } else {
      if (els.chatAnonNotice) els.chatAnonNotice.classList.add('hidden');
      closeAnonNameEditor();
    }
  }, { skipEmailVerificationCheck: true });

  if (state.isReplay) {
    await startReplay();
    return;
  }

  handleGameUpdate(game);
  const unsubGame = subscribeGame(state.teamId, state.gameId, (updated) => {
    handleGameUpdate(updated);
  }, (error) => {
    console.warn('Game subscription failed:', error);
    setConnectionBanner(true, formatFirestoreError(error));
  });
  state.unsubscribers.push(unsubGame);

  if (els.watchReplayBtn) {
    els.watchReplayBtn.addEventListener('click', () => {
      window.location.href = `live-game.html?teamId=${state.teamId}&gameId=${state.gameId}&replay=true`;
    });
  }

  if (els.replayGameLink) {
    els.replayGameLink.href = `game.html#teamId=${state.teamId}&gameId=${state.gameId}`;
  }
}

init().catch(error => {
  console.error('Live game init failed:', error);
  const feed = document.querySelector('#plays-feed');
  if (feed) feed.innerHTML = '<div class="text-sand/60 text-center py-6">Something went wrong loading the game. Try refreshing the page.</div>';
});
