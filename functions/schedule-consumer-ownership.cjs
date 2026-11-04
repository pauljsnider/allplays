"use strict";
const { scheduleDeliveryFingerprint: hash } = require('./schedule-delivery-coordinator.cjs');
const { canonicalScheduleVersion } = require('./schedule-effect-eligibility.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA = /^[a-f0-9]{40}$/;
const fail = () => { throw new Error('Schedule consumer ownership is unavailable.'); };
// Isolated rollout model. Both consumers MUST use this same server-private
// reservation before any effect. Existing production triggers do not yet do so.
// Never use client-writable event flags to choose a consumer or authorize sends.
function createScheduleConsumerOwnership({ store, readVerifiedDeploymentGate, verifyEffectEligibility }) {
    if (!store?.get || !store?.change || [readVerifiedDeploymentGate, verifyEffectEligibility].some((fn) => typeof fn !== 'function')) throw new Error('Durable ownership, verified deployment provenance and per-effect evidence are required.');
    return async ({ teamId, eventId, sourceVersion, consumer }) => {
        if (![teamId, eventId].every((id) => ID.test(id || '')) || typeof sourceVersion !== 'string' || !Number.isFinite(Date.parse(sourceVersion))
            || !['legacy', 'journal'].includes(consumer)) fail();
        sourceVersion = canonicalScheduleVersion(sourceVersion);
        const gate = await readVerifiedDeploymentGate();
        if (!gate || !['legacy-only', 'shadow', 'journal'].includes(gate.mode) || !SHA.test(gate.legacyHead || '') || gate.legacyCompatible !== true
            || (gate.mode === 'journal' && (!SHA.test(gate.journalHead || '') || gate.bothConsumersGated !== true || gate.compatibleProducersVerified !== true))) fail();
        const effect = { teamId, eventId, sourceVersion, category: 'schedule' };
        const effectId = hash({ kind: 'schedule-consumer-v1', ...effect });
        const validate = (row) => {
            if (!row || row.kind !== 'schedule-consumer-owner' || row.effectHash !== hash(effect) || !['legacy', 'journal'].includes(row.owner)
                || (row.owner === 'journal' && !/^[a-f0-9]{64}$/.test(row.eligibilityEvidenceId || ''))) fail();
            return row;
        };
        const saved = await store.get(teamId, effectId);
        if (saved) { const row = validate(saved); return { owner: row.owner, mayConsume: row.owner === consumer }; }
        let eligibility = null;
        if (gate.mode === 'journal') {
            eligibility = await verifyEffectEligibility(structuredClone(effect));
            if (!eligibility || !Object.keys(effect).every((key) => eligibility[key] === effect[key]) || typeof eligibility.eligible !== 'boolean'
                || (eligibility.eligible && !/^[a-f0-9]{64}$/.test(eligibility.evidenceId || ''))) fail();
        }
        const row = validate(await store.change(teamId, effectId, (existing) => {
            if (existing) return validate(existing);
            return { kind: 'schedule-consumer-owner', effectHash: hash(effect), owner: eligibility?.eligible === true ? 'journal' : 'legacy',
                eligibilityEvidenceId: eligibility?.eligible === true ? eligibility.evidenceId : null,
                legacyHead: gate.legacyHead, journalHead: gate.journalHead || null };
        }));
        // Ownership is immutable across rollout/rollback. An unavailable owner
        // requires recovery; another consumer must never automatically take over.
        return { owner: row.owner, mayConsume: row.owner === consumer };
    };
}
module.exports = { createScheduleConsumerOwnership };
