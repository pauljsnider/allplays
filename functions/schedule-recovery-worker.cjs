"use strict";
const { randomUUID } = require('node:crypto');
const { scheduleDeliveryFingerprint: hash } = require('./schedule-delivery-coordinator.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const cursorValid = (value) => value === null || (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,256}$/.test(value));
const fail = () => { throw new Error('Schedule recovery worker is unavailable.'); };
// Backend-only, unmounted runner. A lease schedules bounded scanning; it is
// never send authority. The pipeline independently enforces effect ownership,
// current authorization and durable single-attempt provider reconciliation.
function createScheduleRecoveryWorker({ store, pipeline, authorizeRun, now = Date.now, uuid = randomUUID, leaseMs = 60000 }) {
    if (!store?.get || !store?.change || typeof pipeline?.recover !== 'function' || typeof authorizeRun !== 'function'
        || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) throw new Error('Private worker state, guarded recovery and bounded leases are required.');
    const checked = (row, teamId) => {
        if (row && (row.kind !== 'schedule-recovery-worker' || row.teamId !== teamId || !cursorValid(row.cursor)
            || !Number.isSafeInteger(row.generation) || row.generation < 1 || !Number.isSafeInteger(row.updatedAt)
            || (row.lease !== null && (!row.lease || !UUID.test(row.lease.id || '') || !Number.isSafeInteger(row.lease.expiresAt))))) fail();
        return row;
    };
    return {
        async run({ teamId }) {
            if (typeof teamId !== 'string' || !ID.test(teamId)) fail();
            if (await authorizeRun({ teamId }) !== true) fail();
            const workerId = hash({ kind: 'schedule-recovery-worker-v1', teamId }); const leaseId = uuid();
            if (typeof leaseId !== 'string' || !UUID.test(leaseId)) fail();
            const startedAt = now(); const expiresAt = startedAt + leaseMs; let claimed = false;
            if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(expiresAt)) fail();
            const row = checked(await store.change(teamId, workerId, (existing) => {
                claimed = false; checked(existing, teamId);
                if (existing?.lease && existing.lease.expiresAt > now()) return existing;
                if (now() >= expiresAt) fail();
                claimed = true;
                return { kind: 'schedule-recovery-worker', teamId, cursor: existing?.cursor ?? null, generation: (existing?.generation || 0) + 1,
                    lease: { id: leaseId, expiresAt }, updatedAt: now(), lastOutcome: existing?.lastOutcome ?? 'new' };
            }), teamId);
            if (!claimed) return { state: 'busy' };
            if (row?.lease?.id !== leaseId || row.lease.expiresAt !== expiresAt) fail();
            // A lost claim acknowledgment never starts work. Another invocation
            // waits for expiry, then retries from the durable unchanged cursor.
            if (await authorizeRun({ teamId }) !== true || now() >= expiresAt) fail();
            let page;
            try {
                page = await pipeline.recover({ teamId, cursor: row.cursor });
                if (!page || !Array.isArray(page.results) || page.results.length > 100 || page.results.some((result) => !['pending', 'waiting', 'completed', 'uncertain', 'cancelled_unstarted', 'retry_required'].includes(result?.state)) || !cursorValid(page.nextCursor)
                    || (page.nextCursor !== null && page.nextCursor === row.cursor)) fail();
            } catch {
                // The retained cursor retries the same page after expiry. Do not
                // turn a partially processed page into success or resend authority.
                fail();
            }
            if (await authorizeRun({ teamId }) !== true || now() >= expiresAt) fail();
            const outcome = page.results.some((result) => result?.state === 'retry_required') ? 'retry_required' : 'processed';
            const saved = checked(await store.change(teamId, workerId, (existing) => {
                checked(existing, teamId);
                if (existing?.lease?.id !== leaseId || existing.generation !== row.generation || now() >= expiresAt) fail();
                return { ...existing, cursor: page.nextCursor, lease: null, lastOutcome: outcome, updatedAt: now() };
            }), teamId);
            if (saved?.lease !== null || saved.generation !== row.generation || saved.cursor !== page.nextCursor) fail();
            return { state: outcome, count: page.results.length, cycleComplete: page.nextCursor === null };
        }
    };
}
module.exports = { createScheduleRecoveryWorker };
