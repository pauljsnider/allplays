// Isolated direct-command prototype. Not registered by the production server.
import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';

const favoritePath = ({ teamId, drillId }) => `teams/${teamId}/drillFavorites/${drillId}`;

async function readTarget(reader, args) {
    const team = await reader.get(`teams/${args.teamId}`);
    const drill = await reader.get(`drillLibrary/${args.drillId}`);
    const favorite = await reader.get(favoritePath(args));
    if (!team.exists || !drill.exists) throw new DomainError('not_found', 'The team or drill is unavailable.');
    if (!team.version || !drill.version || (favorite.exists && !favorite.version)) throw new DomainError('unavailable', 'Target revisions could not be verified.');
    return { team, drill, favorite };
}

function revisions(target) {
    return { team: target.team.version, drill: target.drill.version, favorite: target.favorite.version || null };
}

function previewFor(target, { teamId, drillId, favorite }) {
    return {
        action: favorite ? 'Add team drill favorite' : 'Remove team drill favorite',
        teamId, teamName: String(target.team.data.name || teamId),
        drillId, drillTitle: String(target.drill.data.title || drillId),
        wasFavorite: target.favorite.exists, favorite
    };
}

export function createDirectFavoriteCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: 'mcp_direct_favorite',
        args: ({ teamId, drillId, favorite }) => {
            if (!ID.test(teamId || '') || !ID.test(drillId || '') || typeof favorite !== 'boolean') {
                throw new DomainError('invalid_argument', 'Provide exact team/drill IDs and an explicit favorite boolean.');
            }
            return { teamId, drillId, favorite };
        },
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        result: ({ teamId, drillId, favorite }) => ({ teamId, drillId, favorite }),
        readTarget, revisions, preview: previewFor,
        apply: (transaction, target, record, { uid, now }) => {
            if (record.favorite && !target.favorite.exists) {
                transaction.set(favoritePath(record), { addedBy: uid, addedAt: new Date(now()) });
            } else if (!record.favorite && target.favorite.exists) {
                transaction.delete(favoritePath(record));
            }
        }
    });
}
