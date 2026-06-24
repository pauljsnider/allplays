import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('./send-category-notification-test-helpers.cjs');

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
