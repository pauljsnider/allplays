import { db } from './firebase.js';
import { imageStorage, ensureImageAuth } from './firebase-images.js';
import { collection, getDocs, getDoc, doc, addDoc, updateDoc, deleteDoc, setDoc, query, where, orderBy, Timestamp, increment, arrayUnion, arrayRemove, deleteField } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
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

// Games
export async function getGames(teamId) {
    const q = query(collection(db, `teams/${teamId}/games`), orderBy("date"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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

    // Code exists and is not used
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
    const code = generateAccessCode();
    const accessCodeData = {
        code,
        type: 'parent_invite',
        teamId,
        playerId,
        playerNum, // Added for quick context
        relation,
        email: parentEmail || null,
        createdAt: Timestamp.now(),
        expiresAt: new Timestamp(Date.now() / 1000 + 7 * 24 * 60 * 60, 0), // 7 days
        used: false
    };
    const docRef = await addDoc(collection(db, "accessCodes"), accessCodeData);
    return { id: docRef.id, code };
}

export async function redeemParentInvite(userId, code) {
    // 1. Validate Code
    const q = query(
        collection(db, "accessCodes"),
        where("code", "==", code.toUpperCase()),
        where("used", "==", false)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) throw new Error("Invalid or used code");
    
    const codeDoc = snapshot.docs[0];
    const codeData = codeDoc.data();
    
    if (codeData.type !== 'parent_invite') throw new Error("Not a parent invite code");

    // 2. Get Team & Player details for caching
    const [team, player] = await Promise.all([
        getTeam(codeData.teamId),
        getPlayers(codeData.teamId).then(ps => ps.find(p => p.id === codeData.playerId))
    ]);

    if (!team || !player) throw new Error("Team or Player not found");

    // 3. Update User Profile (parentOf)
    const userRef = doc(db, "users", userId);
    await setDoc(userRef, {
        parentOf: arrayUnion({
            teamId: codeData.teamId,
            playerId: codeData.playerId,
            teamName: team.name,
            playerName: player.name,
            playerNumber: player.number,
            playerPhotoUrl: player.photoUrl || null
        }),
        roles: arrayUnion('parent')
    }, { merge: true });

    // 4. Update Player Doc (parents list)
    const playerRef = doc(db, `teams/${codeData.teamId}/players`, codeData.playerId);
    await updateDoc(playerRef, {
        parents: arrayUnion({
            userId,
            email: codeData.email || 'pending', // Will be updated if email not provided in invite
            relation: codeData.relation,
            addedAt: Timestamp.now()
        })
    });

    // 5. Mark Code Used
    await updateDoc(codeDoc.ref, {
        used: true,
        usedBy: userId,
        usedAt: Timestamp.now()
    });

    return { success: true, teamId: codeData.teamId };
}

export async function getParentDashboardData(userId) {
    const userProfile = await getUserProfile(userId);
    if (!userProfile || !userProfile.parentOf || userProfile.parentOf.length === 0) {
        return { upcomingGames: [], children: [] };
    }

    const children = userProfile.parentOf;
    const upcomingGames = [];

    // Fetch games for each team
    // Note: In a real app, we might query 'events' collection group or optimize this.
    // Here we loop through unique teams.
    const teamIds = [...new Set(children.map(c => c.teamId))];
    
    for (const teamId of teamIds) {
        const events = await getEvents(teamId); // Helper that gets games+practices
        const teamChild = children.find(c => c.teamId === teamId);
        
        // Filter for future events
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        const futureEvents = events.filter(e => {
            const d = e.date.toDate ? e.date.toDate() : new Date(e.date);
            return d >= now;
        }).map(e => ({
            ...e,
            teamId,
            teamName: teamChild.teamName,
            childName: teamChild.playerName // Associate with the specific child for this team
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
