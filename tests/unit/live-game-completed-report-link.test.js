import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('live game completed-state match report path', () => {
    it('keeps a direct match report action on the completed live page', () => {
        const html = readRepoFile('live-game.html');
        const js = readRepoFile('js/live-game.js');

        expect(html).toContain('id="watch-report-btn"');
        expect(html).toContain('Match Report');
        expect(js).toContain("watchReportBtn: q('#watch-report-btn')");
        expect(js).toContain('els.watchReportBtn.href = `game.html#teamId=${state.teamId}&gameId=${state.gameId}`;');
        expect(js).toContain("els.replayReportLink.classList.toggle('hidden', !(state.isReplay || state.game?.status === 'completed' || state.game?.liveStatus === 'completed'));");
    });
});
