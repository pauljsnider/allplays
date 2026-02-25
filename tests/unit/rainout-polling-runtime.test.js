import { describe, it, expect } from 'vitest';
import { executeRainoutPollingRun } from '../../js/rainout-polling-runtime.js';

function createHarness({
    initialState = {},
    fetchByTarget = {},
    fetchErrorsByTarget = {}
} = {}) {
    const stateStore = new Map(Object.entries(initialState));
    const idempotencyKeys = new Set();
    const auditLogs = [];
    const events = [];
    const chatUpdates = [];
    const statusUpdates = [];
    const noChangeUpdates = [];

    return {
        stateStore,
        idempotencyKeys,
        auditLogs,
        events,
        chatUpdates,
        statusUpdates,
        noChangeUpdates,
        deps: {
            async fetchSourceEvents(target) {
                const key = `${target.tenantId}::${target.zip}`;
                if (fetchErrorsByTarget[key]) {
                    throw fetchErrorsByTarget[key];
                }
                return fetchByTarget[key] || [];
            },
            async readRainoutState(stateKey) {
                return stateStore.get(stateKey) || null;
            },
            async writeRainoutState(stateKey, state) {
                stateStore.set(stateKey, { ...state });
            },
            async hasProcessedIdempotencyKey(idempotencyKey) {
                return idempotencyKeys.has(idempotencyKey);
            },
            async markProcessedIdempotencyKey(idempotencyKey) {
                idempotencyKeys.add(idempotencyKey);
            },
            async writeRainoutEvent(eventRecord) {
                events.push(eventRecord);
            },
            async postChatUpdate(payload) {
                chatUpdates.push(payload);
            },
            async upsertInAppStatus(payload) {
                statusUpdates.push(payload);
            },
            async postNoChangeUpdate(payload) {
                noChangeUpdates.push(payload);
            },
            async writeAuditLog(record) {
                auditLogs.push(record);
            }
        }
    };
}

describe('rainout polling runtime integration', () => {
    it('processes changed events and skips unchanged events without duplicates', async () => {
        const harness = createHarness({
            initialState: {
                't1::ev-1': {
                    tenantId: 't1',
                    sourceEventId: 'ev-1',
                    status: 'open',
                    updatedAt: 1000
                }
            },
            fetchByTarget: {
                't1::20176': [
                    { tenantId: 't1', sourceEventId: 'ev-1', zip: '20176', facilityId: 'f1', status: 'open', updatedAt: 1000 },
                    { tenantId: 't1', sourceEventId: 'ev-2', zip: '20176', facilityId: 'f1', status: 'closed', updatedAt: 2000 }
                ]
            }
        });

        const subscriptions = [
            { id: 's1', tenantId: 't1', userId: 'u1', zip: '20176' },
            { id: 's2', tenantId: 't1', userId: 'u2', zip: '20176', facilityId: 'f1' },
            { id: 's3', tenantId: 't1', userId: 'u3', zip: '20176', facilityId: 'f2' }
        ];

        const firstRun = await executeRainoutPollingRun({
            nowMs: Date.UTC(2026, 1, 25, 6, 30, 0),
            subscriptions,
            ...harness.deps
        });

        expect(firstRun.processedTargets).toBe(1);
        expect(firstRun.changedEvents).toBe(1);
        expect(firstRun.skippedUnchangedEvents).toBe(1);
        expect(harness.events).toHaveLength(1);
        expect(harness.chatUpdates).toHaveLength(1);
        expect(harness.statusUpdates).toHaveLength(1);
        expect(harness.chatUpdates[0].subscriptionIds.sort()).toEqual(['s1', 's2']);
        expect(harness.chatUpdates[0].userIds.sort()).toEqual(['u1', 'u2']);

        const secondRun = await executeRainoutPollingRun({
            nowMs: Date.UTC(2026, 1, 25, 7, 0, 0),
            subscriptions,
            ...harness.deps
        });

        expect(secondRun.changedEvents).toBe(0);
        expect(secondRun.skippedUnchangedEvents).toBe(2);
        expect(harness.events).toHaveLength(1);
        expect(harness.chatUpdates).toHaveLength(1);
        expect(harness.statusUpdates).toHaveLength(1);
    });

    it('enforces schedule boundaries and feature flag kill switch', async () => {
        const harness = createHarness();
        const subscriptions = [{ id: 's1', tenantId: 't1', zip: '20176' }];

        const notBoundary = await executeRainoutPollingRun({
            nowMs: Date.UTC(2026, 1, 25, 6, 41, 0),
            subscriptions,
            ...harness.deps
        });
        expect(notBoundary.skippedReason).toBe('not_on_boundary');

        const disabled = await executeRainoutPollingRun({
            nowMs: Date.UTC(2026, 1, 25, 6, 30, 0),
            subscriptions,
            config: { enabled: false },
            ...harness.deps
        });
        expect(disabled.skippedReason).toBe('feature_disabled');
    });

    it('isolates tenant failures and enforces per-tenant zip guardrails', async () => {
        const harness = createHarness({
            fetchByTarget: {
                't1::20176': [{ tenantId: 't1', sourceEventId: 'a', zip: '20176', status: 'closed', updatedAt: 11 }],
                't2::10001': [{ tenantId: 't2', sourceEventId: 'b', zip: '10001', status: 'closed', updatedAt: 12 }]
            },
            fetchErrorsByTarget: {
                't1::20175': new Error('upstream-timeout')
            }
        });

        const subscriptions = [
            { id: 's1', tenantId: 't1', userId: 'u1', zip: '20176' },
            { id: 's2', tenantId: 't1', userId: 'u2', zip: '20175' },
            { id: 's3', tenantId: 't1', userId: 'u3', zip: '20174' },
            { id: 's4', tenantId: 't2', userId: 'u4', zip: '10001' }
        ];

        const result = await executeRainoutPollingRun({
            nowMs: Date.UTC(2026, 1, 25, 7, 0, 0),
            subscriptions,
            config: {
                maxZipsPerTenant: 2
            },
            ...harness.deps
        });

        expect(result.processedTargets).toBe(2);
        expect(result.guardrailSkippedTargets).toBe(1);
        expect(result.failedTargets).toBe(1);
        expect(result.changedEvents).toBe(1);
        expect(result.errorClasses).toEqual(['upstream-timeout']);
        expect(harness.chatUpdates).toHaveLength(1);
        expect(harness.chatUpdates[0].tenantId).toBe('t2');
        expect(harness.auditLogs.some((entry) => entry.status === 'error')).toBe(true);
    });
});
