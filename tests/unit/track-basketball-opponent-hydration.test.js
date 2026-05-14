import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('beta basketball opponent stat hydration', () => {
    it('reloads persisted opponent fouls outside configured stat columns', () => {
        const source = readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');

        expect(source).toContain('const stats = statDefaults(currentConfig.columns);');
        expect(source).toContain('if (data.fouls !== undefined) stats.fouls = data.fouls;');
        expect(source).toContain("opponentStats[opp.id].fouls = opp.stats?.fouls || 0;");
    });
});
