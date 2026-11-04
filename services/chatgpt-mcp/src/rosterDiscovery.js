import { DomainError } from './core.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const FIELDS = ['name', 'number', 'position', 'active'];

// Read the current managed roster before proposing adds or updates. Context is
// rebuilt per call; the query still runs with the caller's Firebase token.
export async function getManagedTeamRoster(db, context, { teamId, cursor, limit = 50 }) {
    if (!SAFE_ID.test(teamId || '') || (cursor !== undefined && !SAFE_ID.test(cursor))) {
        throw new DomainError('invalid_argument', 'Use an exact teamId and the returned roster cursor.');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new DomainError('invalid_argument', 'Roster page size must be between 1 and 100.');
    }
    const roles = context.teams.get(teamId)?.roles;
    if (!(roles?.has('owner') || roles?.has('admin'))) {
        throw new DomainError('permission_denied', 'Only a current manager may discover this roster.');
    }
    let query = db.collection(`teams/${teamId}/players`).select(...FIELDS).orderBy('__name__').limit(limit + 1);
    if (cursor) query = query.startAfterDocumentId(cursor);
    // A denied or unavailable page must never look like an empty roster.
    const snapshot = await query.get();
    const hasMore = snapshot.docs.length > limit;
    const page = snapshot.docs.slice(0, limit);
    return {
        teamId,
        players: page.map((document) => {
            const data = document.data() || {};
            return {
                id: document.id,
                name: typeof data.name === 'string' ? data.name : '',
                number: typeof data.number === 'string' || typeof data.number === 'number' ? data.number : null,
                position: typeof data.position === 'string' ? data.position : '',
                active: data.active !== false
            };
        }),
        hasMore,
        nextCursor: hasMore ? page[page.length - 1].id : null,
        fieldsAvailable: ['id', ...FIELDS],
        message: 'Includes active and inactive players. Fetch every page before checking for duplicate names; do not infer a unique player from a partial page. This is not a frozen snapshot: the app revalidates the roster before confirmation. Family contacts and private profile fields are not included.'
    };
}
