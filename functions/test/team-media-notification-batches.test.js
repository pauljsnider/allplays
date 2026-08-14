import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('./send-category-notification-test-helpers.cjs');

const DISPATCH_NOW = new Date('2026-06-21T12:00:00.000Z');

function buildTeamMediaBacklog(count) {
    const entries = [];
    for (let index = count - 1; index >= 0; index -= 1) {
        const batchId = `batch-${String(index).padStart(3, '0')}`;
        const teamId = `team-${(index % 3) + 1}`;
        entries.push([`teamMediaNotificationBatches/${batchId}`, {
            status: 'pending',
            dueAt: new Date(Date.parse('2026-06-20T00:00:00.000Z') + (index * 1000)).toISOString(),
            teamId,
            folderId: 'folder-1',
            albumName: 'Game Highlights',
            itemCount: 1,
            audienceContext: { albumVisibility: 'team' }
        }]);
    }
    entries.push(
        ['teams/team-2', {}],
        ['teams/team-3', {}],
        ['teams/team-1/mediaFolders/folder-1', { name: 'Game Highlights', visibility: 'team' }],
        ['teams/team-2/mediaFolders/folder-1', { name: 'Game Highlights', visibility: 'team' }],
        ['teams/team-3/mediaFolders/folder-1', { name: 'Game Highlights', visibility: 'team' }]
    );
    return Object.fromEntries(entries);
}

function terminalBatchIds(env) {
    return env.updatedDocs
        .filter(({ path, value }) => path.startsWith('teamMediaNotificationBatches/') && ['sent', 'skipped'].includes(value.status))
        .map(({ path }) => path.split('/').pop());
}

test('team media notification batch metadata groups album uploads into hourly windows', () => {
        const { internals, cleanup } = loadNotificationInternals();

        try {
            const metadata = internals.buildTeamMediaNotificationBatchMetadata({
                teamId: 'team 1',
                itemId: 'photo-1',
                item: {
                    folderId: 'folder 1',
                    title: 'Warmups',
                    type: 'photo',
                    createdAt: '2026-06-20T15:42:12.000Z'
                },
                folder: {
                    id: 'folder 1',
                    name: 'Game Highlights',
                    visibility: 'team'
                },
                now: new Date('2026-06-20T15:45:00.000Z')
            });

            assert.equal(metadata.batchId, 'team_1__folder_1__2026-06-20T15_00_00_000Z');
            assert.equal(metadata.albumName, 'Game Highlights');
            assert.deepEqual(metadata.audienceContext, { albumVisibility: 'team' });
            assert.equal(metadata.itemType, 'photo');
            assert.equal(metadata.windowStartAt.toISOString(), '2026-06-20T15:00:00.000Z');
            assert.equal(metadata.dueAt.toISOString(), '2026-06-20T16:00:00.000Z');
        } finally {
            cleanup();
        }
});

test('team media notification batch writes preserve restricted album audience context', () => {
        const { internals, cleanup } = loadNotificationInternals();

        try {
            const metadata = internals.buildTeamMediaNotificationBatchMetadata({
                teamId: 'team-1',
                itemId: 'photo-1',
                item: { folderId: 'folder-1', type: 'photo' },
                folder: {
                    id: 'folder-1',
                    name: 'Player gallery',
                    visibility: 'team',
                    allowedUserIds: ['parent-2', 'staff-1'],
                    allowedRoles: ['parent']
                }
            });

            const nextBatch = internals.buildTeamMediaNotificationBatchWrite({}, metadata);

            assert.deepEqual(nextBatch.audienceContext, {
                albumVisibility: 'team',
                allowedUserIds: ['parent-2', 'staff-1'],
                allowedRoles: ['parent']
            });
        } finally {
            cleanup();
        }
});

test('team media notification batch metadata preserves private album audience rules and skips deleted items', () => {
        const { internals, cleanup } = loadNotificationInternals();

        try {
            assert.deepEqual(internals.buildTeamMediaNotificationBatchMetadata({
                teamId: 'team-1',
                itemId: 'photo-1',
                item: { folderId: 'folder-1', type: 'photo' },
                folder: {
                    id: 'folder-1',
                    name: 'Private film',
                    visibility: 'private',
                    allowedUserIds: ['parent-2'],
                    allowedRoles: ['staff']
                }
            })?.audienceContext, {
                albumVisibility: 'private',
                allowedUserIds: ['parent-2'],
                allowedRoles: ['staff']
            });
            assert.equal(internals.buildTeamMediaNotificationBatchMetadata({
                teamId: 'team-1',
                itemId: 'photo-2',
                item: { folderId: 'folder-1', type: 'photo', deleted: true },
                folder: { id: 'folder-1', name: 'Highlights', visibility: 'team' }
            }), null);
        } finally {
            cleanup();
        }
});

