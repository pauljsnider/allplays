'use strict';

const DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS = 200;
const DEFAULT_MAX_OFFICIAL_ASSIGNMENT_TEAMS = 50;
const DEFAULT_MAX_OFFICIAL_GAMES_PER_TEAM = 100;

function normalizeBoundedId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && !normalized.includes('/') ? normalized : '';
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
  const uid = normalizeBoundedId(authUser.uid);
  const email = authUser.emailVerified === true ? normalizeOfficialEmail(authUser.email) : '';
  return Boolean(
    (uid && normalizeBoundedId(slot.officialUserId) === uid) ||
    (email && normalizeOfficialEmail(slot.officialEmail || slot.email) === email)
  );
}

function canClaimOpenOfficialSlots(teamId, team = {}, user = {}, authUser = {}) {
  const uid = normalizeBoundedId(authUser.uid);
  const email = authUser.emailVerified === true ? normalizeOfficialEmail(authUser.email) : '';
  const adminEmails = Array.isArray(team.adminEmails)
    ? team.adminEmails.map(normalizeOfficialEmail).filter(Boolean)
    : [];
  return Boolean(
    user.isAdmin === true ||
    normalizeBoundedId(team.ownerId) === uid ||
    (email && adminEmails.includes(email)) ||
    (Array.isArray(user.parentTeamIds) && user.parentTeamIds.map(normalizeBoundedId).includes(teamId))
  );
}

function serializeOfficialAssignment({ teamId, teamName, gameId, game, slot, kind }) {
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
    scheduleReviewRequired: kind === 'assigned' && slot.scheduleReviewRequired === true
  };
}

function projectOfficialGameAssignments({ teamId, teamName, gameId, game, authUser, canClaimOpen }) {
  const date = toDate(game.date);
  if (!date || date.getTime() < Date.now() || isCancelledGame(game)) return [];
  const slots = Array.isArray(game.officiatingSlots) ? game.officiatingSlots : [];
  const assigned = slots
    .filter((slot) => slot && typeof slot === 'object' && isAssignedToAuthUser(slot, authUser))
    .map((slot) => serializeOfficialAssignment({ teamId, teamName, gameId, game, slot, kind: 'assigned' }))
    .filter(Boolean);
  const open = canClaimOpen && game.officiatingSelfAssignmentEnabled === true
    ? slots
      .filter((slot) => slot && typeof slot === 'object' &&
        !normalizeBoundedId(slot.officialUserId) &&
        !normalizeOfficialEmail(slot.officialEmail || slot.email) &&
        !String(slot.officialName || '').trim() &&
        String(slot.status || '').trim().toLowerCase() === 'open')
      .map((slot) => serializeOfficialAssignment({ teamId, teamName, gameId, game, slot, kind: 'open' }))
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

  async function loadAssignmentProjection(teamIds, authUser) {
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
    let projections;
    try {
      projections = await Promise.all(teamIds.map(async (teamId) => {
        const [teamSnap, gamesSnap] = await Promise.all([
          firestore.doc(`teams/${teamId}`).get(),
          firestore.collection(`teams/${teamId}/games`)
            .where('date', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
            .limit(boundedGameLimit + 1)
            .get()
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
        const assignments = (Array.isArray(gamesSnap.docs) ? gamesSnap.docs : []).flatMap((gameSnap) => (
          projectOfficialGameAssignments({
            teamId,
            teamName,
            gameId: normalizeBoundedId(gameSnap.id),
            game: gameSnap.data() || {},
            authUser,
            canClaimOpen
          })
        ));
        return { team: { id: teamId, name: teamName }, assignments };
      }));
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', 'Official assignment details could not be verified. Try again.');
    }
    return {
      teams: projections.map((projection) => projection.team),
      assignments: projections.flatMap((projection) => projection.assignments)
        .sort((left, right) => left.date.localeCompare(right.date) || left.teamId.localeCompare(right.teamId)),
      assignmentsComplete: true
    };
  }

  return async function listOfficialLinkedTeamIds(data, context = {}) {
    const uid = normalizeBoundedId(context.auth?.uid);
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

    if (!queryPlans.length) {
      return { teamIds: [], teamCount: 0, isPartial: false };
    }

    const snapshots = await Promise.all(
      queryPlans.map(([field, values]) => loadOfficialDocuments(field, values))
    );
    const teamIds = [...new Set(
      snapshots.flat().map(extractOfficialTeamId).filter(Boolean)
    )].sort();

    const result = {
      teamIds,
      teamCount: teamIds.length,
      isPartial: false
    };
    if (data?.includeAssignments !== true) return result;
    return {
      ...result,
      ...(await loadAssignmentProjection(teamIds, authUser))
    };
  };
}

module.exports = {
  DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS,
  DEFAULT_MAX_OFFICIAL_ASSIGNMENT_TEAMS,
  DEFAULT_MAX_OFFICIAL_GAMES_PER_TEAM,
  buildOfficialEmailCandidates,
  buildOfficialPhoneCandidates,
  canClaimOpenOfficialSlots,
  createOfficialTeamDiscoveryHandler,
  extractOfficialTeamId,
  isAssignedToAuthUser,
  normalizeOfficialEmail,
  normalizeOfficialPhone,
  projectOfficialGameAssignments
};
