import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../live-game-overlay.html', import.meta.url), 'utf8');
const redirect = readFileSync(new URL('../../live-game-overlay-poc.html', import.meta.url), 'utf8');
const currentLiveGame = readFileSync(new URL('../../live-game.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../js/live-game-overlay.js', import.meta.url), 'utf8');
const localProductionAdapter = readFileSync(
    new URL('../manual/live-game-overlay-production-readonly-adapter.js', import.meta.url),
    'utf8'
);

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
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('id="chat-form"');
        expect(html).toContain('id="chat-input"');
        expect(html).toContain('maxlength="2000"');
        expect(html).toContain('id="chat-sign-in"');
        expect(html).toContain('js/live-game-overlay.js?v=3');
    });

    it('keeps the local demo isolated while wiring canonical subscriptions and authenticated chat posting', () => {
        expect(source).toContain("params.demo === '1'");
        expect(source).toContain("params.replay === 'true'");
        expect(source).toContain('startDemoReplayMode');
        expect(source).toContain("return import('./db.js?v=4433176')");
        expect(source).toContain("['localhost', '127.0.0.1']");
        expect(source).toContain("import('../tests/manual/live-game-overlay-production-readonly-adapter.js?v=1')");
        expect(source).toContain("import('./live-game-state.js?v=28')");
        expect(source).toContain('stateTools.applyViewerEventToState');
        expect(source).toContain('stateTools.applyResetEventState');
        expect(source).toContain('stateTools.collectVisibleLiveEventsSequentially');
        expect(source).toContain('stateTools.shouldResetViewerFromGameDoc');
        expect(source).toContain('database.subscribeGame');
        expect(source).toContain('database.subscribeLiveEvents');
        expect(source).toContain('database.subscribeLiveChat');
        expect(source).toContain('database.subscribeReactions');
        expect(source).toContain("import('./auth.js?v=4433179')");
        expect(source).toContain("import('./live-game-chat.js?v=2')");
        expect(source).toContain("import('./safe-image-url.js?v=1')");
        expect(source).toContain('database.postLiveChatMessage');
        expect(source).toContain('uiState.chatUser.uid');
        expect(source).toContain('resolveSafeProfilePhotoWriteUrl');
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
        expect(source).not.toContain('updateGame(');
        expect(source).not.toContain('trackViewerPresence(');
        expect(source).not.toContain('sendReaction(');
        expect(localProductionAdapter).toContain("callPublicProjection('getPublicGameProjection'");
        expect(localProductionAdapter).toContain("gameCollection(teamId, gameId, 'liveEvents')");
        expect(localProductionAdapter).not.toMatch(/\b(?:addDoc|deleteDoc|setDoc|updateDoc|writeBatch|runTransaction)\b/);
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
