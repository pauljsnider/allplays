import { DomainError } from './core.js';
import { ID, fingerprint, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';
import { ordinaryScheduleEvent } from './scheduleReview.js';

const TOOL = 'mcp_direct_practice_attendance';
const pathFor = ({ teamId, sessionId }) => `teams/${teamId}/practiceSessions/${sessionId}`;
const sessionPattern = /^teams\/[A-Za-z0-9_-]{1,128}\/practiceSessions\/[A-Za-z0-9_-]{1,128}$/;
const mask = ['attendance', 'attendancePlayers', 'aiContext.presentPlayerIds', 'aiContext.attendanceSummary', 'updatedAt'];
const safeId = (value) => typeof value === 'string' && ID.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const date = (value) => value instanceof Date && Number.isFinite(value.getTime());
const statuses = ['present', 'late', 'absent'];
const fail = () => { throw new DomainError('unsupported_attendance', 'Select one ordinary draft practice session with canonical attendance and an unambiguous active roster. Legacy, packet-linked or extended data requires app review; no notes are discarded.'); };
export function createDirectPracticeAttendanceStore(options) {
    return createTeamProposalStore({ ...options, preserveTimestampPrecision: true }, { toolName: TOOL, receiptFields: ['teamId', 'eventId', 'sessionId'], policy: {
        read: (path) => sessionPattern.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}(\/games\/[A-Za-z0-9_-]{1,128})?$/.test(path),
        write: (path) => sessionPattern.test(path),
        patchFields: (path, data, fields) => sessionPattern.test(path) && JSON.stringify(fields) === JSON.stringify(mask)
            && Object.keys(data).sort().join(',') === 'aiContext,attendance,attendancePlayers,updatedAt' && date(data.updatedAt),
        query: (path, args) => /^teams\/[A-Za-z0-9_-]{1,128}\/practiceSessions$/.test(path) && safeId(args.eventId)
            ? { fields: ['eventId'], limit: 2, where: { field: 'eventId', value: args.eventId } }
            : /^teams\/[A-Za-z0-9_-]{1,128}\/players$/.test(path) ? { fields: ['name', 'active'], limit: 201 } : null
    } });
}
function nextPlayers(target, args, now) {
    // Keep original Date instances until REST encoding to preserve exact wire
    // timestamps for untouched and already-checked-in attendance records.
    const rows = target.players.map((row) => ({ ...row }));
    for (const change of args.changes) {
        const index = rows.findIndex((row) => row.playerId === change.playerId); const old = rows[index];
        const checkedInAt = change.status === 'absent' ? null : old?.checkedInAt || new Date(now());
        const row = { playerId: change.playerId, displayName: target.roster.find((player) => player.id === change.playerId).data.name,
            status: change.status, checkedInAt, note: old?.note ?? null };
        if (index < 0) rows.push(row); else rows[index] = row;
    }
    return rows;
}
export function createDirectPracticeAttendanceCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, eventId, sessionId, changes }) => {
            if (![teamId, eventId, sessionId].every(safeId) || !Array.isArray(changes) || !changes.length || changes.length > 20
                || changes.some((row) => !row || Object.keys(row).sort().join(',') !== 'playerId,status' || !safeId(row.playerId) || !statuses.includes(row.status))
                || new Set(changes.map((row) => row.playerId)).size !== changes.length) throw new DomainError('invalid_argument', 'Choose 1–20 unique players and present/late/absent statuses. Notes and clearing records require app review.');
            return { teamId, eventId, sessionId, changes: changes.map((row) => ({ ...row })).sort((a, b) => a.playerId.localeCompare(b.playerId)) };
        },
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        validateReceipt: (record) => [record.teamId, record.eventId, record.sessionId].every(safeId),
        result: ({ teamId, eventId, sessionId }) => ({ teamId, eventId, sessionId }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`); const event = await reader.get(`teams/${args.teamId}/games/${args.eventId}`);
            const session = await reader.get(pathFor(args)); const linked = await reader.list(`teams/${args.teamId}/practiceSessions`, { eventId: args.eventId });
            const allRoster = await reader.list(`teams/${args.teamId}/players`); const roster = allRoster.filter((row) => row.data.active !== false);
            const data = session.data;
            if (!team.exists || !team.version || !event.exists || !event.version || event.data.type !== 'practice' || !ordinaryScheduleEvent(event.data)
                || !session.exists || !session.version || linked.length !== 1 || linked[0].id !== args.sessionId || data.eventId !== args.eventId || data.eventType !== 'practice'
                || data.status !== 'draft' || data.homePacketGenerated === true || data.homePacketContent != null
                || allRoster.length > 200 || !roster.length || roster.some((row) => !row.version || !safeId(row.id) || !text(row.data.name, 120) || !row.data.name)
                || args.changes.some((change) => !roster.some((row) => row.id === change.playerId))) return fail();
            const attendance = data.attendance;
            if (!attendance || Object.keys(attendance).some((key) => !['rosterSize', 'checkedInCount', 'updatedAt', 'editedAt', 'players'].includes(key))
                || !Number.isInteger(attendance.rosterSize) || attendance.rosterSize < 0 || !Number.isInteger(attendance.checkedInCount) || attendance.checkedInCount < 0 || !date(attendance.updatedAt)
                || (attendance.editedAt !== undefined && !date(attendance.editedAt)) || !Array.isArray(attendance.players) || attendance.players.length > 200) return fail();
            const players = attendance.players;
            if (attendance.rosterSize < players.length || attendance.checkedInCount !== players.filter((row) => row && ['present', 'late'].includes(row.status)).length
                || (data.aiContext !== undefined && (!data.aiContext || typeof data.aiContext !== 'object' || Array.isArray(data.aiContext) || data.aiContext instanceof Date))) return fail();
            if (new Set(players.map((row) => row?.playerId)).size !== players.length || players.some((row) => !row || Object.keys(row).some((key) => !['playerId', 'displayName', 'status', 'checkedInAt', 'note'].includes(key))
                || !safeId(row.playerId) || !roster.some((player) => player.id === row.playerId) || !text(row.displayName, 120) || !statuses.includes(row.status)
                || !(row.note === null || text(row.note, 2000)) || (row.status === 'absent' ? row.checkedInAt !== null : !date(row.checkedInAt)))) return fail();
            return { team, event, session, linked, allRoster, roster, players };
        },
        revisions: ({ team, event, session, linked, allRoster }) => ({ team: team.version, event: event.version, session: session.version,
            linked: fingerprint(linked.map((row) => [row.id, row.version])), roster: fingerprint(allRoster.map((row) => [row.id, row.version])) }),
        preview: ({ event, roster, players }, args) => ({ action: 'Save selected practice attendance', teamId: args.teamId, eventId: args.eventId, sessionId: args.sessionId,
            practiceTitle: String(event.data.title || 'Practice'), changes: args.changes.map((change) => ({ ...change, name: roster.find((row) => row.id === change.playerId).data.name,
                before: players.find((row) => row.playerId === change.playerId)?.status || 'not_marked' })),
            effect: 'Records only these statuses, retaining existing notes and other players. Present/late retains an existing check-in time or records one; absent clears that player’s check-in time. Refreshes attendance totals without changing other AI context, packets, schedule or sending messages.' }),
        apply: (tx, target, args, { now }) => {
            const players = nextPlayers(target, args, now); const count = (status) => players.filter((row) => row.status === status).length;
            const checkedInCount = count('present') + count('late'); const timestamp = new Date(now());
            tx.patchFields(pathFor(args), { attendance: { rosterSize: target.roster.length, checkedInCount, updatedAt: timestamp, editedAt: timestamp, players },
                attendancePlayers: checkedInCount, aiContext: { presentPlayerIds: players.filter((row) => row.status !== 'absent').map((row) => row.playerId),
                    attendanceSummary: { present: count('present'), late: count('late'), absent: count('absent') } }, updatedAt: timestamp }, mask);
        }
    });
}
