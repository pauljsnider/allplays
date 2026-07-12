import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function getFunctionSource(functionName) {
    const start = dbSource.indexOf(`export async function ${functionName}(`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = dbSource.indexOf('\nexport async function ', start + 1);
    const nextImport = dbSource.indexOf('\nimport ', start + 1);
    const candidates = [nextExport, nextImport].filter((value) => value !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : dbSource.length;
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
        'grantCoachRoleForTeam',
        functionSource
    )(
        deps.Timestamp,
        deps.buildPublicTeamSearchFields,
        deps.addDoc,
        deps.collection,
        deps.db,
        deps.grantCoachRoleForTeam
    );
}

function buildGrantCoachRoleForTeam(deps) {
    const functionSource = getFunctionSource('grantCoachRoleForTeam')
        .replace('export async function grantCoachRoleForTeam', 'return async function grantCoachRoleForTeam');

    return new Function(
        'setDoc',
        'doc',
        'db',
        'arrayUnion',
        functionSource
    )(
        deps.setDoc,
        deps.doc,
        deps.db,
        deps.arrayUnion
    );
}

function makeCreateTeamDeps(overrides = {}) {
    return {
        Timestamp: { now: () => 'NOW' },
        buildPublicTeamSearchFields: () => ({}),
        addDoc: vi.fn(async () => ({ id: 'team-new' })),
        collection: (_db, path) => ({ path }),
        db: {},
        grantCoachRoleForTeam: vi.fn(async () => true),
        ...overrides
    };
}

describe('createTeam coach role grant', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('grants the coach role to the creator after the team is created', async () => {
        const deps = makeCreateTeamDeps();
        const createTeam = buildCreateTeam(deps);

        const teamId = await createTeam({ name: 'Jr Current', ownerId: 'owner-uid' });

        expect(teamId).toBe('team-new');
        expect(deps.grantCoachRoleForTeam).toHaveBeenCalledTimes(1);
        expect(deps.grantCoachRoleForTeam).toHaveBeenCalledWith('owner-uid', 'team-new');
    });

    it('skips the coach role grant when no ownerId is present', async () => {
        const deps = makeCreateTeamDeps();
        const createTeam = buildCreateTeam(deps);

        const teamId = await createTeam({ name: 'Ownerless Team' });

        expect(teamId).toBe('team-new');
        expect(deps.grantCoachRoleForTeam).not.toHaveBeenCalled();
    });

    it('still resolves with the team id when the coach role grant fails', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const setDoc = vi.fn(async () => {
            throw new Error('permission denied');
        });
        const grantCoachRoleForTeam = buildGrantCoachRoleForTeam({
            setDoc,
            doc: (_db, collectionPath, id) => ({ path: `${collectionPath}/${id}` }),
            db: {},
            arrayUnion: (...values) => ({ __arrayUnion: values })
        });
        const deps = makeCreateTeamDeps({ grantCoachRoleForTeam });
        const createTeam = buildCreateTeam(deps);

        const teamId = await createTeam({ name: 'Jr Current', ownerId: 'owner-uid' });

        expect(teamId).toBe('team-new');
        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalled();
    });
});

describe('grantCoachRoleForTeam', () => {
    it('merges coachOf and the coach role onto the users doc', async () => {
        const writes = [];
        const grantCoachRoleForTeam = buildGrantCoachRoleForTeam({
            setDoc: vi.fn(async (ref, data, options) => {
                writes.push({ path: ref.path, data, options });
            }),
            doc: (_db, collectionPath, id) => ({ path: `${collectionPath}/${id}` }),
            db: {},
            arrayUnion: (...values) => ({ __arrayUnion: values })
        });

        const result = await grantCoachRoleForTeam('owner-uid', 'team-new');

        expect(result).toBe(true);
        expect(writes).toEqual([
            {
                path: 'users/owner-uid',
                data: {
                    coachOf: { __arrayUnion: ['team-new'] },
                    roles: { __arrayUnion: ['coach'] }
                },
                options: { merge: true }
            }
        ]);
    });

    it('returns false without throwing when the write is rejected', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const grantCoachRoleForTeam = buildGrantCoachRoleForTeam({
            setDoc: vi.fn(async () => {
                throw new Error('permission denied');
            }),
            doc: (_db, collectionPath, id) => ({ path: `${collectionPath}/${id}` }),
            db: {},
            arrayUnion: (...values) => ({ __arrayUnion: values })
        });

        await expect(grantCoachRoleForTeam('owner-uid', 'team-new')).resolves.toBe(false);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('returns false when userId or teamId is missing', async () => {
        const setDoc = vi.fn();
        const grantCoachRoleForTeam = buildGrantCoachRoleForTeam({
            setDoc,
            doc: () => ({}),
            db: {},
            arrayUnion: (...values) => values
        });

        await expect(grantCoachRoleForTeam('', 'team-new')).resolves.toBe(false);
        await expect(grantCoachRoleForTeam('owner-uid', '')).resolves.toBe(false);
        expect(setDoc).not.toHaveBeenCalled();
    });
});
