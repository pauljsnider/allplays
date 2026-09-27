import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function extractFunction(name, nextMarker) {
    const start = dbSource.indexOf(`export async function ${name}`);
    const end = dbSource.indexOf(nextMarker, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return dbSource.slice(start, end).replace(`export async function ${name}`, `async function ${name}`);
}

function loadConfigMutationClients(callableFactory) {
    const deleteSource = extractFunction('deleteConfig', 'export async function resetTeamStatConfigs');
    const resetSource = extractFunction('resetTeamStatConfigs', '// Stats');
    const factory = new Function(
        'httpsCallable',
        'functions',
        `${deleteSource}\n${resetSource}\nreturn { deleteConfig, resetTeamStatConfigs };`
    );
    return factory(callableFactory, { name: 'functions' });
}

describe('stat config mutation clients', () => {
    it('routes delete through the server-authoritative callable', async () => {
        const callable = vi.fn().mockResolvedValue({ data: { deleted: true } });
        const httpsCallable = vi.fn(() => callable);
        const { deleteConfig } = loadConfigMutationClients(httpsCallable);

        await expect(deleteConfig('team-1', 'config-1')).resolves.toBe(true);
        expect(httpsCallable).toHaveBeenCalledWith({ name: 'functions' }, 'deleteStatConfig');
        expect(callable).toHaveBeenCalledWith({ teamId: 'team-1', configId: 'config-1' });
    });

    it('routes reset through one all-or-nothing server transaction', async () => {
        const callable = vi.fn().mockResolvedValue({ data: { resetCount: 2 } });
        const httpsCallable = vi.fn(() => callable);
        const { resetTeamStatConfigs } = loadConfigMutationClients(httpsCallable);

        await expect(resetTeamStatConfigs('team-1')).resolves.toBe(2);
        expect(httpsCallable).toHaveBeenCalledWith({ name: 'functions' }, 'resetTeamStatConfigs');
        expect(callable).toHaveBeenCalledWith({ teamId: 'team-1' });
    });

    it.each([
        ['deleteConfig', { data: {} }],
        ['resetTeamStatConfigs', { data: { resetCount: -1 } }]
    ])('rejects malformed %s responses instead of reporting a mutation success', async (method, response) => {
        const { deleteConfig, resetTeamStatConfigs } = loadConfigMutationClients(
            vi.fn(() => vi.fn().mockResolvedValue(response))
        );

        const promise = method === 'deleteConfig'
            ? deleteConfig('team-1', 'config-1')
            : resetTeamStatConfigs('team-1');
        await expect(promise).rejects.toThrow(/response is invalid/i);
    });
});
