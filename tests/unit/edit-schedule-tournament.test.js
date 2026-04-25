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

  it('renders admin-only tournament standings editor controls in the schedule flow', () => {
    const source = readEditSchedule();

    expect(source).toContain('id="tournament-standings-admin-panel"');
    expect(source).toContain('id="tournament-standings-modal"');
    expect(source).toContain('renderTournamentStandingsAdminPanel(');
    expect(source).toContain('openTournamentStandingsEditor(');
    expect(source).toContain('if (!canManageTournamentStandings() || pools.length === 0)');
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

  it('wires the pool advancement action through the full team game list', () => {
    const source = readEditSchedule();

    expect(source).toContain('applyTournamentAdvancementPatches');
    expect(source).toContain('planTournamentPoolAdvancement');
    expect(source).toContain('class="advance-tournament-pool-btn');
    expect(source).toContain("document.querySelectorAll('.advance-tournament-pool-btn').forEach(btn => {");
    expect(source).toContain('let allTeamGamesCache = {};');
    expect(source).toContain('allTeamGamesCache = {};');
    expect(source).toContain('allTeamGamesCache[event.id] = eventRecord;');
    expect(source).toContain('const games = Object.values(allTeamGamesCache).filter((candidate) => candidate?.id);');
    expect(source).toContain('const plan = planTournamentPoolAdvancement(games, {');
    expect(source).toContain('await applyTournamentAdvancementPatches(currentTeamId, plan.patches, games);');
    expect(source).toContain('Skipped advancement for ${poolName}. ${plan.reason}');
  });

  it('wires persistence helpers for saving and clearing pool ranking overrides', () => {
    const source = readEditSchedule();

    expect(source).toContain('saveTournamentPoolOverride');
    expect(source).toContain('clearTournamentPoolOverride');
    expect(source).toContain('persistTournamentStandingsOverride');
    expect(source).toContain('handleClearTournamentStandingsOverride');
  });
});
