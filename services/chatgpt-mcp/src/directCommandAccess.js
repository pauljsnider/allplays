import { DomainError } from './core.js';
import { ID } from './directRevisionCommand.js';

export function validateManager(context, uid, teamId) {
    if (context.uid !== uid || !ID.test(uid)) throw new DomainError('permission_denied', 'The connected account changed.');
    const roles = context.teams.get(teamId)?.roles;
    if (!(roles?.has('owner') || roles?.has('admin'))) throw new DomainError('permission_denied', 'Current team-manager access is required.');
}