test('team media notification payload summarizes the album and total batch count', () => {
        const { internals, cleanup } = loadNotificationInternals();

        try {
            assert.deepEqual(internals.buildTeamMediaNotificationPayload({
                albumName: 'Game Highlights',
                itemCount: 3
            }), {
                title: 'New team media',
                body: 'Game Highlights has 3 new media items.'
            });
        } finally {
            cleanup();
        }
});

test('team media notification batch writes keep itemCount aligned with unique item ids', () => {
        const { internals, cleanup } = loadNotificationInternals();

        try {
            const metadata = internals.buildTeamMediaNotificationBatchMetadata({
                teamId: 'team-1',
                itemId: 'photo-1',
                item: {
                    folderId: 'folder-1',
                    title: 'Warmups',
                    type: 'photo',
                    createdAt: '2026-06-20T15:42:12.000Z'
                },
                folder: {
                    id: 'folder-1',
                    name: 'Game Highlights',
                    visibility: 'team'
                },
                now: new Date('2026-06-20T15:45:00.000Z')
            });

            const nextBatch = internals.buildTeamMediaNotificationBatchWrite({
                itemCount: 2,
                itemIds: ['photo-1'],
                itemTypes: ['photo']
            }, metadata);

            assert.equal(nextBatch.itemCount, 1);
            assert.deepEqual(nextBatch.itemIds, ['photo-1']);
            assert.deepEqual(nextBatch.itemTypes, ['photo']);
        } finally {
            cleanup();
        }
});

test('team media dispatcher drains 120 oldest-due batches through limit(50) pages', async () => {
    const { env, internals, cleanup } = loadNotificationInternals({
        initialDocs: buildTeamMediaBacklog(120)
    });

    try {
        const summary = await internals.dispatchDueTeamMediaNotificationBatches(DISPATCH_NOW);

        assert.equal(summary.stoppedBecause, 'drained');
        assert.equal(summary.backlogDrained, true);
        assert.equal(summary.processedCount, 120);
        assert.equal(summary.sentCount, 120);
        assert.equal(summary.pagesAttempted, 3);
        assert.deepEqual(env.teamMediaQueryLog.map((query) => query.limit), [50, 50, 50]);
        assert.deepEqual(env.teamMediaQueryLog.map((query) => query.order), [
            { field: 'dueAt', direction: 'asc' },
            { field: 'dueAt', direction: 'asc' },
            { field: 'dueAt', direction: 'asc' }
        ]);
        assert.deepEqual(env.teamMediaQueryLog.map((query) => query.resultIds.length), [50, 50, 20]);
        assert.equal(new Set(terminalBatchIds(env)).size, 120);
        assert.equal(terminalBatchIds(env).length, 120);
    } finally {
        cleanup();
    }
});

test('team media dispatcher reports an empty queue as drained', async () => {
    const { env, internals, cleanup } = loadNotificationInternals();

    try {
        const summary = await internals.dispatchDueTeamMediaNotificationBatches(DISPATCH_NOW);

        assert.equal(summary.stoppedBecause, 'drained');
        assert.equal(summary.processedCount, 0);
        assert.equal(summary.pagesAttempted, 1);
        assert.equal(env.teamMediaQueryLog.length, 1);
    } finally {
        cleanup();
    }
});

test('team media dispatcher drains a partial final page', async () => {
    const { env, internals, cleanup } = loadNotificationInternals({
        initialDocs: buildTeamMediaBacklog(73)
    });

    try {
        const summary = await internals.dispatchDueTeamMediaNotificationBatches(DISPATCH_NOW);

        assert.equal(summary.stoppedBecause, 'drained');
        assert.equal(summary.processedCount, 73);
        assert.deepEqual(env.teamMediaQueryLog.map((query) => query.resultIds.length), [50, 23]);
    } finally {
        cleanup();
    }
});

