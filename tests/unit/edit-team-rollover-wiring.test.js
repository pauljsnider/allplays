import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditTeamSource() {
    return readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');
}

describe('edit team roster rollover wiring', () => {
    it('loads a selectable player preview and copies only selected players after team creation', () => {
        const source = readEditTeamSource();

        expect(source).toContain('id="rosterRolloverSourceTeam"');
        expect(source).toContain('class="rollover-player-checkbox');
        expect(source).toContain('getSelectedRolloverPlayerIds()');
        expect(source).toContain('copySelectedPlayersForTeamRollover(rolloverSourceTeamId, newTeamId, selectedRolloverPlayerIds)');
    });

    it('reports rollover failures clearly before leaving the create flow', () => {
        const source = readEditTeamSource();

        expect(source).toContain('Roster rollover failed:');
        expect(source).toContain('Team created, but roster rollover failed. No selected players were copied.');
    });
});
