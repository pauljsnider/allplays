import { db, auth, storage } from './firebase.js';
import { imageStorage, ensureImageAuth, requireImageAuth } from './firebase-images.js?v=2';
import { collection, getDocs, getDoc, doc, addDoc, updateDoc, deleteDoc, setDoc, query, where, orderBy, Timestamp, increment, arrayUnion, arrayRemove, deleteField, limit as limitQuery, startAfter as startAfterQuery, getCountFromServer, onSnapshot } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { getApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
// import { getAI, getGenerativeModel, GoogleAIBackend } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-vertexai.js';
export { collection, getDocs, deleteDoc, query };
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";

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
    const gamesSnapshot = await getDocs(collection(db, `teams / ${teamId}/games`));
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
export async function getPlayers(teamId) {
    const q = query(collection(db, `teams/${teamId}/players`), orderBy("number"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function addPlayer(teamId, playerData) {
    playerData.createdAt = Timestamp.now();
    const docRef = await addDoc(collection(db, `teams/${teamId}/players`), playerData);
    return docRef.id;
}

export async function updatePlayer(teamId, playerId, playerData) {
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

        await updateDoc(userRef, {
            parentOf: updatedParentOf,
            parentTeamIds: updatedParentTeamIds,
            updatedAt: Timestamp.now()
        });
    }
}

// Games
export async function getGames(teamId) {
    const q = query(collection(db, `teams/${teamId}/games`), orderBy("date"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
    // Restricted update for parents
    const allowedKeys = ['photoUrl', 'emergencyContact', 'medicalInfo'];
    const updateData = {};

    Object.keys(data).forEach(key => {
        if (allowedKeys.includes(key)) {
            updateData[key] = data[key];
        }
    });

    if (Object.keys(updateData).length === 0) return;

    updateData.updatedAt = Timestamp.now();
    await updateDoc(doc(db, `teams/${teamId}/players`, playerId), updateData);
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
export async function postChatMessage(teamId, { text, senderId, senderName, senderEmail, senderPhotoUrl, ai = false, aiName = null, aiQuestion = null, aiMeta = null }) {
    const messagesRef = collection(db, 'teams', teamId, 'chatMessages');
    return await addDoc(messagesRef, {
        text,
        senderId,
        senderName: senderName || null,
        senderEmail: senderEmail || null,
        senderPhotoUrl: senderPhotoUrl || null,
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
