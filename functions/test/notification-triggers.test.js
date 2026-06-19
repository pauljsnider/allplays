import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('./send-category-notification-test-helpers');

function makeSnapshot(ref, data, exists = true) {
    return {
        id: ref.id,
        ref,
        exists,
        data: () => (data == null ? data : JSON.parse(JSON.stringify(data)))
    };
}

function makeChange(ref, beforeData, afterData) {
    return {
        before: makeSnapshot(ref, beforeData, beforeData != null),
        after: makeSnapshot(ref, afterData, afterData != null)
    };
}

test('notifyGameCreated sends a schedule notification once and records audit output', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { schedule: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { schedule: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-1');
        const snapshot = makeSnapshot(ref, {
            title: 'Game at Lions',
            type: 'game',
            date: '2026-06-20T16:00:00.000Z',
            createdBy: 'coach-1'
        });
        const context = { params: { teamId: 'team-1', gameId: 'game-1' } };

        const firstResult = await moduleExports.notifyGameCreated(snapshot, context);
        const secondResult = await moduleExports.notifyGameCreated(snapshot, context);

        assert.equal(firstResult?.successCount, 1);
        assert.equal(secondResult, null);
        assert.equal(env.counts.dedupTransactions, 2);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.category, 'schedule');
        assert.equal(env.auditWrites[0].value.dedupGuardApplied, true);
    } finally {
        cleanup();
    }
});

test('notifyGameCreated respects practice preferences and skips sends when the category is off', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { schedule: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/practice-1');
        const snapshot = makeSnapshot(ref, {
            title: 'Wednesday practice',
            type: 'practice',
            date: '2026-06-21T16:00:00.000Z',
            createdBy: 'coach-1'
        });
        const context = { params: { teamId: 'team-1', gameId: 'practice-1' } };

        const result = await moduleExports.notifyGameCreated(snapshot, context);

        assert.equal(result, null);
        assert.equal(env.messagingCalls.length, 0);
        assert.equal(env.auditWrites.length, 0);
        assert.equal(env.counts.dedupTransactions, 1);
    } finally {
        cleanup();
    }
});

test('notifyGameCreated sends a practice notification once and records audit output', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { practice: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { practice: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/practice-2');
        const snapshot = makeSnapshot(ref, {
            title: 'Thursday practice',
            type: 'practice',
            date: '2026-06-22T16:00:00.000Z',
            createdBy: 'coach-1'
        });
        const context = { params: { teamId: 'team-1', gameId: 'practice-2' } };

        const firstResult = await moduleExports.notifyGameCreated(snapshot, context);
        const secondResult = await moduleExports.notifyGameCreated(snapshot, context);

        assert.equal(firstResult?.successCount, 1);
        assert.equal(secondResult, null);
        assert.equal(env.counts.dedupTransactions, 2);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].data.category, 'practice');
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.category, 'practice');
        assert.equal(env.auditWrites[0].value.dedupGuardApplied, true);
    } finally {
        cleanup();
    }
});

test('notifyGameUpdated sends liveScore notifications and records once-only audit state', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { liveScore: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { liveScore: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/games/game-2');
        const change = makeChange(ref, { homeScore: 10, awayScore: 8 }, { homeScore: 12, awayScore: 8, updatedBy: 'coach-1' });
        const context = { params: { teamId: 'team-1', gameId: 'game-2' } };

        const result = await moduleExports.notifyGameUpdated(change, context);

        assert.equal(result?.successCount, 1);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].data.category, 'liveScore');
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.category, 'liveScore');
        assert.equal(env.auditWrites[0].value.dedupGuardApplied, false);
    } finally {
        cleanup();
    }
});

