import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
  return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule tournament wiring', () => {
  it('includes tournament bracket configuration fields in the game form', () => {
    const source = readEditSchedule();

    expect(source).toContain('id="tournament-settings"');
    expect(source).toContain('id="tournamentBracketName"');
    expect(source).toContain('id="tournamentRoundName"');
    expect(source).toContain('id="tournamentHomeSourceType"');
    expect(source).toContain('id="tournamentAwaySourceType"');
  });

  it('persists tournament metadata into saved game data', () => {
    const source = readEditSchedule();
    const submitIndex = source.indexOf("document.getElementById('add-game-form').addEventListener('submit', async (e) => {");
    const endIndex = source.indexOf('// ===== PRACTICE FORM HANDLERS =====');
    expect(submitIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(submitIndex);

    const block = source.slice(submitIndex, endIndex);
    const tournamentDataMatches = block.match(/const tournamentData = readTournamentFormState\(\);/g) || [];
    expect(tournamentDataMatches).toHaveLength(1);
    expect(block).toContain('if (tournamentData) {');
    expect(block).toContain('gameData.tournament = tournamentData;');
  });

  it('wires the pool advancement action through the tournament admin workflow', () => {
    const source = readEditSchedule();

    expect(source).toContain('applyTournamentAdvancementPatches');
    expect(source).toContain('planTournamentPoolAdvancement');
    expect(source).toContain('class="advance-tournament-pool-btn');
    expect(source).toContain("document.querySelectorAll('.advance-tournament-pool-btn').forEach(btn => {");
    expect(source).toContain('const plan = planTournamentPoolAdvancement(games, {');
    expect(source).toContain('await applyTournamentAdvancementPatches(currentTeamId, plan.patches, games);');
    expect(source).toContain('Skipped advancement for ${poolName}. ${plan.reason}');
  });
});
