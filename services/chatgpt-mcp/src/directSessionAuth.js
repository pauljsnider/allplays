import { createHash } from 'node:crypto';
import { DomainError, loadManagedTeamsFromCallable, resolveUserContext } from './core.js';
import { extractBearerToken } from './identity.js';
import { createUserDb } from './firestoreRest.js';
import { createDirectFavoriteStore } from './directFavoriteStore.js';

// Review consent permits preparation only. The separate, one-action approval
// in directFavoriteMcp is required for execution; no grant is upgraded here.
export function createDirectSessionAuthenticator({ oauth, resolveIdentity, now = Date.now }) {
    return async (authorization) => {
        const token = extractBearerToken(authorization);
        const grant = token ? await oauth.resolveAccessToken(token, { includeBinding: true }) : null;
        if (!grant || !grant.clientId || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= now()) {
            throw new DomainError('unauthenticated', 'A current broker-issued connection is required.');
        }
        if (grant.reviewRequests !== true) throw new DomainError('insufficient_scope', 'Explicit review-request consent is required.');
        // Bypass the ordinary read cache: revoked Firebase refresh credentials
        // must fail before a new protocol interaction or execution step.
        const identity = await resolveIdentity(`Bearer ${grant.firebaseRefreshToken}`, { forceRefresh: true });
        if (identity?.via !== 'refresh-token' || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid || '') || !identity.idToken) {
            throw new DomainError('unauthenticated', 'The connected identity could not be verified.');
        }
        return {
            uid: identity.uid, email: identity.email, idToken: identity.idToken,
            clientId: grant.clientId, expiresAt: grant.expiresAt,
            grantKey: createHash('sha256').update(token).digest('hex')
        };
    };
}

export function directFavoriteDependencies({ projectId, fetchImpl = fetch }) {
    return (actor, getCurrentActor) => ({
        uid: actor.uid,
        store: createDirectFavoriteStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        getContext: async () => {
            const current = await getCurrentActor();
            const managed = await loadManagedTeamsFromCallable({ projectId, idToken: current.idToken, fetchImpl });
            if (managed.isPartial) throw new DomainError('unavailable', 'Current manager access could not be verified completely.');
            return resolveUserContext(createUserDb({ projectId, idToken: current.idToken, fetchImpl }), current, { managedTeams: managed.teams });
        }
    });
}
