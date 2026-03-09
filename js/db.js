import {
    db,
    auth,
    storage,
    collection,
    getDocs,
    getDoc,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    setDoc,
    query,
    where,
    orderBy,
    Timestamp,
    increment,
    arrayUnion,
    arrayRemove,
    deleteField,
    limit,
    startAfter,
    getCountFromServer,
    onSnapshot,
    serverTimestamp,
    collectionGroup,
    writeBatch,
    runTransaction,
    ref,
    uploadBytes,
    getDownloadURL
} from './firebase.js?v=9';
import { imageStorage, ensureImageAuth, requireImageAuth } from './firebase-images.js?v=2';
import { buildDrillDiagramUploadPaths } from './drill-upload-paths.js?v=1';
import { isAccessCodeExpired } from './access-code-utils.js?v=1';
import {
    buildParentMembershipRequestId,
    buildParentMembershipRequestUpdate,
    mergeApprovedParentLinkState
} from './parent-membership-utils.js?v=1';
import { buildCoachOverrideRsvpDocId, shouldDeleteLegacyRsvpForOverride } from './rsvp-doc-ids.js';
import { computeEffectiveRsvpSummary } from './rsvp-summary.js?v=1';
import {
    shouldMirrorSharedGame,
    createSharedScheduleId,
    buildMirroredGamePayload,
    buildSharedScheduleSourceUpdate,
    buildSharedScheduleDetachUpdate
} from './shared-schedule-sync.js';
import {
    isTeamActive,
    filterTeamsByActive,
    shouldIncludeTeamInLiveOrUpcoming,
    shouldIncludeTeamInReplay
} from './team-visibility.js?v=1';
import { getApp } from './vendor/firebase-app.js';
// import { getAI, getGenerativeModel, GoogleAIBackend } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-vertexai.js';
export { collection, getDocs, deleteDoc, query };
const limitQuery = limit;
const startAfterQuery = startAfter;
const CHAT_REACTIONS = [
    { key: 'thumbs_up', emoji: '👍' },
    { key: 'heart', emoji: '❤️' },
    { key: 'joy', emoji: '😂' },
    { key: 'wow', emoji: '😮' },
    { key: 'sad', emoji: '😢' },
    { key: 'clap', emoji: '👏' }
];
const CHAT_REACTION_KEYS = new Set(CHAT_REACTIONS.map(r => r.key));

export async function uploadTeamPhoto(file) {
    console.log('Starting photo upload...', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
    });

    await ensureImageAuth();

    const path = `team-photos/${Date.now()}_${file.name}`;
    console.log('Upload path:', path);

    const storageRef = ref(imageStorage, path);
    console.log('Storage reference created');

    const snapshot = await uploadBytes(storageRef, file);
    console.log('Upload complete, getting download URL...');

    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log('Download URL obtained:', downloadURL);

    return downloadURL;
}

export async function uploadPlayerPhoto(file) {
    console.log('Starting player photo upload...', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
    });

    await ensureImageAuth();

    const path = `player-photos/${Date.now()}_${file.name}`;
    const storageRef = ref(imageStorage, path);

    const snapshot = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log('Player photo URL:', downloadURL);

    return downloadURL;
}

export async function uploadUserPhoto(file) {
    console.log('Starting user photo upload...', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
    });

    await ensureImageAuth();

    const path = `user-photos/${Date.now()}_${file.name}`;
    const storageRef = ref(imageStorage, path);

    const snapshot = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log('User photo URL:', downloadURL);

    return downloadURL;
}

export async function uploadChatImage(teamId, file) {
    await requireImageAuth();

    const ts = Date.now();
    const safeName = String(file.name || 'image').replace(/[^\w.\-]+/g, '_');
    const imagePath = `team-photos/${ts}_chat_${teamId}_${safeName}`;

    try {
        const storageRef = ref(imageStorage, imagePath);
        const snapshot = await uploadBytes(storageRef, file);
        const url = await getDownloadURL(snapshot.ref);
        return {
            url,
            path: imagePath,
            name: file.name || null,
            type: file.type || null,
            size: Number.isFinite(file.size) ? file.size : null
        };
    } catch (error) {
        const code = error?.code || '';
        if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
            console.warn('Image storage denied chat upload, falling back to main storage:', error?.message || error);
            const fallbackPath = `stat-sheets/${ts}_chat_${teamId}_${safeName}`;
            const fallbackRef = ref(storage, fallbackPath);
            const fallbackSnapshot = await uploadBytes(fallbackRef, file);
            const fallbackUrl = await getDownloadURL(fallbackSnapshot.ref);
            return {
                url: fallbackUrl,
                path: fallbackPath,
                name: file.name || null,
                type: file.type || null,
                size: Number.isFinite(file.size) ? file.size : null
            };
        }
        throw error;
    }
}

export async function uploadStatSheetPhoto(file) {
    console.log('Starting stat sheet upload...', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
    });

    await requireImageAuth();

    const path = `team-photos/${Date.now()}_stat-sheet_${file.name}`;
    try {
        const storageRef = ref(imageStorage, path);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        console.log('Stat sheet URL (image storage):', downloadURL);
        return downloadURL;
    } catch (error) {
        const code = error?.code || '';
        if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
            console.warn('Image storage denied upload, falling back to main storage:', error?.message || error);
            const fallbackRef = ref(storage, `stat-sheets/${Date.now()}_${file.name}`);
            const snapshot = await uploadBytes(fallbackRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);
            console.log('Stat sheet URL (main storage):', downloadURL);
            return downloadURL;
        }
        throw error;
    }
}

// Teams
export async function getTeams(options = {}) {
    const includeInactive = !!options.includeInactive;
    const q = query(collection(db, "teams"), orderBy("name"));
    const snapshot = await getDocs(q);
    const teams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return filterTeamsByActive(teams, includeInactive);
}

export async function getTeam(teamId, options = {}) {
    const includeInactive = !!options.includeInactive;
    const docRef = doc(db, "teams", teamId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const team = { id: docSnap.id, ...docSnap.data() };
        if (!includeInactive && !isTeamActive(team)) return null;
        return team;
    } else {
        return null;
    }
}

export async function getUserTeams(userId, options = {}) {
    const includeInactive = !!options.includeInactive;
    const q = query(collection(db, "teams"), where("ownerId", "==", userId));
    const snapshot = await getDocs(q);
    // Sort in memory instead of query to avoid composite index requirement
    const teams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.name.localeCompare(b.name));
    return filterTeamsByActive(teams, includeInactive);
}

export async function getUserTeamsWithAccess(userId, email, options = {}) {
    const includeInactive = !!options.includeInactive;
    const [ownedSnap, adminSnap] = await Promise.all([
        getDocs(query(collection(db, "teams"), where("ownerId", "==", userId))),
        email ? getDocs(query(collection(db, "teams"), where("adminEmails", "array-contains", email.toLowerCase()))) : Promise.resolve({ docs: [] })
    ]);

    const map = new Map();
    ownedSnap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
    adminSnap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));

    const teams = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    return filterTeamsByActive(teams, includeInactive);
}

/**
 * Get teams where the user is connected as a parent (via parentOf)
 * This is used to power the "My Teams" view for parents, in a read-only way.
 */