test('notifyTeamChatMessageCreated sends mentions and liveChat only to enabled recipients and records audit entries', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: ['assistant@example.com'] },
        parentUserIds: ['parent-1'],
        authUsersByEmail: { 'assistant@example.com': 'coach-2' },
        userDocs: {
            'coach-1': { displayName: 'Coach Prime' },
            'coach-2': { displayName: 'Coach Helper' },
            'parent-1': { displayName: 'Jamie Parent' }
        },
        indexedTargets: [
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { liveChat: true, mentions: true } },
            { uid: 'coach-2', deviceId: 'assistant-device', token: 'assistant-token', categories: { liveChat: true, mentions: true } },
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { mentions: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/chatMessages/message-1');
        const snapshot = makeSnapshot(ref, {
            text: 'Nice work @Jamie',
            senderId: 'coach-1',
            senderName: 'Coach Prime',
            conversationId: 'team'
        });
        const context = { params: { teamId: 'team-1', messageId: 'message-1' } };

        const result = await moduleExports.notifyTeamChatMessageCreated(snapshot, context);

        assert.equal(result.length, 2);
        assert.equal(env.messagingCalls.length, 2);
        assert.deepEqual(env.messagingCalls.map((call) => call.data.category).sort(), ['liveChat', 'mentions']);
        assert.deepEqual(env.messagingCalls.map((call) => call.tokens[0]).sort(), ['assistant-token', 'parent-token']);
        assert.deepEqual(env.updatedDocs, [{ path: 'teams/team-1/chatMessages/message-1', value: { mentionedUids: ['parent-1'] } }]);
        assert.equal(env.auditWrites.length, 2);
        assert.deepEqual(env.auditWrites.map((entry) => entry.value.category).sort(), ['liveChat', 'mentions']);
    } finally {
        cleanup();
    }
});

test('notifyFeeAssigned sends fees notifications only to opted-in payer targets', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: [] },
        parentUserIds: ['parent-1'],
        playerDocs: {
            'player-1': { parents: [{ userId: 'parent-1' }] }
        },
        privateProfileDocs: {
            'player-1': { parents: [{ userId: 'parent-1' }] }
        },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1');
        const snapshot = makeSnapshot(ref, {
            playerId: 'player-1',
            feeTitle: 'Tournament dues',
            amountCents: 4500
        });
        const context = { params: { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' } };

        const result = await moduleExports.notifyFeeAssigned(snapshot, context);

        assert.equal(result, null);
        assert.equal(env.messagingCalls.length, 1);
        assert.equal(env.messagingCalls[0].data.category, 'fees');
        assert.equal(env.auditWrites.length, 1);
        assert.equal(env.auditWrites[0].value.category, 'fees');
    } finally {
        cleanup();
    }
});

test('notifyFeeMarkedPaid sends fees notifications to payer and staff and records audit entries', async () => {
    const { moduleExports, env, cleanup } = loadNotificationInternals({
        teamDoc: { ownerId: 'coach-1', adminEmails: ['assistant@example.com'] },
        parentUserIds: ['parent-1'],
        authUsersByEmail: { 'assistant@example.com': 'coach-2' },
        indexedTargets: [
            { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { fees: true } },
            { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { fees: true } },
            { uid: 'coach-2', deviceId: 'assistant-device', token: 'assistant-token', categories: { fees: true } }
        ]
    });

    try {
        const ref = env.firestoreState.doc('teams/team-1/feeBatches/batch-1/feeRecipients/recipient-2');
        const change = makeChange(ref, { status: 'pending' }, { status: 'paid', feeTitle: 'Tournament dues', userId: 'parent-1' });
        const context = { params: { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-2' } };

        const result = await moduleExports.notifyFeeMarkedPaid(change, context);

        assert.equal(result, null);
        assert.equal(env.messagingCalls.length, 2);
        assert.deepEqual(env.messagingCalls.map((call) => call.tokens.length).sort(), [1, 2]);
        assert.equal(env.auditWrites.length, 2);
        assert.deepEqual(env.auditWrites.map((entry) => entry.value.category), ['fees', 'fees']);
    } finally {
        cleanup();
    }
});

for (const category of ['schedule', 'practice', 'liveScore', 'liveChat', 'mentions', 'fees']) {
    test(`sendCategoryNotification suppresses ${category} when every indexed recipient opted out`, async () => {
        const { internals, env, cleanup } = loadNotificationInternals({
            teamDoc: { ownerId: 'coach-1', adminEmails: [] },
            indexedRecipients: [
                { uid: 'coach-1', deviceId: 'coach-device', token: 'coach-token', categories: { [category]: false } }
            ]
        });

        try {
            const result = await internals.sendCategoryNotification({
                teamId: 'team-1',
                gameId: `${category}-game`,
                category,
                title: 'Notification regression check',
                body: 'This should not send.'
            });

            assert.equal(result, null);
            assert.equal(env.messagingCalls.length, 0);
            assert.equal(env.inboxWrites.length, 0);
            assert.equal(env.auditWrites.length, 0);
        } finally {
            cleanup();
        }
    });
}
