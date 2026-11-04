import { DomainError } from './core.js';
import { ID, fingerprint, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';
import { normalizeScheduleFields, ordinaryScheduleEvent, scheduleAfter, scheduleFields, scheduleSummary } from './scheduleReview.js';

const TOOL = 'mcp_direct_schedule_event';
const eventPath = (args) => `teams/${args.teamId}/games/${args.eventId}`;
const eventPattern = /^teams\/[A-Za-z0-9_-]{1,128}\/games\/[A-Za-z0-9_-]{1,128}$/;
const patchKeys = ['date', 'end', 'arrivalTime', 'location', 'title', 'opponent', 'isHome', 'updatedAt', 'updatedBy'];
export function createDirectScheduleStore(options) {
    return createTeamProposalStore(options, { toolName: TOOL, receiptFields: ['teamId', 'eventId', 'eventType', 'mode'],
        policy: {
            read: (path) => eventPattern.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}$/.test(path),
            write: (path) => eventPattern.test(path),
            patch: (path, data) => eventPattern.test(path) && data.updatedAt instanceof Date && data.updatedBy === options.uid
                && Object.keys(data).every((key) => patchKeys.includes(key)),
            query: (path) => /^teams\/[A-Za-z0-9_-]{1,128}\/games$/.test(path) ? { fields: scheduleFields, limit: 201 } : null
        }
    });
}
const storedField = (key) => ({ startDate: 'date', endDate: 'end' })[key] || key;
const storedValue = (key, value) => ['startDate', 'endDate', 'arrivalTime'].includes(key) ? value ? new Date(value) : null : value;
const normalizedLabel = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
export function createDirectScheduleCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: TOOL,
        deliveryEvidence: (record, proposalId) => ({ proposalId, teamId: record.teamId, eventId: record.eventId, mode: record.mode, eventType: record.eventType,
            intentDigest: record.digest, previewDigest: fingerprint(record.preview), beforeVersion: record.revisions.event }),
        args: ({ mode, teamId, eventId, eventType, changes }) => {
            if (!['create', 'update'].includes(mode) || !ID.test(teamId || '') || !ID.test(eventId || '')) throw new DomainError('invalid_argument', 'Use exact team/event IDs and create or update.');
            return { mode, teamId, eventId, eventType, changes: normalizeScheduleFields(eventType, changes) };
        },
        validateReceipt: (record) => ID.test(record.teamId || '') && ID.test(record.eventId || '') && ['create', 'update'].includes(record.mode) && ['game', 'practice'].includes(record.eventType),
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        result: ({ teamId, eventId, eventType, mode, status }) => ({ teamId, eventId, eventType, mode,
            notificationDelivery: status === 'completed' ? 'unverified' : 'not_requested', message: status === 'completed' ? 'Schedule save completed once. Team notifications are handled by the existing pipeline; delivery is not verified. Do not repeat the save to resend.' : 'Not applied. Separate approval of the save and possible team notifications is required.' }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`);
            if (!team.exists || !team.version) throw new DomainError('not_found', 'The team is unavailable.');
            const event = await reader.get(eventPath(args));
            if (args.mode === 'create' && event.exists) throw new DomainError('conflict', 'The event ID exists. Check the same proposal outcome.');
            if (args.mode === 'update' && (!ordinaryScheduleEvent(event.data) || (event.data.type || 'game') !== args.eventType)) throw new DomainError('unsupported_event', 'Only ordinary scheduled events are supported. Recurring, imported, linked, active and special-engine events require app review.');
            const before = event.exists ? scheduleSummary(args.eventId, event.data) : null;
            const after = scheduleAfter(before, args.eventType, args.changes);
            const schedule = args.mode === 'create' ? await reader.list(`teams/${args.teamId}/games`) : [];
            if (schedule.length >= 200) throw new DomainError('unsupported_schedule', 'Use app review when this team already has 200 schedule records. No partial duplicate check was used.');
            if (schedule.some((row) => {
                const other = scheduleSummary(row.id, row.data);
                return other.eventType === args.eventType && other.startDate === after.startDate
                    && normalizedLabel(args.eventType === 'game' ? other.opponent : other.title) === normalizedLabel(args.eventType === 'game' ? after.opponent : after.title);
            })) throw new DomainError('ambiguous_event', 'A matching event type, start time and opponent/title already exists. Review exact IDs in the app.');
            return { team, event, schedule, before, after };
        },
        revisions: ({ team, event, schedule }) => ({ team: team.version, event: event.version, schedule: fingerprint(schedule.map((row) => [row.id, row.version])) }),
        preview: ({ team, before, after }, args) => ({ action: `${args.mode === 'create' ? 'Create' : 'Update'} one scheduled ${args.eventType}`,
            teamId: args.teamId, teamName: String(team.data.name || args.teamId), eventId: args.eventId,
            before, requested: args.changes, after, requiredAcknowledgements: ['notifyTeam'],
            effect: 'This save may notify current eligible team members through the existing notification pipeline, independently of reminder settings. Delivery is not verified by this tool. No recurrence, linked opponents, cancellations or access changes.' }),
        apply: (transaction, { before, after }, args, { uid, now }) => {
            if (args.mode === 'create') {
                const common = { type: args.eventType, date: new Date(after.startDate), end: after.endDate ? new Date(after.endDate) : null,
                    location: after.location, notes: '', status: 'scheduled', homeScore: 0, awayScore: 0, statTrackerConfigId: null, createdBy: uid, createdAt: new Date(now()) };
                transaction.set(eventPath(args), args.eventType === 'practice'
                    ? { ...common, title: after.title, opponent: null, scheduleNotifications: {} }
                    : { ...common, title: null, opponent: after.opponent, isHome: after.isHome, arrivalTime: after.arrivalTime ? new Date(after.arrivalTime) : null,
                        assignments: [], competitionType: 'league', countsTowardSeasonRecord: true, opponentTeamId: null, opponentTeamName: null, opponentTeamPhoto: null });
            } else {
                const keys = new Set(Object.keys(args.changes));
                if (args.changes.startDate) for (const key of ['endDate', 'arrivalTime']) if (before[key] && (args.eventType === 'game' || key === 'endDate')) keys.add(key);
                transaction.patch(eventPath(args), { ...Object.fromEntries([...keys].map((key) => [storedField(key), storedValue(key, after[key])])), updatedAt: new Date(now()), updatedBy: uid });
            }
        }
    });
}
