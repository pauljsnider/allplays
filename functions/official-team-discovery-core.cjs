'use strict';

const {
  buildSharedGameSyntheticId: buildSyntheticSharedGameId,
  getValidatedParentTeamIds,
  normalizeSharedGamePath
} = require('./officiating-self-assignment-core.cjs');

const DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS = 200;
const DEFAULT_MAX_OFFICIAL_ASSIGNMENT_TEAMS = 50;
const DEFAULT_MAX_OFFICIAL_GAMES_PER_TEAM = 100;

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

function isCancelledGame(game = {}) {
  return [game.status, game.liveStatus]
    .map((value) => String(value || '').trim().toLowerCase())
    .some((value) => ['cancelled', 'canceled', 'deleted'].includes(value));
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
  const date = toDate(game.date);
  if (!date || date.getTime() < Date.now() || isCancelledGame(game)) return [];
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
  maxGamesPerTeam = DEFAULT_MAX_OFFICIAL_GAMES_PER_TEAM
}) {
  if (!firestore || !auth || typeof HttpsError !== 'function') {
    throw new Error('Official team discovery dependencies are required.');
  }

  const boundedLimit = Math.max(1, Math.min(Number(maxDocumentsPerQuery) || DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS, 500));
  const boundedAssignmentTeamLimit = Math.max(1, Math.min(Number(maxAssignmentTeams) || DEFAULT_MAX_OFFICIAL_ASSIGNMENT_TEAMS, 100));
  const boundedGameLimit = Math.max(1, Math.min(Number(maxGamesPerTeam) || DEFAULT_MAX_OFFICIAL_GAMES_PER_TEAM, 500));

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

  async function loadAssignmentProjection(teamIds, authUser, directoryTeamIds = new Set(), preferredTeamId = '') {
    if (teamIds.length > boundedAssignmentTeamLimit) {
      throw new HttpsError(
        'resource-exhausted',
        'Official assignment discovery is too large to verify completely. Contact support.'
      );
    }
    if (teamIds.length === 0) {
      return { teams: [], assignments: [], assignmentsComplete: true };
    }
    let userSnap;
    try {
      userSnap = await firestore.doc(`users/${authUser.uid}`).get();
    } catch {
      throw new HttpsError('unavailable', 'Official assignment details could not be verified. Try again.');
    }
    const user = userSnap?.exists ? userSnap.data() || {} : {};
    const assignmentStartDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    async function loadSharedGameDocuments(teamId) {
      const membershipQueries = [
        ['homeTeamId', '=='],
        ['awayTeamId', '=='],
        ['teamIds', 'array-contains']
      ];
      const queries = membershipQueries.map(([field, operator]) => firestore
        .collectionGroup('sharedGames')
        .where(field, operator, teamId)
        .where('date', '>=', assignmentStartDate)
        .limit(boundedGameLimit + 1));
      const snapshots = await Promise.all(queries.map((query) => query.get()));
      if (snapshots.some((snapshot) => (snapshot.size ?? snapshot.docs?.length ?? 0) > boundedGameLimit)) {
        throw new HttpsError(
          'resource-exhausted',
          'Official shared-game history is too large to verify completely. Contact support.'
        );
      }
      const documentsByPath = new Map();
      snapshots.forEach((snapshot) => {
        (Array.isArray(snapshot.docs) ? snapshot.docs : []).forEach((docSnap) => {
          const path = getSharedGamePath(docSnap);
          if (!path) {
            throw new HttpsError('failed-precondition', 'Official shared-game identity could not be verified.');
          }
          documentsByPath.set(path, docSnap);
        });
      });
      if (documentsByPath.size > boundedGameLimit) {
        throw new HttpsError(
          'resource-exhausted',
          'Official shared-game history is too large to verify completely. Contact support.'
        );
      }
      return [...documentsByPath.values()];
    }
    let projections;
    try {
      projections = await Promise.all(teamIds.map(async (teamId) => {
        const [teamSnap, gamesSnap, sharedGameDocs] = await Promise.all([
          firestore.doc(`teams/${teamId}`).get(),
          firestore.collection(`teams/${teamId}/games`)
            .where('date', '>=', assignmentStartDate)
            .limit(boundedGameLimit + 1)
            .get(),
          loadSharedGameDocuments(teamId)
        ]);
        if ((gamesSnap.size ?? gamesSnap.docs?.length ?? 0) > boundedGameLimit) {
          throw new HttpsError(
            'resource-exhausted',
            'Official assignment history is too large to verify completely. Contact support.'
          );
        }
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
      }));
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

    const emailCandidates = authUser.emailVerified === true ? buildOfficialEmailCandidates(authUser) : [];
    const normalizedEmail = authUser.emailVerified === true ? normalizeOfficialEmail(authUser.email) : '';
    const phoneCandidates = buildOfficialPhoneCandidates(authUser);
    const normalizedPhone = normalizeOfficialPhone(authUser.phoneNumber);
    const queryPlans = [
      ['email', emailCandidates],
      ['emailLower', normalizedEmail ? [normalizedEmail] : []],
      ['phone', phoneCandidates],
      ['phoneDigits', normalizedPhone ? [normalizedPhone] : []]
    ].filter(([, values]) => values.length > 0);

    const [snapshots, assignedTeamIds] = await Promise.all([
      queryPlans.length
        ? Promise.all(queryPlans.map(([field, values]) => loadOfficialDocuments(field, values)))
        : Promise.resolve([]),
      loadAssignedTeamIds(authUser)
    ]);
    const teamIds = [...new Set(
      [...snapshots.flat().map(extractOfficialTeamId).filter(Boolean), ...assignedTeamIds]
    )].sort();

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
    const projection = await loadAssignmentProjection(projectionTeamIds, authUser, new Set(teamIds), requestedTeamId);
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
  buildOfficialEmailCandidates,
  buildOfficialPhoneCandidates,
  buildSharedGameSyntheticId,
  canClaimOpenOfficialSlots,
  createOfficialTeamDiscoveryHandler,
  extractOfficialTeamId,
  isAssignedToAuthUser,
  normalizeOfficialEmail,
  normalizeOfficialPhone,
  projectOfficialGameAssignments
};
