import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../live-game-overlay-poc.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../js/live-game-overlay-poc.js', import.meta.url), 'utf8');

describe('live game overlay prototype page', () => {
    it('ships as a separate no-index broadcast canvas with accessible overlay regions', () => {
        expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
        expect(html).toContain('id="broadcast-stage"');
        expect(html).toContain('id="overlay-video"');
        expect(html).toContain('id="score-bug"');
        expect(html).toContain('id="plays-panel"');
        expect(html).toContain('id="insights-panel"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('js/live-game-overlay-poc.js?v=1');
    });

    it('keeps the local demo isolated while wiring the real read-only subscriptions', () => {
        expect(source).toContain("params.demo === '1'");
        expect(source).toContain("import('./db.js?v=4433176')");
        expect(source).toContain('database.subscribeGame');
        expect(source).toContain('database.subscribeLiveEvents');
        expect(source).toContain('database.subscribeLiveChat');
        expect(source).not.toContain('updateGame(');
        expect(source).not.toContain('postLiveChatMessage(');
    });

    it('provides focus, panel, keyboard, and demo interactions without changing live-game.html', () => {
        expect(html).toContain('id="focus-toggle"');
        expect(html).toContain('id="demo-lab"');
        expect(html).toContain('data-action="home-goal"');
        expect(source).toContain("event.key.toLowerCase() === 'f'");
        expect(source).toContain('togglePanel');
    });
});