export async function getParentTeams(userId, options = {}) {
    const includeInactive = !!options.includeInactive;
    const profile = await getUserProfile(userId);
    if (!profile || !Array.isArray(profile.parentOf) || profile.parentOf.length === 0) {
        return [];
    }

    const teamIds = [...new Set(profile.parentOf.map(p => p.teamId).filter(Boolean))];
    if (teamIds.length === 0) return [];

    const teams = [];
    for (const teamId of teamIds) {
        const team = await getTeam(teamId, { includeInactive });
        if (team) {
            teams.push(team);
        }
    }

    // Sort by name for consistency with other helpers
    return teams.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// User profiles
export async function getUserProfile(userId) {
    const docRef = doc(db, "users", userId);
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
}

export async function updateUserProfile(userId, profile) {
    const docRef = doc(db, "users", userId);
    profile.updatedAt = Timestamp.now();
    await setDoc(docRef, profile, { merge: true });
}

export async function getAllUsers() {
    const q = query(collection(db, "users"), orderBy("email"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getUserByEmail(email) {
    const q = query(collection(db, "users"), where("email", "==", email));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

export async function createTeam(teamData) {
    teamData.createdAt = Timestamp.now();
    teamData.updatedAt = Timestamp.now();
    if (!Object.prototype.hasOwnProperty.call(teamData, 'active')) {
        teamData.active = true;
    }
    if (!Object.prototype.hasOwnProperty.call(teamData, 'deactivatedAt')) {
        teamData.deactivatedAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(teamData, 'deactivatedBy')) {
        teamData.deactivatedBy = null;
    }
    const docRef = await addDoc(collection(db, "teams"), teamData);
    return docRef.id;
}

export async function updateTeam(teamId, teamData) {
    teamData.updatedAt = Timestamp.now();
    const docRef = doc(db, "teams", teamId);
    await updateDoc(docRef, teamData);
}

export async function addTeamAdminEmail(teamId, email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
        throw new Error('Admin email is required');
    }

    const docRef = doc(db, "teams", teamId);
    await updateDoc(docRef, {
        adminEmails: arrayUnion(normalizedEmail),
        updatedAt: Timestamp.now()
    });
}

export async function deleteTeam(teamId) {
    const userId = auth.currentUser?.uid || null;
    await updateDoc(doc(db, "teams", teamId), {
        active: false,
        deactivatedAt: Timestamp.now(),
        deactivatedBy: userId,
        updatedAt: Timestamp.now()
    });
}

// Players
function assertNoSensitivePlayerFields(playerData) {
    if (!playerData || typeof playerData !== 'object') return;
    const forbidden = ['medicalInfo', 'emergencyContact'];
    const present = forbidden.filter(k => Object.prototype.hasOwnProperty.call(playerData, k));
    if (present.length) {
        throw new Error(`Do not write sensitive fields to public player doc: ${present.join(', ')}`);
    }
}

export async function getPlayers(teamId, options = {}) {
    const includeInactive = !!options.includeInactive;
    const isActivePlayer = (player) => player?.active !== false;
    // Prefer server-side ordering by jersey number, but fall back to an
    // unordered read + client sort if indexes are still building.
    try {
        const q = query(collection(db, `teams/${teamId}/players`), orderBy("number"));
        const snapshot = await getDocs(q);
        const players = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return includeInactive ? players : players.filter(isActivePlayer);
    } catch (e) {
        const code = e?.code || '';
        if (code !== 'failed-precondition') throw e;

        const snapshot = await getDocs(collection(db, `teams/${teamId}/players`));
        const players = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Keep ordering stable and human-friendly.
        const sorted = players.sort((a, b) => {
            const an = (a.number ?? '').toString().trim();
            const bn = (b.number ?? '').toString().trim();
            const ai = an === '' ? NaN : Number.parseInt(an, 10);
            const bi = bn === '' ? NaN : Number.parseInt(bn, 10);
            const aIsNum = Number.isFinite(ai);
            const bIsNum = Number.isFinite(bi);
            if (aIsNum && bIsNum) return ai - bi;
            if (aIsNum && !bIsNum) return -1;
            if (!aIsNum && bIsNum) return 1;
            return an.localeCompare(bn);
        });
        return includeInactive ? sorted : sorted.filter(isActivePlayer);
    }
}

export async function addPlayer(teamId, playerData) {
    assertNoSensitivePlayerFields(playerData);
    playerData.createdAt = Timestamp.now();
    if (!Object.prototype.hasOwnProperty.call(playerData, 'active')) {
        playerData.active = true;
    }
    const docRef = await addDoc(collection(db, `teams/${teamId}/players`), playerData);
    return docRef.id;
}

export async function updatePlayer(teamId, playerId, playerData) {
    assertNoSensitivePlayerFields(playerData);
    playerData.updatedAt = Timestamp.now();
    await updateDoc(doc(db, `teams/${teamId}/players`, playerId), playerData);
}

export async function deletePlayer(teamId, playerId) {
    await updateDoc(doc(db, `teams/${teamId}/players`, playerId), {
        active: false,
        deactivatedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });
}

export async function deactivatePlayer(teamId, playerId) {
    await updateDoc(doc(db, `teams/${teamId}/players`, playerId), {
        active: false,
        deactivatedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });
}

export async function reactivatePlayer(teamId, playerId) {
    await updateDoc(doc(db, `teams/${teamId}/players`, playerId), {
        active: true,
        deactivatedAt: deleteField(),
        updatedAt: Timestamp.now()
    });
}

/**
 * Remove a parent link from both the player document and user profile.
 * Updates player.parents array and user.parentOf/parentTeamIds.
 */
export async function removeParentFromPlayer(teamId, playerId, parentUserId) {
    // 1. Update player doc
    const playerRef = doc(db, `teams/${teamId}/players`, playerId);
    const snap = await getDoc(playerRef);
    if (snap.exists()) {
        const data = snap.data() || {};
        const parents = Array.isArray(data.parents) ? data.parents : [];
        const updatedParents = parents.filter(p => p.userId !== parentUserId);
        await updateDoc(playerRef, {
            parents: updatedParents,
            updatedAt: Timestamp.now()
        });
    }

    // 2. Update user profile (parentOf and parentTeamIds)
    const userRef = doc(db, "users", parentUserId);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
        const userData = userSnap.data() || {};
        const parentOf = Array.isArray(userData.parentOf) ? userData.parentOf : [];

        // Remove the specific parent link
        const updatedParentOf = parentOf.filter(
            p => !(p.teamId === teamId && p.playerId === playerId)
        );

        // Rebuild parentTeamIds from remaining parentOf entries
        const updatedParentTeamIds = [...new Set(updatedParentOf.map(p => p.teamId).filter(Boolean))];
        const updatedParentPlayerKeys = [...new Set(
            updatedParentOf
                .map(p => (p?.teamId && p?.playerId ? `${p.teamId}::${p.playerId}` : null))
                .filter(Boolean)
        )];

        await updateDoc(userRef, {
            parentOf: updatedParentOf,
            parentTeamIds: updatedParentTeamIds,
            parentPlayerKeys: updatedParentPlayerKeys,
            updatedAt: Timestamp.now()
        });
    }
}

function sortParentMembershipRequests(requests = []) {
    return [...requests].sort((a, b) => {
        const aTime = a?.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a?.createdAt || 0).getTime();
        const bTime = b?.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b?.createdAt || 0).getTime();
        return bTime - aTime;
    });
}

function getCurrentUserIdentity() {
    return {
        userId: auth.currentUser?.uid || '',
        email: (auth.currentUser?.email || '').toLowerCase().trim(),
        name: auth.currentUser?.displayName || auth.currentUser?.email || 'Parent'
    };
}

export async function createParentMembershipRequest(teamId, playerId, relation = 'Parent') {
    const identity = getCurrentUserIdentity();
    if (!identity.userId) {
        throw new Error('You must be signed in to request parent access');
    }
    if (!teamId || !playerId) {
        throw new Error('Team and player are required');
    }

    const [team, players, profile] = await Promise.all([
        getTeam(teamId),
        getPlayers(teamId),
        getUserProfile(identity.userId)
    ]);
    const player = (players || []).find((entry) => entry.id === playerId);

    if (!team || !player) {
        throw new Error('Team or player not found');
    }

    const alreadyLinked = (Array.isArray(profile?.parentOf) ? profile.parentOf : []).some((link) => (
        link?.teamId === teamId && link?.playerId === playerId
    ));
    if (alreadyLinked) {
        throw new Error('You already have access to this player');
    }

    const requestId = buildParentMembershipRequestId(identity.userId, playerId);
    const requestRef = doc(db, `teams/${teamId}/membershipRequests`, requestId);
    const existingSnap = await getDoc(requestRef);
    if (existingSnap.exists()) {
        const existingData = existingSnap.data() || {};
        if (existingData.status === 'pending') {
            throw new Error('A request for this player is already pending');
        }
        if (existingData.status === 'approved') {
            throw new Error('This player access request was already approved');
        }
    }

    const now = Timestamp.now();
    const requesterName = profile?.fullName || profile?.displayName || identity.name;
    await setDoc(requestRef, {
        requesterUserId: identity.userId,
        requesterEmail: identity.email || profile?.email || null,
        requesterName: requesterName || 'Parent',
        teamId,
        teamName: team.name || null,
        playerId,
        playerName: player.name || null,
        playerNumber: player.number || null,
        relation: relation || 'Parent',
        status: 'pending',
        createdAt: existingSnap.exists() ? (existingSnap.data()?.createdAt || now) : now,
        updatedAt: now,
        decidedAt: null,
        decidedBy: null,
        decidedByName: null,
        decisionNote: null
    }, { merge: false });

    return { success: true, requestId };
}

export async function listMyParentMembershipRequests(userId) {
    if (!userId) return [];
    const snapshot = await getDocs(query(
        collectionGroup(db, 'membershipRequests'),
        where('requesterUserId', '==', userId)
    ));
    return sortParentMembershipRequests(snapshot.docs.map((requestDoc) => ({
        id: requestDoc.id,
        ...requestDoc.data()
    })));
}

export async function listTeamParentMembershipRequests(teamId) {
    if (!teamId) return [];
    const snapshot = await getDocs(collection(db, `teams/${teamId}/membershipRequests`));
    return sortParentMembershipRequests(snapshot.docs.map((requestDoc) => ({
        id: requestDoc.id,
        ...requestDoc.data()
    })));
}

export async function approveParentMembershipRequest(teamId, requestId, decisionNote = '') {
    const currentUser = auth.currentUser;
    if (!currentUser?.uid) {
        throw new Error('You must be signed in to approve parent access');
    }

    const requestRef = doc(db, `teams/${teamId}/membershipRequests`, requestId);
    await runTransaction(db, async (transaction) => {
        const requestSnap = await transaction.get(requestRef);
        if (!requestSnap.exists()) {
            throw new Error('Request not found');
        }

        const requestData = requestSnap.data() || {};
        const requestUpdate = buildParentMembershipRequestUpdate({
            currentStatus: requestData.status,
            nextStatus: 'approved',
            decidedBy: currentUser.uid,
            decidedByName: currentUser.displayName || currentUser.email || 'Coach',
            decisionNote
        });

        const teamRef = doc(db, 'teams', teamId);
        const playerRef = doc(db, `teams/${teamId}/players`, requestData.playerId);
        const userRef = doc(db, 'users', requestData.requesterUserId);
        const [teamSnap, playerSnap, userSnap] = await Promise.all([
            transaction.get(teamRef),
            transaction.get(playerRef),
            transaction.get(userRef)
        ]);

        if (!teamSnap.exists() || !playerSnap.exists()) {
            throw new Error('Team or player not found');
        }

        const team = { id: teamSnap.id, ...(teamSnap.data() || {}) };
        const player = { id: playerSnap.id, ...(playerSnap.data() || {}) };
        const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
        const merged = mergeApprovedParentLinkState({
            userData,
            parentUserId: requestData.requesterUserId,
            parentEmail: requestData.requesterEmail || userData.email || '',
            team,
            player,
            relation: requestData.relation || null
        });

        const currentParents = Array.isArray(player.parents) ? player.parents : [];
        const hasParentEntry = currentParents.some((parent) => parent?.userId === requestData.requesterUserId);
        const now = Timestamp.now();

        transaction.set(userRef, {
            ...merged.userUpdate,
            updatedAt: now
        }, { merge: true });
        transaction.set(playerRef, {
            parents: hasParentEntry ? currentParents : [...currentParents, {
                ...merged.playerParentEntry,
                addedAt: now
            }],
            updatedAt: now
        }, { merge: true });
        transaction.update(requestRef, {
            ...requestUpdate,
            updatedAt: now,
            decidedAt: now
        });
    });

    return { success: true };
}

export async function denyParentMembershipRequest(teamId, requestId, decisionNote = '') {
    const currentUser = auth.currentUser;
    if (!currentUser?.uid) {
        throw new Error('You must be signed in to deny parent access');
    }

    const requestRef = doc(db, `teams/${teamId}/membershipRequests`, requestId);
    await runTransaction(db, async (transaction) => {
        const requestSnap = await transaction.get(requestRef);
        if (!requestSnap.exists()) {
            throw new Error('Request not found');
        }

        const requestData = requestSnap.data() || {};
        const requestUpdate = buildParentMembershipRequestUpdate({
            currentStatus: requestData.status,
            nextStatus: 'denied',
            decidedBy: currentUser.uid,
            decidedByName: currentUser.displayName || currentUser.email || 'Coach',
            decisionNote
        });
        const now = Timestamp.now();
        transaction.update(requestRef, {
            ...requestUpdate,
            updatedAt: now,
            decidedAt: now
        });
    });

    return { success: true };
}

// Games
export async function getGames(teamId) {
    const gamesRef = collection(db, `teams/${teamId}/games`);
    try {
        const q = query(gamesRef, orderBy("date"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        // Fallback when indexes are still building or unavailable.
        const snapshot = await getDocs(gamesRef);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
}

export async function getAggregatedStatsForGames(teamId, gameIds) {
    const totalsByPlayer = {};
    const validGameIds = Array.isArray(gameIds) ? gameIds.filter(Boolean) : [];
    if (validGameIds.length === 0) return totalsByPlayer;

    const snapshots = await Promise.all(
        validGameIds.map(gameId =>
            getDocs(collection(db, `teams/${teamId}/games/${gameId}/aggregatedStats`))
        )
    );

    snapshots.forEach((snap) => {
        snap.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const stats = data.stats || {};
            const playerId = docSnap.id;
            if (!totalsByPlayer[playerId]) {
                totalsByPlayer[playerId] = {};
            }
            Object.entries(stats).forEach(([key, value]) => {
                const num = typeof value === 'number' ? value : parseFloat(value) || 0;
                totalsByPlayer[playerId][key] = (totalsByPlayer[playerId][key] || 0) + num;
            });
        });
    });

    return totalsByPlayer;
}

export async function getAggregatedStatsForPlayer(teamId, gameId, playerId) {
    try {
        const docRef = doc(db, `teams/${teamId}/games/${gameId}/aggregatedStats`, playerId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return null;
        const data = docSnap.data() || {};
        return data.stats || {};
    } catch (error) {
        console.error('[getAggregatedStatsForPlayer] failed to load aggregated stats', {
            teamId,
            gameId,
            playerId,
            error,
        });
        throw new Error(`Unable to load stats for player ${playerId}: ${error.message}`);
    }
}

export async function getGame(teamId, gameId) {
    const docRef = doc(db, `teams/${teamId}/games`, gameId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() };
    } else {
        return null;
    }
}

export function subscribeGame(teamId, gameId, callback, onError) {
    const docRef = doc(db, `teams/${teamId}/games`, gameId);
    return onSnapshot(docRef, (snapshot) => {
        if (!snapshot.exists()) {
            callback(null);
            return;
        }
        callback({ id: snapshot.id, ...snapshot.data() });
    }, onError);
}

export async function getGameEvents(teamId, gameId, { limit = 50 } = {}) {
    const q = query(
        collection(db, `teams/${teamId}/games/${gameId}/events`),
        orderBy('timestamp', 'desc'),
        limitQuery(limit)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
}

async function deleteSharedScheduleCounterpart(game) {
    const counterpartTeamId = String(game?.sharedScheduleOpponentTeamId || '').trim();
    const counterpartGameId = String(game?.sharedScheduleOpponentGameId || '').trim();
    if (!counterpartTeamId || !counterpartGameId) return;

    try {
        await deleteDoc(doc(db, `teams/${counterpartTeamId}/games`, counterpartGameId));
    } catch (error) {
        console.warn('Failed to delete shared schedule counterpart:', error);
    }
}

async function syncSharedScheduleCounterpart(teamId, gameId, sourceGame, previousGame = null) {
    const sourceRef = doc(db, `teams/${teamId}/games`, gameId);
    const hadCounterpart = !!(previousGame?.sharedScheduleOpponentTeamId && previousGame?.sharedScheduleOpponentGameId);
    const nextShouldMirror = shouldMirrorSharedGame(sourceGame, teamId);
    const opponentTeamChanged = hadCounterpart && previousGame.sharedScheduleOpponentTeamId !== sourceGame.opponentTeamId;

    if (hadCounterpart && (!nextShouldMirror || opponentTeamChanged)) {
        await deleteSharedScheduleCounterpart(previousGame);
        await updateDoc(sourceRef, buildSharedScheduleDetachUpdate());
    }

    if (!nextShouldMirror) {
        return;
    }

    const sourceTeam = await getTeam(teamId, { includeInactive: true });
    if (!sourceTeam) {
        console.warn('Failed to sync shared schedule counterpart: source team not found', teamId);
        return;
    }

    const sharedScheduleId = previousGame?.sharedScheduleId || createSharedScheduleId(teamId, gameId);
    const counterpartTeamId = sourceGame.opponentTeamId;
    const counterpartRef = (!opponentTeamChanged && previousGame?.sharedScheduleOpponentGameId)
        ? doc(db, `teams/${counterpartTeamId}/games`, previousGame.sharedScheduleOpponentGameId)
        : null;
    const mirrorPayload = buildMirroredGamePayload({
        sourceTeamId: teamId,
        sourceTeam,
        sourceGameId: gameId,
        sourceGame,
        sharedScheduleId
    });

    let counterpartGameId = previousGame?.sharedScheduleOpponentGameId || null;

    if (counterpartRef && counterpartGameId) {
        await updateDoc(counterpartRef, mirrorPayload);
    } else {
        const newCounterpartRef = await addDoc(collection(db, `teams/${counterpartTeamId}/games`), mirrorPayload);
        counterpartGameId = newCounterpartRef.id;
    }

    await updateDoc(sourceRef, buildSharedScheduleSourceUpdate({
        sharedScheduleId,
        counterpartTeamId,
        counterpartGameId
    }));
}

export async function addGame(teamId, gameData) {
    gameData.createdAt = Timestamp.now();
    const docRef = await addDoc(collection(db, `teams/${teamId}/games`), gameData);
    if (shouldMirrorSharedGame(gameData, teamId)) {
        try {
            await syncSharedScheduleCounterpart(teamId, docRef.id, { ...gameData, id: docRef.id });
        } catch (error) {
            console.warn('Failed to create shared schedule counterpart:', error);
        }
    }
    return docRef.id;
}

export async function updateGame(teamId, gameId, gameData) {
    const docRef = doc(db, `teams/${teamId}/games`, gameId);
    const previousGame = await getGame(teamId, gameId);
    await updateDoc(docRef, gameData);
    const nextGame = {
        ...(previousGame || {}),
        ...gameData,
        id: gameId
    };
    const shouldSync = shouldMirrorSharedGame(nextGame, teamId) || !!previousGame?.sharedScheduleId;
    if (shouldSync) {
        try {
            await syncSharedScheduleCounterpart(teamId, gameId, nextGame, previousGame);
        } catch (error) {
            console.warn('Failed to sync shared schedule counterpart:', error);
        }
    }
}

export async function deleteGame(teamId, gameId) {
    const existingGame = await getGame(teamId, gameId);
    await deleteDoc(doc(db, `teams/${teamId}/games`, gameId));
    if (existingGame?.sharedScheduleId) {
        await deleteSharedScheduleCounterpart(existingGame);
    }
}

// ============================================
// Events (Games + Practices) - Phase 1
// ============================================

/**
 * Normalize legacy game docs with defaults for backward compatibility
 * @param {Object} doc - Raw document from Firestore
 * @returns {Object} Normalized event with type and title defaults
 */
export function normalizeEvent(doc) {
    return {
        ...doc,
        type: doc.type || 'game',
        title: doc.title || (doc.type === 'practice' ? 'Practice' : null),
        end: doc.end || null
    };
}

/**
 * Get all events (games + practices) with optional filtering
 * @param {string} teamId - Team ID
 * @param {Object} options - { type: 'game' | 'practice' | 'all' }
 * @returns {Promise<Array>} Array of normalized events
 */
export async function getEvents(teamId, options = {}) {
    const q = query(collection(db, `teams/${teamId}/games`), orderBy("date"));
    const snapshot = await getDocs(q);
    let events = snapshot.docs.map(d => normalizeEvent({ id: d.id, ...d.data() }));

    if (options.type && options.type !== 'all') {
        events = events.filter(e => e.type === options.type);
    }
    return events;
}

/**
 * Add a generic event (game or practice)
 * @param {string} teamId - Team ID
 * @param {Object} eventData - Event data including type field
 * @returns {Promise<string>} New document ID
 */
export async function addEvent(teamId, eventData) {
    eventData.createdAt = Timestamp.now();
    eventData.type = eventData.type || 'game';
    const docRef = await addDoc(collection(db, `teams/${teamId}/games`), eventData);
    return docRef.id;
}

/**
 * Add a practice event
 * @param {string} teamId - Team ID
 * @param {Object} practiceData - { title, date, end, location, notes, recurrence? }
 * @returns {Promise<string>} New document ID
 */
export async function addPractice(teamId, practiceData) {
    return addEvent(teamId, {
        ...practiceData,
        type: 'practice',
        title: practiceData.title || 'Practice',
        opponent: null,
        status: 'scheduled',
        homeScore: 0,
        awayScore: 0,
        statTrackerConfigId: null
    });
}

/**
 * Update any event (game or practice)
 * @param {string} teamId - Team ID
 * @param {string} eventId - Event document ID
 * @param {Object} eventData - Fields to update
 */
export async function updateEvent(teamId, eventId, eventData) {
    const docRef = doc(db, `teams/${teamId}/games`, eventId);
    await updateDoc(docRef, eventData);
}

/**
 * Delete any event (game or practice)
 * @param {string} teamId - Team ID
 * @param {string} eventId - Event document ID
 */
export async function deleteEvent(teamId, eventId) {
    await deleteDoc(doc(db, `teams/${teamId}/games`, eventId));
}

// ============================================
// Recurring Practices - Phase 2
// ============================================

/**
 * Cancel a single occurrence of a recurring practice
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 * @param {string} isoDate - The date to cancel (e.g., '2024-12-24')
 */
export async function cancelOccurrence(teamId, masterId, isoDate) {
    const docRef = doc(db, `teams/${teamId}/games`, masterId);
    await updateDoc(docRef, {
        exDates: arrayUnion(isoDate)
    });
}

/**
 * Update a single occurrence of a recurring practice
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 * @param {string} isoDate - The date to override (e.g., '2024-12-19')
 * @param {Object} changes - The fields to override { startTime, endTime, location, title, notes }
 */
export async function updateOccurrence(teamId, masterId, isoDate, changes) {
    const docRef = doc(db, `teams/${teamId}/games`, masterId);

    // Build the update object with dot notation for nested field
    const updateData = {};
    Object.keys(changes).forEach(key => {
        updateData[`overrides.${isoDate}.${key}`] = changes[key];
    });

    await updateDoc(docRef, updateData);
}

/**
 * Restore a previously cancelled occurrence
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 * @param {string} isoDate - The date to restore (e.g., '2024-12-24')
 */
export async function restoreOccurrence(teamId, masterId, isoDate) {
    const docRef = doc(db, `teams/${teamId}/games`, masterId);
    await updateDoc(docRef, {
        exDates: arrayRemove(isoDate)
    });
}

/**
 * Remove override for a specific occurrence, reverting to series defaults
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 * @param {string} isoDate - The date to clear override for
 */
export async function clearOccurrenceOverride(teamId, masterId, isoDate) {
    const docRef = doc(db, `teams/${teamId}/games`, masterId);
    await updateDoc(docRef, {
        [`overrides.${isoDate}`]: deleteField()
    });
}

/**
 * Update the entire recurring series (affects all future occurrences)
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 * @param {Object} seriesData - Fields to update on the master
 */
export async function updateSeries(teamId, masterId, seriesData) {
    const docRef = doc(db, `teams/${teamId}/games`, masterId);
    await updateDoc(docRef, seriesData);
}

/**
 * Delete the entire recurring series and all its occurrences
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 */
export async function deleteSeries(teamId, masterId) {
    await deleteDoc(doc(db, `teams/${teamId}/games`, masterId));
}

/**
 * Find the series master document by its seriesId
 * @param {string} teamId - Team ID
 * @param {string} seriesId - The UUID of the series
 * @returns {Promise<Object|null>} The master document or null
 */
export async function getSeriesMaster(teamId, seriesId) {
    const q = query(
        collection(db, `teams/${teamId}/games`),
        where("seriesId", "==", seriesId),
        where("isSeriesMaster", "==", true)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

// Configs
export async function getConfigs(teamId) {
    const q = query(collection(db, `teams/${teamId}/statTrackerConfigs`), orderBy("name"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function createConfig(teamId, configData) {
    configData.createdAt = Timestamp.now();
    const docRef = await addDoc(collection(db, `teams/${teamId}/statTrackerConfigs`), configData);
    return docRef.id;
}

// Backwards-compat helper: older pages import addConfig
// Route through createConfig so default templates can be created without breaking
export async function addConfig(teamId, configData) {
    return createConfig(teamId, configData);
}

export async function deleteConfig(teamId, configId) {
    await deleteDoc(doc(db, `teams/${teamId}/statTrackerConfigs`, configId));
}

// Stats
export async function logStatEvent(teamId, gameId, eventData) {
    eventData.timestamp = Timestamp.now();
    await addDoc(collection(db, `teams/${teamId}/games/${gameId}/events`), eventData);
}

export async function updatePlayerStats(teamId, gameId, playerId, statKey, change, playerName, playerNumber) {
    const docRef = doc(db, `teams/${teamId}/games/${gameId}/aggregatedStats`, playerId);
    await setDoc(docRef, {
        playerName,
        playerNumber,
        stats: {
            [statKey]: increment(change)
        }
    }, { merge: true });
}

// Calendar Functions
export async function addCalendarToTeam(teamId, calendarUrl) {
    const team = await getTeam(teamId);
    const calendarUrls = team.calendarUrls || [];

    if (!calendarUrls.includes(calendarUrl)) {
        calendarUrls.push(calendarUrl);
        await updateTeam(teamId, { calendarUrls });
    }
}

export async function removeCalendarFromTeam(teamId, calendarUrl) {
    const team = await getTeam(teamId);
    const calendarUrls = (team.calendarUrls || []).filter(url => url !== calendarUrl);
    await updateTeam(teamId, { calendarUrls });
}

export async function getTrackedCalendarEventUids(teamId) {
    const games = await getGames(teamId);
    return games
        .filter(game => game.calendarEventUid)
        .map(game => game.calendarEventUid);
}

// Access Codes
export function generateAccessCode() {
    // Generate a random 8-character alphanumeric code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars like 0, O, I, 1
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

export async function createAccessCode(userId, email, phone, code) {
    const accessCodeData = {
        code,
        generatedBy: userId,
        email: email || null,
        phone: phone || null,
        createdAt: Timestamp.now(),
        used: false,
        usedBy: null,
        usedAt: null
    };
    const docRef = await addDoc(collection(db, "accessCodes"), accessCodeData);
    return docRef.id;
}

export async function getUserAccessCodes(userId) {
    const q = query(
        collection(db, "accessCodes"),
        where("generatedBy", "==", userId)
    );
    const snapshot = await getDocs(q);
    const codes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Sort by createdAt in JavaScript instead of Firestore to avoid needing an index
    return codes.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.toMillis() - a.createdAt.toMillis();
    });
}

export async function validateAccessCode(code) {
    const q = query(
        collection(db, "accessCodes"),
        where("code", "==", code.toUpperCase())
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        return { valid: false, message: "Invalid access code" };
    }

    const codeDoc = snapshot.docs[0];
    const data = codeDoc.data();

    if (data.used) {
        return { valid: false, message: "Code already used" };
    }

    if (isAccessCodeExpired(data.expiresAt)) {
        return { valid: false, message: "Code has expired" };
    }

    // Code exists, not used, and not expired
    return {
        valid: true,
        codeId: codeDoc.id,
        type: data.type || 'standard',
        data: data
    };
}

export async function markAccessCodeAsUsed(codeId, userId) {
    const codeRef = doc(db, "accessCodes", codeId);
    await runTransaction(db, async (transaction) => {
        const codeSnapshot = await transaction.get(codeRef);
        if (!codeSnapshot.exists()) {
            throw new Error("Invalid access code");
        }

        const codeData = codeSnapshot.data() || {};
        if (codeData.used) {
            throw new Error("Code already used");
        }

        if (isAccessCodeExpired(codeData.expiresAt)) {
            throw new Error("Code has expired");
        }

        transaction.update(codeRef, {
            used: true,
            usedBy: userId,
            usedAt: Timestamp.now()
        });
    });
}

export async function redeemAdminInviteAtomicPersistence({
    teamId,
    userId,
    userEmail,
    codeId
}) {
    if (!teamId) {
        throw new Error('Missing teamId for admin invite persistence');
    }
    if (!userId) {
        throw new Error('Missing userId for admin invite persistence');
    }
    if (!codeId) {
        throw new Error('Missing codeId for admin invite persistence');
    }

    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    if (!normalizedEmail) {
        throw new Error('Missing user email for admin invite persistence');
    }

    const teamRef = doc(db, "teams", teamId);
    const userRef = doc(db, "users", userId);
    const codeRef = doc(db, "accessCodes", codeId);
    let userGrantApplied = false;
    let userAlreadyCoachedTeam = false;
    let userAlreadyHadCoachRole = false;
    try {
        const [teamSnapshot, codeSnapshot, userSnapshot] = await Promise.all([
            getDoc(teamRef),
            getDoc(codeRef),
            getDoc(userRef)
        ]);

        if (!teamSnapshot.exists()) {
            throw new Error('Team not found for admin invite persistence');
        }
        if (!codeSnapshot.exists()) {
            throw new Error('Access code not found for admin invite persistence');
        }

        const codeData = codeSnapshot.data() || {};
        if (codeData.type !== 'admin_invite') {
            throw new Error('Access code is not an admin invite');
        }

        if ((codeData.teamId || null) !== teamId) {
            throw new Error('Access code team does not match admin invite target');
        }

        if (codeData.used === true) {
            throw new Error('Access code has already been used');
        }

        const existingUserData = userSnapshot.exists() ? (userSnapshot.data() || {}) : {};
        const existingCoachOf = Array.isArray(existingUserData.coachOf) ? existingUserData.coachOf : [];
        const existingRoles = Array.isArray(existingUserData.roles) ? existingUserData.roles : [];
        userAlreadyCoachedTeam = existingCoachOf.includes(teamId);
        userAlreadyHadCoachRole = existingRoles.includes('coach');

        const userGrantTimestamp = Timestamp.now();
        await setDoc(userRef, {
            coachOf: arrayUnion(teamId),
            roles: arrayUnion('coach'),
            updatedAt: userGrantTimestamp
        }, { merge: true });
        userGrantApplied = true;

        await runTransaction(db, async (transaction) => {
            const [teamSnapshotAfterGrant, codeSnapshotAfterGrant] = await Promise.all([
                transaction.get(teamRef),
                transaction.get(codeRef)
            ]);

            if (!teamSnapshotAfterGrant.exists()) {
                throw new Error('Team not found for admin invite persistence');
            }
            if (!codeSnapshotAfterGrant.exists()) {
                throw new Error('Access code not found for admin invite persistence');
            }

            const latestCodeData = codeSnapshotAfterGrant.data() || {};
            if (latestCodeData.type !== 'admin_invite') {
                throw new Error('Access code is not an admin invite');
            }
            if ((latestCodeData.teamId || null) !== teamId) {
                throw new Error('Access code team does not match admin invite target');
            }
            if (latestCodeData.used === true) {
                throw new Error('Access code has already been used');
            }

            const now = Timestamp.now();
            transaction.update(teamRef, {
                adminEmails: arrayUnion(normalizedEmail),
                updatedAt: now
            });
            transaction.update(codeRef, {
                used: true,
                usedBy: userId,
                usedAt: now
            });
        });
    } catch (error) {
        let rollbackError = null;
        if (userGrantApplied) {
            const rollbackUpdate = {
                updatedAt: Timestamp.now()
            };

            if (!userAlreadyCoachedTeam) {
                rollbackUpdate.coachOf = arrayRemove(teamId);
            }
            if (!userAlreadyHadCoachRole) {
                rollbackUpdate.roles = arrayRemove('coach');
            }

            if (rollbackUpdate.coachOf || rollbackUpdate.roles) {
                try {
                    await updateDoc(userRef, rollbackUpdate);
                } catch (rollbackFailure) {
                    rollbackError = rollbackFailure;
                }
            }
        }

        const baseMessage = `Admin invite atomic persistence failed: ${error?.message || error}`;
        if (rollbackError) {
            throw new Error(`${baseMessage}. Rollback failed: ${rollbackError?.message || rollbackError}`);
        }
        throw new Error(baseMessage);
    }
}

export async function redeemAdminInviteAtomically(codeId, userId, fallbackEmail = null) {
    return runTransaction(db, async (transaction) => {
        const codeRef = doc(db, "accessCodes", codeId);
        const codeSnap = await transaction.get(codeRef);

        if (!codeSnap.exists()) {
            throw new Error("Invalid access code");
        }

        const codeData = codeSnap.data() || {};
        if (codeData.used) {
            throw new Error("Code already used");
        }

        if (codeData.type !== 'admin_invite') {
            throw new Error("Not an admin invite code");
        }

        if (codeData.expiresAt) {
            const expiresAtMs = codeData.expiresAt.toMillis ? codeData.expiresAt.toMillis() : codeData.expiresAt;
            if (Date.now() > expiresAtMs) {
                throw new Error("Code has expired");
            }
        }

        const teamId = codeData.teamId;
        const teamRef = doc(db, "teams", teamId);
        const userRef = doc(db, "users", userId);

        const [teamSnap, userSnap] = await Promise.all([
            transaction.get(teamRef),
            transaction.get(userRef)
        ]);

        if (!teamSnap.exists()) {
            throw new Error("Team not found");
        }

        const teamData = teamSnap.data() || {};
        const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
        const authEmail = auth.currentUser?.email || '';
        const userEmail = (userData.email || authEmail || fallbackEmail || '').toLowerCase().trim();
        if (!userEmail) {
            throw new Error('Unable to determine user email for admin invite');
        }

        transaction.set(teamRef, {
            adminEmails: arrayUnion(userEmail)
        }, { merge: true });

        transaction.set(userRef, {
            coachOf: arrayUnion(teamId),
            roles: arrayUnion('coach')
        }, { merge: true });

        transaction.update(codeRef, {
            used: true,
            usedBy: userId,
            usedAt: Timestamp.now()
        });

        return {
            success: true,
            teamId,
            teamName: teamData.name || null
        };
    });
}

// ============================================
// Parent Role Functions
// ============================================

export async function inviteParent(teamId, playerId, playerNum, parentEmail, relation) {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        throw new Error('You must be signed in to invite a parent');
    }

    // Get team and player info for the invite
    const [team, players] = await Promise.all([
        getTeam(teamId),
        getPlayers(teamId)
    ]);
    const player = players.find(p => p.id === playerId);

    const code = generateAccessCode();
    const accessCodeData = {
        code,
        type: 'parent_invite',
        teamId,
        playerId,
        playerNum, // Added for quick context
        playerName: player?.name || null,
        teamName: team?.name || null,
        relation,
        email: parentEmail || null,
        generatedBy: currentUser.uid,
        createdAt: Timestamp.now(),
        // 7 days from now
        expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
        used: false,
        usedBy: null,
        usedAt: null
    };
    const docRef = await addDoc(collection(db, "accessCodes"), accessCodeData);

    // Check if user with this email already exists
    let existingUser = null;
    if (parentEmail) {
        existingUser = await getUserByEmail(parentEmail);
    }

    return {
        id: docRef.id,
        code,
        teamName: team?.name || null,
        playerName: player?.name || null,
        existingUser: !!existingUser
    };
}

/**
 * Invite an admin to a team
 * @param {string} teamId - The team ID
 * @param {string} adminEmail - The admin's email address
 * @returns {Promise<{id: string, code: string, teamName: string, existingUser: boolean}>}
 */
export async function inviteAdmin(teamId, adminEmail) {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        throw new Error('You must be signed in to invite an admin');
    }

    const team = await getTeam(teamId);
    if (!team) {
        throw new Error('Team not found');
    }

    const code = generateAccessCode();
    const accessCodeData = {
        code,
        type: 'admin_invite',
        teamId,
        teamName: team.name || null,
        email: adminEmail,
        generatedBy: currentUser.uid,
        createdAt: Timestamp.now(),
        // 7 days from now
        expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
        used: false,
        usedBy: null,
        usedAt: null
    };
    const docRef = await addDoc(collection(db, "accessCodes"), accessCodeData);

    // Check if user already exists
    const existingUser = await getUserByEmail(adminEmail);

    return {
        id: docRef.id,
        code,
        teamName: team.name || null,
        existingUser: !!existingUser
    };
}

export async function redeemParentInvite(userId, code) {
    console.log('[redeemParentInvite] start', { userId, code });

    // 1. Find candidate code document
    const q = query(
        collection(db, "accessCodes"),
        where("code", "==", code.toUpperCase())
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error("Invalid or used code");

    const parentInviteDocs = snapshot.docs.filter(d => (d.data() || {}).type === 'parent_invite');
    if (parentInviteDocs.length === 0) throw new Error("Invalid or used code");

    // Duplicates can exist; prefer a currently redeemable parent invite doc.
    const codeDoc = parentInviteDocs.find((d) => {
        const invite = d.data() || {};
        return invite.used !== true && !isAccessCodeExpired(invite.expiresAt);
    }) || parentInviteDocs[0];
    const codeRef = codeDoc.ref;
    let codeData;

    // 2. Atomically claim code before side effects
    await runTransaction(db, async (transaction) => {
        const latestCodeSnapshot = await transaction.get(codeRef);
        if (!latestCodeSnapshot.exists()) {
            throw new Error("Invalid or used code");
        }

        const latestCodeData = latestCodeSnapshot.data() || {};
        if (latestCodeData.type !== 'parent_invite') {
            throw new Error("Not a parent invite code");
        }
        if (latestCodeData.used) {
            throw new Error("Invalid or used code");
        }
        if (isAccessCodeExpired(latestCodeData.expiresAt)) {
            throw new Error("Code has expired");
        }

        transaction.update(codeRef, {
            used: true,
            usedBy: userId,
            usedAt: Timestamp.now()
        });

        codeData = latestCodeData;
    });

    console.log('[redeemParentInvite] code loaded', {
        codeId: codeDoc.id,
        type: codeData.type,
        teamId: codeData.teamId,
        playerId: codeData.playerId,
        generatedBy: codeData.generatedBy
    });
    try {
        // 3. Get Team & Player details for caching
        console.log('[redeemParentInvite] fetching team & player', {
            teamId: codeData.teamId,
            playerId: codeData.playerId
        });
        const [team, player] = await Promise.all([
            getTeam(codeData.teamId),
            getPlayers(codeData.teamId).then(ps => ps.find(p => p.id === codeData.playerId))
        ]);

        if (!team || !player) {
            console.error('[redeemParentInvite] missing team or player', { teamExists: !!team, playerExists: !!player });
            throw new Error("Team or Player not found");
        }
        console.log('[redeemParentInvite] team & player resolved', {
            teamName: team.name,
            playerName: player.name,
            playerNumber: player.number
        });

        // 4. Update User Profile (parentOf + parentTeamIds for Firestore rules)
        try {
            const userRef = doc(db, "users", userId);
            await setDoc(userRef, {
                parentOf: arrayUnion({
                    teamId: codeData.teamId,
                    playerId: codeData.playerId,
                    teamName: team.name,
                    playerName: player.name,
                    playerNumber: player.number,
                    playerPhotoUrl: player.photoUrl || null,
                    relation: codeData.relation || null
                }),
                // Denormalized array for fast Firestore rules lookup
                parentTeamIds: arrayUnion(codeData.teamId),
                parentPlayerKeys: arrayUnion(`${codeData.teamId}::${codeData.playerId}`),
                roles: arrayUnion('parent')
            }, { merge: true });
            console.log('[redeemParentInvite] user profile updated');
        } catch (err) {
            console.error('redeemParentInvite: error updating user profile', err);
            throw new Error('Unable to link parent (profile). ' + (err?.message || ''));
        }

        // 5. Update Player Doc (parents list)
        try {
            const playerRef = doc(db, `teams/${codeData.teamId}/players`, codeData.playerId);

            // Log current parents state for debugging
            try {
                const snap = await getDoc(playerRef);
                if (snap.exists()) {
                    const data = snap.data() || {};
                    console.log('[redeemParentInvite] current player parents before update', {
                        teamId: codeData.teamId,
                        playerId: codeData.playerId,
                        parents: data.parents || []
                    });
                } else {
                    console.log('[redeemParentInvite] player doc not found before parents update', {
                        teamId: codeData.teamId,
                        playerId: codeData.playerId
                    });
                }
            } catch (innerErr) {
                console.warn('[redeemParentInvite] failed to read player before update (non-fatal)', innerErr);
            }

            await updateDoc(playerRef, {
                parents: arrayUnion({
                    userId,
                    email: codeData.email || 'pending', // Will be updated if email not provided in invite
                    relation: codeData.relation,
                    addedAt: Timestamp.now()
                })
            });
            console.log('[redeemParentInvite] player parents updated');
        } catch (err) {
            // If this fails (e.g., due to stricter live rules), we still
            // consider the parent linked via their user profile. Coaches
            // simply won't see the connection until rules are updated.
            console.error('redeemParentInvite: error updating player parents (non-fatal)', {
                message: err?.message,
                code: err?.code,
                name: err?.name
            });
        }
    } catch (err) {
        try {
            await runTransaction(db, async (transaction) => {
                const latestCodeSnapshot = await transaction.get(codeRef);
                if (!latestCodeSnapshot.exists()) {
                    return;
                }

                const latestCodeData = latestCodeSnapshot.data() || {};
                if (latestCodeData.used === true && latestCodeData.usedBy === userId) {
                    transaction.update(codeRef, {
                        used: false,
                        usedBy: null,
                        usedAt: null
                    });
                }
            });
        } catch (rollbackErr) {
            console.error('redeemParentInvite: failed to rollback code claim', rollbackErr);
        }
        throw err;
    }

    console.log('[redeemParentInvite] access code marked used', { codeId: codeDoc.id });
    return { success: true, teamId: codeData.teamId };
}

export async function rollbackParentInviteRedemption(userId, code) {
    console.log('[rollbackParentInviteRedemption] start', { userId, code });

    const normalizedCode = String(code || '').toUpperCase();
    if (!userId || !normalizedCode) {
        throw new Error('User and code are required to rollback parent invite redemption');
    }

    const q = query(
        collection(db, "accessCodes"),
        where("code", "==", normalizedCode)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
        throw new Error('Invite code not found for rollback');
    }

    const codeDoc = snapshot.docs.find(d => (d.data() || {}).type === 'parent_invite') || snapshot.docs[0];
    const codeData = codeDoc.data() || {};
    if (codeData.type !== 'parent_invite') {
        throw new Error('Rollback target is not a parent invite code');
    }

    if (!codeData.used || codeData.usedBy !== userId) {
        console.warn('[rollbackParentInviteRedemption] skipping rollback; code not used by user', {
            codeId: codeDoc.id,
            used: codeData.used,
            usedBy: codeData.usedBy
        });
        return;
    }

    const teamId = codeData.teamId || null;
    const playerId = codeData.playerId || null;

    try {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const userData = userSnap.data() || {};
            const parentOf = Array.isArray(userData.parentOf) ? userData.parentOf : [];
            const filteredParentOf = parentOf.filter(link =>
                !(link?.teamId === teamId && link?.playerId === playerId)
            );
            const filteredParentTeamIds = [...new Set(
                filteredParentOf.map(link => link?.teamId).filter(Boolean)
            )];
            const filteredParentPlayerKeys = [...new Set(
                filteredParentOf
                    .map(link => (link?.teamId && link?.playerId ? `${link.teamId}::${link.playerId}` : null))
                    .filter(Boolean)
            )];
            const existingRoles = Array.isArray(userData.roles) ? userData.roles : [];
            const filteredRoles = filteredParentOf.length === 0
                ? existingRoles.filter(role => role !== 'parent')
                : existingRoles;

            await setDoc(userRef, {
                parentOf: filteredParentOf,
                parentTeamIds: filteredParentTeamIds,
                parentPlayerKeys: filteredParentPlayerKeys,
                roles: filteredRoles
            }, { merge: true });
        }
    } catch (error) {
        console.warn('[rollbackParentInviteRedemption] failed to rollback user profile links (non-fatal)', error);
    }

    if (teamId && playerId) {
        try {
            const playerRef = doc(db, `teams/${teamId}/players`, playerId);
            const playerSnap = await getDoc(playerRef);
            if (playerSnap.exists()) {
                const playerData = playerSnap.data() || {};
                const parents = Array.isArray(playerData.parents) ? playerData.parents : [];
                const filteredParents = parents.filter(parent => parent?.userId !== userId);
                await updateDoc(playerRef, { parents: filteredParents });
            }
        } catch (error) {
            console.warn('[rollbackParentInviteRedemption] failed to rollback player parent link (non-fatal)', error);
        }
    }

    await updateDoc(codeDoc.ref, {
        used: false,
        usedBy: null,
        usedAt: null
    });

    console.log('[rollbackParentInviteRedemption] completed', { codeId: codeDoc.id });
}

export async function getParentDashboardData(userId) {
    const userProfile = await getUserProfile(userId);
    if (!userProfile || !userProfile.parentOf || userProfile.parentOf.length === 0) {
        return { upcomingGames: [], children: [] };
    }

    // Use the cached parentOf links on the user profile as the
    // source of truth for which players this parent can see.
    // We no longer require the player doc to have a matching
    // parents[] entry, because production rules may block that
    // write even when the profile is updated successfully.
    const children = userProfile.parentOf;
    const activeChildren = [];
    const upcomingGames = [];

    // Cache events per team to avoid duplicate reads when a parent
    // has multiple players on the same team.
    const eventsByTeam = new Map();

    // Use a single "today" boundary for all filtering
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const child of children) {
        if (!child.teamId) continue;
        const team = await getTeam(child.teamId);
        if (!team) continue;
        activeChildren.push(child);

        let events = eventsByTeam.get(child.teamId);
        if (!events) {
            events = await getEvents(child.teamId);
            eventsByTeam.set(child.teamId, events);
        }

        const futureEvents = events
            .filter(e => {
                const d = e.date?.toDate ? e.date.toDate() : new Date(e.date);
                return d >= now;
            })
            .map(e => ({
                ...e,
                teamId: child.teamId,
                teamName: child.teamName,
                childName: child.playerName
            }));

        upcomingGames.push(...futureEvents);
    }

    // Sort by date
    upcomingGames.sort((a, b) => {
        const dA = a.date.toDate ? a.date.toDate() : new Date(a.date);
        const dB = b.date.toDate ? b.date.toDate() : new Date(b.date);
        return dA - dB;
    });

    return { upcomingGames, children: activeChildren };
}

export async function updatePlayerProfile(teamId, playerId, data) {
    // Restricted update for parents.
    // SECURITY: sensitive fields must never live on the public player doc.
    const now = Timestamp.now();

    // Public player doc: allow photoUrl only.
    if (Object.prototype.hasOwnProperty.call(data, 'photoUrl')) {
        await updateDoc(doc(db, `teams/${teamId}/players`, playerId), {
            photoUrl: data.photoUrl || null,
            updatedAt: now
        });
    }

    // Private profile doc: emergencyContact / medicalInfo only.
    const privateUpdate = {};
    if (Object.prototype.hasOwnProperty.call(data, 'emergencyContact')) {
        privateUpdate.emergencyContact = data.emergencyContact || null;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'medicalInfo')) {
        privateUpdate.medicalInfo = data.medicalInfo || '';
    }
    if (Object.keys(privateUpdate).length > 0) {
        privateUpdate.updatedAt = now;
        const ref = doc(db, `teams/${teamId}/players/${playerId}/private/profile`);
        await setDoc(ref, privateUpdate, { merge: true });
    }
}

export async function getPlayerPrivateProfile(teamId, playerId) {
    const ref = doc(db, `teams/${teamId}/players/${playerId}/private/profile`);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() || {}) : null;
}

// ============================================
// Team Chat Functions
// ============================================

/**
 * Check if a user can access a team's chat.
 * Access granted to: team owner, team admins, global admins, and parents of players on the team.
 */
export function canAccessTeamChat(user, team) {
    if (!user || !team) return false;

    // Team owner
    if (team.ownerId === user.uid) return true;

    // Team admin (email in adminEmails)
    if (user.email && team.adminEmails?.map(e => e.toLowerCase()).includes(user.email.toLowerCase())) {
        return true;
    }

    // Global admin
    if (user.isAdmin) return true;

    // Parent (has parentOf entry for this team)
    if (user.parentOf?.some(p => p.teamId === team.id)) return true;

    return false;
}

/**
 * Check if a user can moderate (delete others' messages) in a team's chat.
 * Moderation allowed for: team owner, team admins, global admins.
 * Parents can only delete their own messages.
 */
export function canModerateChat(user, team) {
    if (!user || !team) return false;

    // Team owner
    if (team.ownerId === user.uid) return true;

    // Team admin (email in adminEmails)
    if (user.email && team.adminEmails?.map(e => e.toLowerCase()).includes(user.email.toLowerCase())) {
        return true;
    }

    // Global admin
    if (user.isAdmin) return true;

    return false;
}

/**
 * Get chat messages for a team with pagination support.
 * Returns messages ordered by createdAt descending (newest first).
 */
export async function getChatMessages(teamId, { limit = 50, startAfterDoc = null } = {}) {
    const messagesRef = collection(db, 'teams', teamId, 'chatMessages');
    let q = query(messagesRef, orderBy('createdAt', 'desc'), limitQuery(limit));

    if (startAfterDoc) {
        q = query(messagesRef, orderBy('createdAt', 'desc'), startAfterQuery(startAfterDoc), limitQuery(limit));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
}

/**
 * Subscribe to chat messages in real time (newest first).
 * Returns an unsubscribe function.
 */
export function subscribeToChatMessages(teamId, { limit = 50 } = {}, onMessages) {
    const messagesRef = collection(db, 'teams', teamId, 'chatMessages');
    const q = query(messagesRef, orderBy('createdAt', 'desc'), limitQuery(limit));
    return onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
        const oldestDoc = snapshot.docs.length ? snapshot.docs[snapshot.docs.length - 1] : null;
        onMessages(docs, oldestDoc);
    });
}

/**
 * Post a new chat message.
 */
export async function postChatMessage(teamId, {
    text,
    senderId,
    senderName,
    senderEmail,
    senderPhotoUrl,
    imageUrl = null,
    imagePath = null,
    imageName = null,
    imageType = null,
    imageSize = null,
    ai = false,
    aiName = null,
    aiQuestion = null,
    aiMeta = null
}) {
    const messagesRef = collection(db, 'teams', teamId, 'chatMessages');
    return await addDoc(messagesRef, {
        text,
        senderId,
        senderName: senderName || null,
        senderEmail: senderEmail || null,
        senderPhotoUrl: senderPhotoUrl || null,
        imageUrl: imageUrl || null,
        imagePath: imagePath || null,
        imageName: imageName || null,
        imageType: imageType || null,
        imageSize: Number.isFinite(imageSize) ? imageSize : null,
        createdAt: Timestamp.now(),
        editedAt: null,
        deleted: false,
        ai: ai === true,
        aiName: aiName || null,
        aiQuestion: aiQuestion || null,
        aiMeta: aiMeta || null
    });
}

/**
 * Edit an existing chat message (sender only).
 */
export async function editChatMessage(teamId, messageId, newText) {
    const messageRef = doc(db, 'teams', teamId, 'chatMessages', messageId);
    return await updateDoc(messageRef, {
        text: newText,
        editedAt: Timestamp.now()
    });
}

/**
 * Soft-delete a chat message.
 */
export async function deleteChatMessage(teamId, messageId) {
    const messageRef = doc(db, 'teams', teamId, 'chatMessages', messageId);
    return await updateDoc(messageRef, {
        deleted: true
    });
}

export async function toggleChatReaction(teamId, messageId, reactionKey, userId) {
    if (!CHAT_REACTION_KEYS.has(reactionKey)) {
        throw new Error('Unsupported reaction key');
    }
    if (!userId) {
        throw new Error('Missing userId for reaction');
    }

    const messageRef = doc(db, 'teams', teamId, 'chatMessages', messageId);
    const snap = await getDoc(messageRef);
    if (!snap.exists()) {
        throw new Error('Message not found');
    }

    const data = snap.data() || {};
    const raw = (data && typeof data.reactions === 'object' && data.reactions) ? data.reactions : {};
    const existing = Array.isArray(raw[reactionKey]) ? raw[reactionKey] : [];
    const hasReaction = existing.includes(userId);

    await updateDoc(messageRef, {
        [`reactions.${reactionKey}`]: hasReaction ? arrayRemove(userId) : arrayUnion(userId)
    });

    return !hasReaction;
}

/**
 * Update the user's last read timestamp for a team chat
 * @param {string} userId - The user's ID
 * @param {string} teamId - The team ID
 */
export async function updateChatLastRead(userId, teamId) {
    const userRef = doc(db, 'users', userId);
    const fieldPath = `chatLastRead.${teamId}`;
    return await updateDoc(userRef, {
        [fieldPath]: Timestamp.now()
    });
}

/**
 * Get unread message count for a team chat
 * @param {string} userId - The user's ID
 * @param {string} teamId - The team ID
 * @returns {Promise<number>} Number of unread messages
 */
export async function getUnreadChatCount(userId, teamId) {
    // Get user's last read timestamp
    const userDoc = await getDoc(doc(db, 'users', userId));
    const userData = userDoc.data();
    const lastRead = userData?.chatLastRead?.[teamId];

    // Query messages after last read
    // Note: Firestore doesn't support inequality on multiple fields, so we filter senderId in memory
    const messagesRef = collection(db, 'teams', teamId, 'chatMessages');
    let q;
    if (lastRead) {
        q = query(messagesRef, where('createdAt', '>', lastRead));
    } else {
        // Never read - get all messages
        q = query(messagesRef);
    }

    const snapshot = await getDocs(q);
    // Filter out own messages in memory
    let count = 0;
    snapshot.docs.forEach(doc => {
        if (doc.data().senderId !== userId) {
            count++;
        }
    });
    return count;
}

/**
 * Get unread counts for multiple teams
 * @param {string} userId - The user's ID
 * @param {string[]} teamIds - Array of team IDs
 * @returns {Promise<Object>} Map of teamId to unread count
 */
export async function getUnreadChatCounts(userId, teamIds) {
    const counts = {};
    await Promise.all(teamIds.map(async (teamId) => {
        try {
            counts[teamId] = await getUnreadChatCount(userId, teamId);
        } catch (err) {
            console.warn(`Failed to get unread count for team ${teamId}:`, err);
            counts[teamId] = 0;
        }
    }));
    return counts;
}

// ============ LIVE GAME EVENTS ============

/**
 * Broadcast a live event (fire-and-forget from tracker)
 */
export async function broadcastLiveEvent(teamId, gameId, eventData) {
    const eventsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveEvents');
    return addDoc(eventsRef, {
        ...eventData,
        createdAt: serverTimestamp()
    });
}

/**
 * Subscribe to live events (for viewer)
 */
export function subscribeLiveEvents(teamId, gameId, callback, onError) {
    const eventsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveEvents');
    const q = query(eventsRef, orderBy('createdAt', 'asc'));

    return onSnapshot(q, (snapshot) => {
        const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(events);
    }, onError);
}

/**
 * Get all live events (for replay)
 */
export async function getLiveEvents(teamId, gameId) {
    const eventsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveEvents');
    const q = query(eventsRef, orderBy('createdAt', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Subscribe to aggregated stats (real-time) for Game Day Command Center
 */
export function subscribeAggregatedStats(teamId, gameId, callback, onError) {
    const ref = collection(db, 'teams', teamId, 'games', gameId, 'aggregatedStats');
    return onSnapshot(ref, snap => {
        const stats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(stats);
    }, onError);
}

/**
 * Update game live status
 */
export async function setGameLiveStatus(teamId, gameId, status) {
    const gameRef = doc(db, 'teams', teamId, 'games', gameId);
    const updates = { liveStatus: status };

    if (status === 'live') {
        updates.liveStartedAt = serverTimestamp();
    }

    return updateDoc(gameRef, updates);
}

// ============ LIVE CHAT ============

/**
 * Subscribe to live game chat
 */
export function subscribeLiveChat(teamId, gameId, options, callback, onError) {
    const chatRef = collection(db, 'teams', teamId, 'games', gameId, 'liveChat');
    const q = query(chatRef, orderBy('createdAt', 'desc'), limitQuery(options.limit || 100));

    return onSnapshot(q, (snapshot) => {
        const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(messages);
    }, onError);
}

/**
 * Post a message to live game chat
 */
export async function postLiveChatMessage(teamId, gameId, messageData) {
    const chatRef = collection(db, 'teams', teamId, 'games', gameId, 'liveChat');
    return addDoc(chatRef, {
        ...messageData,
        createdAt: serverTimestamp()
    });
}

/**
 * Get all chat messages (for replay)
 */
export async function getLiveChatHistory(teamId, gameId) {
    const chatRef = collection(db, 'teams', teamId, 'games', gameId, 'liveChat');
    const q = query(chatRef, orderBy('createdAt', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ============ LIVE REACTIONS ============

/**
 * Send a reaction (ephemeral)
 */
export async function sendReaction(teamId, gameId, reactionData) {
    const reactionsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveReactions');
    return addDoc(reactionsRef, {
        ...reactionData,
        createdAt: serverTimestamp()
    });
}

/**
 * Subscribe to reactions (real-time) - only recent reactions
 */
export function subscribeReactions(teamId, gameId, callback, onError) {
    const reactionsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveReactions');
    const q = query(reactionsRef, orderBy('createdAt', 'desc'), limitQuery(20));

    return onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                callback({ id: change.doc.id, ...change.doc.data() });
            }
        });
    }, onError);
}

/**
 * Get all reactions (for replay)
 */
export async function getLiveReactions(teamId, gameId) {
    const reactionsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveReactions');
    const q = query(reactionsRef, orderBy('createdAt', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ============ VIEWER PRESENCE ============

/**
 * Track viewer presence and get count updates
 */
export function trackViewerPresence(teamId, gameId, onCountChange) {
    const gameRef = doc(db, 'teams', teamId, 'games', gameId);

    // Increment on connect
    updateDoc(gameRef, {
        liveViewerCount: increment(1)
    }).catch(err => console.warn('Failed to increment viewer count:', err));

    // Subscribe to count changes
    const unsubscribe = onSnapshot(gameRef, (snapshot) => {
        const data = snapshot.data();
        onCountChange(data?.liveViewerCount || 0);
    });

    // Decrement on disconnect
    const cleanup = () => {
        updateDoc(gameRef, {
            liveViewerCount: increment(-1)
        }).catch(err => console.warn('Failed to decrement viewer count:', err));
        unsubscribe();
    };

    // Handle page unload
    window.addEventListener('beforeunload', cleanup);

    return () => {
        window.removeEventListener('beforeunload', cleanup);
        cleanup();
    };
}

// ============ GAME DISCOVERY ============

/**
 * Get upcoming live games across all public teams
 */
export async function getUpcomingLiveGames(limitCount = 10) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const gamesRef = collectionGroup(db, 'games');
    const q = query(
        gamesRef,
        where('type', '==', 'game'),
        where('date', '>=', Timestamp.fromDate(startOfToday)),
        where('date', '<=', Timestamp.fromDate(oneWeekFromNow)),
        orderBy('date', 'asc'),
        limitQuery(limitCount)
    );

    let snapshot;
    const games = [];

    try {
        snapshot = await getDocs(q);
    } catch (error) {
        // Fallback when the collection group date index isn't ready yet.
        // Pull a limited sample and filter client-side.
        const fallbackQuery = query(gamesRef, limitQuery(200));
        snapshot = await getDocs(fallbackQuery);
    }

    for (const docSnap of snapshot.docs) {
        const gameData = { id: docSnap.id, ...docSnap.data() };
        if (gameData.type === 'practice' || gameData.status === 'completed' || gameData.liveStatus === 'completed') {
            continue;
        }
        if (!gameData.type) {
            gameData.type = 'game';
        }
        const gameDate = gameData.date?.toDate ? gameData.date.toDate() : new Date(gameData.date);
        if (gameDate < startOfToday || gameDate > oneWeekFromNow) {
            continue;
        }
        // Get team info (parent document)
        const teamRef = docSnap.ref.parent.parent;
        const teamSnap = await getDoc(teamRef);
        if (teamSnap.exists()) {
            gameData.team = { id: teamSnap.id, ...teamSnap.data() };
            gameData.teamId = teamSnap.id;
            if (!shouldIncludeTeamInLiveOrUpcoming(gameData.team)) {
                continue;
            }
        } else {
            continue;
        }
        games.push(gameData);
    }

    games.sort((a, b) => {
        const aDate = a.date?.toDate ? a.date.toDate() : new Date(a.date);
        const bDate = b.date?.toDate ? b.date.toDate() : new Date(b.date);
        return aDate - bDate;
    });

    return games;
}

// ============================================
// Drill Library CRUD (Practice Command Center)
// ============================================

/**
 * Get community drills with optional filters
 * @param {Object} options - { sport, type, level, skill, searchText, limitCount, startAfterDoc }
 * @returns {Promise<{ drills: Array, lastDoc: Object|null }>}
 */
export async function getDrills(options = {}) {
    const constraints = [];
    // Security + index-safe query:
    // only fetch community docs server-side so Firestore rules never evaluate
    // inaccessible custom documents from other teams.
    constraints.push(where('source', '==', 'community'));
    constraints.push(orderBy('title'));
    const pageSize = options.limitCount || 24;
    const fetchLimit = Math.max(pageSize * 2, 24);
    const term = options.searchText ? options.searchText.toLowerCase() : null;
    const drills = [];
    let cursor = options.startAfterDoc || null;
    let lastReturnedDoc = null;
    let safety = 0;
    let hasMore = true;

    while (drills.length < pageSize && hasMore && safety < 8) {
        const pageConstraints = [...constraints, limitQuery(fetchLimit)];
        if (cursor) pageConstraints.push(startAfterQuery(cursor));
        const q = query(collection(db, 'drillLibrary'), ...pageConstraints);
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            hasMore = false;
            break;
        }

        const page = snapshot.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
        let filtered = page;
        if (options.sport) {
            filtered = filtered.filter(d => d.sport === options.sport);
        }
        if (options.type) filtered = filtered.filter(d => d.type === options.type);
        if (options.level) filtered = filtered.filter(d => d.level === options.level);
        if (options.skill) filtered = filtered.filter(d => Array.isArray(d.skills) && d.skills.includes(options.skill));
        if (term) {
            filtered = filtered.filter(d =>
                (d.title || '').toLowerCase().includes(term) ||
                (d.description || '').toLowerCase().includes(term) ||
                (d.skills || []).some(s => s.toLowerCase().includes(term))
            );
        }

        for (const d of filtered) {
            if (drills.length >= pageSize) break;
            drills.push(d);
            lastReturnedDoc = d._doc;
        }

        const lastFetchedDoc = snapshot.docs[snapshot.docs.length - 1];
        cursor = lastFetchedDoc || null;
        hasMore = snapshot.docs.length >= fetchLimit;
        safety += 1;
    }

    const lastDoc = drills.length >= pageSize ? lastReturnedDoc : null;
    return { drills, lastDoc };
}

/**
 * Get drills published by teams to the community feed.
 * Uses explicit query guards so Firestore rules evaluate safely for all documents.
 * @param {Object} options - { sport, type, level, skill, searchText, limitCount }
 * @returns {Promise<Array>}
 */
export async function getPublishedDrills(options = {}) {
    const q = query(
        collection(db, 'drillLibrary'),
        where('publishedToCommunity', '==', true),
        limitQuery(options.limitCount || 40)
    );
    const snapshot = await getDocs(q);
    let drills = snapshot.docs
        .map(d => ({ id: d.id, ...d.data(), _doc: d }))
        .filter(d => d.source === 'custom');
    const term = options.searchText ? options.searchText.toLowerCase() : null;
    if (options.sport) {
        drills = drills.filter(d => d.sport === options.sport);
    }
    if (options.type) drills = drills.filter(d => d.type === options.type);
    if (options.level) drills = drills.filter(d => d.level === options.level);
    if (options.skill) drills = drills.filter(d => Array.isArray(d.skills) && d.skills.includes(options.skill));
    if (term) {
        drills = drills.filter(d =>
            (d.title || '').toLowerCase().includes(term) ||
            (d.description || '').toLowerCase().includes(term) ||
            (d.skills || []).some(s => s.toLowerCase().includes(term))
        );
    }
    drills.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    return drills;
}

/**
 * Get custom drills for a specific team
 */
export async function getTeamDrills(teamId) {
    const q = query(
        collection(db, 'drillLibrary'),
        where('source', '==', 'custom'),
        where('teamId', '==', teamId),
        orderBy('title')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
}

/**
 * Get a single drill by ID
 */
export async function getDrill(drillId) {
    const docRef = doc(db, 'drillLibrary', drillId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
}

/**
 * Create a custom drill for a team
 */
export async function createDrill(teamId, data) {
    const user = auth.currentUser;
    const isPublished = !!data.publishedToCommunity;
    const authorName = user?.displayName || user?.email || 'Team Coach';
    const drillData = {
        ...data,
        source: 'custom',
        teamId,
        createdBy: user ? user.uid : null,
        author: isPublished ? authorName : (data.author || null),
        authorId: isPublished ? (user?.uid || null) : (data.authorId || null),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    };
    const docRef = await addDoc(collection(db, 'drillLibrary'), drillData);
    return docRef.id;
}

/**
 * Update a custom drill
 */
export async function updateDrill(drillId, data) {
    const user = auth.currentUser;
    if (data.publishedToCommunity === true) {
        data.author = user?.displayName || user?.email || data.author || 'Team Coach';
        data.authorId = user?.uid || data.authorId || null;
    }
    data.updatedAt = Timestamp.now();
    await updateDoc(doc(db, 'drillLibrary', drillId), data);
}

/**
 * Delete a custom drill
 */
export async function deleteDrill(drillId) {
    await deleteDoc(doc(db, 'drillLibrary', drillId));
}

// ============================================
// Drill Diagrams
// ============================================

export async function uploadDrillDiagram(drillId, file) {
    await ensureImageAuth();
    const { imagePath, fallbackPath } = buildDrillDiagramUploadPaths(drillId, file?.name, Date.now());
    try {
        const storageRef = ref(imageStorage, imagePath);
        const snapshot = await uploadBytes(storageRef, file);
        return await getDownloadURL(snapshot.ref);
    } catch (error) {
        const code = error?.code || '';
        if (code === 'storage/unauthorized' || code === 'storage/unauthenticated' || code === 'storage/unknown') {
            // Match fallback behavior used by chat/stat-sheet uploads.
            const fallbackRef = ref(storage, fallbackPath);
            const snapshot = await uploadBytes(fallbackRef, file);
            return await getDownloadURL(snapshot.ref);
        }
        throw error;
    }
}

// ============================================
// Drill Favorites
// ============================================

/**
 * Get all favorite drill IDs for a team
 * @returns {Promise<string[]>} Array of drill IDs
 */
export async function getDrillFavorites(teamId) {
    const snapshot = await getDocs(collection(db, `teams/${teamId}/drillFavorites`));
    return snapshot.docs.map(d => d.id);
}

/**
 * Add a drill to team favorites
 */
export async function addDrillFavorite(teamId, drillId) {
    const user = auth.currentUser;
    await setDoc(doc(db, `teams/${teamId}/drillFavorites`, drillId), {
        addedBy: user ? user.uid : null,
        addedAt: Timestamp.now()
    });
}

/**
 * Remove a drill from team favorites
 */
export async function removeDrillFavorite(teamId, drillId) {
    await deleteDoc(doc(db, `teams/${teamId}/drillFavorites`, drillId));
}

// ============================================
// Practice Sessions
// ============================================

/**
 * Get all practice sessions for a team
 */
export async function getPracticeSessions(teamId) {
    const q = query(
        collection(db, `teams/${teamId}/practiceSessions`),
        orderBy('date', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Get a single practice session
 */
export async function getPracticeSession(teamId, sessionId) {
    const docRef = doc(db, `teams/${teamId}/practiceSessions`, sessionId);
    const snap = await getDoc(docRef);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Get a practice session linked to a specific schedule event
 */
export async function getPracticeSessionByEvent(teamId, eventId) {
    if (!teamId || !eventId) return null;
    const q = query(
        collection(db, `teams/${teamId}/practiceSessions`),
        where('eventId', '==', eventId),
        limitQuery(1)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const d = snapshot.docs[0];
    return { id: d.id, ...d.data() };
}

/**
 * Create a new practice session
 */
export async function createPracticeSession(teamId, data) {
    const user = auth.currentUser;
    const attendance = data.attendance || {
        rosterSize: 0,
        checkedInCount: 0,
        updatedAt: Timestamp.now(),
        players: []
    };
    const sessionData = {
        ...data,
        createdBy: user ? user.uid : null,
        status: data.status || 'draft',
        blocks: data.blocks || [],
        aiChatHistory: data.aiChatHistory || [],
        attendance,
        attendancePlayers: data.attendancePlayers ?? attendance.checkedInCount ?? 0,
        homePacketGenerated: data.homePacketGenerated ?? false,
        homePacketContent: data.homePacketContent ?? null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    };
    const docRef = await addDoc(collection(db, `teams/${teamId}/practiceSessions`), sessionData);
    return docRef.id;
}

/**
 * Update a practice session
 */
export async function updatePracticeSession(teamId, sessionId, data) {
    data.updatedAt = Timestamp.now();
    await updateDoc(doc(db, `teams/${teamId}/practiceSessions`, sessionId), data);
}

/**
 * Create or update a practice session linked to a schedule event
 */
export async function upsertPracticeSessionForEvent(teamId, eventId, data = {}) {
    const existing = await getPracticeSessionByEvent(teamId, eventId);
    if (existing) {
        await updatePracticeSession(teamId, existing.id, {
            ...data,
            eventId,
            eventType: 'practice'
        });
        return existing.id;
    }
    return await createPracticeSession(teamId, {
        ...data,
        eventId,
        eventType: 'practice',
        sourcePage: data.sourcePage || 'edit-schedule'
    });
}

/**
 * Update attendance for a practice session
 */
export async function updatePracticeAttendance(teamId, sessionId, attendance) {
    const players = (attendance?.players || []).map(p => ({
        playerId: p.playerId,
        displayName: p.displayName || '',
        status: p.status || 'absent',
        checkedInAt: p.checkedInAt || null,
        note: p.note || null
    }));
    const rawEditedAt = attendance?.editedAt || null;
    let editedAt = Timestamp.now();
    if (rawEditedAt) {
        if (typeof rawEditedAt?.toDate === 'function' || rawEditedAt instanceof Timestamp) {
            editedAt = rawEditedAt;
        } else {
            const parsed = new Date(rawEditedAt);
            editedAt = Number.isNaN(parsed.getTime()) ? Timestamp.now() : Timestamp.fromDate(parsed);
        }
    }
    const checkedInCount = players.filter(p => p.status === 'present' || p.status === 'late').length;
    const absentCount = players.filter(p => p.status === 'absent').length;
    const lateCount = players.filter(p => p.status === 'late').length;
    const normalized = {
        rosterSize: players.length,
        checkedInCount,
        updatedAt: Timestamp.now(),
        editedAt,
        players
    };
    await updatePracticeSession(teamId, sessionId, {
        attendance: normalized,
        attendancePlayers: checkedInCount,
        aiContext: {
            presentPlayerIds: players.filter(p => p.status === 'present' || p.status === 'late').map(p => p.playerId),
            attendanceSummary: { present: checkedInCount - lateCount, late: lateCount, absent: absentCount }
        }
    });
}

/**
 * Delete a practice session
 */
export async function deletePracticeSession(teamId, sessionId) {
    await deleteDoc(doc(db, `teams/${teamId}/practiceSessions`, sessionId));
}

/**
 * Get packet completion records for a practice session
 */
export async function getPracticePacketCompletions(teamId, sessionId) {
    const snapshot = await getDocs(collection(db, `teams/${teamId}/practiceSessions/${sessionId}/packetCompletions`));
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Parent marks a specific child's packet as completed
 */
export async function upsertPracticePacketCompletion(teamId, sessionId, payload) {
    const user = auth.currentUser;
    const parentUserId = payload?.parentUserId || user?.uid || null;
    const childId = payload?.childId || null;
    if (!parentUserId || !childId) throw new Error('parentUserId and childId are required');
    const docId = `${parentUserId}__${childId}`;
    await setDoc(doc(db, `teams/${teamId}/practiceSessions/${sessionId}/packetCompletions`, docId), {
        parentUserId,
        parentName: payload?.parentName || user?.displayName || user?.email || 'Parent',
        childId,
        childName: payload?.childName || null,
        status: 'completed',
        completedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    }, { merge: true });
}

// ==================== PRACTICE TEMPLATES ====================

/**
 * Save a practice plan as a reusable template
 */
export async function savePracticeTemplate(teamId, { name, blocks, totalMinutes, createdBy }) {
    return await addDoc(collection(db, `teams/${teamId}/practiceTemplates`), {
        name,
        blocks,
        totalMinutes: totalMinutes || 0,
        createdBy,
        createdAt: Timestamp.now()
    });
}

/**
 * Get all practice templates for a team, newest first
 */
export async function getPracticeTemplates(teamId) {
    const ref = collection(db, `teams/${teamId}/practiceTemplates`);
    const q = query(ref, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Delete a practice template
 */
export async function deletePracticeTemplate(teamId, templateId) {
    await deleteDoc(doc(db, `teams/${teamId}/practiceTemplates`, templateId));
}

/**
 * Get currently live games
 */
export async function getLiveGamesNow() {
    const gamesRef = collectionGroup(db, 'games');
    const q = query(
        gamesRef,
        where('liveStatus', '==', 'live')
    );

    const snapshot = await getDocs(q);
    const games = [];

    for (const docSnap of snapshot.docs) {
        const gameData = { id: docSnap.id, ...docSnap.data() };
        const teamRef = docSnap.ref.parent.parent;
        const teamSnap = await getDoc(teamRef);
        if (teamSnap.exists()) {
            gameData.team = { id: teamSnap.id, ...teamSnap.data() };
            gameData.teamId = teamSnap.id;
            if (!shouldIncludeTeamInLiveOrUpcoming(gameData.team)) {
                continue;
            }
        } else {
            continue;
        }
        games.push(gameData);
    }

    return games;
}

/**
 * Get recently completed live-tracked games (for replay section)
 */
export async function getRecentLiveTrackedGames(limitCount = 6) {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const gamesRef = collectionGroup(db, 'games');
    const q = query(
        gamesRef,
        where('liveStatus', '==', 'completed'),
        where('date', '>=', Timestamp.fromDate(oneWeekAgo)),
        orderBy('date', 'desc'),
        limitQuery(limitCount)
    );

    const snapshot = await getDocs(q);
    const games = [];

    for (const docSnap of snapshot.docs) {
        const gameData = { id: docSnap.id, ...docSnap.data() };
        const teamRef = docSnap.ref.parent.parent;
        const teamSnap = await getDoc(teamRef);
        if (teamSnap.exists()) {
            gameData.team = { id: teamSnap.id, ...teamSnap.data() };
            gameData.teamId = teamSnap.id;
            if (!shouldIncludeTeamInReplay(gameData.team)) {
                continue;
            }
        } else {
            continue;
        }
        games.push(gameData);
    }

    return games;
}

// ============================================
// Game Cancellation
// ============================================

export async function cancelGame(teamId, gameId, userId) {
    await updateGame(teamId, gameId, {
        status: 'cancelled',
        cancelledAt: Timestamp.now(),
        cancelledBy: userId
    });
}

// ============================================
// Game Assignments - Carry Forward
// ============================================

export async function getLatestGameAssignments(teamId) {
    const gamesRef = collection(db, `teams/${teamId}/games`);
    const q = query(gamesRef, where('type', '==', 'game'), orderBy('date', 'desc'), limit(20));
    const snap = await getDocs(q);
    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (data.assignments && data.assignments.length > 0) {
            return data.assignments;
        }
    }
    return [];
}

// ============================================
// RSVP / Availability
// ============================================

function normalizeRsvpResponse(response) {
    if (response === 'going' || response === 'maybe' || response === 'not_going') {
        return response;
    }
    return 'not_responded';
}

function uniqueNonEmptyIds(ids) {
    if (!Array.isArray(ids)) return [];
    return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.trim())));
}

const rsvpSummaryHydrationCacheByTeam = new Map();

function getRsvpSummaryHydrationCache(teamId) {
    if (!rsvpSummaryHydrationCacheByTeam.has(teamId)) {
        rsvpSummaryHydrationCacheByTeam.set(teamId, {
            rosterPromise: null,
            playerIdsByUserPromise: new Map()
        });
    }
    return rsvpSummaryHydrationCacheByTeam.get(teamId);
}

function getCachedRsvpRoster(teamId, { forceRefresh = false } = {}) {
    const cache = getRsvpSummaryHydrationCache(teamId);
    if (forceRefresh || !cache.rosterPromise) {
        cache.rosterPromise = getPlayers(teamId).catch((err) => {
            cache.rosterPromise = null;
            throw err;
        });
    }
    return cache.rosterPromise;
}

function getCachedFallbackPlayerIdsForUser(teamId, userId) {
    if (!userId) return Promise.resolve([]);
    const cache = getRsvpSummaryHydrationCache(teamId);
    if (!cache.playerIdsByUserPromise.has(userId)) {
        const playerIdsPromise = (async () => {
            try {
                const profile = await getUserProfile(userId);
                const parentLinks = Array.isArray(profile?.parentOf) ? profile.parentOf : [];
                return uniqueNonEmptyIds(
                    parentLinks
                        .filter((link) => link?.teamId === teamId)
                        .map((link) => link?.playerId)
                );
            } catch (err) {
                if (err?.code === 'permission-denied') return [];
                throw err;
            }
        })().catch((err) => {
            cache.playerIdsByUserPromise.delete(userId);
            throw err;
        });
        cache.playerIdsByUserPromise.set(userId, playerIdsPromise);
    }
    return cache.playerIdsByUserPromise.get(userId);
}

function extractDirectRsvpPlayerIds(rsvp) {
    const direct = uniqueNonEmptyIds(rsvp?.playerIds);
    if (direct.length) return direct;
    const legacy = [];
    if (typeof rsvp?.playerId === 'string' && rsvp.playerId.trim()) legacy.push(rsvp.playerId.trim());
    if (typeof rsvp?.childId === 'string' && rsvp.childId.trim()) legacy.push(rsvp.childId.trim());
    return uniqueNonEmptyIds(legacy);
}

async function buildFallbackPlayerIdsByUser(teamId, rsvps, options = {}) {
    const resolveIdsForUser = typeof options.resolveIdsForUser === 'function'
        ? options.resolveIdsForUser
        : async (uid) => {
            try {
                const profile = await getUserProfile(uid);
                const parentLinks = Array.isArray(profile?.parentOf) ? profile.parentOf : [];
                return uniqueNonEmptyIds(
                    parentLinks
                        .filter((link) => link?.teamId === teamId)
                        .map((link) => link?.playerId)
                );
            } catch (err) {
                if (err?.code === 'permission-denied') return [];
                throw err;
            }
        };

    const fallbackByUser = new Map();
    const unresolvedUserIds = Array.from(new Set(
        rsvps
            .filter((rsvp) => extractDirectRsvpPlayerIds(rsvp).length === 0)
            .map((rsvp) => rsvp?.userId || rsvp?.id)
            .filter(Boolean)
    ));
    if (unresolvedUserIds.length === 0) return fallbackByUser;

    await Promise.all(unresolvedUserIds.map(async (uid) => {
        const idsForTeam = await resolveIdsForUser(uid);
        fallbackByUser.set(uid, idsForTeam);
    }));

    return fallbackByUser;
}

function resolveRsvpPlayerIds(rsvp, fallbackByUser) {
    const direct = extractDirectRsvpPlayerIds(rsvp);
    if (direct.length) return direct;
    const uid = rsvp?.userId || rsvp?.id;
    return uid ? uniqueNonEmptyIds(fallbackByUser.get(uid) || []) : [];
}
export { buildCoachOverrideRsvpDocId };

async function computeRsvpSummary(teamId, gameId, options = {}) {
    const { freshRoster = false } = options;
    const [rsvps, roster] = await Promise.all([
        getRsvps(teamId, gameId),
        getCachedRsvpRoster(teamId, { forceRefresh: freshRoster })
    ]);
    const fallbackByUser = await buildFallbackPlayerIdsByUser(teamId, rsvps, {
        resolveIdsForUser: (uid) => getCachedFallbackPlayerIdsForUser(teamId, uid)
    });
    const activeRosterIds = new Set(roster.map((player) => player.id));
    return computeEffectiveRsvpSummary({
        rsvps,
        activeRosterIds,
        fallbackByUser,
        normalizeResponse: normalizeRsvpResponse,
        resolvePlayerIds: resolveRsvpPlayerIds
    });
}

export async function getRsvpSummaries(teamId, gameIds) {
    const uniqueGameIds = uniqueNonEmptyIds(gameIds);
    const summaries = new Map();
    if (!teamId || uniqueGameIds.length === 0) return summaries;

    const roster = await getCachedRsvpRoster(teamId);
    const activeRosterIds = new Set(roster.map((player) => player.id));

    const rsvpResults = await Promise.allSettled(
        uniqueGameIds.map((gameId) => getRsvps(teamId, gameId))
    );

    await Promise.all(rsvpResults.map(async (result, index) => {
        const gameId = uniqueGameIds[index];
        if (result.status !== 'fulfilled') {
            summaries.set(gameId, null);
            return;
        }

        const rsvps = result.value;
        const fallbackByUser = await buildFallbackPlayerIdsByUser(teamId, rsvps, {
            resolveIdsForUser: (uid) => getCachedFallbackPlayerIdsForUser(teamId, uid)
        });
        const summary = computeEffectiveRsvpSummary({
            rsvps,
            activeRosterIds,
            fallbackByUser,
            normalizeResponse: normalizeRsvpResponse,
            resolvePlayerIds: resolveRsvpPlayerIds
        });
        summaries.set(gameId, summary);
    }));

    return summaries;
}

export async function submitRsvp(teamId, gameId, userId, { displayName, playerIds, response, note }) {
    const authUid = auth.currentUser?.uid || null;
    if (userId && authUid && userId !== authUid) {
        throw new Error('RSVP user mismatch. Please refresh and try again.');
    }
    const effectiveUserId = userId || authUid || null;
    if (!effectiveUserId) {
        throw new Error('You must be signed in to submit RSVP');
    }

    const rsvpRef = doc(db, `teams/${teamId}/games/${gameId}/rsvps`, effectiveUserId);
    await setDoc(rsvpRef, {
        userId: effectiveUserId,
        displayName: displayName || null,
        playerIds: playerIds || [],
        response, // 'going' | 'maybe' | 'not_going'
        respondedAt: Timestamp.now(),
        note: note || null
    });

    // Best effort: aggregate summary if caller can read RSVPs.
    // Parent accounts may be able to write their own RSVP but still fail this read
    // depending on team linkage state in profile claims/data.
    let summary = null;
    try {
        summary = await computeRsvpSummary(teamId, gameId);
    } catch (err) {
        if (err?.code !== 'permission-denied') throw err;
    }

    // Best effort: write denormalized summary if caller is allowed to update game doc.
    // For recurring-occurrence IDs (masterId__instanceDate) the virtual game doc may not
    // exist, so we also suppress 'not-found' rather than crashing the submission.
    if (summary) {
        try {
            await updateDoc(doc(db, `teams/${teamId}/games`, gameId), { rsvpSummary: summary });
        } catch (err) {
            if (err?.code !== 'permission-denied' && err?.code !== 'not-found') throw err;
        }
    }

    return summary;
}

export async function submitRsvpForPlayer(teamId, gameId, userId, { displayName, playerId, response, note }) {
    const authUid = auth.currentUser?.uid || null;
    if (userId && authUid && userId !== authUid) {
        throw new Error('RSVP user mismatch. Please refresh and try again.');
    }
    const effectiveUserId = userId || authUid || null;
    if (!effectiveUserId) {
        throw new Error('You must be signed in to submit RSVP');
    }

    const normalizedPlayerId = String(playerId || '').trim();
    if (!normalizedPlayerId) {
        throw new Error('Missing player for RSVP override');
    }

    const docId = buildCoachOverrideRsvpDocId(effectiveUserId, normalizedPlayerId);
    const rsvpRef = doc(db, `teams/${teamId}/games/${gameId}/rsvps`, docId);
    await setDoc(rsvpRef, {
        userId: effectiveUserId,
        displayName: displayName || null,
        playerIds: [normalizedPlayerId],
        response, // 'going' | 'maybe' | 'not_going'
        respondedAt: Timestamp.now(),
        note: note || null
    });
    if (docId !== effectiveUserId) {
        const legacyRsvpRef = doc(db, `teams/${teamId}/games/${gameId}/rsvps`, effectiveUserId);
        let legacySnap = null;
        try {
            legacySnap = await getDoc(legacyRsvpRef);
        } catch (err) {
            if (err?.code !== 'permission-denied') throw err;
        }
        if (legacySnap?.exists() && shouldDeleteLegacyRsvpForOverride(legacySnap.data(), normalizedPlayerId)) {
            await deleteDoc(legacyRsvpRef);
        }
    }

    // Keep denormalized summary consistent with submitRsvp behavior.
    let summary = null;
    try {
        summary = await computeRsvpSummary(teamId, gameId, { freshRoster: true });
    } catch (err) {
        if (err?.code !== 'permission-denied') throw err;
    }

    if (summary) {
        try {
            await updateDoc(doc(db, `teams/${teamId}/games`, gameId), { rsvpSummary: summary });
        } catch (err) {
            if (err?.code !== 'permission-denied' && err?.code !== 'not-found') throw err;
        }
    }

    return summary;
}

export async function getRsvps(teamId, gameId) {
    const rsvpsRef = collection(db, `teams/${teamId}/games/${gameId}/rsvps`);
    const snap = await getDocs(rsvpsRef);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getMyRsvp(teamId, gameId, userId) {
    const rsvpRef = doc(db, `teams/${teamId}/games/${gameId}/rsvps`, userId);
    const snap = await getDoc(rsvpRef);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getRsvpSummary(teamId, gameId) {
    return computeRsvpSummary(teamId, gameId);
}

const RIDE_OFFER_STATUS = {
    OPEN: 'open',
    CLOSED: 'closed',
    CANCELLED: 'cancelled'
};

const RIDE_REQUEST_STATUS = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    WAITLISTED: 'waitlisted',
    DECLINED: 'declined'
};

function normalizeRideOfferStatus(status) {
    const value = (status || '').toString().toLowerCase();
    if (value === RIDE_OFFER_STATUS.CLOSED || value === RIDE_OFFER_STATUS.CANCELLED) return value;
    return RIDE_OFFER_STATUS.OPEN;
}

function normalizeRideRequestStatus(status) {
    const value = (status || '').toString().toLowerCase();
    if (value === RIDE_REQUEST_STATUS.CONFIRMED) return RIDE_REQUEST_STATUS.CONFIRMED;
    if (value === RIDE_REQUEST_STATUS.WAITLISTED) return RIDE_REQUEST_STATUS.WAITLISTED;
    if (value === RIDE_REQUEST_STATUS.DECLINED) return RIDE_REQUEST_STATUS.DECLINED;
    return RIDE_REQUEST_STATUS.PENDING;
}

function isDecisionStatus(status) {
    const normalized = normalizeRideRequestStatus(status);
    return normalized === RIDE_REQUEST_STATUS.CONFIRMED ||
        normalized === RIDE_REQUEST_STATUS.WAITLISTED ||
        normalized === RIDE_REQUEST_STATUS.DECLINED;
}

function toNonNegativeInteger(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
}

function nextConfirmedSeatCount(currentSeatCountConfirmed, previousRequestStatus, nextRequestStatus) {
    const current = toNonNegativeInteger(currentSeatCountConfirmed, 0);
    const wasConfirmed = normalizeRideRequestStatus(previousRequestStatus) === RIDE_REQUEST_STATUS.CONFIRMED;
    const willBeConfirmed = normalizeRideRequestStatus(nextRequestStatus) === RIDE_REQUEST_STATUS.CONFIRMED;
    if (wasConfirmed === willBeConfirmed) return current;
    if (wasConfirmed && !willBeConfirmed) return Math.max(0, current - 1);
    return current + 1;
}

/**
 * Create a rideshare offer under a game/practice event.
 */
export async function createRideOffer(teamId, gameId, payload = {}) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error('You must be signed in to offer a ride.');
    const seatCapacity = toNonNegativeInteger(payload.seatCapacity, 0);
    if (seatCapacity <= 0) throw new Error('Seat capacity must be at least 1.');

    const directionRaw = (payload.direction || '').toString().toLowerCase();
    const direction = directionRaw === 'to' || directionRaw === 'from' || directionRaw === 'round-trip'
        ? directionRaw
        : 'to';

    const note = typeof payload.note === 'string' ? payload.note.trim() : '';
    const offerRef = await addDoc(collection(db, `teams/${teamId}/games/${gameId}/rideOffers`), {
        driverUserId: user.uid,
        driverName: payload.driverName || user.displayName || user.email || 'Parent Driver',
        seatCapacity,
        seatCountConfirmed: 0,
        direction,
        note: note || null,
        status: RIDE_OFFER_STATUS.OPEN,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });
    return offerRef.id;
}

/**
 * List rideshare offers (with nested requests) for an event.
 */
export async function listRideOffersForEvent(teamId, gameId) {
    const offersSnap = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/rideOffers`));
    const offers = await Promise.all(offersSnap.docs.map(async (offerDoc) => {
        const offerData = offerDoc.data() || {};
        const requestsSnap = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/rideOffers/${offerDoc.id}/requests`));
        const requests = requestsSnap.docs
            .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }))
            .sort((a, b) => {
                const at = a?.requestedAt?.toMillis?.() || 0;
                const bt = b?.requestedAt?.toMillis?.() || 0;
                return at - bt;
            });
        return {
            id: offerDoc.id,
            ...offerData,
            status: normalizeRideOfferStatus(offerData.status),
            seatCapacity: toNonNegativeInteger(offerData.seatCapacity, 0),
            seatCountConfirmed: toNonNegativeInteger(offerData.seatCountConfirmed, 0),
            requests
        };
    }));

    offers.sort((a, b) => {
        const at = a?.createdAt?.toMillis?.() || 0;
        const bt = b?.createdAt?.toMillis?.() || 0;
        return bt - at;
    });
    return offers;
}

/**
 * Request a seat for a linked child.
 */
export async function requestRideSpot(teamId, gameId, offerId, payload = {}) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error('You must be signed in to request a ride.');
    const childId = (payload.childId || '').toString().trim();
    if (!childId) throw new Error('childId is required to request a ride.');
    const childName = (payload.childName || '').toString().trim();
    const requestId = `${user.uid}__${childId}`;
    await setDoc(doc(db, `teams/${teamId}/games/${gameId}/rideOffers/${offerId}/requests`, requestId), {
        parentUserId: user.uid,
        childId,
        childName: childName || null,
        status: RIDE_REQUEST_STATUS.PENDING,
        requestedAt: Timestamp.now(),
        respondedAt: null,
        updatedAt: Timestamp.now()
    }, { merge: true });
    return requestId;
}

