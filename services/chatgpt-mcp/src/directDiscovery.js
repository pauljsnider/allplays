import { DomainError } from './core.js';
import { ID } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';

// Discovery deliberately projects only names and schema summaries, never whole
// team, player or configuration documents. Every page rechecks current access.
export function createDirectDiscovery({ uid, getContext, getDb }) {
    return {
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
