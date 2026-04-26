import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TEAM_HTML_PATH = path.resolve(process.cwd(), 'team.html');

describe('team tournament standings wiring', () => {
  it('imports the tournament standings helper and renders the public standings section', () => {
    const source = fs.readFileSync(TEAM_HTML_PATH, 'utf8');

    expect(source).toContain("import { computeTournamentPoolStandings } from './js/tournament-standings.js?v=2';");
    expect(source).toContain('id="tournament-standings-section"');
    expect(source).toContain('Results &amp; Standings');
    expect(source).toContain('No completed tournament games with scores yet.');
    expect(source).toContain('renderTournamentStandingsSection(tournamentStandings, team);');
  });
});