/**
 * Driver/admin updates request status with seat-capacity protection.
 */
export async function updateRideRequestStatus(teamId, gameId, offerId, requestId, nextStatus) {
    const requestRef = doc(db, `teams/${teamId}/games/${gameId}/rideOffers/${offerId}/requests`, requestId);
    const offerRef = doc(db, `teams/${teamId}/games/${gameId}/rideOffers`, offerId);
    const normalizedNextStatus = normalizeRideRequestStatus(nextStatus);
    if (!isDecisionStatus(normalizedNextStatus)) {
        throw new Error('Status must be confirmed, waitlisted, or declined.');
    }

    return runTransaction(db, async (tx) => {
        const [offerSnap, requestSnap] = await Promise.all([tx.get(offerRef), tx.get(requestRef)]);
        if (!offerSnap.exists()) throw new Error('Ride offer not found.');
        if (!requestSnap.exists()) throw new Error('Ride request not found.');

        const offer = offerSnap.data() || {};
        const request = requestSnap.data() || {};
        const offerStatus = normalizeRideOfferStatus(offer.status);
        if (offerStatus !== RIDE_OFFER_STATUS.OPEN) throw new Error('Ride offer is closed.');

        const seatCapacity = toNonNegativeInteger(offer.seatCapacity, 0);
        const currentSeatCountConfirmed = toNonNegativeInteger(offer.seatCountConfirmed, 0);
        const nextSeatCount = nextConfirmedSeatCount(currentSeatCountConfirmed, request.status, normalizedNextStatus);
        if (nextSeatCount > seatCapacity) throw new Error('Offer is full.');

        tx.update(requestRef, {
            status: normalizedNextStatus,
            respondedAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        });
        tx.update(offerRef, {
            seatCountConfirmed: nextSeatCount,
            updatedAt: Timestamp.now()
        });
        return { seatCountConfirmed: nextSeatCount };
    });
}

