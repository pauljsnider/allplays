import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('./send-category-notification-test-helpers.cjs');

function buildLargeFixture({ recipients = 500, devicesPerRecipient = 1 }) {
    const indexedTargets = [];
    for (let recipientIndex = 0; recipientIndex < recipients; recipientIndex += 1) {
        const uid = `user-${recipientIndex}`;
        for (let deviceIndex = 0; deviceIndex < devicesPerRecipient; deviceIndex += 1) {
            indexedTargets.push({
                uid,
                deviceId: `device-${deviceIndex}`,
                token: `token-${recipientIndex}-${deviceIndex}`,
                categories: { schedule: true }
            });
        }
    }

    return {
        teamDoc: {
            ownerId: 'user-0',
            adminEmails: []
        },
        parentUserIds: Array.from({ length: recipients - 1 }, (_, index) => `user-${index + 1}`),
        indexedTargets
    };
}

describe('sendCategoryNotification load coverage', () => {
    it('handles a 500-recipient indexed send without legacy per-user scans', async () => {
        const { internals, env, cleanup } = loadNotificationInternals(buildLargeFixture({
            recipients: 500,
            devicesPerRecipient: 1
        }));

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                title: 'Schedule updated',
                body: 'The bus leaves at 5:30.'
            });

            assert.equal(result.successCount, 500);
            assert.equal(result.failureCount, 0);
            assert.equal(env.counts.recipientQueries, 1);
            assert.equal(env.counts.parentQueries, 0);
            assert.equal(env.counts.preferenceGets, 0);
            assert.equal(env.counts.deviceGets, 0);
            assert.equal(env.messagingCalls.length, 1);
            assert.equal(env.messagingCalls[0].tokens.length, 500);
            assert.equal(env.inboxWrites.length, 500);
        } finally {
            cleanup();
        }
    });

    it('preserves 500-token FCM chunking for large indexed sends', async () => {
        const { internals, env, cleanup } = loadNotificationInternals(buildLargeFixture({
            recipients: 500,
            devicesPerRecipient: 2
        }));

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                category: 'schedule',
                title: 'Schedule updated',
                body: 'Two buses this time.'
            });

            assert.equal(result.successCount, 1000);
            assert.equal(result.failureCount, 0);
            assert.equal(env.counts.recipientQueries, 1);
            assert.equal(env.counts.parentQueries, 0);
            assert.equal(env.counts.preferenceGets, 0);
            assert.equal(env.counts.deviceGets, 0);
            assert.equal(env.messagingCalls.length, 2);
            assert.deepEqual(env.messagingCalls.map((call) => call.tokens.length), [500, 500]);
            assert.equal(env.inboxWrites.length, 500);
        } finally {
            cleanup();
        }
    });
});
