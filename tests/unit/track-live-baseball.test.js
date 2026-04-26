import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTrackLive() {
    return readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
}

describe('track-live baseball scorekeeping wiring', () => {
    it('renders baseball controls and hides generic stat tables for baseball sports', () => {
        const source = readTrackLive();

        expect(source).toContain("import { applyBaseballScorekeepingAction, createBaseballLiveState");
        expect(source).toContain('id="baseballScorekeepingPanel"');
        expect(source).toContain('id="teamStatsPanel"');
        expect(source).toContain('id="opponentStatsPanel"');
        expect(source).toContain('isBaseballScorekeepingSport(liveSport)');
        expect(source).toContain("teamStatsPanel.classList.toggle('hidden', gameState.isBaseballScorekeeping)");
        expect(source).toContain('data-baseball-action="ball"');
        expect(source).toContain('data-baseball-action="homeRun"');
    });

    it('publishes baseball live events through the existing live event flow', () => {
        const source = readTrackLive();

        expect(source).toContain("type: 'baseball'");
        expect(source).toContain('baseballState: result.state');
        expect(source).toContain('situation: getBaseballSituationSummary(result.state)');
        expect(source).toContain('await addLogEntry(result.description');
    });
});