export async function closeRideOffer(teamId, gameId, offerId, status = RIDE_OFFER_STATUS.CLOSED) {
    const normalizedStatus = normalizeRideOfferStatus(status);
    await updateDoc(doc(db, `teams/${teamId}/games/${gameId}/rideOffers`, offerId), {
        status: normalizedStatus,
        updatedAt: Timestamp.now()
    });
}

export async function cancelRideRequest(teamId, gameId, offerId, requestId) {
    const requestRef = doc(db, `teams/${teamId}/games/${gameId}/rideOffers/${offerId}/requests`, requestId);
    const offerRef = doc(db, `teams/${teamId}/games/${gameId}/rideOffers`, offerId);

    return runTransaction(db, async (tx) => {
        const [offerSnap, requestSnap] = await Promise.all([tx.get(offerRef), tx.get(requestRef)]);
        if (!requestSnap.exists()) return;
        const offer = offerSnap.exists() ? (offerSnap.data() || {}) : null;
        const request = requestSnap.data() || {};
        tx.delete(requestRef);
        if (!offer) return;
        const nextSeatCount = nextConfirmedSeatCount(
            toNonNegativeInteger(offer.seatCountConfirmed, 0),
            request.status,
            RIDE_REQUEST_STATUS.DECLINED
        );
        tx.update(offerRef, {
            seatCountConfirmed: nextSeatCount,
            updatedAt: Timestamp.now()
        });
    });
}

