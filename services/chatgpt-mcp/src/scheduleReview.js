// Schedule creation and date/location/title updates can announce changes to
// families. Keep execution in the existing authenticated app confirmation flow.
import { DomainError } from './core.js';
import { ID } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { prepareWriteReview, getWriteReviewStatus } from './writeReview.js';

const invalid = (message) => { throw new DomainError('invalid_argument', message); };
export function normalizeScheduleInstant(value) {
    if (typeof value !== 'string') return invalid('Use an ISO date/time with an explicit UTC offset.');
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return invalid('Use an ISO date/time with an explicit UTC offset, not a local or date-only value.');
    const [, year, month, day, hour, minute, second = '0', , offset] = match;
    const calendar = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
        || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
        || offset === '-00:00' || (offset !== 'Z' && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4)) > 59
            || (Number(offset.slice(1, 3)) === 14 && Number(offset.slice(4)) !== 0)))) return invalid('The date, time or UTC offset is invalid.');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return invalid('The date/time is invalid.');
    return date.toISOString();
}

export const scheduleFields = ['type', 'title', 'opponent', 'date', 'end', 'arrivalTime', 'location', 'isHome', 'status', 'liveStatus',
    'trackingEngine', 'source', 'sourceMetadata', 'opponentTeamId', 'sharedMatchupId', 'sharedScheduleId', 'sharedScheduleOpponentGameId', 'isSeriesMaster', 'seriesId', 'recurrence', 'deleted', 'cancelled'];
const instant = (date) => date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
export function ordinaryScheduleEvent(data) {
    return data && ['game', 'practice'].includes(data.type || 'game') && (!data.status || data.status === 'scheduled')
        && (!data.liveStatus || data.liveStatus === 'scheduled')
        && !data.deleted && !data.cancelled && !data.trackingEngine && !data.source && !data.sourceMetadata
        && !data.opponentTeamId && !data.sharedMatchupId && !data.sharedScheduleId && !data.sharedScheduleOpponentGameId && !data.isSeriesMaster && !data.seriesId && !data.recurrence
        && Boolean(instant(data.date));
}
export function scheduleSummary(id, data) {
    return { id, eventType: data.type || 'game', title: typeof data.title === 'string' ? data.title : '',
        opponent: typeof data.opponent === 'string' ? data.opponent : '', startDate: instant(data.date), endDate: instant(data.end),
        arrivalTime: instant(data.arrivalTime), location: typeof data.location === 'string' ? data.location : '',
        isHome: typeof data.isHome === 'boolean' ? data.isHome : null, supportsOrdinaryAppReview: Boolean(ordinaryScheduleEvent(data)) };
}

export function createScheduleReviewCommands({ uid, getContext, getDb, now = Date.now }) {
    return {
        async prepare({ requestId, mode, teamId, eventId, eventType, changes }) {
            if (!['create', 'update'].includes(mode) || !ID.test(teamId || '') || !['game', 'practice'].includes(eventType)
                || (mode === 'update' ? !ID.test(eventId || '') : eventId !== undefined)
                || !changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) return invalid('Provide a create or update request with exact IDs, event type and changes.');
            const input = {};
            const fields = ['startDate', 'endDate', 'location', ...(eventType === 'game' ? ['opponent', 'isHome', 'arrivalTime'] : ['title'])];
            for (const [key, value] of Object.entries(changes)) {
                if (!fields.includes(key)) return invalid('Only ordinary date/time, location, title/opponent and home/away fields are supported. Use the app for other fields.');
                if (['startDate', 'endDate', 'arrivalTime'].includes(key)) input[key] = value === '' && key !== 'startDate' ? '' : normalizeScheduleInstant(value);
                else if (key === 'isHome') { if (typeof value !== 'boolean') return invalid('isHome must be a boolean.'); input[key] = value; }
                else {
                    if (typeof value !== 'string' || value !== value.trim() || value.length > (key === 'location' ? 200 : 120)
                        || /[\u0000-\u001f\u007f]/.test(value) || (key !== 'location' && !value)) return invalid('Use a bounded, trimmed title/opponent/location.');
                    input[key] = value;
                }
            }
            const context = await getContext(); validateManager(context, uid, teamId);
            const db = await getDb(); let before = null;
            if (mode === 'update') {
                const snapshot = await db.doc(`teams/${teamId}/games/${eventId}`).get();
                const data = snapshot.exists ? snapshot.data() : null;
                if (!ordinaryScheduleEvent(data) || (data.type || 'game') !== eventType) throw new DomainError('unsupported_event', 'Select an ordinary scheduled event with the exact type. Recurring, imported, linked, active or special-engine events require the app.');
                before = scheduleSummary(eventId, data);
            }
            const after = { ...(before || { eventType, title: eventType === 'practice' ? 'Practice' : '', opponent: '', endDate: null, arrivalTime: null, location: '', isHome: null }), ...input };
            // The app shifts omitted end/arrival times by the start-time delta.
            // Persist only requested fields so its final prepare preserves current
            // notes, configs and all unrequested fields, even if they change later.
            if (before && input.startDate) {
                const shift = Date.parse(input.startDate) - Date.parse(before.startDate);
                for (const key of ['endDate', 'arrivalTime']) if (!(key in input) && before[key]) after[key] = new Date(Date.parse(before[key]) + shift).toISOString();
            }
            if (!after.startDate || (eventType === 'game' && !after.opponent) || (eventType === 'practice' && !after.endDate)
                || (after.endDate && Date.parse(after.endDate) <= Date.parse(after.startDate))) return invalid('Supply a start time, a game opponent or practice end time, and an end time after the start.');
            const result = await prepareWriteReview(db, context, { requestId,
                action: mode === 'create' ? 'create_schedule_event' : 'update_schedule_event',
                arguments: { teamId, eventType, ...(mode === 'update' ? { eventId } : {}), input }
            }, now());
            return { ...result, preview: { before, requested: input, estimatedAfter: after },
                previewIsAdvisory: true, mayNotifyTeam: true,
                message: 'This call only prepares or retrieves a review request; see status for its app outcome. Creating or updating an event may notify the team independently of reminder settings. Open the review URL; the app rebuilds the final preview from current data and requires explicit confirmation.' };
        },
        async status(args) {
            const context = await getContext();
            if (context.uid !== uid) throw new DomainError('permission_denied', 'The connected account changed.');
            return getWriteReviewStatus(await getDb(), context, args, now());
        }
    };
}
