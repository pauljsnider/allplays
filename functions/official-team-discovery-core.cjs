'use strict';

const {
  buildSharedGameSyntheticId: buildSyntheticSharedGameId,
  getValidatedParentTeamIds,
  isCurrentOrUpcomingOfficiatingGame,
  normalizeSharedGamePath
} = require('./officiating-self-assignment-core.cjs');

const DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS = 200;
const DEFAULT_MAX_OFFICIAL_ASSIGNMENT_TEAMS = 50;
const DEFAULT_MAX_OFFICIAL_GAMES_PER_TEAM = 100;
const DEFAULT_MAX_OFFICIAL_PROJECTION_QUERIES = 60;
const DEFAULT_MAX_OFFICIAL_PROJECTION_DOCUMENTS = 2000;
const DEFAULT_OFFICIAL_PROJECTION_CONCURRENCY = 6;

function normalizeBoundedId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && !normalized.includes('/') ? normalized : '';
}

function normalizeStoredUserId(value) {
  if (typeof value !== 'string') return '';
  if (!value || value.length > 128 || value.includes('/') || value !== value.trim()) return '';
  return value;
}

function hasStoredPrincipalValue(value) {
  if (value === null || value === undefined) return false;
  return typeof value === 'string' ? value.length > 0 : true;
}

function normalizeOfficialEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 320) : '';
}

function normalizeOfficialPhone(value) {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value))];
}

function buildOfficialEmailCandidates(authUser = {}) {
  const rawEmail = typeof authUser.email === 'string' ? authUser.email.trim() : '';
  return uniqueStrings([rawEmail, normalizeOfficialEmail(rawEmail)]).slice(0, 10);
}

function buildOfficialPhoneCandidates(authUser = {}) {
  const rawPhone = typeof authUser.phoneNumber === 'string' ? authUser.phoneNumber.trim() : '';
  const digits = normalizeOfficialPhone(rawPhone);
  if (!digits) return [];

  const candidates = [rawPhone, digits];
  if (digits.length === 10) {
    const area = digits.slice(0, 3);
    const prefix = digits.slice(3, 6);
    const line = digits.slice(6);
    candidates.push(
      `+1${digits}`,
      `${area}-${prefix}-${line}`,
      `${area}.${prefix}.${line}`,
      `${area} ${prefix} ${line}`,
      `(${area}) ${prefix}-${line}`
    );
  }
  return uniqueStrings(candidates).slice(0, 10);
}

function chunkValues(values, size = 30) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrencyLimit(items, limit, worker) {
  const values = Array.from(items || []);
  const concurrency = Math.max(1, Math.min(Number(limit) || 1, values.length || 1));
  const results = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(values[currentIndex], currentIndex);
    }
  }));
  return results;
}

function allocateProjectionQueryLimits(jobCount, totalDocumentLimit, reservedDocuments, perQueryLimit) {
  let remainingDocuments = totalDocumentLimit - reservedDocuments;
  if (jobCount > 0 && remainingDocuments < jobCount) return [];
  const limits = [];
  for (let index = 0; index < jobCount; index += 1) {
    const remainingJobs = jobCount - index;
    const queryLimit = Math.max(1, Math.min(perQueryLimit, Math.floor(remainingDocuments / remainingJobs)));
    limits.push(queryLimit);
    remainingDocuments -= queryLimit;
  }
  return limits;
}

function isOfficialDocumentAuthorizedForQuery(docSnapshot, authUser = {}, proof = 'auth') {
  const official = docSnapshot?.data?.() || {};
  const uid = normalizeStoredUserId(authUser.uid);
  const storedOfficialUserId = normalizeStoredUserId(official.officialUserId);
  if (hasStoredPrincipalValue(official.officialUserId)) {
    return Boolean(uid && storedOfficialUserId && uid === storedOfficialUserId);
  }
  if (proof !== 'profile-phone') return true;
  if (authUser.emailVerified !== true) return false;
  const authEmail = normalizeOfficialEmail(authUser.email);
  return Boolean(
    authEmail &&
    [official.emailLower, official.email]
      .map(normalizeOfficialEmail)
      .some((email) => email === authEmail)
  );
}