test('team media dispatcher stops at the page cap and resumes remaining batches once', async () => {
    const { env, internals, cleanup } = loadNotificationInternals({
        initialDocs: buildTeamMediaBacklog(120)
    });

    try {
        const firstSummary = await internals.dispatchDueTeamMediaNotificationBatches(DISPATCH_NOW, { maxPages: 2 });
        assert.equal(firstSummary.stoppedBecause, 'maxPages');
        assert.equal(firstSummary.processedCount, 100);
        assert.equal(firstSummary.backlogDrained, false);

        const secondSummary = await internals.dispatchDueTeamMediaNotificationBatches(DISPATCH_NOW);
        assert.equal(secondSummary.stoppedBecause, 'drained');
        assert.equal(secondSummary.processedCount, 20);
        assert.equal(new Set(terminalBatchIds(env)).size, 120);
        assert.equal(terminalBatchIds(env).length, 120);
    } finally {
        cleanup();
    }
});

test('team media dispatcher stops at the runtime cap and leaves work for the next invocation', async () => {
    const { internals, cleanup } = loadNotificationInternals({
        initialDocs: buildTeamMediaBacklog(3)
    });
    const dateNow = vi.spyOn(Date, 'now')
        .mockReturnValueOnce(0)
        .mockReturnValue(1);

    try {
        const firstSummary = await internals.dispatchDueTeamMediaNotificationBatches(DISPATCH_NOW, { maxRuntimeMs: 1 });
        assert.equal(firstSummary.stoppedBecause, 'maxRuntimeMs');
        assert.equal(firstSummary.processedCount, 0);
        assert.equal(firstSummary.backlogDrained, false);

        dateNow.mockRestore();
        const secondSummary = await internals.dispatchDueTeamMediaNotificationBatches(DISPATCH_NOW);
        assert.equal(secondSummary.processedCount, 3);
        assert.equal(secondSummary.backlogDrained, true);
    } finally {
        dateNow.mockRestore();
        cleanup();
    }
});

test('team media dispatcher uses stable oldest-due ordering across pages', async () => {
    const { env, internals, cleanup } = loadNotificationInternals({
        initialDocs: buildTeamMediaBacklog(120)
    });

    try {
        await internals.dispatchDueTeamMediaNotificationBatches(DISPATCH_NOW);
        const queriedIds = env.teamMediaQueryLog.flatMap((query) => query.resultIds);
        const expectedIds = Array.from({ length: 120 }, (_, index) => `batch-${String(index).padStart(3, '0')}`);
        assert.deepEqual(queriedIds, expectedIds);
    } finally {
        cleanup();
    }
});

test('team media dispatcher defers a released failed batch until the next invocation', async () => {
    const { env, internals, cleanup } = loadNotificationInternals({
        initialDocs: buildTeamMediaBacklog(55),
        docGetErrors: {
            'teams/team-1/mediaFolders/folder-1': [new Error('temporary folder read failure')]
        }
    });

    try {
        const firstSummary = await internals.dispatchDueTeamMediaNotificationBatches(DISPATCH_NOW);
        const firstRunClaims = env.updatedDocs.filter(({ path, value }) => (
            path === 'teamMediaNotificationBatches/batch-000' && value.status === 'sending'
        ));

        assert.equal(firstSummary.stoppedBecause, 'drained');
        assert.equal(firstSummary.processedCount, 55);
        assert.equal(firstSummary.sentCount, 54);
        assert.equal(firstSummary.releasedPendingCount, 1);
        assert.equal(firstSummary.backlogDrained, false);
        assert.equal(firstRunClaims.length, 1);
        assert.equal(env.getStoredDoc('teamMediaNotificationBatches/batch-000').status, 'pending');

        const secondSummary = await internals.dispatchDueTeamMediaNotificationBatches(DISPATCH_NOW);
        assert.equal(secondSummary.processedCount, 1);
        assert.equal(secondSummary.sentCount, 1);
        assert.equal(secondSummary.backlogDrained, true);
        assert.equal(env.getStoredDoc('teamMediaNotificationBatches/batch-000').status, 'sent');
        assert.equal(new Set(terminalBatchIds(env)).size, 55);
        assert.equal(terminalBatchIds(env).length, 55);
    } finally {
        cleanup();
    }
});
