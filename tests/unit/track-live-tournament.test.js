import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTrackLive() {
  return readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
}

describe('track live tournament advancement wiring', () => {
  it('recomputes tournament bracket patches when a game is finalized', () => {
    const source = readTrackLive();

    expect(source).toContain("import { collectTournamentAdvancementPatches } from './js/tournament-brackets.js?v=1';");
    expect(source).toContain('const advancementPatches = collectTournamentAdvancementPatches(allGames);');
    expect(source).toContain('const maxAdvancementBatchOperations = 450;');
    expect(source).toContain('for (let i = 0; i < advancementPatches.length; i += maxAdvancementBatchOperations) {');
    expect(source).toContain('advancementPatches.slice(i, i + maxAdvancementBatchOperations).forEach(({ gameId, tournament }) => {');
  });
});
