import { DomainError } from './core.js';
import { ID, fingerprint, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';

const TOOL = 'mcp_direct_practice_timeline';
const sessionPath = (teamId, sessionId) => `teams/${teamId}/practiceSessions/${sessionId}`;
const sessionPattern = /^teams\/[A-Za-z0-9_-]{1,128}\/practiceSessions\/[A-Za-z0-9_-]{1,128}$/;
const text = (value, max = 120) => typeof value === 'string' && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const description = (value) => typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const validBlocks = (blocks) => Array.isArray(blocks) && blocks.length > 0 && blocks.length <= 30 && blocks.every((block) =>
    block && typeof block === 'object' && !Array.isArray(block)
    && Object.keys(block).every((key) => ['drillId', 'title', 'duration', 'type', 'description'].includes(key))
    && (block.drillId !== undefined ? ID.test(block.drillId) && block.title === undefined : text(block.title) && Boolean(block.title))
    && Number.isInteger(block.duration) && block.duration >= 1 && block.duration <= 120
    && (block.type === undefined || text(block.type, 60) && Boolean(block.type))
    && (block.description === undefined || description(block.description)));
const duration = (blocks) => blocks.reduce((sum, block) => sum + block.duration, 0);
export const isDirectPracticeEvent = (event) => event?.type === 'practice' && event.deleted !== true && event.cancelled !== true
    && !['cancelled', 'canceled', 'deleted'].includes(String(event.status || '').toLowerCase())
    && !['cancelled', 'canceled', 'deleted'].includes(String(event.liveStatus || '').toLowerCase())
    && !event.isSeriesMaster && !event.seriesId && !event.recurrence
    && event.date instanceof Date && Number.isFinite(event.date.getTime());

export function createDirectPracticeTimelineStore(options) {
    return createTeamProposalStore(options, {
        toolName: TOOL, receiptFields: ['teamId', 'eventId', 'sessionId', 'mode'],
        policy: {
            read: (path) => sessionPattern.test(path) || /^(teams|drillLibrary)\/[A-Za-z0-9_-]{1,128}$/.test(path)
                || /^teams\/[A-Za-z0-9_-]{1,128}\/games\/[A-Za-z0-9_-]{1,128}$/.test(path),
            write: (path) => sessionPattern.test(path),
            patch: (path, data) => sessionPattern.test(path) && data.updatedAt instanceof Date
                && Object.keys(data).every((key) => ['title', 'location', 'updatedAt'].includes(key)),
            append: (path, field, values, data) => sessionPattern.test(path) && field === 'blocks' && Array.isArray(values)
                && values.length > 0 && values.length <= 30 && data.updatedAt instanceof Date && Number.isInteger(data.duration)
                && Object.keys(data).every((key) => ['title', 'location', 'duration', 'updatedAt'].includes(key)),
            query: (path, args) => /^teams\/[A-Za-z0-9_-]{1,128}\/practiceSessions$/.test(path) && ID.test(args.eventId || '')
                ? { fields: ['eventId'], limit: 2, where: { field: 'eventId', value: args.eventId } } : null
        }
    });
}

function newBlocks(args, drills, start = 0) {
    return (args.changes.blocks || args.changes.appendBlocks || []).map((block, index) => {
        const drill = block.drillId ? drills.get(block.drillId)?.data : null;
        const drillTitle = drill ? drill.title : block.title;
        const type = block.type ?? (drill?.type || 'Technical');
        const detail = block.description ?? drill?.description ?? '';
        if (!text(drillTitle) || !drillTitle || !text(type, 60) || !description(detail)) {
            throw new DomainError('unsupported_drill', 'The selected drill needs app review before it can be added to this bounded timeline.');
        }
        return { order: start + index, drillId: block.drillId || null, drillTitle, type, duration: block.duration, description: detail, notes: '', notesLog: [] };
    });
}
function changesFor(target, args) {
    if (args.mode === 'create') {
        const blocks = newBlocks(args, target.drills);
        if (duration(blocks) > 600) throw new DomainError('invalid_argument', 'Use a timeline of at most 600 minutes.');
        const location = args.changes.location !== undefined ? args.changes.location || null : target.event.data.location || null;
        if (location !== null && !text(location, 200)) throw new DomainError('unsupported_event', 'Review the practice location in the app.');
        return { title: args.changes.title, location,
            blocks, duration: duration(blocks) };
    }
    const patch = {};
    if (args.changes.title !== undefined) patch.title = args.changes.title;
    if (args.changes.location !== undefined) patch.location = args.changes.location || null;
    if (args.changes.appendBlocks) {
        const existing = target.session.data.blocks;
        if (!Array.isArray(existing) || existing.some((block, index) => !block || block.order !== index || !Number.isInteger(block.duration) || block.duration < 1 || block.duration > 120)
            || existing.length + args.changes.appendBlocks.length > 100) {
            throw new DomainError('unsupported_timeline', 'The existing timeline needs app review before appending blocks.');
        }
        patch.blocks = [...existing, ...newBlocks(args, target.drills, existing.length)];
        patch.duration = duration(patch.blocks);
        if (patch.duration > 600) throw new DomainError('invalid_argument', 'Use a timeline of at most 600 minutes.');
    }
    return patch;
}

export function createDirectPracticeTimelineCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ mode, teamId, eventId, sessionId, changes }) => {
            const allowed = mode === 'create' ? ['title', 'location', 'blocks'] : ['title', 'location', 'appendBlocks'];
            if (!['create', 'update'].includes(mode) || ![teamId, eventId, sessionId].every((id) => ID.test(id || ''))
                || !changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0
                || Object.keys(changes).some((key) => !allowed.includes(key))
                || (mode === 'create' && (!changes.title || !validBlocks(changes.blocks)))
                || (changes.title !== undefined && (!text(changes.title) || !changes.title))
                || (changes.location !== undefined && !text(changes.location, 200))
                || (changes.appendBlocks !== undefined && !validBlocks(changes.appendBlocks))) {
                throw new DomainError('invalid_argument', 'Use exact IDs and a title/location or explicit bounded drill blocks. Only draft timelines are supported; schedule, packets, attendance and existing notes require the app.');
            }
            return { mode, teamId, eventId, sessionId, changes: structuredClone(changes) };
        },
        validateReceipt: (record) => [record.teamId, record.eventId, record.sessionId].every((id) => ID.test(id || '')) && ['create', 'update'].includes(record.mode),
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        result: ({ mode, teamId, eventId, sessionId }) => ({ mode, teamId, eventId, sessionId }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`);
            const event = await reader.get(`teams/${args.teamId}/games/${args.eventId}`);
            if (!team.exists || !team.version || !event.exists || !event.version || !isDirectPracticeEvent(event.data)) {
                throw new DomainError('unsupported_event', 'Choose an existing active, non-recurring practice event with a valid date. Schedule changes require app review.');
            }
            const linked = await reader.list(`teams/${args.teamId}/practiceSessions`, { eventId: args.eventId });
            const session = await reader.get(sessionPath(args.teamId, args.sessionId));
            if (args.mode === 'create' && (linked.length || session.exists)) throw new DomainError('conflict', 'A timeline or this session ID already exists. Discover its exact ID and prepare an update.');
            if (args.mode === 'update' && (linked.length !== 1 || linked[0].id !== args.sessionId || !session.exists || !session.version
                || session.data.eventId !== args.eventId || session.data.eventType !== 'practice' || session.data.status !== 'draft'
                || session.data.homePacketGenerated === true || session.data.homePacketContent != null)) {
                throw new DomainError('unsupported_timeline', 'Select one unambiguous draft timeline without an assigned packet. Other timeline states require app review.');
            }
            const drills = new Map();
            for (const block of args.changes.blocks || args.changes.appendBlocks || []) if (block.drillId && !drills.has(block.drillId)) {
                const drill = await reader.get(`drillLibrary/${block.drillId}`);
                if (!drill.exists || !drill.version || !(drill.data.source === 'community' || drill.data.publishedToCommunity === true || drill.data.teamId === args.teamId)) {
                    throw new DomainError('permission_denied', 'This drill is not available for the selected team.');
                }
                drills.set(block.drillId, drill);
            }
            return { team, event, session, linked, drills };
        },
        revisions: ({ team, event, session, linked, drills }) => ({ team: team.version, event: event.version, session: session.version || null,
            linked: fingerprint(linked.map((row) => [row.id, row.version])), drills: Object.fromEntries([...drills].map(([id, drill]) => [id, drill.version])) }),
        preview: (target, args) => {
            const patch = changesFor(target, args);
            const old = target.session.data;
            const added = newBlocks(args, target.drills, args.mode === 'create' ? 0 : old?.blocks?.length || 0);
            return { action: args.mode === 'create' ? 'Create a draft practice timeline' : 'Update a draft practice timeline',
                teamId: args.teamId, teamName: String(target.team.data.name || args.teamId), eventId: args.eventId, sessionId: args.sessionId,
                eventDate: target.event.data.date.toISOString(), eventTitle: String(target.event.data.title || 'Practice'),
                before: old ? { title: old.title || null, location: old.location || null, blockCount: Array.isArray(old.blocks) ? old.blocks.length : null, duration: old.duration ?? null } : null,
                after: { title: patch.title ?? old?.title ?? null, location: Object.hasOwn(patch, 'location') ? patch.location : old?.location ?? null,
                    blockCount: patch.blocks?.length ?? old?.blocks?.length ?? 0, duration: patch.duration ?? old?.duration ?? null },
                blocksToAdd: added,
                effect: 'Preserves existing blocks, notes, attendance and delivery settings. Does not change the schedule, generate a packet or send a message.' };
        },
        apply: (tx, target, args, { uid, now }) => {
            const patch = changesFor(target, args); const timestamp = new Date(now());
            if (args.mode === 'create') tx.set(sessionPath(args.teamId, args.sessionId), { ...patch, eventId: args.eventId, eventType: 'practice', sourcePage: 'mcp',
                date: target.event.data.date, createdBy: uid, status: 'draft', aiChatHistory: [],
                attendance: { rosterSize: 0, checkedInCount: 0, updatedAt: timestamp, players: [] }, attendancePlayers: 0,
                homePacketGenerated: false, homePacketContent: null, createdAt: timestamp, updatedAt: timestamp });
            else if (args.changes.appendBlocks) {
                const fields = { ...patch };
                delete fields.blocks;
                // Firestore appends without re-encoding existing blocks. This
                // preserves notes and any legacy reference/timestamp values.
                tx.append(sessionPath(args.teamId, args.sessionId), 'blocks', newBlocks(args, target.drills, target.session.data.blocks.length), { ...fields, updatedAt: timestamp });
            } else tx.patch(sessionPath(args.teamId, args.sessionId), { ...patch, updatedAt: timestamp });
        }
    });
}