function validateLegacyOfficialBindingState({ official = {}, user = {}, authUser = {}, userId, expectedPhone }) {
  const normalizedUserId = normalizeStoredUserId(userId);
  const normalizedExpectedPhone = normalizeOfficialPhone(expectedPhone);
  if (!normalizedUserId || normalizedExpectedPhone.length < 7 || normalizedExpectedPhone.length > 15) {
    throw new Error('A valid target user and expected phone are required.');
  }
  if (!authUser || authUser.uid !== normalizedUserId || authUser.disabled === true) {
    throw new Error('The target Auth account is unavailable.');
  }
  const storedOfficialUserId = normalizeStoredUserId(official.officialUserId);
  if (hasStoredPrincipalValue(official.officialUserId)) {
    if (!storedOfficialUserId || storedOfficialUserId !== normalizedUserId) {
      throw new Error('The official row already has a conflicting canonical user binding.');
    }
    return { alreadyBound: true, normalizedUserId };
  }
  const profilePhone = normalizeOfficialPhone(user.phoneNumber || user.phone);
  const officialPhone = normalizeOfficialPhone(official.phoneDigits || official.phone);
  if (profilePhone !== normalizedExpectedPhone || officialPhone !== normalizedExpectedPhone) {
    throw new Error('The approved phone does not match both legacy records.');
  }
  const officialEmails = [official.emailLower, official.email].map(normalizeOfficialEmail).filter(Boolean);
  if (officialEmails.length > 0) {
    const authEmail = authUser.emailVerified === true ? normalizeOfficialEmail(authUser.email) : '';
    if (!authEmail || !officialEmails.includes(authEmail)) {
      throw new Error('The official row has a conflicting email identity.');
    }
  }
  return { alreadyBound: false, normalizedUserId };
}

function createOfficialUserBindingMigrator({ firestore, auth, serverTimestamp = () => new Date() }) {
  if (!firestore || !auth || typeof firestore.runTransaction !== 'function') {
    throw new Error('Official identity migration dependencies are required.');
  }
  return async function migrateOfficialUserBinding({
    teamId,
    officialId,
    userId,
    expectedPhone,
    dryRun = true
  } = {}) {
    const normalizedTeamId = normalizeBoundedId(teamId);
    const normalizedOfficialId = normalizeBoundedId(officialId);
    const normalizedUserId = normalizeStoredUserId(userId);
    if (!normalizedTeamId || !normalizedOfficialId || !normalizedUserId) {
      throw new Error('Valid team, official, and user IDs are required.');
    }
    const authUser = await auth.getUser(normalizedUserId);
    const officialRef = firestore.doc(`teams/${normalizedTeamId}/officials/${normalizedOfficialId}`);
    const userRef = firestore.doc(`users/${normalizedUserId}`);
    return firestore.runTransaction(async (transaction) => {
      const [officialSnap, userSnap] = await Promise.all([
        transaction.get(officialRef),
        transaction.get(userRef)
      ]);
      if (!officialSnap.exists || !userSnap.exists) {
        throw new Error('Both the official row and user profile must exist.');
      }
      const validation = validateLegacyOfficialBindingState({
        official: officialSnap.data() || {},
        user: userSnap.data() || {},
        authUser,
        userId: normalizedUserId,
        expectedPhone
      });
      if (!dryRun && !validation.alreadyBound) {
        transaction.update(officialRef, {
          officialUserId: normalizedUserId,
          officialUserBindingMethod: 'operator-approved-profile-phone',
          officialUserBoundAt: serverTimestamp()
        });
      }
      return {
        teamId: normalizedTeamId,
        officialId: normalizedOfficialId,
        userId: normalizedUserId,
        dryRun: dryRun === true,
        alreadyBound: validation.alreadyBound
      };
    });
  };
}

function extractOfficialTeamId(docSnapshot) {
  const parts = String(docSnapshot?.ref?.path || '').split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== 'teams' || parts[2] !== 'officials') return '';
  return normalizeBoundedId(parts[1]);
}

