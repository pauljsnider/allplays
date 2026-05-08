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
    getDownloadURL,
    deleteObject
} from './firebase.js?v=11';
import { imageStorage, ensureImageAuth, requireImageAuth } from './firebase-images.js?v=4';
import { buildDrillDiagramUploadPaths } from './drill-upload-paths.js?v=1';
import { isAccessCodeExpired } from './access-code-utils.js?v=1';
import {
    buildParentMembershipRequestId,
    buildParentMembershipRequestUpdate,
    hasParentLink,
    mergeApprovedParentLinkState
} from './parent-membership-utils.js?v=1';
import { buildCoachOverrideRsvpDocId, shouldDeleteLegacyRsvpForOverride } from './rsvp-doc-ids.js';
import { computeEffectiveRsvpSummary } from './rsvp-summary.js?v=1';
import { buildGameDayRsvpBreakdown } from './game-day-rsvp-breakdown.js?v=1';
import { isAvailabilityLocked, normalizeAvailabilityPreferences } from './availability-preferences.js?v=1';
import { normalizeChatAttachments } from './team-chat-media.js';
import {
    DEFAULT_TEAM_CONVERSATION_ID,
    buildConversationId,
    buildDefaultTeamConversation,
    isDefaultTeamConversation,
    isUserInConversation,
    normalizeConversationParticipantIds,
    normalizeConversationType
} from './team-chat-conversations.js';
import {
    normalizeTeamMediaFolderDraft,
    normalizeTeamMediaVideoDraft
} from './team-media-utils.js?v=1';
import {
    shouldMirrorSharedGame,
    createSharedScheduleId,
    buildMirroredGamePayload,
    buildSharedScheduleSourceUpdate,
    buildSharedScheduleDetachUpdate
} from './shared-schedule-sync.js';
import { normalizeTeamNotificationPreferences } from './notification-preferences.js?v=1';
import { normalizeAdSpaceSponsors, normalizeLocalAttractionSponsors } from './local-attractions.js?v=2';
import { buildRosterFieldDefinitionPayload } from './roster-profile-fields.js?v=2';
import {
    decodeSharedGameSyntheticId,
    isSharedGameSyntheticId,
    mergeGamesForTeam,
    projectSharedGameForTeam
} from './shared-games.js?v=1';
import {
    normalizeAthleteProfileDraft,
    collectAthleteProfileMediaCleanupPaths,
    summarizeAthleteProfileCareer,
    collectAthleteGameClipsForPlayer
} from './athlete-profile-utils.js?v=2';
import {
    isTeamActive,
    filterTeamsByActive,
    shouldIncludeTeamInLiveOrUpcoming,
    shouldIncludeTeamInReplay
} from './team-visibility.js?v=1';
import { normalizeStatTrackerConfig } from './stat-leaderboards.js?v=1';
import { buildPublishedBracketView } from './bracket-management.js?v=1';
import { buildRolloverPlayerCopy } from './team-rollover.js?v=1';
import { isPublicTrackingItem, normalizeTrackingStatus } from './player-tracking-summary.js?v=1';
import {
    buildRegistrationRosterDecision,
    getRegistrationGuardianDrafts,
    getRegistrationPlayerDraft,
    matchesRegistrationReviewStatus,
    normalizeRegistrationStatus,
    summarizeRegistration
} from './registration-review.js?v=1';
import { buildTournamentPoolOverrideKey } from './tournament-standings.js?v=1';
import { buildBulkDeleteUpdates, buildMoveUpdates, buildReorderUpdates, sortByMediaOrder } from './team-media-utils.js?v=1';
import { getApp } from './vendor/firebase-app.js';
import {
    claimOfficiatingSlot,
    computeOfficiatingCoverageStatus,
    updateOfficiatingSlotResponse
} from './officiating-utils.js?v=3';
import { buildOfficiatingNotificationRecord } from './officiating-notifications.js?v=2';
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


function normalizeDelimitedStrings(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(',');
    return Array.from(new Set(values
        .map((item) => String(item || '').trim())
        .filter(Boolean)));
}

export function normalizeOfficialDraft(draft = {}) {
    const name = String(draft.name || '').trim();
    const email = String(draft.email || '').trim();
    const phone = String(draft.phone || '').trim();
    const roles = normalizeDelimitedStrings(draft.roles);
    const tags = normalizeDelimitedStrings(draft.tags);

    if (!name) {
        throw new Error('Official name is required');
    }
    if (!email && !phone) {
        throw new Error('Official email or phone is required');
    }
    if (roles.length === 0) {
        throw new Error('At least one officiating role is required');
    }

    return {
        name,
        email: email || null,
        phone: phone || null,
        roles,
        tags
    };
}

