"use strict";
const { scheduleDeliveryFingerprint: hash } = require('./schedule-delivery-coordinator.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = () => { throw new Error('Schedule effect eligibility is unavailable.'); };
function canonicalScheduleVersion(value) {
    if (typeof value !== 'string') fail();
    const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
    if (!match || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== match[1]) fail();
    return `${match[1]}.${(match[2] || '').padEnd(9, '0')}Z`;
}
const ordinaryFields = new Set(['type', 'date', 'end', 'location', 'notes', 'status', 'homeScore', 'awayScore', 'statTrackerConfigId', 'createdBy', 'createdAt',
    'title', 'opponent', 'isHome', 'arrivalTime', 'assignments', 'competitionType', 'countsTowardSeasonRecord', 'opponentTeamId', 'opponentTeamName',
    'opponentTeamPhoto', 'scheduleNotifications', 'updatedAt', 'updatedBy']);
const unset = (value) => value === undefined || (value && Object.hasOwn(value, 'nullValue')) || value?.stringValue === '';
// This narrow allowlist intentionally routes older/custom, imported, recurring,
// linked, live, special-engine and unrecognized shapes to their legacy owner.
const supported = (fields) => fields && Object.keys(fields).every((key) => ordinaryFields.has(key))
    && ['game', 'practice'].includes(fields.type?.stringValue) && fields.status?.stringValue === 'scheduled'
    && typeof fields.date?.timestampValue === 'string' && Number.isFinite(Date.parse(fields.date.timestampValue))
    && ['opponentTeamId', 'opponentTeamName', 'opponentTeamPhoto'].every((key) => unset(fields[key]))
    && (unset(fields.competitionType) || fields.competitionType.stringValue === 'league');

// All three readers are server-owned. findEvidence must use a private index;
// verifyCommit must use the durable evidence authority, never a user receipt.
// A missing proof means legacy. A read/verification error is unknown and must
// retry without choosing either consumer. No production index is mounted here.
function createScheduleEffectEligibility({ findEvidence, verifyCommit, readEvent }) {
    if ([findEvidence, verifyCommit, readEvent].some((fn) => typeof fn !== 'function')) throw new Error('Server-owned evidence lookup, verification and exact event reads are required.');
    return async (input) => {
        if (!input || !ID.test(input.teamId || '') || !ID.test(input.eventId || '') || input.category !== 'schedule') fail();
        const effect = { teamId: input.teamId, eventId: input.eventId, sourceVersion: canonicalScheduleVersion(input.sourceVersion), category: 'schedule' };
        const reference = await findEvidence(structuredClone(effect));
        if (reference === null) return { ...effect, eligible: false };
        if (!reference || reference.teamId !== effect.teamId || !HASH.test(reference.evidenceId || '')) fail();
        const commit = await verifyCommit(reference);
        if (!commit || commit.teamId !== effect.teamId || commit.eventId !== effect.eventId || canonicalScheduleVersion(commit.sourceVersion) !== effect.sourceVersion
            || commit.approvalId !== reference.evidenceId || !['create', 'update'].includes(commit.mode) || !['game', 'practice'].includes(commit.eventType)
            || commit.committed !== true || commit.consumed !== true || commit.approve !== true || commit.notifyTeam !== true || !HASH.test(commit.eventDigest || '')) fail();
        const event = await readEvent(structuredClone(effect));
        if (!event || canonicalScheduleVersion(event.version) !== effect.sourceVersion || hash(event.data) !== commit.eventDigest) fail();
        if (!supported(event.data) || event.data.type.stringValue !== commit.eventType) return { ...effect, eligible: false };
        return { ...effect, eligible: true, evidenceId: reference.evidenceId };
    };
}
module.exports = { canonicalScheduleVersion, createScheduleEffectEligibility };
