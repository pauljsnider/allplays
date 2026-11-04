"use strict";
const { scheduleDeliveryFingerprint: hash } = require('./schedule-delivery-coordinator.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA = /^[a-f0-9]{40}$/;
const fail = () => { throw new Error('Schedule consumer ownership is unavailable.'); };
// Isolated rollout model. Both consumers MUST use this same server-private
// reservation before any effect. Existing production triggers do not yet do so.
// Never use client-writable event flags to choose a consumer or authorize sends.
function createScheduleConsumerOwnership({ store, readVerifiedDeploymentGate }) {
    if (!store?.change || typeof readVerifiedDeploymentGate !== 'function') throw new Error('Durable ownership and verified deployment provenance are required.');
    return async ({ teamId, eventId, sourceVersion, consumer }) => {
        if (![teamId, eventId].every((id) => ID.test(id || '')) || typeof sourceVersion !== 'string' || !Number.isFinite(Date.parse(sourceVersion))
            || !['legacy', 'journal'].includes(consumer)) fail();
        const version = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(sourceVersion);
        if (!version || new Date(sourceVersion).toISOString().slice(0, 19) !== version[1]) fail();
        sourceVersion = `${version[1]}.${(version[2] || '').padEnd(9, '0')}Z`;
        const gate = await readVerifiedDeploymentGate();
        if (!gate || !['legacy-only', 'shadow', 'journal'].includes(gate.mode) || !SHA.test(gate.legacyHead || '') || gate.legacyCompatible !== true
            || (gate.mode === 'journal' && (!SHA.test(gate.journalHead || '') || gate.bothConsumersGated !== true || gate.compatibleProducersVerified !== true))) fail();
        const effect = { teamId, eventId, sourceVersion, category: 'schedule' };
        const effectId = hash({ kind: 'schedule-consumer-v1', ...effect });
        const row = await store.change(teamId, effectId, (existing) => {
            if (existing) {
                if (existing.kind !== 'schedule-consumer-owner' || existing.effectHash !== hash(effect) || !['legacy', 'journal'].includes(existing.owner)) fail();
                return existing;
            }
            return { kind: 'schedule-consumer-owner', effectHash: hash(effect), owner: gate.mode === 'journal' ? 'journal' : 'legacy',
                legacyHead: gate.legacyHead, journalHead: gate.journalHead || null };
        });
        if (!row || row.kind !== 'schedule-consumer-owner' || row.effectHash !== hash(effect) || !['legacy', 'journal'].includes(row.owner)) fail();
        // Ownership is immutable across rollout/rollback. An unavailable owner
        // requires recovery; another consumer must never automatically take over.
        return { owner: row.owner, mayConsume: row.owner === consumer };
    };
}
module.exports = { createScheduleConsumerOwnership };
