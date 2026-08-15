import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoFile = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('live game share preview wiring', () => {
    it('gives existing live-game links a branded metadata fallback', () => {
        const html = repoFile('live-game.html');

        expect(html).toContain('<meta property="og:title" content="Watch a live game on ALL PLAYS">');
        expect(html).toContain('<meta property="og:image" content="https://allplays.ai/img/logo_large.png">');
        expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    });

    it('routes new watch shares through the game-specific preview function before the SPA fallback', () => {
        const firebaseConfig = JSON.parse(repoFile('firebase.json'));
        const rewrites = firebaseConfig.hosting.rewrites;

        expect(rewrites[0]).toEqual({
            source: '/watch',
            function: 'liveGameSharePreview'
        });
        expect(rewrites[2]).toEqual({
            source: '!/app/assets/**',
            destination: '/index.html'
        });
    });

    it('keeps preview shares on Firebase Hosting until the canonical host cutover', () => {
        const tracker = repoFile('track-live.html');
        const schedule = repoFile('edit-schedule.html');
        const cutoverRunbook = repoFile('docs/hosting-cutover-runbook.md');

        expect(cutoverRunbook).toContain('from\nGitHub Pages to the Firebase Hosting candidate');
        expect(tracker).toContain('https://game-flow-c6311.web.app/watch?teamId=${encodeURIComponent(currentTeamId)}&gameId=${encodeURIComponent(currentGameId)}');
        expect(schedule).toContain('https://game-flow-c6311.web.app/watch?teamId=${encodeURIComponent(currentTeamId)}&gameId=${encodeURIComponent(gameId)}');
        expect(tracker).not.toContain('`${window.location.origin}/watch?');
        expect(schedule).not.toContain('`${window.location.origin}/watch?');
    });

    it('keeps crawler metadata on the deployed candidate origin before DNS cutover', () => {
        const source = repoFile('functions/index.js');
        const start = source.indexOf('exports.liveGameSharePreview = functions');
        const end = source.indexOf('exports.playerSharePreview = functions', start);
        const handler = source.slice(start, end);

        expect(handler).toContain('setPublicSharePreviewCorsHeaders(res)');
        expect(handler).toContain('`${PUBLIC_SHARE_PREVIEW_ORIGIN}/watch?${query}`');
        expect(handler).not.toContain('`https://allplays.ai/watch?${query}`');
    });
});
