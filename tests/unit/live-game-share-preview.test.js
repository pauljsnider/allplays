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
        expect(rewrites[1]).toEqual({
            source: '/report',
            function: 'gameReportSharePreview'
        });
        expect(rewrites[3]).toEqual({
            source: '!/app/assets/**',
            destination: '/index.html'
        });
    });

    it('uses the branded Firebase Hosting domain for preview shares', () => {
        const tracker = repoFile('track-live.html');
        const schedule = repoFile('edit-schedule.html');

        expect(tracker).toContain('https://share.allplays.ai/watch?teamId=${encodeURIComponent(currentTeamId)}&gameId=${encodeURIComponent(currentGameId)}');
        expect(schedule).toContain('https://share.allplays.ai/watch?teamId=${encodeURIComponent(currentTeamId)}&gameId=${encodeURIComponent(gameId)}');
        expect(tracker).not.toContain('https://game-flow-c6311.web.app/watch');
        expect(schedule).not.toContain('https://game-flow-c6311.web.app/watch');
        expect(tracker).not.toContain('`${window.location.origin}/watch?');
        expect(schedule).not.toContain('`${window.location.origin}/watch?');
    });

    it('keeps crawler metadata on the branded share origin', () => {
        const source = repoFile('functions/index.js');
        const start = source.indexOf('exports.liveGameSharePreview = functions');
        const end = source.indexOf('exports.gameReportSharePreview = functions', start);
        const handler = source.slice(start, end);

        expect(handler).toContain('setPublicSharePreviewCorsHeaders(res)');
        expect(handler).toContain('`${PUBLIC_SHARE_PREVIEW_ORIGIN}/watch?${query}`');
        expect(handler).toContain('buildLiveGameShareParams');
        expect(handler).not.toContain('`https://allplays.ai/watch?${query}`');
        expect(source).toContain("const PUBLIC_SHARE_PREVIEW_ORIGIN = 'https://share.allplays.ai'");
        expect(source).not.toContain("const PUBLIC_SHARE_PREVIEW_ORIGIN = 'https://game-flow-c6311.web.app'");
    });

    it('uses public metadata when available and a generic redirect for private reports', () => {
        const source = repoFile('functions/index.js');
        const start = source.indexOf('exports.gameReportSharePreview = functions');
        const end = source.indexOf('exports.playerSharePreview = functions', start);
        const handler = source.slice(start, end);
        const projectionStart = handler.indexOf('const game = await getPublicGameProjection(teamId, gameId, team);');
        const paramsStart = handler.indexOf('const params = new URLSearchParams', projectionStart);
        const privateProjectionBranch = handler.slice(projectionStart, paramsStart);

        expect(start).toBeGreaterThan(-1);
        expect(handler).toContain('getPublicGameProjection(teamId, gameId, team)');
        expect(privateProjectionBranch).not.toContain("res.status(404).send('Game report not found.')");
        expect(handler).toContain(': buildGameReportShareMetadata();');
        expect(handler).toContain("ip: `game-report-share|${getRequestIp(req)}`");
        expect(handler).toContain('`${PUBLIC_SHARE_PREVIEW_ORIGIN}/report?${query}`');
        expect(handler).toContain('`https://allplays.ai/game.html#${query}`');
        expect(handler).toContain("res.set('X-Robots-Tag', 'noindex, nofollow')");
        expect(handler).not.toContain('getPlayers(');
    });
});