function extractAssignedGameTeamIds(docSnapshot, collectionGroupName) {
  if (collectionGroupName === 'games') {
    const parts = String(docSnapshot?.ref?.path || '').split('/').filter(Boolean);
    const teamId = parts.length === 4 && parts[0] === 'teams' && parts[2] === 'games'
      ? normalizeStoredUserId(parts[1])
      : '';
    return teamId ? [teamId] : [];
  }

  const game = docSnapshot?.data?.() || {};
  const rawTeamIds = [
    ...(game.homeTeamId == null || game.homeTeamId === '' ? [] : [game.homeTeamId]),
    ...(game.awayTeamId == null || game.awayTeamId === '' ? [] : [game.awayTeamId]),
    ...(Array.isArray(game.teamIds) ? game.teamIds : [])
  ];
  if (game.teamIds != null && !Array.isArray(game.teamIds)) return [];
  const teamIds = rawTeamIds.map(normalizeStoredUserId);
  if (!teamIds.length || teamIds.some((teamId) => !teamId)) return [];
  return [...new Set(teamIds)];
}

function isAuthUserMissing(error) {
  return ['auth/user-not-found', 'user-not-found'].includes(String(error?.code || ''));
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  if (value && typeof value.toMillis === 'function') return new Date(value.toMillis());
  if (value && typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isCurrentOrUpcomingOfficialGame(game = {}, now = new Date()) {
  return isCurrentOrUpcomingOfficiatingGame(game, now);
}

function isAssignedToAuthUser(slot = {}, authUser = {}) {
  const uid = normalizeStoredUserId(authUser.uid);
  const email = authUser.emailVerified === true ? normalizeOfficialEmail(authUser.email) : '';
  const assignedUid = normalizeStoredUserId(slot.officialUserId);
  if (hasStoredPrincipalValue(slot.officialUserId)) return Boolean(assignedUid && uid && assignedUid === uid);
  return Boolean(email && normalizeOfficialEmail(slot.officialEmail || slot.email) === email);
}

function getSharedGamePath(docSnapshot) {
  return normalizeSharedGamePath(docSnapshot?.ref?.path) || '';
}

function buildSharedGameSyntheticId(docSnapshot) {
  const path = getSharedGamePath(docSnapshot);
  return path ? buildSyntheticSharedGameId(path) : '';
}

function getSharedGameDocumentId(docSnapshot) {
  const path = getSharedGamePath(docSnapshot);
  return path ? path.split('/').pop() || '' : '';
}

function projectSharedGameForTeam(game = {}, teamId = '') {
  const isHome = normalizeBoundedId(game.homeTeamId) === teamId;
  const isAway = normalizeBoundedId(game.awayTeamId) === teamId;
  const opponent = isHome
    ? game.awayTeamName || game.opponentTeamName || game.opponent
    : isAway
      ? game.homeTeamName || game.opponentTeamName || game.opponent
      : game.opponent;
  return { ...game, opponent };
}

function canClaimOpenOfficialSlots(teamId, team = {}, user = {}, authUser = {}) {
  const uid = normalizeStoredUserId(authUser.uid);
  const email = authUser.emailVerified === true ? normalizeOfficialEmail(authUser.email) : '';
  const adminEmails = Array.isArray(team.adminEmails)
    ? team.adminEmails.map(normalizeOfficialEmail).filter(Boolean)
    : [];
  return Boolean(
    user.isAdmin === true ||
    normalizeStoredUserId(team.ownerId) === uid ||
    (email && adminEmails.includes(email)) ||
    getValidatedParentTeamIds(user).includes(teamId)
  );
}

function serializeOfficialAssignment({ teamId, teamName, gameId, sharedGamePath = '', game, slot, kind }) {
  const date = toDate(game.date);
  const slotId = normalizeBoundedId(slot.id) || normalizeBoundedId(slot.slotId);
  if (!date || !normalizeBoundedId(teamId) || !normalizeBoundedId(gameId) || !slotId) return null;
  return {
    kind,
    teamId,
    teamName,
    gameId,
    slotId,
    position: String(slot.position || 'Official').trim().slice(0, 100) || 'Official',
    status: kind === 'open' ? 'open' : (String(slot.status || 'pending').trim().slice(0, 50) || 'pending'),
    opponent: String(game.opponent || 'TBD').trim().slice(0, 200) || 'TBD',
    location: String(game.location || 'Location TBD').trim().slice(0, 500) || 'Location TBD',
    date: date.toISOString(),
    canClaim: kind === 'open',
    scheduleReviewRequired: kind === 'assigned' && slot.scheduleReviewRequired === true,
    ...(sharedGamePath ? { sharedGamePath } : {})
  };
}

function projectOfficialGameAssignments({ teamId, teamName, gameId, sharedGamePath = '', game, authUser, canClaimOpen }) {
  if (!isCurrentOrUpcomingOfficialGame(game)) return [];
  const slots = Array.isArray(game.officiatingSlots) ? game.officiatingSlots : [];
  const assigned = slots
    .filter((slot) => slot && typeof slot === 'object' && isAssignedToAuthUser(slot, authUser))
    .map((slot) => serializeOfficialAssignment({ teamId, teamName, gameId, sharedGamePath, game, slot, kind: 'assigned' }))
    .filter(Boolean);
  const open = canClaimOpen && game.officiatingSelfAssignmentEnabled === true
    ? slots
      .filter((slot) => slot && typeof slot === 'object' &&
        !hasStoredPrincipalValue(slot.officialUserId) &&
        !normalizeOfficialEmail(slot.officialEmail || slot.email) &&
        !String(slot.officialName || '').trim() &&
        String(slot.status || '').trim().toLowerCase() === 'open')
      .map((slot) => serializeOfficialAssignment({ teamId, teamName, gameId, sharedGamePath, game, slot, kind: 'open' }))
      .filter(Boolean)
    : [];
  return [...assigned, ...open];
}

function createOfficialTeamDiscoveryHandler({
  firestore,
  auth,
  HttpsError,
  maxDocumentsPerQuery = DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS,
  maxAssignmentTeams = DEFAULT_MAX_OFFICIAL_ASSIGNMENT_TEAMS,
  maxGamesPerTeam = DEFAULT_MAX_OFFICIAL_GAMES_PER_TEAM,
  maxProjectionQueries = DEFAULT_MAX_OFFICIAL_PROJECTION_QUERIES,
  maxProjectionDocuments = DEFAULT_MAX_OFFICIAL_PROJECTION_DOCUMENTS,
  projectionConcurrency = DEFAULT_OFFICIAL_PROJECTION_CONCURRENCY
}) {
  if (!firestore || !auth || typeof HttpsError !== 'function') {
    throw new Error('Official team discovery dependencies are required.');
  }

  const boundedLimit = Math.max(1, Math.min(Number(maxDocumentsPerQuery) || DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS, 500));
  const boundedAssignmentTeamLimit = Math.max(1, Math.min(Number(maxAssignmentTeams) || DEFAULT_MAX_OFFICIAL_ASSIGNMENT_TEAMS, 100));
  const boundedGameLimit = Math.max(1, Math.min(Number(maxGamesPerTeam) || DEFAULT_MAX_OFFICIAL_GAMES_PER_TEAM, 500));
  const boundedProjectionQueryLimit = Math.max(1, Math.min(Number(maxProjectionQueries) || DEFAULT_MAX_OFFICIAL_PROJECTION_QUERIES, 120));
  const boundedProjectionDocumentLimit = Math.max(1, Math.min(Number(maxProjectionDocuments) || DEFAULT_MAX_OFFICIAL_PROJECTION_DOCUMENTS, 5000));
  const boundedProjectionConcurrency = Math.max(1, Math.min(Number(projectionConcurrency) || DEFAULT_OFFICIAL_PROJECTION_CONCURRENCY, 12));

  async function loadOfficialDocuments(field, values) {
    if (!values.length) return [];
    try {
      let officialsQuery = firestore.collectionGroup('officials');
      officialsQuery = values.length === 1
        ? officialsQuery.where(field, '==', values[0])
        : officialsQuery.where(field, 'in', values);
      const snapshot = await officialsQuery.limit(boundedLimit + 1).get();
      if ((snapshot.size ?? snapshot.docs?.length ?? 0) > boundedLimit) {
        throw new HttpsError(
          'resource-exhausted',
          'Official team discovery is too large to verify completely. Contact support.'
        );
      }
      return Array.isArray(snapshot.docs) ? snapshot.docs : [];
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', 'Official team access could not be verified. Try again.');
    }
  }

  async function loadAssignedTeamIds(authUser) {
    const assignmentStartDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const collectionGroups = ['games', 'sharedGames'];
    const identityPlans = [
      { field: 'officiatingAuthorizedUserIds', value: authUser.uid },
      ...(authUser.emailVerified === true && normalizeOfficialEmail(authUser.email)
        ? [{ field: 'officiatingAuthorizedEmails', value: normalizeOfficialEmail(authUser.email) }]
        : [])
    ];
    const queryPlans = collectionGroups.flatMap((collectionGroupName) => identityPlans.map((identity) => ({
      collectionGroupName,
      ...identity
    })));
    let snapshots;
    try {
      snapshots = await Promise.all(queryPlans.map(({ collectionGroupName, field, value }) => firestore
        .collectionGroup(collectionGroupName)
        .where(field, 'array-contains', value)
        .where('date', '>=', assignmentStartDate)
        .limit(boundedGameLimit + 1)
        .get()));
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', 'Official assignment access could not be verified. Try again.');
    }
    if (snapshots.some((snapshot) => (snapshot.size ?? snapshot.docs?.length ?? 0) > boundedGameLimit)) {
      throw new HttpsError(
        'resource-exhausted',
        'Official assignment discovery is too large to verify completely. Contact support.'
      );
    }
    const teamIds = [];
    snapshots.forEach((snapshot, index) => {
      (Array.isArray(snapshot.docs) ? snapshot.docs : []).forEach((docSnapshot) => {
        const game = docSnapshot?.data?.() || {};
        const hasCurrentAssignment = Array.isArray(game.officiatingSlots)
          && game.officiatingSlots.some((slot) => (
            slot && typeof slot === 'object' && isAssignedToAuthUser(slot, authUser)
          ));
        if (!hasCurrentAssignment) return;
        const assignedTeamIds = extractAssignedGameTeamIds(docSnapshot, queryPlans[index].collectionGroupName);
        if (!assignedTeamIds.length) {
          throw new HttpsError('failed-precondition', 'Official assignment team identity could not be verified.');
        }
        teamIds.push(...assignedTeamIds);
      });
    });
    const uniqueTeamIds = [...new Set(teamIds)].sort();
    if (uniqueTeamIds.length > boundedAssignmentTeamLimit) {
      throw new HttpsError(
        'resource-exhausted',
        'Official assignment discovery is too large to verify completely. Contact support.'
      );
    }
    return uniqueTeamIds;
  }

  async function loadAssignmentProjection(teamIds, authUser, user = {}, directoryTeamIds = new Set(), preferredTeamId = '') {
    if (teamIds.length > boundedAssignmentTeamLimit) {
      throw new HttpsError(
        'resource-exhausted',
        'Official assignment discovery is too large to verify completely. Contact support.'
      );
    }
    if (teamIds.length === 0) {
      return { teams: [], assignments: [], assignmentsComplete: true };
    }
    const assignmentStartDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const teamRefs = teamIds.map((teamId) => firestore.doc(`teams/${teamId}`));
    const sharedMembershipPlans = [
      ['homeTeamId', 'in'],
      ['awayTeamId', 'in'],
      ['teamIds', 'array-contains-any']
    ];
    const queryJobs = [
      ...teamIds.map((teamId) => ({
        kind: 'direct',
        teamId,
        buildQuery: (queryLimit) => firestore.collection(`teams/${teamId}/games`)
          .where('date', '>=', assignmentStartDate)
          .limit(queryLimit)
      })),
      ...sharedMembershipPlans.flatMap(([field, operator]) => chunkValues(teamIds).map((teamIdChunk) => ({
        kind: 'shared',
        buildQuery: (queryLimit) => firestore.collectionGroup('sharedGames')
          .where(field, operator, teamIdChunk)
          .where('date', '>=', assignmentStartDate)
          .limit(queryLimit)
      })))
    ];
    if (queryJobs.length > boundedProjectionQueryLimit) {
      throw new HttpsError(
        'resource-exhausted',
        'Official assignment projection requires too many queries to verify safely. Contact support.'
      );
    }
    const queryReadLimits = allocateProjectionQueryLimits(
      queryJobs.length,
      boundedProjectionDocumentLimit,
      teamIds.length,
      boundedGameLimit + 1
    );
    if (queryReadLimits.length !== queryJobs.length) {
      throw new HttpsError(
        'resource-exhausted',
        'Official assignment projection is too large to verify safely. Contact support.'
      );
    }
    let projections;
    try {
      const teamSnapshots = typeof firestore.getAll === 'function'
        ? await firestore.getAll(...teamRefs)
        : await mapWithConcurrencyLimit(teamRefs, boundedProjectionConcurrency, (teamRef) => teamRef.get());
      let projectionDocumentCount = teamSnapshots.length;
      const querySnapshots = await mapWithConcurrencyLimit(
        queryJobs,
        boundedProjectionConcurrency,
        async (job, index) => {
          const queryReadLimit = queryReadLimits[index];
          const snapshot = await job.buildQuery(queryReadLimit).get();
          const snapshotSize = snapshot.size ?? snapshot.docs?.length ?? 0;
          projectionDocumentCount += snapshot.size ?? snapshot.docs?.length ?? 0;
          if (projectionDocumentCount > boundedProjectionDocumentLimit) {
            throw new HttpsError(
              'resource-exhausted',
              'Official assignment projection is too large to verify safely. Contact support.'
            );
          }
          if (
            snapshotSize > boundedGameLimit ||
            (queryReadLimit <= boundedGameLimit && snapshotSize >= queryReadLimit)
          ) {
            throw new HttpsError(
              'resource-exhausted',
              'Official assignment history is too large to verify completely. Contact support.'
            );
          }
          return snapshot;
        }
      );
      const teamSnapshotsById = new Map(teamSnapshots.map((teamSnap) => [teamSnap.id, teamSnap]));
      const directSnapshotsByTeamId = new Map();
      const sharedDocumentsByTeamId = new Map(teamIds.map((teamId) => [teamId, new Map()]));
      querySnapshots.forEach((snapshot, index) => {
        const job = queryJobs[index];
        if (job.kind === 'direct') {
          if ((snapshot.size ?? snapshot.docs?.length ?? 0) > boundedGameLimit) {
            throw new HttpsError(
              'resource-exhausted',
              'Official assignment history is too large to verify completely. Contact support.'
            );
          }
          directSnapshotsByTeamId.set(job.teamId, snapshot);
          return;
        }
        (Array.isArray(snapshot.docs) ? snapshot.docs : []).forEach((docSnap) => {
          const path = getSharedGamePath(docSnap);
          if (!path) {
            throw new HttpsError('failed-precondition', 'Official shared-game identity could not be verified.');
          }
          const sharedGame = docSnap.data() || {};
          const rawTeamIds = [
            sharedGame.homeTeamId,
            sharedGame.awayTeamId,
            ...(Array.isArray(sharedGame.teamIds) ? sharedGame.teamIds : [])
          ].filter((value) => value !== null && value !== undefined && value !== '');
          rawTeamIds.map(normalizeStoredUserId).filter(Boolean).forEach((teamId) => {
            sharedDocumentsByTeamId.get(teamId)?.set(path, docSnap);
          });
        });
      });
      sharedDocumentsByTeamId.forEach((documentsByPath) => {
        if (documentsByPath.size > boundedGameLimit) {
          throw new HttpsError(
            'resource-exhausted',
            'Official shared-game history is too large to verify completely. Contact support.'
          );
        }
      });
      projections = teamIds.map((teamId) => {
        const teamSnap = teamSnapshotsById.get(teamId);
        const gamesSnap = directSnapshotsByTeamId.get(teamId) || { docs: [] };
        const sharedGameDocs = [...(sharedDocumentsByTeamId.get(teamId)?.values() || [])];
        const team = teamSnap?.exists ? teamSnap.data() || {} : {};
        const teamName = String(team.name || 'Team').trim().slice(0, 200) || 'Team';
        const canClaimOpen = canClaimOpenOfficialSlots(teamId, team, user, authUser);
        const sharedGameDocumentIds = new Set(sharedGameDocs.map(getSharedGameDocumentId).filter(Boolean));
        const directAssignments = (Array.isArray(gamesSnap.docs) ? gamesSnap.docs : []).flatMap((gameSnap) => {
          const game = gameSnap.data() || {};
          if (typeof game.sharedGameId === 'string' && sharedGameDocumentIds.has(game.sharedGameId.trim())) {
            return [];
          }
          return projectOfficialGameAssignments({
            teamId,
            teamName,
            gameId: normalizeBoundedId(gameSnap.id),
            game,
            authUser,
            canClaimOpen
          });
        });
        const sharedAssignments = sharedGameDocs.flatMap((gameSnap) => {
          const sharedGamePath = getSharedGamePath(gameSnap);
          const gameId = buildSharedGameSyntheticId(gameSnap);
          if (!gameId || !sharedGamePath) {
            throw new HttpsError('failed-precondition', 'Official shared-game identity could not be represented safely.');
          }
          return projectOfficialGameAssignments({
            teamId,
            teamName,
            gameId,
            sharedGamePath,
            game: projectSharedGameForTeam(gameSnap.data() || {}, teamId),
            authUser,
            canClaimOpen
          });
        });
        const assignments = [...directAssignments, ...sharedAssignments];
        const hasAccess = directoryTeamIds.has(teamId) || canClaimOpen ||
          assignments.some((assignment) => assignment.kind === 'assigned');
        return { team: { id: teamId, name: teamName }, assignments, hasAccess };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', 'Official assignment details could not be verified. Try again.');
    }
    const accessibleProjections = projections.filter((projection) => projection.hasAccess);
    const assignmentProjections = preferredTeamId
      ? [
          ...accessibleProjections.filter((projection) => projection.team.id === preferredTeamId),
          ...accessibleProjections.filter((projection) => projection.team.id !== preferredTeamId)
        ]
      : accessibleProjections;
    const deduplicatedAssignments = new Map();
    assignmentProjections.flatMap((projection) => projection.assignments).forEach((assignment) => {
      const key = assignment.sharedGamePath
        ? `shared:${assignment.sharedGamePath}:${assignment.slotId}`
        : `direct:${assignment.teamId}:${assignment.gameId}:${assignment.slotId}`;
      if (!deduplicatedAssignments.has(key)) deduplicatedAssignments.set(key, assignment);
    });
    return {
      teams: accessibleProjections.map((projection) => projection.team),
      assignments: [...deduplicatedAssignments.values()]
        .sort((left, right) => left.date.localeCompare(right.date) || left.teamId.localeCompare(right.teamId)),
      assignmentsComplete: true
    };
  }

  return async function listOfficialLinkedTeamIds(data, context = {}) {
    const uid = normalizeStoredUserId(context.auth?.uid);
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to view official assignments.');

    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (error) {
      if (isAuthUserMissing(error)) {
        throw new HttpsError('permission-denied', 'This account is not available.');
      }
      throw new HttpsError('unavailable', 'Account access could not be verified. Try again.');
    }
    if (!authUser || authUser.uid !== uid || authUser.disabled === true) {
      throw new HttpsError('permission-denied', 'This account is not available.');
    }

    let userSnap;
    try {
      userSnap = await firestore.doc(`users/${authUser.uid}`).get();
    } catch {
      throw new HttpsError('unavailable', 'Official profile identity could not be verified. Try again.');
    }
    const user = userSnap?.exists ? userSnap.data() || {} : {};
    const emailCandidates = authUser.emailVerified === true ? buildOfficialEmailCandidates(authUser) : [];
    const normalizedEmail = authUser.emailVerified === true ? normalizeOfficialEmail(authUser.email) : '';
    const authPhoneCandidates = buildOfficialPhoneCandidates(authUser);
    const normalizedPhone = normalizeOfficialPhone(authUser.phoneNumber);
    const profilePhoneCandidates = buildOfficialPhoneCandidates({ phoneNumber: user.phoneNumber || user.phone });
    const normalizedProfilePhone = normalizeOfficialPhone(user.phoneNumber || user.phone);
    const queryPlans = [
      { field: 'officialUserId', values: [authUser.uid], proof: 'auth' },
      { field: 'email', values: emailCandidates, proof: 'auth' },
      { field: 'emailLower', values: normalizedEmail ? [normalizedEmail] : [], proof: 'auth' },
      { field: 'phone', values: authPhoneCandidates, proof: 'auth' },
      { field: 'phoneDigits', values: normalizedPhone ? [normalizedPhone] : [], proof: 'auth' },
      { field: 'phone', values: profilePhoneCandidates, proof: 'profile-phone' },
      { field: 'phoneDigits', values: normalizedProfilePhone ? [normalizedProfilePhone] : [], proof: 'profile-phone' }
    ].filter(({ values }, index, plans) => values.length > 0 && !plans.slice(0, index).some((plan) => (
      plan.field === plans[index].field && JSON.stringify(plan.values) === JSON.stringify(values)
    )));

    const [snapshots, assignedTeamIds] = await Promise.all([
      queryPlans.length
        ? Promise.all(queryPlans.map(async ({ field, values, proof }) => {
            const docs = await loadOfficialDocuments(field, values);
            return docs.filter((docSnap) => isOfficialDocumentAuthorizedForQuery(docSnap, authUser, proof));
          }))
        : Promise.resolve([]),
      loadAssignedTeamIds(authUser)
    ]);
    const directoryTeamIds = [...new Set(
      snapshots.flat().map(extractOfficialTeamId).filter(Boolean)
    )].sort();
    const teamIds = [...new Set([...directoryTeamIds, ...assignedTeamIds])].sort();

    const result = {
      teamIds,
      teamCount: teamIds.length,
      isPartial: false
    };
    if (data?.includeAssignments !== true) return result;
    const requestedTeamId = normalizeBoundedId(data?.requestedTeamId);
    if (data?.requestedTeamId != null && !requestedTeamId) {
      throw new HttpsError('invalid-argument', 'The requested official team is invalid.');
    }
    const projectionTeamIds = [...new Set([...teamIds, ...(requestedTeamId ? [requestedTeamId] : [])])].sort();
    const projection = await loadAssignmentProjection(
      projectionTeamIds,
      authUser,
      user,
      new Set(directoryTeamIds),
      requestedTeamId
    );
    const accessibleTeamIds = projection.teams.map((team) => team.id);
    return {
      teamIds: accessibleTeamIds,
      teamCount: accessibleTeamIds.length,
      isPartial: false,
      ...projection
    };
  };
}

module.exports = {
  DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS,
  DEFAULT_MAX_OFFICIAL_ASSIGNMENT_TEAMS,
  DEFAULT_MAX_OFFICIAL_GAMES_PER_TEAM,
  DEFAULT_MAX_OFFICIAL_PROJECTION_QUERIES,
  DEFAULT_MAX_OFFICIAL_PROJECTION_DOCUMENTS,
  buildOfficialEmailCandidates,
  buildOfficialPhoneCandidates,
  buildSharedGameSyntheticId,
  canClaimOpenOfficialSlots,
  createOfficialTeamDiscoveryHandler,
  createOfficialUserBindingMigrator,
  extractOfficialTeamId,
  isAssignedToAuthUser,
  isCurrentOrUpcomingOfficialGame,
  normalizeOfficialEmail,
  normalizeOfficialPhone,
  projectOfficialGameAssignments
};
