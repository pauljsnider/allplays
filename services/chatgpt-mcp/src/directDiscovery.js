import { DomainError } from './core.js';
import { ID } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { isDirectPracticeEvent } from './directPracticeTimeline.js';
import { getManagedTeamRoster } from './rosterDiscovery.js';

// Discovery deliberately projects only names and schema summaries, never whole
// team, player or configuration documents. Every page rechecks current access.
export function createDirectDiscovery({ uid, getContext, getDb }) {
    const managedDb = async (teamId) => {
        if (!ID.test(teamId || '')) throw new DomainError('invalid_argument', 'Use an exact team ID.');
        validateManager(await getContext(), uid, teamId);
        return getDb();
    };
    const page = async (query, { cursor, limit = 20 }, map) => {
        if ((cursor !== undefined && !ID.test(cursor)) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new DomainError('invalid_argument', 'Use the returned cursor and a page size from 1 to 50.');
        query = query.orderBy('__name__').limit(limit + 1);
        if (cursor) query = query.startAfterDocumentId(cursor);
        const snapshot = await query.get();
        const hasMore = snapshot.docs.length > limit;
        const docs = snapshot.docs.slice(0, limit);
        return { items: docs.map(map), hasMore, nextCursor: hasMore ? docs.at(-1).id : null };
    };
    return {
        async practices(args) {
            const db = await managedDb(args.teamId);
            const query = db.collection(`teams/${args.teamId}/games`).where('type', '==', 'practice')
                .select('title', 'location', 'date', 'type', 'status', 'liveStatus', 'deleted', 'cancelled', 'isSeriesMaster', 'seriesId', 'recurrence');
            return { teamId: args.teamId, ...await page(query, args, (doc) => {
                const data = doc.data();
                return { id: doc.id, title: String(data.title || 'Practice'), location: typeof data.location === 'string' ? data.location : null,
                    date: data.date instanceof Date && Number.isFinite(data.date.getTime()) ? data.date.toISOString() : null,
                    supportsDirectTimeline: isDirectPracticeEvent(data) };
            }), message: 'Choose an exact event ID. Recurring, cancelled or malformed events require app review.' };
        },
        async timelines({ teamId, eventId }) {
            const db = await managedDb(teamId);
            if (!ID.test(eventId || '')) throw new DomainError('invalid_argument', 'Use an exact event ID.');
            const snapshot = await db.collection(`teams/${teamId}/practiceSessions`).where('eventId', '==', eventId)
                .select('title', 'location', 'status', 'duration').limit(2).get();
            return { teamId, eventId, ambiguous: snapshot.docs.length > 1,
                timelines: snapshot.docs.map((doc) => ({ id: doc.id, title: String(doc.data().title || ''), location: typeof doc.data().location === 'string' ? doc.data().location : null,
                    status: String(doc.data().status || ''), duration: typeof doc.data().duration === 'number' ? doc.data().duration : null })),
                message: 'Multiple linked timelines require app review. Preparation verifies current draft state, packet status and exact revisions.' };
        },
        async drills(args) {
            const db = await managedDb(args.teamId);
            if (!['community', 'team', 'published'].includes(args.scope)) throw new DomainError('invalid_argument', 'Choose community, published or team drill scope.');
            let query = db.collection('drillLibrary');
            query = args.scope === 'team' ? query.where('teamId', '==', args.teamId)
                : args.scope === 'community' ? query.where('source', '==', 'community') : query.where('publishedToCommunity', '==', true);
            return { teamId: args.teamId, scope: args.scope, ...await page(query.select('title', 'type', 'setup'), args, (doc) => {
                const data = doc.data(); const minutes = Number(data.setup?.duration);
                return { id: doc.id, title: String(data.title || ''), type: typeof data.type === 'string' ? data.type : null,
                    suggestedMinutes: Number.isInteger(minutes) && minutes > 0 && minutes <= 120 ? minutes : null };
            }), message: 'Choose exact drill IDs and explicit durations. Preparation reads the description and current revision for approval.' };
        },
        async roster(args) {
            const context = await getContext();
            if (context.uid !== uid) throw new DomainError('permission_denied', 'The connected account changed.');
            return getManagedTeamRoster(await getDb(), context, args);
        },
        async teams() {
            const context = await getContext();
            if (context.uid !== uid) throw new DomainError('permission_denied', 'The connected account changed.');
            return { teams: [...context.teams].filter(([, team]) => team.roles.has('owner') || team.roles.has('admin'))
                .map(([id, team]) => ({ id, name: String(team.team?.name || id) })) };
        },
        async configurations({ teamId, cursor, limit = 20 }) {
            if (!ID.test(teamId || '') || (cursor !== undefined && !ID.test(cursor)) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
                throw new DomainError('invalid_argument', 'Use an exact team ID, returned cursor and page size from 1 to 50.');
            }
            validateManager(await getContext(), uid, teamId);
            const db = await getDb();
            let query = db.collection(`teams/${teamId}/statTrackerConfigs`).select('name', 'baseType').orderBy('__name__').limit(limit + 1);
            if (cursor) query = query.startAfterDocumentId(cursor);
            const snapshot = await query.get();
            const hasMore = snapshot.docs.length > limit;
            const page = snapshot.docs.slice(0, limit);
            return {
                teamId, configurations: page.map((doc) => ({ id: doc.id, name: String(doc.data().name || ''), baseType: String(doc.data().baseType || '') })),
                hasMore, nextCursor: hasMore ? page.at(-1).id : null,
                message: 'Fetch every page before resolving duplicate names. Preparation reads the exact configuration and approval rechecks its revision.'
            };
        }
    };
}
