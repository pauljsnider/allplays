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
    ref,
    uploadBytes,
    getDownloadURL
} from './firebase.js?v=9';
import { imageStorage, ensureImageAuth, requireImageAuth } from './firebase-images.js?v=2';
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
export async function getTeams() {
    const q = query(collection(db, "teams"), orderBy("name"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getTeam(teamId) {
    const docRef = doc(db, "teams", teamId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() };
    } else {
        return null;
    }
}

export async function getUserTeams(userId) {
    const q = query(collection(db, "teams"), where("ownerId", "==", userId));
    const snapshot = await getDocs(q);
    // Sort in memory instead of query to avoid composite index requirement
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getUserTeamsWithAccess(userId, email) {
    const [ownedSnap, adminSnap] = await Promise.all([
        getDocs(query(collection(db, "teams"), where("ownerId", "==", userId))),
        email ? getDocs(query(collection(db, "teams"), where("adminEmails", "array-contains", email.toLowerCase()))) : Promise.resolve({ docs: [] })
    ]);

    const map = new Map();
    ownedSnap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
    adminSnap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get teams where the user is connected as a parent (via parentOf)
 * This is used to power the "My Teams" view for parents, in a read-only way.
 */
export async function getParentTeams(userId) {
    const profile = await getUserProfile(userId);
    if (!profile || !Array.isArray(profile.parentOf) || profile.parentOf.length === 0) {
        return [];
    }

    const teamIds = [...new Set(profile.parentOf.map(p => p.teamId).filter(Boolean))];
    if (teamIds.length === 0) return [];

    const teams = [];
    for (const teamId of teamIds) {
        const team = await getTeam(teamId);
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
    const docRef = await addDoc(collection(db, "teams"), teamData);
    return docRef.id;
}

export async function updateTeam(teamId, teamData) {
    teamData.updatedAt = Timestamp.now();
    const docRef = doc(db, "teams", teamId);
    await updateDoc(docRef, teamData);
}

export async function deleteTeam(teamId) {
    // Delete games and their subcollections
    const gamesSnapshot = await getDocs(collection(db, `teams/${teamId}/games`));
    for (const gameDoc of gamesSnapshot.docs) {
        const gameId = gameDoc.id;
        // Remove events
        const eventsSnap = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/events`));
        await Promise.all(eventsSnap.docs.map(docItem => deleteDoc(docItem.ref)));
        // Remove aggregated stats
        const statsSnap = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/aggregatedStats`));
        await Promise.all(statsSnap.docs.map(docItem => deleteDoc(docItem.ref)));
        await deleteDoc(gameDoc.ref);
    }

    // Delete players
    const playersSnapshot = await getDocs(collection(db, `teams/${teamId}/players`));
    await Promise.all(playersSnapshot.docs.map(docItem => deleteDoc(docItem.ref)));

    // Delete configs
    const configsSnapshot = await getDocs(collection(db, `teams/${teamId}/statTrackerConfigs`));
    await Promise.all(configsSnapshot.docs.map(docItem => deleteDoc(docItem.ref)));

    // Finally delete team document
    await deleteDoc(doc(db, "teams", teamId));
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

export async function getPlayers(teamId) {
    // Prefer server-side ordering by jersey number, but fall back to an
    // unordered read + client sort if indexes are still building.
    try {
        const q = query(collection(db, `teams/${teamId}/players`), orderBy("number"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
        const code = e?.code || '';
        if (code !== 'failed-precondition') throw e;

        const snapshot = await getDocs(collection(db, `teams/${teamId}/players`));
        const players = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Keep ordering stable and human-friendly.
        return players.sort((a, b) => {
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
    }
}

export async function addPlayer(teamId, playerData) {
    assertNoSensitivePlayerFields(playerData);
    playerData.createdAt = Timestamp.now();
    const docRef = await addDoc(collection(db, `teams/${teamId}/players`), playerData);
    return docRef.id;
}

export async function updatePlayer(teamId, playerId, playerData) {
    assertNoSensitivePlayerFields(playerData);
    playerData.updatedAt = Timestamp.now();
    await updateDoc(doc(db, `teams/${teamId}/players`, playerId), playerData);
}

export async function deletePlayer(teamId, playerId) {
    await deleteDoc(doc(db, `teams/${teamId}/players`, playerId));
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

export async function addGame(teamId, gameData) {
    gameData.createdAt = Timestamp.now();
    const docRef = await addDoc(collection(db, `teams/${teamId}/games`), gameData);
    return docRef.id;
}

export async function updateGame(teamId, gameId, gameData) {
    const docRef = doc(db, `teams/${teamId}/games`, gameId);
    await updateDoc(docRef, gameData);
}

export async function deleteGame(teamId, gameId) {
    await deleteDoc(doc(db, `teams/${teamId}/games`, gameId));
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

    // Check expiration for codes that have expiresAt
    if (data.expiresAt) {
        const expiresAtMs = data.expiresAt.toMillis ? data.expiresAt.toMillis() : data.expiresAt;
        if (Date.now() > expiresAtMs) {
            return { valid: false, message: "Code has expired" };
        }
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
    const docRef = doc(db, "accessCodes", codeId);
    await updateDoc(docRef, {
        used: true,
        usedBy: userId,
        usedAt: Timestamp.now()
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

    // 1. Validate Code
    const q = query(
        collection(db, "accessCodes"),
        where("code", "==", code.toUpperCase()),
        where("used", "==", false)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error("Invalid or used code");
    
    const codeDoc = snapshot.docs[0];
    const codeData = codeDoc.data() || {};
    console.log('[redeemParentInvite] code loaded', {
        codeId: codeDoc.id,
        type: codeData.type,
        teamId: codeData.teamId,
        playerId: codeData.playerId,
        generatedBy: codeData.generatedBy
    });
    
    if (codeData.type !== 'parent_invite') throw new Error("Not a parent invite code");

    // 2. Get Team & Player details for caching
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

    // 3. Update User Profile (parentOf + parentTeamIds for Firestore rules)
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

    // 4. Update Player Doc (parents list)
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

    // 5. Mark Code Used
    try {
        await updateDoc(codeDoc.ref, {
            used: true,
            usedBy: userId,
            usedAt: Timestamp.now()
        });
        console.log('[redeemParentInvite] access code marked used', { codeId: codeDoc.id });
    } catch (err) {
        console.error('redeemParentInvite: error marking code used', err);
        throw new Error('Unable to link parent (access code). ' + (err?.message || ''));
    }

    return { success: true, teamId: codeData.teamId };
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
    const upcomingGames = [];

    // Cache events per team to avoid duplicate reads when a parent
    // has multiple players on the same team.
    const eventsByTeam = new Map();

    // Use a single "today" boundary for all filtering
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const child of children) {
        if (!child.teamId) continue;

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

    return { upcomingGames, children };
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
    await requireImageAuth();
    const path = `drill-diagrams/${drillId}/${Date.now()}_${file.name}`;
    const storageRef = ref(imageStorage, path);
    const snapshot = await uploadBytes(storageRef, file);
    return await getDownloadURL(snapshot.ref);
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
        }
        games.push(gameData);
    }

    return games;
}

// ============================================
// Game Cancellation
// ============================================

export async function cancelGame(teamId, gameId, userId) {
    const gameRef = doc(db, `teams/${teamId}/games`, gameId);
    await updateDoc(gameRef, {
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
        const rsvps = await getRsvps(teamId, gameId);
        summary = { going: 0, maybe: 0, notGoing: 0, total: rsvps.length };
        rsvps.forEach(r => {
            if (r.response === 'going') summary.going++;
            else if (r.response === 'maybe') summary.maybe++;
            else if (r.response === 'not_going') summary.notGoing++;
        });
    } catch (err) {
        if (err?.code !== 'permission-denied') throw err;
    }

    // Best effort: write denormalized summary if caller is allowed to update game doc.
    if (summary) {
        try {
            await updateDoc(doc(db, `teams/${teamId}/games`, gameId), { rsvpSummary: summary });
        } catch (err) {
            if (err?.code !== 'permission-denied') throw err;
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
