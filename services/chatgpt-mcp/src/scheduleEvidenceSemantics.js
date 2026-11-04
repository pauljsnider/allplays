import { DomainError } from './core.js';
import { ID, fingerprint } from './directRevisionCommand.js';
import { decodeFields, encodeValue } from './firestoreRest.js';
import { normalizeScheduleFields, ordinaryScheduleEvent, scheduleAfter, scheduleSummary } from './scheduleReview.js';

const deny = () => { throw new DomainError('confirmation_unavailable', 'The schedule write does not match the approved change.'); };
const same = (one, two) => fingerprint(one) === fingerprint(two);

// Independently reconstruct the allowed mutation from the captured form, never
// from the caller's descriptor digest or proposed write fields. Keep this
// verifier separate from the domain writer so new fields fail closed until
// their approval semantics have also been reviewed here.
export function approvedScheduleWrite({ preview, descriptor, actor, row, write, issuedAt, now }) {
    try {
        const { mode, teamId, eventId, eventType } = descriptor;
        if (!['create', 'update'].includes(mode) || !['game', 'practice'].includes(eventType)
            || !ID.test(teamId || '') || !ID.test(eventId || '') || preview.teamId !== teamId || preview.eventId !== eventId
            || preview.action !== `${mode === 'create' ? 'Create' : 'Update'} one scheduled ${eventType}`
            || !same(preview.requiredAcknowledgements, ['notifyTeam'])) deny();
        const changes = normalizeScheduleFields(eventType, preview.requested);
        if (!same(changes, preview.requested)
            || descriptor.intentDigest !== fingerprint({ uid: actor.uid, mode, teamId, eventId, eventType, changes })) deny();
        const data = mode === 'update' ? decodeFields(row.found.fields) : null;
        if (data && (!ordinaryScheduleEvent(data) || (data.type || 'game') !== eventType)) deny();
        const before = data ? scheduleSummary(eventId, data) : null;
        const after = scheduleAfter(before, eventType, changes);
        if (!same(before, preview.before) || !same(after, preview.after)) deny();

        // Audit timestamps are the only non-preview values supplied by the
        // executor. Bound them to this approval attempt; all other audit and
        // default values below are derived by this verifier.
        const timestamp = write.update.fields[mode === 'create' ? 'createdAt' : 'updatedAt']?.timestampValue;
        const time = Date.parse(timestamp);
        if (!Number.isSafeInteger(time) || time < issuedAt || time > now) deny();
        if (mode === 'create') {
            const common = { type: eventType, date: new Date(after.startDate), end: after.endDate ? new Date(after.endDate) : null,
                location: after.location, notes: '', status: 'scheduled', homeScore: 0, awayScore: 0,
                statTrackerConfigId: null, createdBy: actor.uid, createdAt: new Date(time) };
            return encodeValue(eventType === 'practice'
                ? { ...common, title: after.title, opponent: null, scheduleNotifications: {} }
                : { ...common, title: null, opponent: after.opponent, isHome: after.isHome,
                    arrivalTime: after.arrivalTime ? new Date(after.arrivalTime) : null, assignments: [], competitionType: 'league',
                    countsTowardSeasonRecord: true, opponentTeamId: null, opponentTeamName: null, opponentTeamPhoto: null }).mapValue.fields;
        }
        const keys = new Set(Object.keys(changes));
        if (changes.startDate) for (const key of ['endDate', 'arrivalTime']) if (before[key] && (eventType === 'game' || key === 'endDate')) keys.add(key);
        const fields = Object.fromEntries([...keys].map((key) => [({ startDate: 'date', endDate: 'end' })[key] || key,
            ['startDate', 'endDate', 'arrivalTime'].includes(key) ? after[key] ? new Date(after[key]) : null : after[key]]));
        return encodeValue({ ...fields, updatedAt: new Date(time), updatedBy: actor.uid }).mapValue.fields;
    } catch { deny(); }
}
