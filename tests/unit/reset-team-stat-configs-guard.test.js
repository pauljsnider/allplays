import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function loadResetHelpers(overrides = {}) {
    const source = readDbSource();
    const start = source.indexOf('function isResetBlockingLocalGameAssignment(game = {}) {');
    const end = source.indexOf('// Stats', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const block = source
        .slice(start, end)
        .replace('export async function resetTeamStatConfigs', 'async function resetTeamStatConfigs');
    const factory = new Function(
        'deps',
        `const {
            getDocs,
            query,
            collection,
            where,
            getConfigs,
            writeBatch,
            doc,
            db,
            collectionGroup
        } = deps;
        ${block}
        return {
            isResetBlockingLocalGameAssignment,
            hasResetBlockingLocalGameUsingConfig,
            hasResetBlockingSharedGameUsingConfig,
            resetTeamStatConfigs
        };`
    );

    return factory({
        getDocs: async () => ({ docs: [], empty: true }),
        query: (...args) => ({ args }),
        collection: (...args) => ({ args }),
        where: (...args) => ({ args }),
        getConfigs: async () => [],
        writeBatch: () => ({ delete: () => {}, commit: async () => {} }),
        doc: (...args) => ({ args }),
        db: { name: 'test-db' },
        collectionGroup: (...args) => ({ args }),
        ...overrides
    });
}

describe('resetTeamStatConfigs guard', () => {
    it('treats completed, final, cancelled, and completed-live games as reset-safe history', () => {
        const { isResetBlockingLocalGameAssignment } = loadResetHelpers();

        expect(isResetBlockingLocalGameAssignment({ statTrackerConfigId: 'cfg-1', status: 'completed' })).toBe(false);
        expect(isResetBlockingLocalGameAssignment({ statTrackerConfigId: 'cfg-1', status: 'final' })).toBe(false);
        expect(isResetBlockingLocalGameAssignment({ statTrackerConfigId: 'cfg-1', status: 'cancelled' })).toBe(false);
        expect(isResetBlockingLocalGameAssignment({ statTrackerConfigId: 'cfg-1', liveStatus: 'completed' })).toBe(false);
        expect(isResetBlockingLocalGameAssignment({ statTrackerConfigId: 'cfg-1', status: 'scheduled' })).toBe(true);
        expect(isResetBlockingLocalGameAssignment({ statTrackerConfigId: 'cfg-1', liveStatus: 'live' })).toBe(true);
    });

    it('allows reset when only historical local games reference the config and no shared games do', async () => {
        const batch = {
            delete: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined)
        };
        const getDocs = vi.fn()
            .mockResolvedValueOnce({
                docs: [
                    { data: () => ({ statTrackerConfigId: 'cfg-1', status: 'completed' }) },
                    { data: () => ({ statTrackerConfigId: 'cfg-1', liveStatus: 'completed' }) },
                    { data: () => ({ statTrackerConfigId: 'cfg-1', status: 'cancelled' }) }
                ],
                empty: false
            })
            .mockResolvedValueOnce({ docs: [], empty: true })
            .mockResolvedValueOnce({ docs: [], empty: true })
            .mockResolvedValueOnce({ docs: [], empty: true });
        const getConfigs = vi.fn().mockResolvedValue([{ id: 'cfg-1' }]);
        const doc = vi.fn((...args) => ({ args }));
        const { resetTeamStatConfigs } = loadResetHelpers({
            getDocs,
            getConfigs,
            writeBatch: () => batch,
            doc
        });

        const deletedCount = await resetTeamStatConfigs('team-1');

        expect(deletedCount).toBe(1);
        expect(getDocs).toHaveBeenCalledTimes(4);
        expect(batch.delete).toHaveBeenCalledTimes(1);
        expect(batch.commit).toHaveBeenCalledTimes(1);
        expect(doc).toHaveBeenCalledWith(expect.anything(), 'teams/team-1/statTrackerConfigs', 'cfg-1');
    });

    it('blocks reset when a scheduled local game still references the config', async () => {
        const batch = {
            delete: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined)
        };
        const getDocs = vi.fn().mockResolvedValue({
            docs: [
                { data: () => ({ statTrackerConfigId: 'cfg-1', status: 'scheduled' }) }
            ],
            empty: false
        });
        const { resetTeamStatConfigs } = loadResetHelpers({
            getDocs,
            getConfigs: async () => [{ id: 'cfg-1' }],
            writeBatch: () => batch
        });

        await expect(resetTeamStatConfigs('team-1')).rejects.toThrow(
            'One or more stat configs are still assigned to scheduled or shared games. Remove those assignments before resetting the stats setup.'
        );
        expect(batch.delete).not.toHaveBeenCalled();
        expect(batch.commit).not.toHaveBeenCalled();
    });

    it('allows reset when only completed shared games reference the config', async () => {
        const batch = {
            delete: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined)
        };
        const getDocs = vi.fn()
            .mockResolvedValueOnce({ docs: [], empty: true })
            .mockResolvedValueOnce({
                docs: [
                    { data: () => ({ statTrackerConfigId: 'cfg-1', status: 'completed' }) }
                ],
                empty: false
            })
            .mockResolvedValueOnce({ docs: [], empty: true })
            .mockResolvedValueOnce({ docs: [], empty: true });
        const { resetTeamStatConfigs } = loadResetHelpers({
            getDocs,
            getConfigs: async () => [{ id: 'cfg-1' }],
            writeBatch: () => batch
        });

        const deletedCount = await resetTeamStatConfigs('team-1');

        expect(deletedCount).toBe(1);
        expect(batch.delete).toHaveBeenCalledTimes(1);
        expect(batch.commit).toHaveBeenCalledTimes(1);
    });

    it('blocks reset when a scheduled shared game still references the config', async () => {
        const batch = {
            delete: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined)
        };
        const getDocs = vi.fn()
            .mockResolvedValueOnce({ docs: [], empty: true })
            .mockResolvedValueOnce({
                docs: [
                    { data: () => ({ statTrackerConfigId: 'cfg-1', status: 'scheduled' }) }
                ],
                empty: false
            })
            .mockResolvedValueOnce({ docs: [], empty: true })
            .mockResolvedValueOnce({ docs: [], empty: true });
        const { resetTeamStatConfigs } = loadResetHelpers({
            getDocs,
            getConfigs: async () => [{ id: 'cfg-1' }],
            writeBatch: () => batch
        });

        await expect(resetTeamStatConfigs('team-1')).rejects.toThrow(
            'One or more stat configs are still assigned to scheduled or shared games. Remove those assignments before resetting the stats setup.'
        );
        expect(batch.delete).not.toHaveBeenCalled();
        expect(batch.commit).not.toHaveBeenCalled();
    });
});
