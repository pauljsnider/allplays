import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../live-game-overlay.html', import.meta.url), 'utf8');
const redirect = readFileSync(new URL('../../live-game-overlay-poc.html', import.meta.url), 'utf8');
const currentLiveGame = readFileSync(new URL('../../live-game.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../js/live-game-overlay.js', import.meta.url), 'utf8');
const modelSource = readFileSync(new URL('../../js/live-game-overlay-model.js', import.meta.url), 'utf8');
const liveStateSource = readFileSync(new URL('../../js/live-game-state.js', import.meta.url), 'utf8');
const trackerSource = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
const legacyTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
const appTrackerSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');

describe('live game overlay page', () => {
    it('ships as a separate no-index broadcast canvas with accessible overlay regions', () => {
        expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
        expect(html).toContain('id="broadcast-stage"');
        expect(html).toContain('id="overlay-video"');
        expect(html).toContain('id="score-bug"');
        expect(html).toContain('id="plays-panel"');
        expect(html).toContain('id="insights-panel"');
        expect(html).toContain('id="reactions-overlay"');
        expect(html).toContain('id="replay-controls"');
        expect(html).toContain('id="replay-progress"');
        expect(html).toContain('data-replay-speed="4"');
        expect(html).toContain('data-replay-speed="50"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('id="chat-form"');
        expect(html).toContain('id="chat-input"');
        expect(html).toContain('maxlength="2000"');
        expect(html).toContain('id="chat-sign-in"');
        expect(html).toContain('id="mention-menu"');
        expect(html).toContain('id="mention-allplays"');
        expect(html).toContain('id="anon-change-btn"');
        expect(html).toContain('id="ai-thinking"');
        expect(html).toContain('id="chat-badge"');
        expect(html).toContain('data-chat-reaction="fire"');
        expect(html).toContain('id="replay-scan-status"');
        expect(html).toContain('Video catches up when paused');
        expect(html).toContain('class="replay-play-glyph"');
        expect(html).toContain('class="replay-pause-glyph"');
        expect(html).toContain('data-replay-action="play"');
        expect(html).toContain('id="share-game"');
        expect(html).toContain('id="watch-replay"');
        expect(html).toContain('id="watch-replay-menu"');
        expect(html).toContain('id="scoreboard-toggle"');
        expect(html).toContain('id="scoreboard-menu-toggle"');
        expect(html).toContain('id="mute-toggle"');
        expect(html).toContain('id="fullscreen-toggle"');
        expect(html).toContain('id="game-actions-menu"');
        expect(html).toContain('id="match-report-link"');
        expect(html).toContain('id="game-details-link"');
        expect(html).toContain('id="replay-access-gate"');
        expect(html).toContain('id="announcer-toggle"');
        expect(html).toContain('id="opponent-tab"');
        expect(html).toContain('id="home-team-photo"');
        expect(html).toContain('id="away-team-photo"');
        expect(html).toContain('data-score-hidden="false"');
        expect(html).toMatch(/\.panel-tab\s*\{[^}]*min-width:\s*44px;/);
        expect(html).toContain('js/live-game-overlay.js?v=34');
    });

    it('keeps the local demo isolated while wiring canonical subscriptions and authenticated chat posting', () => {
        expect(source).toContain("params.demo === '1'");
        expect(source).toContain("params.replay === 'true'");
        expect(source).toContain('startDemoReplayMode');
        expect(source).toContain("return import('./db.js?v=4433191')");
        expect(source).toContain("import('./live-game-state.js?v=39')");
        expect(source).toContain('stateTools.applyResetEventState');
        expect(source).toContain('reconcileOverlayLiveEvents');
        expect(source).toContain("from './live-game-overlay-model.js?v=19'");
        expect(source).toContain('resolvePublicProjectionVideoOptions');
        expect(source).toContain('getSafeOverlayProviderUrl(publicUrl)');
        expect(modelSource).toContain('stateTools.applyViewerEventToState');
        expect(modelSource).toContain('stateTools.collectVisibleLiveEventsSequentially');
        expect(source).toContain('stateTools.shouldResetViewerFromGameDoc');
        expect(source).toContain('database.subscribeGame');
        expect(source).toContain('database.subscribeLiveEvents');
        expect(source).toContain('database.subscribeLiveChat');
        expect(source).toContain('database.subscribeReactions');
        expect(source).toContain('getOverlayLiveClockMs');
        expect(source).toContain('syncLiveClockAnchor');
        expect(source).toContain("import('./auth.js?v=4433195')");
        expect(source).toContain("import('./live-game-chat.js?v=2')");
        expect(source).toContain("from './safe-image-url.js?v=1'");
        expect(source).toContain('database.postLiveChatMessage');
        expect(source).toContain('database.sendReaction');
        expect(source).toContain('uiState.chatUser.uid');
        expect(source).toContain('resolveSafeProfilePhotoWriteUrl');
        expect(source).toContain('createSafeImageElement');
        expect(source).toContain('formatOverlayChatMessageHtml');
        expect(source).toContain('generateAiResponse');
        expect(source).toContain("import('./vendor/firebase-ai.js')");
        expect(source).toContain('handleMentionInput');
        expect(source).toContain('ensureChatDisplayName');
        expect(source).toContain('liveChatDisplayName:');
        expect(source).toContain('updateChatUnread');
        expect(source).toContain('text.length > 2000');
        expect(source).toContain('Date.now() - uiState.lastChatSentAt < 1500');
        expect(source).toContain('Message failed to send. Score and video remain connected.');
        expect(source).toContain('database.getLiveEvents');
        expect(source).toContain('database.getLiveChatHistory');
        expect(source).toContain('database.getLiveReactions');
        expect(source).toContain('buildReplaySessionState');
        expect(source).toContain('collectReplayEventWindow');
        expect(source).toContain('collectReplayStreamWindow');
        expect(source).toContain('getReplayElapsedMs');
        expect(source).toContain('seekReplay');
        expect(source).toContain('syncReplayMedia');
        expect(source).toContain('handleYouTubeReplayMessage');
        expect(source).toContain('parseYouTubeReplayTelemetry');
        expect(source).not.toContain('updateGame(');
        expect(source).not.toContain('trackViewerPresence(');
        expect(source).toContain('sendChatReaction');
        expect(source).toContain("from './game-share-links.js?v=1'");
        expect(source).toContain("from './utils.js?v=443367'");
        expect(source).toContain("from './live-game-announcer.js?v=1'");
        expect(source).toContain("import('./team-entitlements.js?v=9')");
        expect(source).toContain('isRecordedReplayTeamPassGateEnabled');
        expect(source).toContain('getTeamEntitlementStatus');
        expect(source).toContain('showReplayAccessGate');
        expect(source).toContain("uiState.videoMuted ? 'mute' : 'unMute'");
        expect(source).toContain('requestFullscreen');
        expect(source).toContain('buildGameWatchShareUrl');
        expect(source).toContain('toggleScoreboardVisibility');
        expect(source).toContain("setConnectionIssue('replay'");
        expect(source).toContain('connectionIssues: new Map()');
        expect(source).toContain("state.events.slice(0, 60)");
        expect(source).toContain('renderTeamPhoto');
        expect(source).toContain('image.dataset.source === safeUrl');
    });

    it('keeps every current tracker live-event family in the overlay parity inventory', () => {
        const eventInventory = [
            ['lineup', [trackerSource, legacyTrackerSource]],
            ['clock_start', [trackerSource, legacyTrackerSource]],
            ['clock_pause', [trackerSource, legacyTrackerSource]],
            ['clock_sync', [trackerSource, legacyTrackerSource]],
            ['period_change', [trackerSource, legacyTrackerSource]],
            ['stat', [trackerSource, legacyTrackerSource, appTrackerSource]],
            ['goal', [trackerSource]],
            ['volleyball', [trackerSource]],
            ['baseball', [trackerSource]],
            ['football_play', [trackerSource]],
            ['football_score', [trackerSource]],
            ['note', [trackerSource, legacyTrackerSource]],
            ['substitution', [legacyTrackerSource]],
            ['undo', [trackerSource, legacyTrackerSource]],
            ['log_remove', [legacyTrackerSource]],
            ['reset', [trackerSource]],
            ['score_update', [appTrackerSource]]
        ];

        eventInventory.forEach(([eventType, producers]) => {
            producers.forEach((producer) => expect(producer).toContain(`type: '${eventType}'`));
        });
        expect(liveStateSource).toContain("event?.type === 'lineup'");
        expect(liveStateSource).toContain("event?.type === 'clock_sync'");
        expect(modelSource).toContain("event.type === 'clock_start'");
        expect(modelSource).toContain("event.type === 'clock_pause'");
        expect(modelSource).toContain("event.type === 'reset'");
        expect(modelSource).toContain('stateTools.applyViewerEventToState');
    });

    it('provides focus, panel, keyboard, and demo interactions without changing live-game.html', () => {
        expect(html).toContain('id="focus-toggle"');
        expect(html).toContain('id="demo-lab"');
        expect(html).toContain('data-action="home-goal"');
        expect(source).toContain("event.key.toLowerCase() === 'f'");
        expect(source).toContain('togglePanel');
        expect(source).toContain('usesCompactPanelLayout');
        expect(html).toContain('data-panel-layout="wide"');
        expect(html).toContain('data-panel-open="false"');
        expect(html).toContain('@media (min-width: 901px) and (max-width: 1320px)');
        expect(currentLiveGame).not.toContain('live-game-overlay');
    });

    it('keeps the former preview URL as a query-preserving compatibility redirect', () => {
        expect(redirect).toContain("new URL('live-game-overlay.html', window.location.href)");
        expect(redirect).toContain('destination.search = window.location.search');
        expect(redirect).toContain('destination.hash = window.location.hash');
    });
});