export async function getRsvpBreakdownByPlayer(teamId, gameId) {
    const [players, rsvps] = await Promise.all([
        getPlayers(teamId, { includeInactive: true }),
        getRsvps(teamId, gameId)
    ]);
    const fallbackByUser = await buildFallbackPlayerIdsByUser(teamId, rsvps);

    const byPlayer = new Map();
    players.forEach((player) => {
        byPlayer.set(player.id, {
            playerId: player.id,
            playerName: player.name || `#${player.number || ''}`.trim() || 'Unknown Player',
            playerNumber: player.number || '',
            response: 'not_responded',
            respondedAt: null,
            note: null,
            responderUserId: null
        });
    });

    const toMillis = (value) => {
        if (!value) return 0;
        if (typeof value?.toMillis === 'function') return value.toMillis();
        if (value instanceof Date) return value.getTime();
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    };

    rsvps.forEach((rsvp) => {
        const ids = resolveRsvpPlayerIds(rsvp, fallbackByUser);
        if (!ids.length) return;
        ids.forEach((playerId) => {
            let existing = byPlayer.get(playerId);
            if (!existing) {
                existing = {
                    playerId,
                    playerName: 'Former Player',
                    playerNumber: '',
                    response: 'not_responded',
                    respondedAt: null,
                    note: null,
                    responderUserId: null
                };
            }
            const existingMillis = toMillis(existing.respondedAt);
            const nextMillis = toMillis(rsvp.respondedAt);
            if (nextMillis < existingMillis) return;
            existing.response = normalizeRsvpResponse(rsvp.response);
            existing.respondedAt = rsvp.respondedAt || null;
            existing.note = rsvp.note || null;
            existing.responderUserId = rsvp.userId || null;
            byPlayer.set(playerId, existing);
        });
    });

    const grouped = {
        going: [],
        maybe: [],
        not_going: [],
        not_responded: []
    };

    Array.from(byPlayer.values())
        .sort((a, b) => {
            const an = (a.playerNumber ?? '').toString();
            const bn = (b.playerNumber ?? '').toString();
            const ai = Number.parseInt(an, 10);
            const bi = Number.parseInt(bn, 10);
            const aNum = Number.isFinite(ai);
            const bNum = Number.isFinite(bi);
            if (aNum && bNum && ai !== bi) return ai - bi;
            if (aNum && !bNum) return -1;
            if (!aNum && bNum) return 1;
            return (a.playerName || '').localeCompare(b.playerName || '');
        })
        .forEach((row) => {
            const key = row.response === 'going' || row.response === 'maybe' || row.response === 'not_going'
                ? row.response
                : 'not_responded';
            grouped[key].push(row);
        });

    return {
        grouped,
        counts: {
            going: grouped.going.length,
            maybe: grouped.maybe.length,
            notGoing: grouped.not_going.length,
            notResponded: grouped.not_responded.length,
            total: players.length
        }
    };
}
