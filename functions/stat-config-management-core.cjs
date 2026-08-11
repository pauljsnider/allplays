'use strict';

const DEFAULT_MAX_STAT_CONFIGS = 200;
const DEFAULT_MAX_SHARED_GAMES_PER_QUERY = 500;
const CONFIG_ASSIGNED_MESSAGE = 'This config is still assigned to one or more games. Remove it from those games before deleting the config.';
const RESET_ASSIGNED_MESSAGE = 'One or more stat configs are still assigned to existing games, including completed history. Remove those assignments before resetting the stats setup.';

function normalizeBoundedId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && !normalized.includes('/') ? normalized : '';
}

function isSharedGameLinkedToTeam(game = {}, teamId) {
  return game.homeTeamId === teamId
    || game.awayTeamId === teamId
    || (Array.isArray(game.teamIds) && game.teamIds.includes(teamId));
}

function snapshotSize(snapshot) {
  return Number(snapshot?.size ?? snapshot?.docs?.length ?? 0);
}

function isAuthUserMissing(error) {
  return ['auth/user-not-found', 'user-not-found'].includes(String(error?.code || ''));
}

function makeValueQuery(collectionRef, field, values) {
  return values.length === 1
    ? collectionRef.where(field, '==', values[0])
    : collectionRef.where(field, 'in', values);
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function createStatConfigManagementHandlers({
  firestore,
  auth,
  hasTeamAdminAccess,
  HttpsError,
  maxConfigs = DEFAULT_MAX_STAT_CONFIGS,
  maxSharedGamesPerQuery = DEFAULT_MAX_SHARED_GAMES_PER_QUERY
}) {
  if (!firestore || !auth || typeof hasTeamAdminAccess !== 'function' || typeof HttpsError !== 'function') {
    throw new Error('Stat config management dependencies are required.');
  }

  const configLimit = Math.max(1, Math.min(Number(maxConfigs) || DEFAULT_MAX_STAT_CONFIGS, 400));
  const sharedGameLimit = Math.max(1, Math.min(Number(maxSharedGamesPerQuery) || DEFAULT_MAX_SHARED_GAMES_PER_QUERY, 1000));

  async function loadEnabledAuthUser(context) {
    const uid = normalizeBoundedId(context.auth?.uid);
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to manage stat configs.');
    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (error) {
      if (isAuthUserMissing(error)) throw new HttpsError('permission-denied', 'This account is not available.');
      throw new HttpsError('unavailable', 'Account access could not be verified. Try again.');
    }
    if (!authUser || authUser.uid !== uid || authUser.disabled === true) {
      throw new HttpsError('permission-denied', 'This account is not available.');
    }
    return { uid, authUser };
  }

  function parseRequest(data, { requireConfig = false } = {}) {
    const teamId = normalizeBoundedId(data?.teamId);
    const configId = requireConfig ? normalizeBoundedId(data?.configId) : '';
    if (!teamId || (requireConfig && !configId)) {
      throw new HttpsError('invalid-argument', requireConfig
        ? 'Valid teamId and configId values are required.'
        : 'A valid teamId is required.');
    }
    return { teamId, configId };
  }

  async function loadAuthorizedTeam(transaction, teamId, caller) {
    const teamRef = firestore.doc(`teams/${teamId}`);
    const userRef = firestore.doc(`users/${caller.uid}`);
    const teamSnap = await transaction.get(teamRef);
    const userSnap = await transaction.get(userRef);
    if (!teamSnap.exists) throw new HttpsError('not-found', 'Team not found.');
    const team = teamSnap.data() || {};
    const user = userSnap.exists ? userSnap.data() || {} : {};
    if (!hasTeamAdminAccess({
      team,
      user: { isAdmin: user.isAdmin === true },
      uid: caller.uid,
      email: typeof caller.authUser.email === 'string' ? caller.authUser.email.trim().toLowerCase() : ''
    })) {
      throw new HttpsError('permission-denied', 'You cannot manage stat configs for this team.');
    }
    return teamRef;
  }

  async function readBoundedSharedQuery(transaction, query) {
    const snapshot = await transaction.get(query.limit(sharedGameLimit + 1));
    if (snapshotSize(snapshot) > sharedGameLimit) {
      throw new HttpsError(
        'resource-exhausted',
        'Shared game history is too large to verify completely. No configs were changed.'
      );
    }
    return snapshot.docs || [];
  }

  async function deleteStatConfig(data, context = {}) {
    const { teamId, configId } = parseRequest(data, { requireConfig: true });
    const caller = await loadEnabledAuthUser(context);
    try {
      return await firestore.runTransaction(async (transaction) => {
        await loadAuthorizedTeam(transaction, teamId, caller);
        const configRef = firestore.doc(`teams/${teamId}/statTrackerConfigs/${configId}`);
        const configSnap = await transaction.get(configRef);
        if (!configSnap.exists) return { deleted: false, configId };

        const localGamesQuery = firestore.collection(`teams/${teamId}/games`)
          .where('statTrackerConfigId', '==', configId)
          .limit(1);
        const sharedGamesQuery = firestore.collectionGroup('sharedGames')
          .where('statTrackerConfigId', '==', configId);
        const localGamesSnap = await transaction.get(localGamesQuery);
        const sharedGameDocs = await readBoundedSharedQuery(transaction, sharedGamesQuery);
        const hasSharedReference = sharedGameDocs.some((docSnap) => (
          isSharedGameLinkedToTeam(docSnap.data() || {}, teamId)
        ));

        if (!localGamesSnap.empty || hasSharedReference) {
          throw new HttpsError('failed-precondition', CONFIG_ASSIGNED_MESSAGE);
        }
        transaction.delete(configRef);
        return { deleted: true, configId };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', 'Stat config references could not be verified. No config was deleted.');
    }
  }

  async function resetTeamStatConfigs(data, context = {}) {
    const { teamId } = parseRequest(data);
    const caller = await loadEnabledAuthUser(context);
    try {
      return await firestore.runTransaction(async (transaction) => {
        await loadAuthorizedTeam(transaction, teamId, caller);
        const configsQuery = firestore.collection(`teams/${teamId}/statTrackerConfigs`).limit(configLimit + 1);
        const configsSnap = await transaction.get(configsQuery);
        if (snapshotSize(configsSnap) > configLimit) {
          throw new HttpsError('resource-exhausted', 'This team has too many stat configs to reset safely.');
        }
        const configDocs = configsSnap.docs || [];
        const configIds = configDocs.map((docSnap) => normalizeBoundedId(docSnap.id)).filter(Boolean);
        if (!configIds.length) return { resetCount: 0 };

        for (const configIdChunk of chunk(configIds, 30)) {
          const localQuery = makeValueQuery(
            firestore.collection(`teams/${teamId}/games`),
            'statTrackerConfigId',
            configIdChunk
          ).limit(1);
          const localSnapshot = await transaction.get(localQuery);
          if (!localSnapshot.empty) throw new HttpsError('failed-precondition', RESET_ASSIGNED_MESSAGE);
        }

        const sharedGamesRef = firestore.collectionGroup('sharedGames');
        const sharedQueries = [
          sharedGamesRef.where('homeTeamId', '==', teamId),
          sharedGamesRef.where('awayTeamId', '==', teamId),
          sharedGamesRef.where('teamIds', 'array-contains', teamId)
        ];
        const sharedGamesByPath = new Map();
        for (const sharedQuery of sharedQueries) {
          const docs = await readBoundedSharedQuery(transaction, sharedQuery);
          docs.forEach((docSnap) => sharedGamesByPath.set(docSnap.ref.path, docSnap));
        }
        const resetConfigIds = new Set(configIds);
        const hasSharedReference = [...sharedGamesByPath.values()].some((docSnap) => {
          const game = docSnap.data() || {};
          return isSharedGameLinkedToTeam(game, teamId)
            && resetConfigIds.has(normalizeBoundedId(game.statTrackerConfigId));
        });
        if (hasSharedReference) throw new HttpsError('failed-precondition', RESET_ASSIGNED_MESSAGE);

        configDocs.forEach((configDoc) => transaction.delete(configDoc.ref));
        return { resetCount: configDocs.length };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', 'Stat config history could not be verified. No configs were reset.');
    }
  }

  return { deleteStatConfig, resetTeamStatConfigs };
}

module.exports = {
  CONFIG_ASSIGNED_MESSAGE,
  DEFAULT_MAX_SHARED_GAMES_PER_QUERY,
  DEFAULT_MAX_STAT_CONFIGS,
  RESET_ASSIGNED_MESSAGE,
  createStatConfigManagementHandlers,
  isSharedGameLinkedToTeam,
  normalizeBoundedId
};