function getTeamGameDocRef(teamId, gameId) {
    return doc(db, 'teams', teamId, 'games', gameId);
}

function getTeamGameCollectionRef(teamId) {
    return collection(db, `teams/${teamId}/games`);
}

function getSharedGameDocRefFromId(gameId) {
    const sharedPath = decodeSharedGameSyntheticId(gameId);
    if (!sharedPath) return null;
    return doc(db, sharedPath);
}

function getGameDocRef(teamId, gameId) {
    return getSharedGameDocRefFromId(gameId) || getTeamGameDocRef(teamId, gameId);
}

function getGameSubcollectionRef(teamId, gameId, subcollectionName) {
    const baseRef = getGameDocRef(teamId, gameId);
    return collection(db, `${baseRef.path}/${subcollectionName}`);
}

function normalizeSharedGameSnapshot(docSnap) {
    return {
        id: docSnap.id,
        ...docSnap.data(),
        _sharedGamePath: docSnap.ref.path
    };
}

async function getSharedGamesForTeam(teamId) {
    const sharedGamesRef = collectionGroup(db, 'sharedGames');
    const queries = [
        query(sharedGamesRef, where('homeTeamId', '==', teamId)),
        query(sharedGamesRef, where('awayTeamId', '==', teamId)),
        query(sharedGamesRef, where('teamIds', 'array-contains', teamId))
    ];

    const snapshots = await Promise.allSettled(queries.map((q) => getDocs(q)));
    const sharedGamesByPath = new Map();

    snapshots.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        result.value.docs.forEach((docSnap) => {
            sharedGamesByPath.set(docSnap.ref.path, normalizeSharedGameSnapshot(docSnap));
        });
    });

    return Array.from(sharedGamesByPath.values());
}

async function hasSharedGameUsingConfig(teamId, configId) {
    const sharedGamesRef = collectionGroup(db, 'sharedGames');
    const queries = [
        query(sharedGamesRef, where('homeTeamId', '==', teamId), where('statTrackerConfigId', '==', configId), limit(1)),
        query(sharedGamesRef, where('awayTeamId', '==', teamId), where('statTrackerConfigId', '==', configId), limit(1)),
        query(sharedGamesRef, where('teamIds', 'array-contains', teamId), where('statTrackerConfigId', '==', configId), limit(1))
    ];

    const snapshots = await Promise.allSettled(queries.map((q) => getDocs(q)));
    return snapshots.some((result) => result.status === 'fulfilled' && !result.value.empty);
}

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
    const safeName = String(file.name || 'media').replace(/[^\w.\-]+/g, '_');
    const isVideo = String(file.type || '').toLowerCase().startsWith('video/');
    const mediaFolder = isVideo ? 'team-videos' : 'team-photos';
    const imagePath = `${mediaFolder}/${ts}_chat_${teamId}_${safeName}`;

    try {
        const storageRef = ref(imageStorage, imagePath);
        const snapshot = await uploadBytes(storageRef, file);
        const url = await getDownloadURL(snapshot.ref);
        return {
            url,
            path: imagePath,
            name: file.name || null,
            type: file.type || null,
            size: Number.isFinite(file.size) ? file.size : null,
            thumbnailUrl: null
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
                size: Number.isFinite(file.size) ? file.size : null,
                thumbnailUrl: null
            };
        }
        throw error;
    }
}

export async function deleteUploadedChatAttachments(attachments = []) {
    const deletions = attachments
        .filter((attachment) => attachment?.path)
        .map(async (attachment) => {
            const usesImageStorage = attachment.path.startsWith('team-photos/')
                || attachment.path.startsWith('team-videos/');
            const storageRef = ref(usesImageStorage ? imageStorage : storage, attachment.path);
            await deleteObject(storageRef);
        });

    const results = await Promise.allSettled(deletions);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) {
        throw failure.reason;
    }
}

