import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoFile = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('public player share preview wiring', () => {
    it('gives direct player links a branded generic metadata fallback', () => {
        const html = repoFile('player.html');

        expect(html).toContain('<meta property="og:title" content="Player profile on ALL PLAYS">');
        expect(html).toContain('<meta property="og:image" content="https://allplays.ai/img/logo_large.png">');
        expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    });

    it('routes clean player share links through the privacy-aware preview function', () => {
        const firebaseConfig = JSON.parse(repoFile('firebase.json'));

        expect(firebaseConfig.hosting.rewrites[1]).toEqual({
            source: '/player-card',
            function: 'playerSharePreview'
        });
    });

    it('only reveals the player share action after the preview endpoint approves a HEAD request', () => {
        const html = repoFile('player.html');

        expect(html).toContain('id="player-share-action" class="hidden');
        expect(html).toContain("fetch(shareUrl, { method: 'HEAD', credentials: 'omit' })");
        expect(html).toContain("if (!response.ok) return;");
        expect(html).toContain("container.classList.remove('hidden');");
        expect(html).toContain("url = new URL('/player-card', 'https://game-flow-c6311.web.app')");
        expect(html).not.toContain("url = new URL('/player-card', window.location.origin)");
    });

    it('keeps the server handler behind the public projection and no-store response boundary', () => {
        const source = repoFile('functions/index.js');
        const start = source.indexOf('exports.playerSharePreview = functions');
        const end = source.indexOf('exports.reportPublicOpportunity', start);
        const handler = source.slice(start, end);

        expect(start).toBeGreaterThan(-1);
        expect(handler).toContain('buildPublicPlayerShareProjection');
        expect(handler).toContain("res.status(404).send('Player profile not found.')");
        expect(handler).toContain("res.set('Cache-Control', 'private, no-store, max-age=0')");
        expect(handler).toContain('setPublicSharePreviewCorsHeaders(res)');
        expect(source).toContain("res.set('Access-Control-Allow-Origin', '*')");
        expect(handler).toContain("if (req.method === 'OPTIONS')");
        expect(source).toContain("const PUBLIC_SHARE_PREVIEW_ORIGIN = 'https://game-flow-c6311.web.app'");
        expect(handler).toContain('`${PUBLIC_SHARE_PREVIEW_ORIGIN}/player-card?${shareParams.toString()}`');
        expect(handler.indexOf("res.set('Cache-Control', 'private, no-store, max-age=0')"))
            .toBeLessThan(handler.indexOf('firestore.doc(`teams/${teamId}`).get()'));
        expect(handler).not.toContain('photoUrl');
    });
});
