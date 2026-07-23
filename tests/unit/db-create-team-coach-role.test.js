import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function getFunctionSource(functionName) {
    const start = dbSource.indexOf(`export async function ${functionName}(`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = dbSource.indexOf('\nexport async function ', start + 1);
    const end = nextExport === -1 ? dbSource.length : nextExport;
    return dbSource.slice(start, end);
}

function buildCreateTeam(deps) {
    const functionSource = getFunctionSource('createTeam')
        .replace('export async function createTeam', 'return async function createTeam');

    return new Function(
        'Timestamp',
        'buildPublicTeamSearchFields',
        'addDoc',
        'collection',
        'db',
        functionSource
    )(
        deps.Timestamp,
        deps.buildPublicTeamSearchFields,
        deps.addDoc,
        deps.collection,
        deps.db
    );
}

describe('createTeam owner access grant', () => {
    it('creates the team without attempting a client write to server-managed user roles', async () => {
        const addDoc = vi.fn(async () => ({ id: 'team-new' }));
        const createTeam = buildCreateTeam({
            Timestamp: { now: () => 'NOW' },
            buildPublicTeamSearchFields: () => ({}),
            addDoc,
            collection: (_db, path) => ({ path }),
            db: {}
        });

        await expect(createTeam({ name: 'Vipers', ownerId: 'owner-uid' })).resolves.toBe('team-new');
        expect(addDoc).toHaveBeenCalledTimes(1);
        expect(getFunctionSource('createTeam')).not.toContain('grantCoachRoleForTeam');
        expect(dbSource).not.toContain('export async function grantCoachRoleForTeam');
    });
});
