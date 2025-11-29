import { db } from './firebase.js';
import { imageStorage, ensureImageAuth } from './firebase-images.js';
import { collection, getDocs, getDoc, doc, addDoc, updateDoc, deleteDoc, setDoc, query, where, orderBy, Timestamp, increment } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
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

    // Code exists, so it's valid (codes can be reused)
    return { valid: true, codeId: snapshot.docs[0].id };
}

export async function markAccessCodeAsUsed(codeId, userId) {
    const docRef = doc(db, "accessCodes", codeId);
    await updateDoc(docRef, {
        used: true,
        usedBy: userId,
        usedAt: Timestamp.now()
    });
}