export async function uploadGameClip(teamId, gameId, file) {
    await requireImageAuth();

    const ts = Date.now();
    const safeName = String(file.name || 'clip').replace(/[^\w.\-]+/g, '_');
    const clipPath = `team-videos/${ts}_game-clip_${teamId}_${gameId}_${safeName}`;

    try {
        const storageRef = ref(imageStorage, clipPath);
        const snapshot = await uploadBytes(storageRef, file);
        const url = await getDownloadURL(snapshot.ref);
        return {
            url,
            path: clipPath,
            name: file.name || null,
            type: file.type || null,
            size: Number.isFinite(file.size) ? file.size : null,
            source: 'upload'
        };
    } catch (error) {
        const code = error?.code || '';
        if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
            console.warn('Image storage denied game clip upload, falling back to main storage:', error?.message || error);
            const fallbackPath = `game-clips/${ts}_${teamId}_${gameId}_${safeName}`;
            const fallbackRef = ref(storage, fallbackPath);
            const fallbackSnapshot = await uploadBytes(fallbackRef, file);
            const fallbackUrl = await getDownloadURL(fallbackSnapshot.ref);
            return {
                url: fallbackUrl,
                path: fallbackPath,
                name: file.name || null,
                type: file.type || null,
                size: Number.isFinite(file.size) ? file.size : null,
                source: 'upload'
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

function normalizeGameDateValue(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compareGamesByDateAsc(a, b) {
    const aDate = normalizeGameDateValue(a?.date);
    const bDate = normalizeGameDateValue(b?.date);
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate - bDate;
}

function compareGamesByDateDesc(a, b) {
    return compareGamesByDateAsc(b, a);
}

function getSharedHomepageTeamIds(sharedGame) {
    return Array.from(new Set([
        sharedGame?.homeTeamId,
        sharedGame?.awayTeamId,
        ...(Array.isArray(sharedGame?.teamIds) ? sharedGame.teamIds : [])
    ].filter(Boolean)));
}

async function projectSharedHomepageGame(sharedGame, shouldIncludeTeam) {
    const teamIds = getSharedHomepageTeamIds(sharedGame);

    for (const teamId of teamIds) {
        const teamSnap = await getDoc(doc(db, 'teams', teamId));
        if (!teamSnap.exists()) {
            continue;
        }

        const team = { id: teamSnap.id, ...teamSnap.data() };
        if (!shouldIncludeTeam(team)) {
            continue;
        }

        const projectedGame = projectSharedGameForTeam(sharedGame, teamId);
        if (!projectedGame) {
            continue;
        }

        return {
            ...projectedGame,
            team
        };
    }

    return null;
}

async function getSharedHomepageGames(queryConstraints, shouldIncludeTeam, maxResults) {
    const sharedGamesRef = collectionGroup(db, 'sharedGames');
    const snapshot = await getDocs(query(sharedGamesRef, ...queryConstraints));
    const games = [];

    for (const docSnap of snapshot.docs) {
        const sharedGame = normalizeSharedGameSnapshot(docSnap);
        const projectedGame = await projectSharedHomepageGame(sharedGame, shouldIncludeTeam);
        if (!projectedGame) {
            continue;
        }

        games.push(projectedGame);
        if (maxResults && games.length >= maxResults) {
            break;
        }
    }

    return games;
}

// ============ LIVE GAME EVENTS ============

/**
 * Broadcast a live event (fire-and-forget from tracker)
 */
export async function broadcastLiveEvent(teamId, gameId, eventData) {
    const eventsRef = getGameSubcollectionRef(teamId, gameId, 'liveEvents');
    const eventId = typeof eventData?.eventId === 'string' ? eventData.eventId.trim() : '';
    const eventPayload = {
        ...eventData,
        ...(eventId ? { eventId } : {}),
        createdAt: serverTimestamp()
    };

    if (eventId && !eventId.includes('/')) {
        const eventRef = doc(eventsRef, eventId);
        try {
            await setDoc(eventRef, eventPayload);
            return eventRef;
        } catch (error) {
            const confirmedSnap = await getDoc(eventRef).catch(() => null);
            if (confirmedSnap?.exists?.() && confirmedSnap.data()?.eventId === eventId) {
                return eventRef;
            }
            throw error;
        }
    }

    return addDoc(eventsRef, {
        ...eventPayload
    });
}

/**
 * Subscribe to live events (for viewer)
 */
export function subscribeLiveEvents(teamId, gameId, callback, onError) {
    const eventsRef = getGameSubcollectionRef(teamId, gameId, 'liveEvents');
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
    const eventsRef = getGameSubcollectionRef(teamId, gameId, 'liveEvents');
    const q = query(eventsRef, orderBy('createdAt', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Subscribe to aggregated stats (real-time) for Game Day Command Center
 */
export function subscribeAggregatedStats(teamId, gameId, callback, onError) {
    const ref = getGameSubcollectionRef(teamId, gameId, 'aggregatedStats');
    return onSnapshot(ref, snap => {
        const stats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(stats);
    }, onError);
}

/**
 * Update game live status
 */
export async function setGameLiveStatus(teamId, gameId, status) {
    const gameRef = getGameDocRef(teamId, gameId);
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
    const chatRef = getGameSubcollectionRef(teamId, gameId, 'liveChat');
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
    const chatRef = getGameSubcollectionRef(teamId, gameId, 'liveChat');
    return addDoc(chatRef, {
        ...messageData,
        createdAt: serverTimestamp()
    });
}

/**
 * Get all chat messages (for replay)
 */
export async function getLiveChatHistory(teamId, gameId) {
    const chatRef = getGameSubcollectionRef(teamId, gameId, 'liveChat');
    const q = query(chatRef, orderBy('createdAt', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ============ LIVE REACTIONS ============

/**
 * Send a reaction (ephemeral)
 */
export async function sendReaction(teamId, gameId, reactionData) {
    const reactionsRef = getGameSubcollectionRef(teamId, gameId, 'liveReactions');
    return addDoc(reactionsRef, {
        ...reactionData,
        createdAt: serverTimestamp()
    });
}

/**
 * Subscribe to reactions (real-time) - only recent reactions
 */
export function subscribeReactions(teamId, gameId, callback, onError) {
    const reactionsRef = getGameSubcollectionRef(teamId, gameId, 'liveReactions');
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
    const reactionsRef = getGameSubcollectionRef(teamId, gameId, 'liveReactions');
    const q = query(reactionsRef, orderBy('createdAt', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ============ VIEWER PRESENCE ============

/**
 * Track viewer presence and get count updates
 */
export function trackViewerPresence(teamId, gameId, onCountChange) {
    const gameRef = getGameDocRef(teamId, gameId);

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
    const fetchBatchSize = Math.max(limitCount * 3, 20);

    const gamesRef = collectionGroup(db, 'games');
    const queryConstraints = [
        where('type', '==', 'game'),
        where('date', '>=', Timestamp.fromDate(startOfToday)),
        where('date', '<=', Timestamp.fromDate(oneWeekFromNow)),
        orderBy('date', 'asc')
    ];
    const games = [];
    let snapshot;

    try {
        let lastDoc = null;
        let exhausted = false;

        while (games.length < limitCount && !exhausted) {
            const pageConstraints = [...queryConstraints, limitQuery(fetchBatchSize)];
            if (lastDoc) {
                pageConstraints.push(startAfterQuery(lastDoc));
            }

            snapshot = await getDocs(query(gamesRef, ...pageConstraints));
            if (snapshot.empty) {
                break;
            }

            lastDoc = snapshot.docs[snapshot.docs.length - 1];

            for (const docSnap of snapshot.docs) {
                const gameData = { id: docSnap.id, ...docSnap.data() };
                if (gameData.type === 'practice' || gameData.status === 'completed' || gameData.status === 'cancelled' || gameData.liveStatus === 'completed') {
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
                if (games.length >= limitCount) {
                    break;
                }
            }

            exhausted = snapshot.docs.length < fetchBatchSize;
        }
    } catch (error) {
        // Fallback when the collection group date index isn't ready yet.
        // Pull a limited sample and filter client-side.
        const fallbackQuery = query(gamesRef, limitQuery(200));
        snapshot = await getDocs(fallbackQuery);
        for (const docSnap of snapshot.docs) {
            const gameData = { id: docSnap.id, ...docSnap.data() };
            if (gameData.type === 'practice' || gameData.status === 'completed' || gameData.status === 'cancelled' || gameData.liveStatus === 'completed') {
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
            if (games.length >= limitCount) {
                break;
            }
        }
    }

    try {
        const sharedGames = await getSharedHomepageGames([
            ...queryConstraints,
            limitQuery(fetchBatchSize)
        ], shouldIncludeTeamInLiveOrUpcoming);
        games.push(...sharedGames.filter((game) => {
            return game.type !== 'practice'
                && game.status !== 'completed'
                && game.status !== 'cancelled'
                && game.liveStatus !== 'completed';
        }));
    } catch (error) {
        console.warn('Could not load shared upcoming live games:', error?.message || error);
    }

    games.sort(compareGamesByDateAsc);

    return games.slice(0, limitCount);
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

    try {
        const sharedGames = await getSharedHomepageGames([
            where('liveStatus', '==', 'live')
        ], shouldIncludeTeamInLiveOrUpcoming);
        games.push(...sharedGames);
    } catch (error) {
        console.warn('Could not load shared live games:', error?.message || error);
    }

    return games;
}

/**
 * Get recently completed live-tracked games (for replay section)
 */
export async function getRecentLiveTrackedGames(limitCount = 6) {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentQueryConstraints = [
        where('liveStatus', '==', 'completed'),
        where('date', '>=', Timestamp.fromDate(oneWeekAgo)),
        orderBy('date', 'desc'),
        limitQuery(limitCount)
    ];

    const gamesRef = collectionGroup(db, 'games');
    const q = query(
        gamesRef,
        ...recentQueryConstraints
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

    try {
        const sharedGames = await getSharedHomepageGames(recentQueryConstraints, shouldIncludeTeamInReplay, limitCount);
        games.push(...sharedGames);
    } catch (error) {
        console.warn('Could not load shared replay games:', error?.message || error);
    }

    games.sort(compareGamesByDateDesc);

    return games.slice(0, limitCount);
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
// Officiating Assignments
// ============================================

export async function createOfficiatingAssignmentNotificationRecords(teamId, records = []) {
    if (!teamId || !Array.isArray(records) || records.length === 0) return [];

    const collectionRef = collection(db, `teams/${teamId}/officiatingNotifications`);
    const writeResults = await Promise.allSettled(records.map((record) => addDoc(collectionRef, {
        ...record,
        timestamp: record.timestamp || Timestamp.now(),
        createdAt: Timestamp.now()
    })));
    const failures = writeResults.filter((result) => result.status === 'rejected');
    if (failures.length) {
        throw new Error(failures[0].reason?.message || 'Failed to create officiating notification record');
    }
    return writeResults.map((result) => result.value.id);
}

async function tryCreateOfficiatingAssignmentNotificationRecords(teamId, records = []) {
    try {
        await createOfficiatingAssignmentNotificationRecords(teamId, records);
    } catch (error) {
        console.warn('Officiating assignment notification creation failed:', error);
    }
}

export async function respondToOfficiatingAssignment(teamId, gameId, slotId, status) {
    const docRef = getGameDocRef(teamId, gameId);
    let notificationRecord = null;
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists()) throw new Error('Game not found');
        const game = snap.data() || {};
        const officiatingSlots = updateOfficiatingSlotResponse(game.officiatingSlots || [], slotId, status);
        const updatedSlot = officiatingSlots.find((slot) => slot.id === slotId) || null;
        if (updatedSlot) {
            notificationRecord = buildOfficiatingNotificationRecord({
                teamId,
                gameId,
                game,
                slot: updatedSlot,
                event: status === 'declined' || status === 'cant_make' ? 'declined' : 'accepted',
                status,
                recipientType: 'assigner',
                actor: auth.currentUser || {},
                timestamp: Timestamp.now()
            });
        }
        transaction.update(docRef, {
            officiatingSlots,
            officiatingCoverageStatus: computeOfficiatingCoverageStatus(officiatingSlots),
            officiatingUpdatedAt: Timestamp.now()
        });
    });

    await tryCreateOfficiatingAssignmentNotificationRecords(teamId, notificationRecord ? [notificationRecord] : []);
}

export async function claimOpenOfficiatingSlot(teamId, gameId, slotId, official = auth.currentUser) {
    const docRef = getGameDocRef(teamId, gameId);
    let notificationRecord = null;
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists()) throw new Error('Game not found');
        const game = snap.data() || {};
        if (game.officiatingSelfAssignmentEnabled !== true) {
            throw new Error('Self-assignment is not enabled for this game');
        }
        const officiatingSlots = claimOfficiatingSlot(game.officiatingSlots || [], slotId, {
            uid: official?.uid || '',
            email: official?.email || '',
            displayName: official?.displayName || official?.email || 'Official'
        });
        const updatedSlot = officiatingSlots.find((slot) => slot.id === slotId) || null;
        if (updatedSlot) {
            notificationRecord = buildOfficiatingNotificationRecord({
                teamId,
                gameId,
                game: { ...game, officiatingSlots },
                slot: updatedSlot,
                event: 'self_assigned',
                status: updatedSlot.status,
                recipientType: 'assigner',
                actor: official || {},
                timestamp: Timestamp.now()
            });
        }
        const officiatingAuthorizedUserIds = new Set(game.officiatingAuthorizedUserIds || []);
        const officiatingAuthorizedEmails = new Set(game.officiatingAuthorizedEmails || []);
        if (official?.uid) officiatingAuthorizedUserIds.add(official.uid);
        if (official?.email) officiatingAuthorizedEmails.add(String(official.email).trim().toLowerCase());

        transaction.update(docRef, {
            officiatingSlots,
            officiatingCoverageStatus: computeOfficiatingCoverageStatus(officiatingSlots),
            officiatingUpdatedAt: Timestamp.now(),
            officiatingAuthorizedUserIds: Array.from(officiatingAuthorizedUserIds),
            officiatingAuthorizedEmails: Array.from(officiatingAuthorizedEmails)
        });
    });

    await tryCreateOfficiatingAssignmentNotificationRecords(teamId, notificationRecord ? [notificationRecord] : []);
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

async function getEventDateForAvailabilityCutoff(teamId, gameId) {
    const [masterId, instanceDate] = String(gameId || '').split('__');
    const gameRef = doc(db, `teams/${teamId}/games`, masterId || gameId);
    const snap = await getDoc(gameRef);
    if (!snap.exists()) return null;
    const game = snap.data();
    const baseDate = game.date?.toDate ? game.date.toDate() : new Date(game.date);
    if (instanceDate && !Number.isNaN(baseDate.getTime())) {
        const occurrenceDate = new Date(`${instanceDate}T00:00:00`);
        if (!Number.isNaN(occurrenceDate.getTime())) {
            occurrenceDate.setHours(baseDate.getHours(), baseDate.getMinutes(), baseDate.getSeconds(), baseDate.getMilliseconds());
            return occurrenceDate;
        }
    }
    return baseDate;
}

async function assertAvailabilityOpen(teamId, gameId) {
    const team = await getTeam(teamId);
    const preferences = normalizeAvailabilityPreferences(team?.availabilityPreferences);
    const eventDate = await getEventDateForAvailabilityCutoff(teamId, gameId);
    if (eventDate && isAvailabilityLocked(eventDate, preferences)) {
        throw new Error('Availability is locked for this event. Contact a coach or admin for changes.');
    }
}

export async function submitRsvp(teamId, gameId, userId, { displayName, playerIds, response, note }) {
    await assertAvailabilityOpen(teamId, gameId);
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

export async function submitRsvpForPlayer(teamId, gameId, userId, { displayName, playerId, response, note, skipAvailabilityCutoff = false }) {
    if (!skipAvailabilityCutoff) {
        await assertAvailabilityOpen(teamId, gameId);
    }
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

export async function getMyRsvp(teamId, gameId, userId, playerIds = []) {
    const rsvpCollectionPath = `teams/${teamId}/games/${gameId}/rsvps`;
    const linkedPlayerIds = uniqueNonEmptyIds(playerIds);
    const directRsvpRef = doc(db, rsvpCollectionPath, userId);

    if (linkedPlayerIds.length === 0) {
        const snap = await getDoc(directRsvpRef);
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    const [directResult, ...overrideResults] = await Promise.allSettled([
        getDoc(directRsvpRef),
        ...linkedPlayerIds.map((playerId) => getDoc(doc(db, rsvpCollectionPath, buildCoachOverrideRsvpDocId(userId, playerId))))
    ]);

    const overrideRsvps = overrideResults
        .filter((result) => result.status === 'fulfilled' && result.value.exists())
        .map((result) => ({ id: result.value.id, ...result.value.data() }));

    if (overrideRsvps.length > 0) {
        const responses = Array.from(new Set(overrideRsvps.map((rsvp) => normalizeRsvpResponse(rsvp.response))));
        if (responses.length === 1) {
            return {
                id: `${userId}__linkedPlayers`,
                userId,
                playerIds: overrideRsvps.flatMap((rsvp) => extractDirectRsvpPlayerIds(rsvp)),
                response: responses[0],
                playerRsvps: overrideRsvps
            };
        }
        return {
            id: `${userId}__linkedPlayers`,
            userId,
            playerIds: overrideRsvps.flatMap((rsvp) => extractDirectRsvpPlayerIds(rsvp)),
            response: 'mixed',
            playerRsvps: overrideRsvps
        };
    }

    if (directResult.status === 'rejected') throw directResult.reason;
    const snap = directResult.value;
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

function normalizeRideEventIds(primaryGameId, fallbackGameIds = []) {
    const fallbackIds = Array.isArray(fallbackGameIds) ? fallbackGameIds : [fallbackGameIds];
    return [...new Set(
        [primaryGameId, ...fallbackIds]
            .map((gameId) => typeof gameId === 'string' ? gameId.trim() : '')
            .filter(Boolean)
    )];
}

async function loadRideOffersForGameId(teamId, gameId) {
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
            sourceGameId: gameId,
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

async function resolveRideOffersGameId(teamId, primaryGameId, fallbackGameIds = []) {
    const candidateGameIds = normalizeRideEventIds(primaryGameId, fallbackGameIds);
    for (const candidateGameId of candidateGameIds) {
        const offersSnap = await getDocs(collection(db, `teams/${teamId}/games/${candidateGameId}/rideOffers`));
        if (!offersSnap.empty) return candidateGameId;
    }
    return candidateGameIds[0] || '';
}

/**
 * Create a rideshare offer under a game/practice event.
 */
export async function createRideOffer(teamId, gameId, payload = {}, options = {}) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error('You must be signed in to offer a ride.');
    const targetGameId = await resolveRideOffersGameId(teamId, gameId, options?.fallbackGameIds);
    if (!targetGameId) throw new Error('gameId is required to offer a ride.');
    const seatCapacity = toNonNegativeInteger(payload.seatCapacity, 0);
    if (seatCapacity <= 0) throw new Error('Seat capacity must be at least 1.');

    const directionRaw = (payload.direction || '').toString().toLowerCase();
    const direction = directionRaw === 'to' || directionRaw === 'from' || directionRaw === 'round-trip'
        ? directionRaw
        : 'to';

    const note = typeof payload.note === 'string' ? payload.note.trim() : '';
    const offerRef = await addDoc(collection(db, `teams/${teamId}/games/${targetGameId}/rideOffers`), {
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
export async function listRideOffersForEvent(teamId, gameId, options = {}) {
    const candidateGameIds = normalizeRideEventIds(gameId, options?.fallbackGameIds);
    if (candidateGameIds.length === 0) return [];

    for (let index = 0; index < candidateGameIds.length; index += 1) {
        const candidateGameId = candidateGameIds[index];
        const offers = await loadRideOffersForGameId(teamId, candidateGameId);
        if (offers.length > 0 || index === candidateGameIds.length - 1) {
            return offers;
        }
    }

    return [];
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
    const requestRef = doc(db, `teams/${teamId}/games/${gameId}/rideOffers/${offerId}/requests`, requestId);
    const existingRequestSnap = await getDoc(requestRef);
    const requestedAt = Timestamp.now();

    if (existingRequestSnap.exists()) {
        const existingRequest = existingRequestSnap.data() || {};
        const existingStatus = normalizeRideRequestStatus(existingRequest.status);
        if (existingStatus && existingStatus !== RIDE_REQUEST_STATUS.DECLINED && existingStatus !== RIDE_REQUEST_STATUS.WAITLISTED) {
            throw new Error('Ride request is already active.');
        }

        await updateDoc(requestRef, {
            childName: childName || null,
            status: RIDE_REQUEST_STATUS.PENDING,
            requestedAt: requestedAt,
            respondedAt: null,
            updatedAt: Timestamp.now()
        });
        return requestId;
    }

    await setDoc(requestRef, {
        parentUserId: user.uid,
        childId,
        childName: childName || null,
        status: RIDE_REQUEST_STATUS.PENDING,
        requestedAt: requestedAt,
        respondedAt: null,
        updatedAt: Timestamp.now()
    });
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
    return buildGameDayRsvpBreakdown({ players, rsvps, fallbackByUser });
}

export async function getPublicTrackingItems(teamId) {
    const snap = await getDocs(query(
        collection(db, `teams/${teamId}/trackingItems`),
        where('public', '==', true),
        where('private', '==', false),
        where('isPrivate', '==', false)
    ));
    return snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter(isPublicTrackingItem);
}

export async function getPlayerTrackingStatuses(teamId, playerIds = []) {
    const uniquePlayerIds = Array.from(new Set((Array.isArray(playerIds) ? playerIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)));
    if (uniquePlayerIds.length === 0) return [];

    const playerIdFields = ['playerId', 'childId', 'memberId'];
    const trackingCollection = collection(db, `teams/${teamId}/memberTracking`);
    const snapshots = await Promise.all(uniquePlayerIds.flatMap((playerId) => (
        playerIdFields.map((fieldName) => getDocs(query(
            trackingCollection,
            where(fieldName, '==', playerId),
            where('public', '==', true)
        )))
    )));

    const statusesById = new Map();
    snapshots.forEach((snap) => {
        snap.docs.forEach((docSnap) => {
            statusesById.set(docSnap.id, normalizeTrackingStatus({
                id: docSnap.id,
                ...docSnap.data()
            }));
        });
    });
    return Array.from(statusesById.values());
}

// ============================================
// Team Media Library Functions
// ============================================

async function getTeamMediaFolderItems(teamId, folderId) {
    const itemsRef = collection(db, 'teams', teamId, 'mediaFolders', folderId, 'items');
    const itemSnapshot = await getDocs(query(itemsRef, orderBy('createdAt', 'desc')));
    return sortByMediaOrder(itemSnapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
}

export async function getTeamMediaFolders(teamId, { visibility = null } = {}) {
    const foldersRef = collection(db, 'teams', teamId, 'mediaFolders');
    const folderQuery = visibility
        ? query(foldersRef, where('visibility', '==', visibility), orderBy('createdAt', 'desc'))
        : query(foldersRef, orderBy('createdAt', 'desc'));
    const folderSnapshot = await getDocs(folderQuery);
    const folders = await Promise.all(folderSnapshot.docs.map(async (folderDoc) => ({
        id: folderDoc.id,
        ...folderDoc.data(),
        items: await getTeamMediaFolderItems(teamId, folderDoc.id)
    })));

    return sortByMediaOrder(folders);
}

export function subscribeToTeamMediaFolders(teamId, { visibility = null } = {}, onFolders, onError = null) {
    const foldersRef = collection(db, 'teams', teamId, 'mediaFolders');
    const q = visibility
        ? query(foldersRef, where('visibility', '==', visibility), orderBy('createdAt', 'desc'))
        : query(foldersRef, orderBy('createdAt', 'desc'));
    return onSnapshot(q, async (snapshot) => {
        const folders = await Promise.all(snapshot.docs.map(async (folderDoc) => ({
            id: folderDoc.id,
            ...folderDoc.data(),
            items: await getTeamMediaFolderItems(teamId, folderDoc.id)
        })));
        onFolders(sortByMediaOrder(folders));
    }, onError || undefined);
}

export async function createTeamMediaFolder(teamId, draft, user = {}) {
    const normalized = normalizeTeamMediaFolderDraft(draft);
    const foldersRef = collection(db, 'teams', teamId, 'mediaFolders');
    const now = Timestamp.now();
    const existingFolders = await getTeamMediaFolders(teamId);

    return await addDoc(foldersRef, {
        ...normalized,
        order: existingFolders.length,
        createdAt: now,
        updatedAt: now,
        createdBy: user.uid || null,
        createdByEmail: user.email || null
    });
}

export async function addTeamMediaVideoLink(teamId, folderId, draft, user = {}) {
    const normalized = normalizeTeamMediaVideoDraft(draft);
    const itemsRef = collection(db, 'teams', teamId, 'mediaFolders', folderId, 'items');
    const now = Timestamp.now();
    const existingItems = await getTeamMediaFolderItems(teamId, folderId);

    return await addDoc(itemsRef, {
        ...normalized,
        order: existingItems.length,
        createdAt: now,
        updatedAt: now,
        createdBy: user.uid || null,
        createdByEmail: user.email || null
    });
}

export async function reorderTeamMediaFolders(teamId, folderIds = []) {
    const updates = buildReorderUpdates(folderIds);
    if (!teamId || updates.length === 0) return;
    const batch = writeBatch(db);
    updates.forEach(({ id, order }) => {
        batch.update(doc(db, 'teams', teamId, 'mediaFolders', id), {
            order,
            updatedAt: Timestamp.now()
        });
    });
    await batch.commit();
}

export async function reorderTeamMediaItems(teamId, folderId, itemIds = []) {
    const updates = buildReorderUpdates(itemIds);
    if (!teamId || !folderId || updates.length === 0) return;
    const batch = writeBatch(db);
    updates.forEach(({ id, order }) => {
        batch.update(doc(db, 'teams', teamId, 'mediaFolders', folderId, 'items', id), {
            order,
            updatedAt: Timestamp.now()
        });
    });
    await batch.commit();
}

export async function moveTeamMediaItems(teamId, sourceFolderId, itemIds = [], targetFolderId) {
    if (!teamId || !sourceFolderId) throw new Error('Team and source folder are required.');
    const updates = buildMoveUpdates(itemIds, targetFolderId, (await getTeamMediaFolderItems(teamId, targetFolderId)).length);
    if (updates.length === 0) throw new Error('Select at least one media item to move.');
    const sourceItems = await getTeamMediaFolderItems(teamId, sourceFolderId);
    const batch = writeBatch(db);
    updates.forEach(({ id, order }) => {
        const item = sourceItems.find((entry) => entry.id === id);
        if (!item) return;
        const { id: _id, ...data } = item;
        batch.set(doc(db, 'teams', teamId, 'mediaFolders', targetFolderId, 'items', id), {
            ...data,
            order,
            updatedAt: Timestamp.now()
        });
        batch.delete(doc(db, 'teams', teamId, 'mediaFolders', sourceFolderId, 'items', id));
    });
    await batch.commit();
}

export async function bulkDeleteTeamMediaItems(teamId, folderId, itemIds = []) {
    const updates = buildBulkDeleteUpdates(itemIds);
    if (!teamId || !folderId) throw new Error('Team and folder are required.');
    if (updates.length === 0) throw new Error('Select at least one media item to delete.');
    const batch = writeBatch(db);
    updates.forEach(({ id }) => {
        batch.delete(doc(db, 'teams', teamId, 'mediaFolders', folderId, 'items', id));
    });
    await batch.commit();
}
