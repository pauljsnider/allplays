import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migrationSource = readFileSync(new URL('../../_migration/backfill-reciprocal-parent-links.js', import.meta.url), 'utf8');

function getFunctionSource(functionName) {
    const start = migrationSource.indexOf(`function ${functionName}`) !== -1
        ? migrationSource.indexOf(`function ${functionName}`)
        : migrationSource.indexOf(`export function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextFunction = migrationSource.indexOf('\nfunction ', start + 1);
    const nextAsyncFunction = migrationSource.indexOf('\nasync function ', start + 1);
    const nextExportFunction = migrationSource.indexOf('\nexport function ', start + 1);
    const candidates = [nextFunction, nextAsyncFunction, nextExportFunction].filter((value) => value !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : migrationSource.length;
    return migrationSource.slice(start, end);
}

function loadBuildParentAccessRepairUpdate() {
    const uniqueStringsSource = getFunctionSource('uniqueStrings');
    const buildParentAccessRepairUpdateSource = getFunctionSource('buildParentAccessRepairUpdate')
        .replace('export function buildParentAccessRepairUpdate', 'function buildParentAccessRepairUpdate');

    return new Function(`
        ${uniqueStringsSource}
        ${buildParentAccessRepairUpdateSource}
        return buildParentAccessRepairUpdate;
    `)();
}

describe('buildParentAccessRepairUpdate', () => {
    it('recomputes parent access keys even when the parentOf link already exists', () => {
        const buildParentAccessRepairUpdate = loadBuildParentAccessRepairUpdate();
        const result = buildParentAccessRepairUpdate({
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1', teamName: 'Team One', playerName: 'Jordan' }
            ],
            parentTeamIds: [],
            parentPlayerKeys: [],
            roles: []
        }, [
            { teamId: 'team-1', playerId: 'player-1', teamName: 'Team One', playerName: 'Jordan' }
        ]);

        expect(result).toEqual({
            changed: true,
            missingLinks: [],
            userUpdate: {
                parentOf: [
                    { teamId: 'team-1', playerId: 'player-1', teamName: 'Team One', playerName: 'Jordan' }
                ],
                parentTeamIds: ['team-1'],
                parentPlayerKeys: ['team-1::player-1'],
                roles: ['parent']
            }
        });
    });
});
