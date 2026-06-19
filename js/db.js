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
    functions,
    httpsCallable,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from './firebase.js?v=18';
import { imageStorage, ensureImageAuth, requireImageAuth } from './firebase-images.js?v=6';
import { uploadBytesResumable } from './vendor/firebase-storage.js';
import { buildDrillDiagramUploadPaths } from './drill-upload-paths.js?v=2';
import { buildChatAttachmentFallbackPath, buildGameClipFallbackPath, buildStatSheetFallbackPath } from './fallback-media-paths.js?v=2';
import { isAccessCodeExpired } from './access-code-utils.js?v=1';
import {
    buildParentMembershipRequestId,
    buildParentMembershipRequestUpdate,
    hasParentLink,
    mergeApprovedParentLinkState
} from './parent-membership-utils.js?v=2';
import { buildCoachOverrideRsvpDocId, shouldDeleteLegacyRsvpForOverride } from './rsvp-doc-ids.js';
import { computeEffectiveRsvpSummary } from './rsvp-summary.js?v=1';
import { buildGameDayRsvpBreakdown } from './game-day-rsvp-breakdown.js?v=1';
import { isAvailabilityLocked, normalizeAvailabilityPreferences } from './availability-preferences.js?v=1';
import { resolveAvailabilityCutoffEventDate } from './availability-cutoff-date.js?v=1';
import { normalizeFamilyShareCalendarUrls, normalizeFamilyShareChildren } from './family-share-utils.js?v=1';
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
} from './team-visibility.js?v=2';

export async function normalizeParentScopeLinks(parentLinks = []) {
    const activeLinks = [];
    let blockedLinkCount = 0;
    let staleLinkCount = 0;
    const teamCache = new Map();
    const playerCache = new Map();
    const seenKeys = new Set();

    for (const link of (Array.isArray(parentLinks) ? parentLinks : [])) {
        const teamId = String(link?.teamId || '').trim();
        const playerId = String(link?.playerId || '').trim();
        if (!teamId || !playerId) continue;

        const playerKey = `${teamId}::${playerId}`;
        if (seenKeys.has(playerKey)) continue;
        seenKeys.add(playerKey);

        let team = teamCache.get(teamId);
        if (team === undefined) {
            team = await getTeam(teamId, { includeInactive: true });
            teamCache.set(teamId, team || null);
        }
        if (!team || !isTeamActive(team)) {
            staleLinkCount += 1;
            continue;
        }

        let playerSnap = playerCache.get(playerKey);
        if (playerSnap === undefined) {
            try {
                playerSnap = await getDoc(doc(db, `teams/${teamId}/players`, playerId));
            } catch (error) {
                if (error?.code === 'permission-denied') {
                    console.warn('[parent-scope] Preserving legacy player link while roster permissions are being repaired:', error);
                    blockedLinkCount += 1;
                    playerSnap = { blockedByPermissions: true };
                } else {
                    throw error;
                }
            }
            playerCache.set(playerKey, playerSnap);
        }

        if (playerSnap?.blockedByPermissions) {
            activeLinks.push({
                ...link,
                teamId,
                playerId,
                teamName: team.name || link.teamName || '',
                playerName: link.playerName || '',
                playerNumber: link.playerNumber ?? '',
                playerPhotoUrl: link.playerPhotoUrl || null
            });
            continue;
        }

        if (!playerSnap?.exists()) {
            staleLinkCount += 1;
            continue;
        }

        const player = { id: playerSnap.id, ...playerSnap.data() };
        if (player.active === false) {
            staleLinkCount += 1;
            continue;
        }

        activeLinks.push({
            ...link,
            teamId,
            playerId,
            teamName: team.name || link.teamName || '',
            playerName: player.name || link.playerName || '',
            playerNumber: player.number ?? link.playerNumber ?? '',
            playerPhotoUrl: player.photoUrl || link.playerPhotoUrl || null
        });
    }

    return {
        activeLinks,
        parentTeamIds: [...new Set(activeLinks.map((link) => link.teamId))],
        parentPlayerKeys: [...new Set(activeLinks.map((link) => `${link.teamId}::${link.playerId}`))],
        blockedLinkCount,
        staleLinkCount
    };
}
import { normalizeStatTrackerConfig, splitPlayerStatsByVisibility } from './stat-leaderboards.js?v=2';
import { buildPublishedBracketView } from './bracket-management.js?v=1';
import { buildRolloverPlayerCopy } from './team-rollover.js?v=1';
import { isPublicTrackingItem, normalizeTrackingStatus } from './player-tracking-summary.js?v=1';
import {
    buildRegistrationRosterDecision,
    buildRegistrationStatusUpdate,
    getRegistrationGuardianDrafts,
    getRegistrationPlayerDraft,
    matchesRegistrationReviewStatus,
    normalizeRegistrationStatus,
    summarizeRegistration
} from './registration-review.js?v=2';
import { assertVolunteerScreeningCleared } from './volunteer-screening-access.js?v=2';
import { buildTournamentPoolOverrideKey } from './tournament-standings.js?v=1';
import { buildBulkDeleteUpdates, buildMoveUpdates, buildReorderUpdates, isSafeTeamMediaUrl, isSupportedTeamMediaDocument, isSupportedTeamMediaImage, normalizeTeamMediaFolderDraft, normalizeAlbumVisibility, sortByMediaOrder } from './team-media-utils.js?v=3';
import { getApp } from './vendor/firebase-app.js';
import {
    claimOfficiatingSlot,
    computeOfficiatingCoverageStatus,
    updateOfficiatingSlotResponse,
    updateOfficiatingSlotResult
} from './officiating-utils.js?v=4';
import { buildOfficiatingNotificationRecord } from './officiating-notifications.js?v=2';
import {
    getTeamEmailAttachmentTotalBytes,
    normalizeTeamEmailAttachments
} from './team-email-attachments.js?v=1';
export {
    TEAM_EMAIL_ATTACHMENT_LIMIT_BYTES,
    assertTeamEmailAttachmentLimit,
    buildTeamEmailDeliveryPayload,
    deleteTeamEmailAttachment,
    getTeamEmailAttachmentTotalBytes,
    getTeamEmailDraft,
    normalizeTeamEmailAttachments,
    queueTeamEmailSend,
    uploadTeamEmailAttachment
} from './team-email-attachments.js?v=1';
// import { getAI, getGenerativeModel, GoogleAIBackend } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-vertexai.js';
export { collection, getDocs, deleteDoc, query };
const limitQuery = limit;
const startAfterQuery = startAfter;
const DEFAULT_PUBLIC_TEAM_DISCOVERY_PAGE_SIZE = 24;
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

function daysAgoDate(days) {
    const safeDays = Number.isFinite(days) ? Math.max(1, days) : 7;
    return new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
}

function toDateKey(date) {
    return date.toISOString().slice(0, 10);
}

function mapSnapshot(snapshot) {
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function getTelemetryEvents({ days = 7, maxEvents = 1500 } = {}) {
    const startDate = Timestamp.fromDate(daysAgoDate(days));
    const safeLimit = Math.min(Math.max(Number(maxEvents) || 1500, 100), 5000);
    const q = query(
        collection(db, 'telemetryEvents'),
        where('createdAt', '>=', startDate),
        orderBy('createdAt', 'desc'),
        limitQuery(safeLimit)
    );
    return mapSnapshot(await getDocs(q));
}

export async function getTelemetryDaily({ days = 30 } = {}) {
    const startKey = toDateKey(daysAgoDate(days));
    const q = query(
        collection(db, 'telemetryDaily'),
        where('date', '>=', startKey),
        orderBy('date', 'desc'),
        limitQuery(Math.min(Math.max(days + 2, 7), 60))
    );
    return mapSnapshot(await getDocs(q));
}

export async function getTelemetryPageDaily({ days = 30, maxPages = 500 } = {}) {
    const startKey = toDateKey(daysAgoDate(days));
    const q = query(
        collection(db, 'telemetryPagesDaily'),
        where('date', '>=', startKey),
        orderBy('date', 'desc'),
        limitQuery(Math.min(Math.max(Number(maxPages) || 500, 50), 1000))
    );
    return mapSnapshot(await getDocs(q));
}

export async function getTelemetryEventDaily({ days = 30, maxEvents = 500 } = {}) {
    const startKey = toDateKey(daysAgoDate(days));
    const q = query(
        collection(db, 'telemetryEventsDaily'),
        where('date', '>=', startKey),
        orderBy('date', 'desc'),
        limitQuery(Math.min(Math.max(Number(maxEvents) || 500, 50), 1000))
    );
    return mapSnapshot(await getDocs(q));
}

export async function getTelemetrySessions({ maxSessions = 200 } = {}) {
    const q = query(
        collection(db, 'telemetrySessions'),
        orderBy('updatedAt', 'desc'),
        limitQuery(Math.min(Math.max(Number(maxSessions) || 200, 50), 500))
    );
    return mapSnapshot(await getDocs(q));
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

function getRequiredSignedInUserId() {
    const userId = auth.currentUser?.uid || null;
    if (!userId) {
        throw new Error('You must be signed in to upload team media.');
    }
    return userId;
}

export async function uploadChatImage(teamId, file) {
    await requireImageAuth();

    const ts = Date.now();
    const userId = getRequiredSignedInUserId();
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
            const fallbackPath = buildChatAttachmentFallbackPath(teamId, userId, file.name, ts);
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
    const userId = getRequiredSignedInUserId();
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
            const fallbackPath = buildGameClipFallbackPath(teamId, gameId, userId, file.name, ts);
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

export async function uploadStatSheetPhoto(teamId, file) {
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
            const userId = auth.currentUser?.uid;
            if (!teamId || !userId) {
                throw new Error('Team-scoped stat sheet fallback upload requires a signed-in team user.');
            }
            const fallbackRef = ref(storage, buildStatSheetFallbackPath(teamId, userId, file.name, Date.now()));
            const snapshot = await uploadBytes(fallbackRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);
            console.log('Stat sheet URL (main storage):', downloadURL);
            return downloadURL;
        }
        throw error;
    }
}

import { resolveZip } from './utils.js?v=9'; // Import resolveZip

function normalizePublicTeamSearchValue(value, { uppercase = false } = {}) {
    const normalized = String(value || '').trim();
    return uppercase ? normalized.toUpperCase() : normalized.toLowerCase();
}

function toTitleCase(value) {
    return String(value || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
        .join(' ');
}

function buildPublicTeamSearchFields(teamData = {}) {
    const searchFields = {};

    if (Object.prototype.hasOwnProperty.call(teamData, 'name')) {
        searchFields.publicSearchName = normalizePublicTeamSearchValue(teamData.name);
    }

    if (Object.prototype.hasOwnProperty.call(teamData, 'city')) {
        searchFields.publicSearchCity = normalizePublicTeamSearchValue(teamData.city);
    }

    if (Object.prototype.hasOwnProperty.call(teamData, 'state')) {
        searchFields.publicSearchState = normalizePublicTeamSearchValue(teamData.state, { uppercase: true });
    }

    if (Object.prototype.hasOwnProperty.call(teamData, 'zip')) {
        searchFields.publicSearchZip = String(teamData.zip || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(searchFields, 'publicSearchCity') || Object.prototype.hasOwnProperty.call(searchFields, 'publicSearchState')) {
        const city = Object.prototype.hasOwnProperty.call(searchFields, 'publicSearchCity')
            ? searchFields.publicSearchCity
            : normalizePublicTeamSearchValue(teamData.city);
        const state = Object.prototype.hasOwnProperty.call(searchFields, 'publicSearchState')
            ? searchFields.publicSearchState
            : normalizePublicTeamSearchValue(teamData.state, { uppercase: true });
        searchFields.publicSearchCityState = city && state ? `${city}, ${state.toLowerCase()}` : '';
    }

    return searchFields;
}

function normalizePublicTeamSearchInput(value) {
    return String(value || '').trim();
}

function buildPublicTeamSearchDescriptor(searchText = '') {
    const trimmed = normalizePublicTeamSearchInput(searchText);
    if (!trimmed) return null;

    if (/^\d{1,5}$/.test(trimmed)) {
        return {
            type: 'zip',
            normalized: trimmed
        };
    }

    if (/^[A-Za-z]{2}$/.test(trimmed) && !trimmed.includes(',')) {
        return {
            type: 'state',
            normalized: trimmed.toLowerCase(),
            state: trimmed.toUpperCase()
        };
    }

    return {
        type: 'location',
        normalized: trimmed.toLowerCase()
    };
}

function buildPublicTeamSearchStrategies(searchText = '') {
    const descriptor = buildPublicTeamSearchDescriptor(searchText);
    const rawTrimmed = normalizePublicTeamSearchInput(searchText);
    const trimmed = descriptor?.normalized || rawTrimmed;
    if (!descriptor) return [];

    const strategies = [];
    const normalizedName = normalizePublicTeamSearchValue(rawTrimmed);
    const legacyNameSearch = toTitleCase(rawTrimmed);
    if (normalizedName) {
        strategies.push(
            { field: 'publicSearchName', start: normalizedName, end: `${normalizedName}\uf8ff` },
            { field: 'name', start: legacyNameSearch, end: `${legacyNameSearch}\uf8ff` }
        );
    }

    if (descriptor.type === 'zip') {
        strategies.push(
            { field: 'publicSearchZip', start: trimmed, end: `${trimmed}\uf8ff` },
            { field: 'zip', start: trimmed, end: `${trimmed}\uf8ff` }
        );
        return strategies;
    }

    const [rawCityPart, rawStatePart = ''] = trimmed.split(',').map((part) => part.trim()).filter((part, index, parts) => index === 0 || part || parts.length > 1);

    if (descriptor.type === 'state') {
        const normalizedState = descriptor.state;
        strategies.push(
            { field: 'publicSearchState', start: normalizedState, end: `${normalizedState}\uf8ff` },
            { field: 'state', start: normalizedState, end: `${normalizedState}\uf8ff` }
        );
        return strategies;
    }

    const citySearch = normalizePublicTeamSearchValue(rawCityPart || trimmed);
    const legacyCitySearch = toTitleCase(rawCityPart || trimmed);
    const normalizedState = rawStatePart ? rawStatePart.toUpperCase() : '';
    const filterByState = normalizedState
        ? (team) => String(team.publicSearchState || team.state || '').trim().toUpperCase().startsWith(normalizedState)
        : null;

    strategies.push(
        { field: 'publicSearchCity', start: citySearch, end: `${citySearch}\uf8ff`, filter: filterByState },
        { field: 'city', start: legacyCitySearch, end: `${legacyCitySearch}\uf8ff`, filter: filterByState }
    );

    return strategies;
}

function sortTeamsByName(teams = []) {
    return [...teams].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function buildPublicTeamSearchPageCursor(searchText, strategyCursors = [], bufferedTeams = []) {
    if (!bufferedTeams.length && !strategyCursors.some(Boolean)) {
        return null;
    }

    return {
        kind: 'public-team-search',
        searchText,
        strategyCursors,
        bufferedTeams
    };
}

function readPublicTeamSearchPageCursor(cursor, searchText, strategyCount) {
    if (!cursor || typeof cursor !== 'object' || cursor.kind !== 'public-team-search') {
        return {
            strategyCursors: Array.from({ length: strategyCount }, () => null),
            bufferedTeams: []
        };
    }

    if (normalizePublicTeamSearchInput(cursor.searchText || '') !== searchText) {
        return {
            strategyCursors: Array.from({ length: strategyCount }, () => null),
            bufferedTeams: []
        };
    }

    return {
        strategyCursors: Array.from({ length: strategyCount }, (_, index) => cursor.strategyCursors?.[index] || null),
        bufferedTeams: Array.isArray(cursor.bufferedTeams) ? cursor.bufferedTeams : []
    };
}

export async function discoverPublicTeams(options = {}) {
    const rawPageSize = Number(options.pageSize);
    const pageSize = Number.isFinite(rawPageSize)
        ? Math.min(Math.max(Math.floor(rawPageSize), 1), 100)
        : DEFAULT_PUBLIC_TEAM_DISCOVERY_PAGE_SIZE;
    const searchText = normalizePublicTeamSearchInput(options.searchText || options.locationFilter || '');
    const cursor = options.cursor || null;
    const teamsRef = collection(db, 'teams');

    if (!searchText) {
        const constraints = [where('isPublic', '==', true), orderBy('name')];
        if (cursor) {
            constraints.push(startAfterQuery(cursor));
        }
        constraints.push(limitQuery(pageSize));
        const snapshot = await getDocs(query(teamsRef, ...constraints));
        const teams = filterTeamsByActive(snapshot.docs.map((teamDoc) => ({ id: teamDoc.id, ...teamDoc.data() })), false);
        return {
            teams,
            nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null
        };
    }

    let strategies = buildPublicTeamSearchStrategies(searchText);
    if (!strategies.length) {
        return { teams: [], nextCursor: null };
    }

    const previousPageCursor = readPublicTeamSearchPageCursor(cursor, searchText, strategies.length);
    if (previousPageCursor.bufferedTeams.length >= pageSize) {
        const teams = previousPageCursor.bufferedTeams.slice(0, pageSize);
        const bufferedTeams = previousPageCursor.bufferedTeams.slice(pageSize);
        return {
            teams,
            nextCursor: buildPublicTeamSearchPageCursor(searchText, previousPageCursor.strategyCursors, bufferedTeams)
        };
    }

    strategies = strategies.map((strategy, index) => ({
        ...strategy,
        startAfterConstraint: previousPageCursor.strategyCursors[index]
            ? [startAfterQuery(previousPageCursor.strategyCursors[index])]
            : []
    }));
    const snapshots = await Promise.all(strategies.map((strategy) => getDocs(query(
        teamsRef,
        where('isPublic', '==', true),
        where(strategy.field, '>=', strategy.start),
        where(strategy.field, '<=', strategy.end),
        orderBy(strategy.field),
        ...strategy.startAfterConstraint,
        limitQuery(pageSize)
    ))));

    const teamsById = new Map(previousPageCursor.bufferedTeams
        .filter((team) => team?.id)
        .map((team) => [team.id, team]));
    snapshots.forEach((snapshot, index) => {
        const strategy = strategies[index];
        snapshot.docs.forEach((teamDoc) => {
            const team = { id: teamDoc.id, ...teamDoc.data() };
            if (typeof strategy.filter === 'function' && !strategy.filter(team)) {
                return;
            }
            teamsById.set(team.id, team);
        });
    });

    const sortedTeams = filterTeamsByActive(sortTeamsByName(Array.from(teamsById.values())), false);
    const teams = sortedTeams.slice(0, pageSize);
    const bufferedTeams = sortedTeams.slice(pageSize);
    const strategyCursors = snapshots.map((snapshot, index) => snapshot.docs.length
        ? snapshot.docs[snapshot.docs.length - 1]
        : previousPageCursor.strategyCursors[index] || null);
    const hasMorePages = bufferedTeams.length > 0 || snapshots.some((snapshot) => snapshot.docs.length === pageSize);

    return {
        teams,
        nextCursor: hasMorePages
            ? buildPublicTeamSearchPageCursor(searchText, strategyCursors, bufferedTeams)
            : null
    };
}

// Teams
export async function getTeams(options = {}) {
    const includeInactive = !!options.includeInactive;
    const publicOnly = options.publicOnly === true;
    const includePrivate = options.includePrivate === true || includeInactive;
    const locationFilter = String(options.locationFilter || '').trim().toLowerCase();

    const teamsRef = collection(db, "teams");
    let teams = [];
    if (includePrivate) {
        teams = (await getDocs(query(teamsRef, orderBy("name")))).docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else if (publicOnly) {
        teams = (await getDocs(query(teamsRef, where("isPublic", "==", true)))).docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    } else {
        const currentUser = auth.currentUser;
        const currentUserEmail = String(currentUser?.email || '').trim().toLowerCase();
        const teamSnapshots = await Promise.all([
            getDocs(query(teamsRef, where("isPublic", "==", true))),
            currentUser?.uid
                ? getDocs(query(teamsRef, where("ownerId", "==", currentUser.uid)))
                : Promise.resolve({ docs: [] }),
            currentUserEmail
                ? getDocs(query(teamsRef, where("adminEmails", "array-contains", currentUserEmail)))
                : Promise.resolve({ docs: [] })
        ]);
        const teamsById = new Map();
        teamSnapshots.forEach((snapshot) => {
            snapshot.docs.forEach(doc => teamsById.set(doc.id, { id: doc.id, ...doc.data() }));
        });
        teams = Array.from(teamsById.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }

    // Apply location filter if provided
    if (locationFilter) {
        const filteredTeams = [];
        const zipToLocationCache = new Map(); // Local cache for this function call

        for (const team of teams) {
            if (team.zip) {
                let resolvedLocation = zipToLocationCache.get(team.zip);
                if (resolvedLocation === undefined) {
                    resolvedLocation = await resolveZip(team.zip);
                    zipToLocationCache.set(team.zip, resolvedLocation);
                }

                const teamLocation = resolvedLocation ? String(resolvedLocation).toLowerCase() : '';

                // Match zip code directly or resolved city/state
                if (team.zip.toLowerCase().includes(locationFilter) || teamLocation.includes(locationFilter)) {
                    filteredTeams.push(team);
                }
            } else if (team.city && team.state) {
                const teamCityState = `${team.city.toLowerCase()}, ${team.state.toLowerCase()}`;
                if (teamCityState.includes(locationFilter)) {
                    filteredTeams.push(team);
                }
            }
        }
        teams = filteredTeams;
    }

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

function getTeamMediaFoldersRef(teamId) {
    return collection(db, `teams/${teamId}/mediaFolders`);
}

function getTeamMediaItemsRef(teamId) {
    return collection(db, `teams/${teamId}/mediaItems`);
}

export async function getTeamMediaFolders(teamId, options = {}) {
    if (!teamId) return [];
    const includePrivate = options.includePrivate === true;
    const foldersRef = getTeamMediaFoldersRef(teamId);
    const snapshot = await getDocs(includePrivate ? foldersRef : query(foldersRef, where('visibility', '==', 'team')));
    return sortByMediaOrder(snapshot.docs.map((folderDoc) => {
        const data = folderDoc.data();
        return { id: folderDoc.id, ...data, visibility: normalizeAlbumVisibility(data.visibility) };
    }));
}

export async function getTeamMediaItems(teamId, folderId = null) {
    if (!teamId) return [];
    const itemsRef = getTeamMediaItemsRef(teamId);
    const snapshot = await getDocs(folderId ? query(itemsRef, where('folderId', '==', folderId)) : itemsRef);
    const items = snapshot.docs
        .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
        .filter((item) => item.deleted !== true)
        .filter((item) => !folderId || item.folderId === folderId);

    const resolvedItems = await Promise.all(items.map(async (item) => {
        if (!['photo', 'file'].includes(String(item?.type || '').toLowerCase())) return item;
        if (String(item.downloadUrl || item.url || item.src || '').trim()) return item;
        if (!item.storagePath) return item;
        try {
            const downloadUrl = await getDownloadURL(ref(storage, item.storagePath));
            updateDoc(doc(db, `teams/${teamId}/mediaItems`, item.id), {
                downloadUrl,
                updatedAt: serverTimestamp()
            }).catch((error) => {
                console.warn('Unable to backfill cached team media download URL:', error);
            });
            return { ...item, downloadUrl };
        } catch (error) {
            console.warn('Unable to resolve team media download URL:', error);
            return item;
        }
    }));

    return sortByMediaOrder(resolvedItems);
}

export async function createTeamMediaFolder(teamId, draft = {}) {
    const folder = normalizeTeamMediaFolderDraft(typeof draft === 'string' ? { name: draft } : draft);
    if (!teamId) throw new Error('Team is required.');
    const existingFolders = await getTeamMediaFolders(teamId, { includePrivate: true });
    const docRef = await addDoc(getTeamMediaFoldersRef(teamId), {
        name: folder.name,
        visibility: folder.visibility,
        order: existingFolders.length,
        nextMediaOrder: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return docRef.id;
}

async function reserveNextTeamMediaOrder(teamId, folderId) {
    const folderRef = doc(db, `teams/${teamId}/mediaFolders`, folderId);
    return runTransaction(db, async (transaction) => {
        const folderSnapshot = await transaction.get(folderRef);
        if (!folderSnapshot.exists()) {
            throw new Error('Choose a folder for this media item.');
        }

        const folderData = folderSnapshot.data() || {};
        const nextMediaOrder = Number(folderData.nextMediaOrder || 0);

        transaction.update(folderRef, {
            nextMediaOrder: nextMediaOrder + 1,
            updatedAt: serverTimestamp()
        });

        return nextMediaOrder;
    });
}

export async function updateTeamMediaFolder(teamId, folderId, draft = {}) {
    const folder = normalizeTeamMediaFolderDraft(draft);
    if (!teamId || !folderId) throw new Error('Album is required.');
    await updateDoc(doc(db, `teams/${teamId}/mediaFolders`, folderId), {
        name: folder.name,
        visibility: folder.visibility,
        updatedAt: serverTimestamp()
    });
}

export async function deleteTeamMediaFolder(teamId, folderId) {
    if (!teamId || !folderId) throw new Error('Album is required.');
    const folderItems = await getTeamMediaItems(teamId, folderId);
    const batch = writeBatch(db);
    batch.delete(doc(db, `teams/${teamId}/mediaFolders`, folderId));
    folderItems.forEach((item) => {
        batch.update(doc(db, `teams/${teamId}/mediaItems`, item.id), {
            deleted: true,
            deletedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    });
    await batch.commit();
}

export async function createTeamMediaLink(teamId, folderId, media = {}) {
    const cleanFolderId = String(folderId || '').trim();
    const title = String(media.title || '').trim();
    const url = String(media.url || '').trim();
    if (!teamId || !cleanFolderId) throw new Error('Choose a folder for this media link.');
    if (!title || !url) throw new Error('Media title and URL are required.');
    if (!isSafeTeamMediaUrl(url)) throw new Error('Use a valid http or https media link.');
    const order = await reserveNextTeamMediaOrder(teamId, cleanFolderId);
    const docRef = await addDoc(getTeamMediaItemsRef(teamId), {
        folderId: cleanFolderId,
        title,
        url,
        type: 'video-link',
        order,
        deleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return docRef.id;
}

export async function setTeamMediaAlbumCover(teamId, folderId, item = {}) {
    const cleanFolderId = String(folderId || '').trim();
    const itemId = String(item.id || '').trim();
    const coverPhotoUrl = String(item.downloadUrl || item.url || item.src || '').trim();
    if (!teamId || !cleanFolderId || !itemId) throw new Error('Choose a photo to use as the album cover.');
    if (!isSafeTeamMediaUrl(coverPhotoUrl)) throw new Error('Album cover must use a valid photo URL.');
    await updateDoc(doc(db, `teams/${teamId}/mediaFolders`, cleanFolderId), {
        coverPhotoId: itemId,
        coverPhotoUrl,
        coverPhotoTitle: String(item.title || item.fileName || '').trim(),
        updatedAt: serverTimestamp()
    });
}

function sanitizeTeamMediaFileName(name) {
    return String(name || 'photo')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'photo';
}

export async function uploadTeamMediaPhoto(teamId, folderId, file, options = {}) {
    const cleanTeamId = String(teamId || '').trim();
    const cleanFolderId = String(folderId || '').trim();
    const currentUser = auth.currentUser;
    if (!cleanTeamId || !cleanFolderId) throw new Error('Choose an album before uploading photos.');
    if (!currentUser?.uid) throw new Error('Sign in before uploading photos.');
    if (!isSupportedTeamMediaImage(file)) throw new Error('Choose an image file that is 10 MB or smaller.');

    const storagePath = `team-media/${cleanTeamId}/${cleanFolderId}/${currentUser.uid}/${Date.now()}-${sanitizeTeamMediaFileName(file.name)}`;
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, file, { contentType: file.type || 'image/jpeg' });

    const snapshot = await new Promise((resolve, reject) => {
        uploadTask.on('state_changed', (progressSnapshot) => {
            if (typeof options.onProgress === 'function') {
                const percent = progressSnapshot.totalBytes > 0
                    ? Math.round((progressSnapshot.bytesTransferred / progressSnapshot.totalBytes) * 100)
                    : 0;
                options.onProgress({
                    bytesTransferred: progressSnapshot.bytesTransferred,
                    totalBytes: progressSnapshot.totalBytes,
                    percent
                });
            }
        }, reject, () => resolve(uploadTask.snapshot));
    });

    const downloadUrl = await getDownloadURL(snapshot.ref);
    const order = await reserveNextTeamMediaOrder(cleanTeamId, cleanFolderId);
    const docRef = await addDoc(getTeamMediaItemsRef(cleanTeamId), {
        folderId: cleanFolderId,
        title: String(file.name || 'Uploaded photo').trim() || 'Uploaded photo',
        type: 'photo',
        storagePath,
        downloadUrl,
        uploadedBy: currentUser.uid,
        size: Number(file.size || 0),
        mimeType: file.type || 'image/jpeg',
        order,
        deleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return docRef.id;
}

export async function uploadTeamMediaFile(teamId, folderId, file, options = {}) {
    const cleanTeamId = String(teamId || '').trim();
    const cleanFolderId = String(folderId || '').trim();
    const currentUser = auth.currentUser;
    if (!cleanTeamId || !cleanFolderId) throw new Error('Choose an album before uploading files.');
    if (!currentUser?.uid) throw new Error('Sign in before uploading files.');
    if (!isSupportedTeamMediaDocument(file)) throw new Error('Choose a supported document file that is 10 MB or smaller.');

    const storagePath = `team-media/${cleanTeamId}/${cleanFolderId}/${currentUser.uid}/${Date.now()}-${sanitizeTeamMediaFileName(file.name)}`;
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, file, { contentType: file.type });

    const snapshot = await new Promise((resolve, reject) => {
        uploadTask.on('state_changed', (progressSnapshot) => {
            if (typeof options.onProgress === 'function') {
                const percent = progressSnapshot.totalBytes > 0
                    ? Math.round((progressSnapshot.bytesTransferred / progressSnapshot.totalBytes) * 100)
                    : 0;
                options.onProgress({
                    bytesTransferred: progressSnapshot.bytesTransferred,
                    totalBytes: progressSnapshot.totalBytes,
                    percent
                });
            }
        }, reject, () => resolve(uploadTask.snapshot));
    });

    const downloadUrl = await getDownloadURL(snapshot.ref);
    const order = await reserveNextTeamMediaOrder(cleanTeamId, cleanFolderId);
    const docRef = await addDoc(getTeamMediaItemsRef(cleanTeamId), {
        folderId: cleanFolderId,
        title: String(file.name || 'Uploaded file').trim() || 'Uploaded file',
        fileName: String(file.name || '').trim(),
        type: 'file',
        storagePath,
        downloadUrl,
        uploadedBy: currentUser.uid,
        size: Number(file.size || 0),
        mimeType: file.type,
        order,
        deleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return docRef.id;
}

export async function deleteTeamMediaItem(teamId, item) {
    const cleanTeamId = String(teamId || '').trim();
    const itemId = String(item?.id || '').trim();
    if (!cleanTeamId || !itemId) throw new Error('Media item is required.');
    if (['photo', 'file'].includes(item?.type) && !item.storagePath) {
        console.error('Media object missing file reference:', itemId);
        throw new Error('Cannot delete media: missing file reference');
    }

    const mediaDocRef = doc(db, `teams/${cleanTeamId}/mediaItems`, itemId);
    if (!mediaDocRef) {
        console.error('Media object missing document reference:', itemId);
        throw new Error('Cannot delete media: missing document reference');
    }

    await updateDoc(mediaDocRef, {
        deleted: true,
        deletedAt: serverTimestamp(),
        deletedBy: auth.currentUser?.uid || null,
        updatedAt: serverTimestamp()
    });

    if (['photo', 'file'].includes(item?.type)) {
        try {
            await deleteObject(ref(storage, item.storagePath));
        } catch (error) {
            console.warn('Unable to delete team media storage object:', error);
        }
    }
}

export async function updateTeamMediaItem(teamId, itemId, updates) {
    const cleanTeamId = String(teamId || '').trim();
    const cleanItemId = String(itemId || '').trim();
    if (!cleanTeamId || !cleanItemId) throw new Error('Media item is required.');
    
    // Sanitize title if it's being updated
    if (Object.prototype.hasOwnProperty.call(updates, 'title')) {
        updates.title = String(updates.title || '').trim();
        if (updates.title === '') {
            throw new Error('Media item title cannot be empty.');
        }
    }

    const mediaItemRef = doc(db, `teams/${cleanTeamId}/mediaItems`, cleanItemId);
    await updateDoc(mediaItemRef, {
        ...updates,
        updatedAt: serverTimestamp(),
    });
}

export async function reorderTeamMediaFolders(teamId, folderIds = []) {
    const updates = buildReorderUpdates(folderIds);
    if (!teamId || updates.length === 0) return;
    const batch = writeBatch(db);
    updates.forEach(({ id, order }) => {
        batch.update(doc(db, `teams/${teamId}/mediaFolders`, id), {
            order,
            updatedAt: serverTimestamp()
        });
    });
    await batch.commit();
}

export async function reorderTeamMediaItems(teamId, itemIds = []) {
    const updates = buildReorderUpdates(itemIds);
    if (!teamId || updates.length === 0) return;
    const batch = writeBatch(db);
    updates.forEach(({ id, order }) => {
        batch.update(doc(db, `teams/${teamId}/mediaItems`, id), {
            order,
            updatedAt: serverTimestamp()
        });
    });
    await batch.commit();
}

export async function moveTeamMediaItems(teamId, itemIds = [], targetFolderId) {
    if (!teamId) throw new Error('Team is required.');
    const targetItems = await getTeamMediaItems(teamId, targetFolderId);
    const updates = buildMoveUpdates(itemIds, targetFolderId, targetItems.length);
    if (updates.length === 0) throw new Error('Select at least one media item to move.');
    const batch = writeBatch(db);
    updates.forEach(({ id, folderId, order }) => {
        batch.update(doc(db, `teams/${teamId}/mediaItems`, id), {
            folderId,
            order,
            updatedAt: serverTimestamp()
        });
    });
    await batch.commit();
}

export async function bulkDeleteTeamMediaItems(teamId, itemIds = []) {
    const updates = buildBulkDeleteUpdates(itemIds);
    if (!teamId) throw new Error('Team is required.');
    if (updates.length === 0) throw new Error('Select at least one media item to delete.');
    const batch = writeBatch(db);
    updates.forEach(({ id }) => {
        batch.update(doc(db, `teams/${teamId}/mediaItems`, id), {
            deleted: true,
            deletedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    });
    await batch.commit();
}

async function getPublishedSponsors(teamId) {
    if (!teamId) return [];

    const sponsorsRef = collection(db, `teams/${teamId}/sponsors`);
    const sponsorQueries = [
        query(sponsorsRef, where("status", "==", "published")),
        query(sponsorsRef, where("status", "==", "active")),
        query(sponsorsRef, where("published", "==", true)),
        query(sponsorsRef, where("isPublished", "==", true))
    ];
    const snapshots = await Promise.allSettled(sponsorQueries.map((q) => getDocs(q)));
    const successfulSnapshots = snapshots.filter((result) => result.status === 'fulfilled');

    if (successfulSnapshots.length === 0) {
        throw snapshots[0]?.reason || new Error('Unable to load sponsor placements');
    }

    const sponsorsById = new Map();
    successfulSnapshots.forEach((result) => {
        result.value.docs.forEach(doc => sponsorsById.set(doc.id, { id: doc.id, ...doc.data() }));
    });

    return Array.from(sponsorsById.values());
}

export async function getLocalAttractionSponsors(teamId) {
    return normalizeLocalAttractionSponsors(await getPublishedSponsors(teamId));
}

export async function getAdSpaceSponsors(teamId) {
    return normalizeAdSpaceSponsors(await getPublishedSponsors(teamId));
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

    const teams = (await Promise.all(
        teamIds.map((teamId) => getTeam(teamId, { includeInactive }))
    )).filter(Boolean);

    // Sort by name for consistency with other helpers
    return teams.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// User profiles
export async function getUserProfile(userId) {
    const docRef = doc(db, "users", userId);
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
}

function compactPublicProfileString(value) {
    return String(value || '').trim();
}

function uniquePublicProfileStrings(values = []) {
    return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function derivePublicProfileTeamIds(userData = {}) {
    const parentOfTeamIds = Array.isArray(userData.parentOf)
        ? userData.parentOf.map((link) => link?.teamId)
        : [];
    const parentTeamIds = Array.isArray(userData.parentTeamIds)
        ? userData.parentTeamIds
        : [];
    return uniquePublicProfileStrings([...parentOfTeamIds, ...parentTeamIds]);
}

async function hashPublicProfileEmail(email) {
    const normalized = compactPublicProfileString(email).toLowerCase();
    if (!normalized || !globalThis.crypto?.subtle) {
        return null;
    }
    const bytes = new TextEncoder().encode(normalized);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
}

async function buildPublicUserProfilePayload(userData = {}) {
    const fullName = compactPublicProfileString(userData.fullName || userData.displayName || userData.name);
    const displayName = compactPublicProfileString(userData.displayName || userData.fullName || userData.name);
    const payload = {
        displayName: displayName || null,
        fullName: fullName || null,
        photoUrl: compactPublicProfileString(userData.photoUrl) || null,
        discoveryTeamIds: derivePublicProfileTeamIds(userData),
        emailHash: await hashPublicProfileEmail(userData.email),
        updatedAt: Timestamp.now()
    };
    return payload;
}

async function syncPublicUserProfile(userId, userData = null) {
    const nextUserData = userData || await getUserProfile(userId) || {};
    const payload = await buildPublicUserProfilePayload(nextUserData);
    await setDoc(doc(db, 'publicUserProfiles', userId), payload, { merge: true });
}

export async function updateUserProfile(userId, profile) {
    const docRef = doc(db, "users", userId);
    profile.updatedAt = Timestamp.now();
    await setDoc(docRef, profile, { merge: true });
    await syncPublicUserProfile(userId);
}

export async function createAccountMergeRequest(userId, { primaryEmail, secondaryEmail }) {
    if (!auth.currentUser || auth.currentUser.uid !== userId) {
        throw new Error('You must be signed in to request an account merge');
    }

    const normalizedPrimaryEmail = String(primaryEmail || '').trim().toLowerCase();
    const normalizedSecondaryEmail = String(secondaryEmail || '').trim().toLowerCase();
    if (!normalizedPrimaryEmail || !normalizedSecondaryEmail) {
        throw new Error('Both account emails are required');
    }

    const now = Timestamp.now();
    const requestRef = await addDoc(collection(db, 'users', userId, 'accountMergeRequests'), {
        requestedBy: userId,
        primaryEmail: normalizedPrimaryEmail,
        secondaryEmail: normalizedSecondaryEmail,
        status: 'pending_verification',
        createdAt: now,
        updatedAt: now
    });
    return requestRef.id;
}

export async function getNotificationPreferencesForTeam(userId, teamId) {
    if (!userId || !teamId) return null;
    const prefRef = doc(db, 'users', userId, 'notificationPreferences', teamId);
    const snap = await getDoc(prefRef);
    if (!snap.exists()) return null;
    return normalizeTeamNotificationPreferences(snap.data());
}

export async function saveNotificationPreferencesForTeam(userId, teamId, preferences) {
    if (!userId || !teamId) {
        throw new Error('Missing userId or teamId for notification preferences');
    }

    const normalized = normalizeTeamNotificationPreferences(preferences);
    const prefRef = doc(db, 'users', userId, 'notificationPreferences', teamId);
    await setDoc(prefRef, {
        ...normalized,
        updatedAt: Timestamp.now()
    }, { merge: true });
    return normalized;
}

function getNotificationDeviceId(token) {
    const normalized = String(token || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (normalized) return normalized.slice(0, 180);
    return `device_${Date.now()}`;
}

export async function upsertNotificationDeviceToken(userId, { token, platform = 'web', userAgent = '' } = {}) {
    if (!userId) {
        throw new Error('Missing userId for notification device token');
    }
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) {
        throw new Error('Missing device token');
    }

    const deviceId = getNotificationDeviceId(normalizedToken);
    const deviceRef = doc(db, 'users', userId, 'notificationDevices', deviceId);
    await setDoc(deviceRef, {
        token: normalizedToken,
        platform,
        userAgent,
        updatedAt: Timestamp.now(),
        createdAt: Timestamp.now()
    }, { merge: true });
    return deviceId;
}

export async function getRegistrationSources() {
    const snapshot = await getDocs(collection(db, "registrationSources"));
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
}

const DEFAULT_ADMIN_COLLECTION_PAGE_SIZE = 25;

function normalizeAdminCollectionPageSize(rawPageSize) {
    const pageSize = Number(rawPageSize);
    if (!Number.isFinite(pageSize)) return DEFAULT_ADMIN_COLLECTION_PAGE_SIZE;
    return Math.min(Math.max(Math.floor(pageSize), 1), 100);
}

export async function getAdminTeamsPage(options = {}) {
    const pageSize = normalizeAdminCollectionPageSize(options.pageSize);
    const constraints = [orderBy('name')];
    if (options.cursor) {
        constraints.push(startAfterQuery(options.cursor));
    }
    constraints.push(limitQuery(pageSize));

    const snapshot = await getDocs(query(collection(db, 'teams'), ...constraints));
    return {
        teams: snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
        nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null
    };
}

export async function getAdminUsersPage(options = {}) {
    const pageSize = normalizeAdminCollectionPageSize(options.pageSize);
    const constraints = [orderBy('email')];
    if (options.cursor) {
        constraints.push(startAfterQuery(options.cursor));
    }
    constraints.push(limitQuery(pageSize));

    const snapshot = await getDocs(query(collection(db, 'users'), ...constraints));
    return {
        users: snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
        nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null
    };
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
    Object.assign(teamData, buildPublicTeamSearchFields(teamData));
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
    Object.assign(teamData, buildPublicTeamSearchFields(teamData));
    await updateDoc(docRef, teamData);
}

export async function saveTeamAvailabilityPreferences(teamId, preferences) {
    if (!teamId) throw new Error('Missing team for availability preferences');
    const normalized = normalizeAvailabilityPreferences(preferences);
    await updateTeam(teamId, { availabilityPreferences: normalized });
    return normalized;
}

function mapSnapshotWithIds(snapshot) {
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

function sortByFields(records, fields) {
    return [...records].sort((a, b) => {
        for (const field of fields) {
            const comparison = String(a?.[field] || '').localeCompare(String(b?.[field] || ''));
            if (comparison !== 0) return comparison;
        }
        return 0;
    });
}

export async function listOrganizationScheduleControls(teamId) {
    if (!teamId) throw new Error('Missing team for organization schedule controls');

    const [availabilitySnapshot, organizationBlackoutsSnapshot, venueBlackoutsSnapshot] = await Promise.all([
        getDocs(collection(db, `teams/${teamId}/venueAvailability`)),
        getDocs(collection(db, `teams/${teamId}/organizationBlackouts`)),
        getDocs(collection(db, `teams/${teamId}/venueBlackouts`))
    ]);

    return {
        availability: sortByFields(mapSnapshotWithIds(availabilitySnapshot), ['dayOfWeek', 'startTime', 'venueName']),
        organizationBlackouts: sortByFields(mapSnapshotWithIds(organizationBlackoutsSnapshot), ['startDate', 'endDate']),
        venueBlackouts: sortByFields(mapSnapshotWithIds(venueBlackoutsSnapshot), ['startDate', 'endDate', 'venueName'])
    };
}

export async function createVenueAvailability(teamId, availabilityData = {}) {
    if (!teamId) throw new Error('Missing team for venue availability');
    const allowedFields = {
        venueName: availabilityData.venueName,
        subVenueName: availabilityData.subVenueName,
        dayOfWeek: availabilityData.dayOfWeek,
        startTime: availabilityData.startTime,
        endTime: availabilityData.endTime,
        notes: availabilityData.notes
    };
    const docRef = await addDoc(collection(db, `teams/${teamId}/venueAvailability`), {
        ...allowedFields,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });
    return docRef.id;
}

export async function createOrganizationBlackout(teamId, blackoutData = {}) {
    if (!teamId) throw new Error('Missing team for organization blackout');
    const allowedFields = {
        startDate: blackoutData.startDate,
        endDate: blackoutData.endDate,
        reason: blackoutData.reason
    };
    const docRef = await addDoc(collection(db, `teams/${teamId}/organizationBlackouts`), {
        ...allowedFields,
        scope: 'organization',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });
    return docRef.id;
}

export async function createVenueBlackout(teamId, blackoutData = {}) {
    if (!teamId) throw new Error('Missing team for venue blackout');
    const allowedFields = {
        venueName: blackoutData.venueName,
        subVenueName: blackoutData.subVenueName,
        startDate: blackoutData.startDate,
        endDate: blackoutData.endDate,
        reason: blackoutData.reason
    };
    const docRef = await addDoc(collection(db, `teams/${teamId}/venueBlackouts`), {
        ...allowedFields,
        scope: 'venue',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });
    return docRef.id;
}

async function listVolunteerScreeningRegistrationsForTeam(teamId) {
    const normalizedTeamId = String(teamId || '').trim();
    if (!normalizedTeamId) return [];

    const forms = await listTeamRegistrationForms(normalizedTeamId);
    if (forms.length === 0) return [];

    const registrationSnapshots = await Promise.all(forms.map(async (form) => {
        const formId = String(form?.id || '').trim();
        if (!formId) return [];

        const snapshot = await getDocs(collection(db, `teams/${normalizedTeamId}/registrationForms/${formId}/registrations`));
        return snapshot.docs.map((registrationDoc) => ({
            id: registrationDoc.id,
            formId,
            teamId: normalizedTeamId,
            refPath: registrationDoc.ref.path,
            ...(registrationDoc.data() || {})
        }));
    }));

    return registrationSnapshots.flat();
}

async function assertVolunteerScreeningClearedForTeamGrant(teamId, target = {}) {
    const normalizedTarget = {
        userId: String(target.userId || '').trim(),
        email: String(target.email || '').trim().toLowerCase()
    };

    if (normalizedTarget.userId && !normalizedTarget.email) {
        const profile = await getUserProfile(normalizedTarget.userId);
        normalizedTarget.email = String(profile?.email || '').trim().toLowerCase();
    }
    try {
        const registrations = await listVolunteerScreeningRegistrationsForTeam(teamId);
        assertVolunteerScreeningCleared(registrations, normalizedTarget);
    } catch (error) {
        console.error('Failed to access registration records for volunteer screening:', error);
        throw error;
    }
}

export async function grantScorekeeperAccess(teamId, memberUserId) {
    const normalizedUserId = String(memberUserId || '').trim();
    if (!teamId) throw new Error('Missing team for scorekeeper access');
    if (!normalizedUserId) throw new Error('Team member user ID is required');

    await assertVolunteerScreeningClearedForTeamGrant(teamId, { userId: normalizedUserId });

    const docRef = doc(db, "teams", teamId);
    await updateDoc(docRef, {
        'teamPermissions.scorekeeping.mode': 'selected',
        'teamPermissions.scorekeeping.memberIds': arrayUnion(normalizedUserId),
        updatedAt: Timestamp.now()
    });
}

export async function revokeScorekeeperAccess(teamId, memberUserId) {
    const normalizedUserId = String(memberUserId || '').trim();
    if (!teamId) throw new Error('Missing team for scorekeeper access');
    if (!normalizedUserId) throw new Error('Team member user ID is required');

    const docRef = doc(db, "teams", teamId);
    await updateDoc(docRef, {
        'teamPermissions.scorekeeping.memberIds': arrayRemove(normalizedUserId),
        updatedAt: Timestamp.now()
    });
}

export async function grantVideographerAccess(teamId, memberUserId) {
    const normalizedUserId = String(memberUserId || '').trim();
    if (!teamId) throw new Error('Missing team for videographer access');
    if (!normalizedUserId) throw new Error('Team member user ID is required');

    await assertVolunteerScreeningClearedForTeamGrant(teamId, { userId: normalizedUserId });

    const docRef = doc(db, "teams", teamId);
    await updateDoc(docRef, {
        'teamPermissions.videography.mode': 'selected',
        'teamPermissions.videography.memberIds': arrayUnion(normalizedUserId),
        updatedAt: Timestamp.now()
    });
}

export async function revokeVideographerAccess(teamId, memberUserId) {
    const normalizedUserId = String(memberUserId || '').trim();
    if (!teamId) throw new Error('Missing team for videographer access');
    if (!normalizedUserId) throw new Error('Team member user ID is required');

    const docRef = doc(db, "teams", teamId);
    await updateDoc(docRef, {
        'teamPermissions.videography.memberIds': arrayRemove(normalizedUserId),
        updatedAt: Timestamp.now()
    });
}

export async function grantStreamScoreAccess(teamId, memberUserId) {
    const normalizedUserId = String(memberUserId || '').trim();
    if (!teamId) throw new Error('Missing team for Stream & Score access');
    if (!normalizedUserId) throw new Error('Team member user ID is required');

    await assertVolunteerScreeningClearedForTeamGrant(teamId, { userId: normalizedUserId });

    const docRef = doc(db, "teams", teamId);
    const teamSnap = await getDoc(docRef);
    const teamData = teamSnap.exists() ? teamSnap.data() : {};
    const currentStreamingMode = teamData?.teamPermissions?.streaming?.mode;

    const updatePayload = {
        'teamPermissions.scorekeeping.mode': 'selected',
        'teamPermissions.scorekeeping.memberIds': arrayUnion(normalizedUserId),
        'teamPermissions.streaming.memberIds': arrayUnion(normalizedUserId),
        updatedAt: Timestamp.now()
    };

    // Only force streaming mode to 'selected' if it's not currently 'all_confirmed'
    if (currentStreamingMode !== 'all_confirmed') {
        updatePayload['teamPermissions.streaming.mode'] = 'selected';
    }

    await updateDoc(docRef, updatePayload);
}

export async function revokeStreamScoreAccess(teamId, memberUserId) {
    const normalizedUserId = String(memberUserId || '').trim();
    if (!teamId) throw new Error('Missing team for Stream & Score access');
    if (!normalizedUserId) throw new Error('Team member user ID is required');

    const docRef = doc(db, "teams", teamId);
    await updateDoc(docRef, {
        'teamPermissions.scorekeeping.memberIds': arrayRemove(normalizedUserId),
        'teamPermissions.streaming.memberIds': arrayRemove(normalizedUserId),
        updatedAt: Timestamp.now()
    });
}

export async function addOfficial(teamId, officialData) {
    const payload = {
        ...normalizeOfficialDraft(officialData),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    };
    const docRef = await addDoc(collection(db, `teams/${teamId}/officials`), payload);
    return docRef.id;
}

export async function updateOfficial(teamId, officialId, officialData) {
    const payload = {
        ...normalizeOfficialDraft(officialData),
        updatedAt: Timestamp.now()
    };
    await updateDoc(doc(db, "teams", teamId, "officials", officialId), payload);
}

export async function deleteOfficial(teamId, officialId) {
    await deleteDoc(doc(db, "teams", teamId, "officials", officialId));
}

function normalizeTournamentPoolOverrideName(poolName) {
    return String(poolName || '').trim();
}

function collectTournamentPoolOverrideKeys(poolOverrides = {}, poolName) {
    const normalizedPoolName = normalizeTournamentPoolOverrideName(poolName);
    if (!normalizedPoolName) return [];

    const keys = new Set([buildTournamentPoolOverrideKey(normalizedPoolName)]);
    Object.entries(poolOverrides || {}).forEach(([key, override]) => {
        if (normalizeTournamentPoolOverrideName(override?.poolName) === normalizedPoolName) {
            keys.add(key);
        }
    });
    return Array.from(keys);
}

export async function saveTournamentPoolOverride(teamId, override = {}) {
    const poolName = normalizeTournamentPoolOverrideName(override?.poolName);
    if (!teamId || !poolName) {
        throw new Error('Missing teamId or poolName for tournament pool override');
    }

    const teamOrder = Array.isArray(override?.teamOrder)
        ? override.teamOrder.map((teamName) => String(teamName || '').trim()).filter(Boolean)
        : [];

    const teamRef = doc(db, "teams", teamId);
    const teamSnapshot = await getDoc(teamRef);
    const existingOverrides = teamSnapshot.exists() ? (teamSnapshot.data()?.tournamentPoolOverrides || {}) : {};
    const key = buildTournamentPoolOverrideKey(poolName);
    const updatePayload = {
        [`tournamentPoolOverrides.${key}`]: {
            poolName,
            teamOrder,
            finalizedAt: override?.finalizedAt || Timestamp.now(),
            finalizedBy: {
                userId: override?.finalizedBy?.userId || null,
                name: override?.finalizedBy?.name || null,
                email: override?.finalizedBy?.email || null
            }
        }
    };

    collectTournamentPoolOverrideKeys(existingOverrides, poolName)
        .filter((existingKey) => existingKey !== key)
        .forEach((existingKey) => {
            updatePayload[`tournamentPoolOverrides.${existingKey}`] = deleteField();
        });

    await updateTeam(teamId, updatePayload);
}

export async function clearTournamentPoolOverride(teamId, poolName) {
    const normalizedPoolName = normalizeTournamentPoolOverrideName(poolName);
    if (!teamId || !normalizedPoolName) {
        throw new Error('Missing teamId or poolName for tournament pool override clear');
    }

    const teamRef = doc(db, "teams", teamId);
    const teamSnapshot = await getDoc(teamRef);
    const existingOverrides = teamSnapshot.exists() ? (teamSnapshot.data()?.tournamentPoolOverrides || {}) : {};
    const keysToDelete = collectTournamentPoolOverrideKeys(existingOverrides, normalizedPoolName);
    if (!keysToDelete.length) return;

    const updatePayload = {};
    keysToDelete.forEach((key) => {
        updatePayload[`tournamentPoolOverrides.${key}`] = deleteField();
    });

    await updateTeam(teamId, updatePayload);
}

export async function addTeamAdminEmail(teamId, email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
        throw new Error('Admin email is required');
    }

    await assertVolunteerScreeningClearedForTeamGrant(teamId, { email: normalizedEmail });

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
    const forbidden = [
        'medicalInfo', 'medical_info', 'medicalNotes', 'medical_notes',
        'emergencyContact', 'emergency_contact', 'emergencyContactName', 'emergencyContactPhone',
        'parents', 'parent', 'parentEmail', 'parentPhone', 'parentRelation',
        'guardian', 'guardians', 'guardianEmail', 'guardianPhone', 'guardianRelation',
        'householdContact', 'householdContacts', 'householdEmail', 'householdPhone', 'householdRelation'
    ];
    const present = forbidden.filter(k => Object.prototype.hasOwnProperty.call(playerData, k));
    const rosterFieldSources = ['rosterFieldValues', 'customFields', 'profileFields', 'extraFields'];
    rosterFieldSources.forEach((sourceKey) => {
        const source = playerData[sourceKey];
        if (!source || typeof source !== 'object') return;
        forbidden.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                present.push(`${sourceKey}.${key}`);
            }
        });
    });
    if (present.length) {
        throw new Error(`Do not write sensitive fields to public player doc: ${present.join(', ')}`);
    }
}

export async function getRosterFieldDefinitions(teamId, team = null) {
    const teamFields = team?.rosterFields || team?.rosterProfileFields || team?.playerProfileFields || team?.customRosterFields || [];

    const fieldsByKey = new Map();
    if (Array.isArray(teamFields)) {
        teamFields.forEach((field, index) => {
            try {
                const normalized = buildRosterFieldDefinitionPayload(field, index);
                fieldsByKey.set(normalized.key, { ...field, key: normalized.key });
            } catch (e) {
                // Skip malformed legacy team-level definitions.
            }
        });
    }

    try {
        const snapshot = await getDocs(collection(db, `teams/${teamId}/rosterFields`));
        snapshot.docs.forEach((docSnap) => {
            fieldsByKey.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
        });
    } catch (e) {
        console.warn('Failed to load roster field definitions from subcollection:', e);
    }

    return Array.from(fieldsByKey.values());
}

export async function saveRosterFieldDefinition(teamId, field) {
    const payload = buildRosterFieldDefinitionPayload(field);
    const fieldRef = doc(db, `teams/${teamId}/rosterFields`, payload.key);
    await setDoc(fieldRef, {
        ...payload,
        updatedAt: Timestamp.now()
    }, { merge: true });
    return { id: payload.key, ...payload };
}

export async function disableRosterFieldDefinition(teamId, fieldId) {
    await setDoc(doc(db, `teams/${teamId}/rosterFields`, fieldId), {
        key: fieldId,
        active: false,
        updatedAt: Timestamp.now()
    }, { merge: true });
}

export async function reorderRosterFieldDefinitions(teamId, fields = []) {
    const batch = writeBatch(db);
    fields.forEach((field, index) => {
        const fieldId = field.id || field.key;
        if (!fieldId) return;
        batch.set(doc(db, `teams/${teamId}/rosterFields`, fieldId), {
            key: fieldId,
            sortOrder: index,
            updatedAt: Timestamp.now()
        }, { merge: true });
    });
    await batch.commit();
}

export async function getOfficials(teamId) {
    const mapOfficial = (docSnap) => ({ id: docSnap.id, ...docSnap.data() });
    try {
        const q = query(collection(db, `teams/${teamId}/officials`), orderBy('name'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(mapOfficial);
    } catch (e) {
        const code = e?.code || '';
        if (code !== 'failed-precondition') throw e;
        const snapshot = await getDocs(collection(db, `teams/${teamId}/officials`));
        return snapshot.docs
            .map(mapOfficial)
            .sort((a, b) => String(a.name || a.displayName || a.email || '').localeCompare(String(b.name || b.displayName || b.email || '')));
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

function playerHasRosterContactFields(player = {}) {
    return Boolean(
        (Array.isArray(player?.parents) && player.parents.length > 0) ||
        String(player?.parentEmail || '').trim() ||
        String(player?.guardianEmail || '').trim() ||
        String(player?.parentUserId || '').trim() ||
        String(player?.guardianUserId || '').trim()
    );
}

async function mergePlayerPrivateProfileParents(teamId, players = []) {
    const rosterPlayers = Array.isArray(players) ? players : [];
    return Promise.all(rosterPlayers.map(async (player) => {
        if (!player?.id || playerHasRosterContactFields(player)) return player;
        try {
            const privateProfile = await getPlayerPrivateProfile(teamId, player.id);
            const privateParents = Array.isArray(privateProfile?.parents) ? privateProfile.parents : [];
            if (privateParents.length === 0) return player;
            return {
                ...player,
                privateProfileParents: privateParents
            };
        } catch (error) {
            if (error?.code === 'permission-denied') return player;
            throw error;
        }
    }));
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

export async function copySelectedPlayersForTeamRollover(sourceTeamId, targetTeamId, selectedPlayerIds = []) {
    const sourceId = String(sourceTeamId || '').trim();
    const targetId = String(targetTeamId || '').trim();
    const selectedIds = new Set((selectedPlayerIds || []).map(id => String(id || '').trim()).filter(Boolean));

    if (!sourceId) throw new Error('Choose a source team to copy players from.');
    if (!targetId) throw new Error('New team is required before copying players.');
    if (sourceId === targetId) throw new Error('Choose a different source team for roster rollover.');
    if (selectedIds.size === 0) return { copiedCount: 0 };

    const sourcePlayers = await getPlayers(sourceId);
    const playersToCopy = sourcePlayers.filter(player => selectedIds.has(String(player.id || '')));
    if (playersToCopy.length !== selectedIds.size) {
        throw new Error('One or more selected players could not be found on the source team. Refresh and try again.');
    }

    const batch = writeBatch(db);
    const rolledOverAt = Timestamp.now();
    playersToCopy.forEach((player) => {
        const playerCopy = buildRolloverPlayerCopy(player, sourceId, rolledOverAt);
        assertNoSensitivePlayerFields(playerCopy);
        playerCopy.createdAt = Timestamp.now();
        const targetRef = doc(collection(db, `teams/${targetId}/players`));
        batch.set(targetRef, playerCopy);
    });

    await batch.commit();
    return { copiedCount: playersToCopy.length };
}

export async function updatePlayer(teamId, playerId, playerData) {
    assertNoSensitivePlayerFields(playerData);
    playerData.updatedAt = Timestamp.now();
    await updateDoc(doc(db, `teams/${teamId}/players`, playerId), playerData);
}

export async function setPlayerPrivateRosterProfileFields(teamId, playerId, rosterFields = {}) {
    await setDoc(doc(db, `teams/${teamId}/players/${playerId}/private/profile`), {
        rosterFields,
        updatedAt: Timestamp.now()
    }, { merge: true });
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

function sortRegistrationReviews(registrations = []) {
    return [...registrations].sort((a, b) => {
        const aTime = a?.submittedAt?.toMillis ? a.submittedAt.toMillis() : (a?.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a?.submittedAt || a?.createdAt || 0).getTime());
        const bTime = b?.submittedAt?.toMillis ? b.submittedAt.toMillis() : (b?.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b?.submittedAt || b?.createdAt || 0).getTime());
        return bTime - aTime;
    });
}

export async function listTeamTrackingItems(teamId) {
    const itemsRef = collection(db, `teams/${teamId}/trackingItems`);
    const snapshot = await getDocs(itemsRef);
    return snapshot.docs
        .map((docSnap) => {
            const data = docSnap.data();
            return {
                id: docSnap.id,
                ...data,
                title: data.title || data.name || ''
            };
        })
        .filter((item) => item.active !== false && item.archived !== true && (!item.status || item.status === 'active') && (!item.scope || item.scope === 'players'))
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

export async function createTeamTrackingItem(teamId, itemData = {}) {
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId) {
        throw new Error('You must be signed in to create tracking items');
    }

    const name = String(itemData.name || itemData.title || '').trim();
    if (!name) {
        throw new Error('Tracking item title is required');
    }

    const itemsRef = collection(db, `teams/${teamId}/trackingItems`);
    const docRef = await addDoc(itemsRef, {
        teamId,
        name,
        description: itemData.description || '',
        visibility: itemData.visibility || 'private',
        status: 'active',
        active: true,
        archived: false,
        createdAt: serverTimestamp(),
        createdBy: currentUserId,
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId
    });
    return docRef.id;
}

export async function listTeamTrackingStatuses(teamId, trackingItemId) {
    const statusesRef = collection(db, `teams/${teamId}/trackingItems/${trackingItemId}/memberTracking`);
    const snapshot = await getDocs(statusesRef);
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function setTeamTrackingStatus(teamId, trackingItemId, playerId, statusData) {
    const statusRef = doc(db, `teams/${teamId}/trackingItems/${trackingItemId}/memberTracking/${playerId}`);
    await setDoc(statusRef, {
        ...statusData,
        teamId,
        trackingItemId,
        playerId,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

export async function listTeamRegistrationForms(teamId) {
    if (!teamId) return [];
    const snapshot = await getDocs(collection(db, `teams/${teamId}/registrationForms`));
    return snapshot.docs
        .map((formDoc) => ({ id: formDoc.id, ...formDoc.data() }))
        .sort((a, b) => String(a.name || a.title || a.id).localeCompare(String(b.name || b.title || b.id)));
}

export async function getTeamRegistrationForm(teamId, formId) {
    if (!teamId || !formId) return null;
    const formSnap = await getDoc(doc(db, 'teams', teamId, 'registrationForms', formId));
    if (!formSnap.exists()) return null;
    return {
        id: formSnap.id,
        ...formSnap.data()
    };
}

export async function listTeamRegistrationReviews(teamId, formId, status = 'all') {
    if (!teamId || !formId) return [];
    const snapshot = await getDocs(collection(db, `teams/${teamId}/registrationForms/${formId}/registrations`));
    return sortRegistrationReviews(snapshot.docs.map((registrationDoc) => {
        const registration = {
            id: registrationDoc.id,
            formId,
            teamId,
            ...registrationDoc.data()
        };
        return {
            ...registration,
            reviewSummary: summarizeRegistration(registration)
        };
    })).filter((registration) => matchesRegistrationReviewStatus(registration, status));
}

export async function listTeamRegistrationReviewsPage(teamId, formId, { status = 'all', pageSize = 25, afterDoc = null } = {}) {
    if (!teamId || !formId) return { registrations: [], lastDoc: null, hasMore: false };
    const collectionRef = collection(db, `teams/${teamId}/registrationForms/${formId}/registrations`);
    const constraints = [];
    if (status !== 'all') {
        constraints.push(where('status', '==', status));
    }
    constraints.push(orderBy('submittedAt', 'desc'));
    constraints.push(limit(pageSize));
    if (afterDoc) {
        constraints.push(startAfter(afterDoc));
    }
    const snapshot = await getDocs(query(collectionRef, ...constraints));
    return {
        registrations: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
        lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
        hasMore: snapshot.docs.length === pageSize
    };
}

async function getExistingGuardianUsers(guardians = []) {
    const lookups = guardians
        .map((guardian) => guardian.email)
        .filter(Boolean)
        .map(async (email) => getUserByEmail(email).catch(() => null));
    return (await Promise.all(lookups)).filter(Boolean);
}

export async function approveTeamRegistration(teamId, formId, registrationId, options = {}) {
    const currentUser = auth.currentUser;
    if (!currentUser?.uid) {
        throw new Error('You must be signed in to approve registrations');
    }
    if (!teamId || !formId || !registrationId) {
        throw new Error('Team, form, and registration are required');
    }

    const registrationRef = doc(db, `teams/${teamId}/registrationForms/${formId}/registrations`, registrationId);
    const teamRef = doc(db, 'teams', teamId);
    const [registrationSnap, teamSnap] = await Promise.all([
        getDoc(registrationRef),
        getDoc(teamRef)
    ]);
    if (!registrationSnap.exists()) throw new Error('Registration not found');
    if (!teamSnap.exists()) throw new Error('Team not found');

    const registration = { id: registrationId, formId, teamId, ...registrationSnap.data() };
    const reviewStatus = normalizeRegistrationStatus(registration.status);
    if (!['pending', 'offer-accepted'].includes(reviewStatus)) {
        throw new Error('Only pending or offer accepted registrations can be approved');
    }

    const team = { id: teamId, ...teamSnap.data() };
    const guardians = getRegistrationGuardianDrafts(registration);
    const existingGuardianUsers = await getExistingGuardianUsers(guardians);
    const existingGuardianByEmail = new Map(existingGuardianUsers.map((user) => [String(user.email || '').toLowerCase(), user]));
    const now = Timestamp.now();
    let playerRef = null;
    let existingPlayer = null;
    const selectedPlayerId = String(options.playerId || registration.linkedPlayerId || registration.playerId || '').trim();

    if (selectedPlayerId) {
        playerRef = doc(db, `teams/${teamId}/players`, selectedPlayerId);
        const playerSnap = await getDoc(playerRef);
        if (!playerSnap.exists()) throw new Error('Selected player not found');
        existingPlayer = { id: playerSnap.id, ...playerSnap.data() };
    } else {
        playerRef = doc(collection(db, `teams/${teamId}/players`));
    }

    const decision = buildRegistrationRosterDecision({
        registration,
        team,
        playerId: playerRef.id,
        rosterDestinationType: existingPlayer ? 'existing-player' : 'new-player',
        reviewer: {
            userId: currentUser.uid,
            email: currentUser.email || '',
            name: currentUser.displayName || currentUser.email || 'Admin'
        },
        now,
        decisionNote: options.decisionNote || ''
    });
    const playerDraft = getRegistrationPlayerDraft(registration);
    assertNoSensitivePlayerFields(playerDraft);

    const guardianLinks = guardians.map((guardian) => {
        const user = guardian.email ? existingGuardianByEmail.get(guardian.email) : null;
        return {
            userId: user?.id || null,
            email: guardian.email || user?.email || '',
            name: guardian.name || user?.fullName || user?.displayName || guardian.email || 'Guardian',
            relation: guardian.relation || 'Guardian',
            phone: guardian.phone || '',
            linkedAt: now,
            source: 'registration'
        };
    });
    const existingParents = Array.isArray(existingPlayer?.parents) ? existingPlayer.parents : [];
    const existingParentKeys = new Set(existingParents.map((parent) => parent?.userId || parent?.email).filter(Boolean));
    const mergedParents = [
        ...existingParents,
        ...guardianLinks.filter((guardian) => !existingParentKeys.has(guardian.userId || guardian.email))
    ];

    const batch = writeBatch(db);
    const playerUpdate = {
        ...decision.player,
        parents: mergedParents,
        updatedAt: now
    };
    if (existingPlayer) {
        batch.set(playerRef, playerUpdate, { merge: true });
    } else {
        batch.set(playerRef, {
            ...playerUpdate,
            createdAt: now
        });
    }

    batch.update(registrationRef, {
        ...decision.registrationUpdate,
        activeWaitlistDemand: false,
        linkedPlayerId: playerRef.id,
        guardianLinks,
        updatedAt: now
    });
    await batch.commit();

    return { success: true, playerId: playerRef.id, linkedGuardians: guardianLinks.length };
}

export async function updateTeamRegistrationWaitlistStatus(teamId, formId, registrationId, status, decisionNote = '') {
    const currentUser = auth.currentUser;
    if (!currentUser?.uid) {
        throw new Error('You must be signed in to manage waitlist registrations');
    }
    if (!teamId || !formId || !registrationId) {
        throw new Error('Team, form, and registration are required');
    }
    const registrationRef = doc(db, `teams/${teamId}/registrationForms/${formId}/registrations`, registrationId);
    const registrationSnap = await getDoc(registrationRef);
    if (!registrationSnap.exists()) throw new Error('Registration not found');
    const now = Timestamp.now();
    const update = buildRegistrationStatusUpdate({
        registration: { id: registrationId, formId, teamId, ...registrationSnap.data() },
        status,
        reviewer: {
            userId: currentUser.uid,
            email: currentUser.email || '',
            name: currentUser.displayName || currentUser.email || 'Admin'
        },
        now,
        decisionNote
    });
    await updateDoc(registrationRef, update);
    return { success: true, status: update.status };
}

export function extendTeamRegistrationOffer(teamId, formId, registrationId, decisionNote = '') {
    return updateTeamRegistrationWaitlistStatus(teamId, formId, registrationId, 'offer-extended', decisionNote);
}

export function releaseTeamRegistrationWaitlist(teamId, formId, registrationId, decisionNote = '') {
    return updateTeamRegistrationWaitlistStatus(teamId, formId, registrationId, 'released', decisionNote);
}

export async function rejectTeamRegistration(teamId, formId, registrationId, decisionNote = '') {
    const currentUser = auth.currentUser;
    if (!currentUser?.uid) {
        throw new Error('You must be signed in to reject registrations');
    }
    if (!teamId || !formId || !registrationId) {
        throw new Error('Team, form, and registration are required');
    }
    const registrationRef = doc(db, `teams/${teamId}/registrationForms/${formId}/registrations`, registrationId);
    const registrationSnap = await getDoc(registrationRef);
    if (!registrationSnap.exists()) throw new Error('Registration not found');
    const currentStatus = normalizeRegistrationStatus(registrationSnap.data()?.status);
    if (!['pending', 'waitlisted', 'offer-extended', 'offer-accepted'].includes(currentStatus)) {
        throw new Error('Only pending, waitlisted, or active offer registrations can be rejected');
    }
    const now = Timestamp.now();
    await updateDoc(registrationRef, {
        status: 'rejected',
        activeWaitlistDemand: false,
        decidedAt: now,
        decidedBy: currentUser.uid,
        decidedByName: currentUser.displayName || currentUser.email || 'Admin',
        decisionNote: String(decisionNote || '').trim(),
        updatedAt: now
    });
    return { success: true };
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
        await syncPublicUserProfile(parentUserId);
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
        if (hasParentLink(userData, teamId, requestData.playerId)) {
            throw new Error('Requester already has access to this player');
        }
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
    const gamesRef = getTeamGameCollectionRef(teamId);
    let teamGames = [];
    try {
        const q = query(gamesRef, orderBy("date"));
        const snapshot = await getDocs(q);
        teamGames = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        // Fallback when indexes are still building or unavailable.
        const snapshot = await getDocs(gamesRef);
        teamGames = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    let sharedGames = [];
    try {
        sharedGames = await getSharedGamesForTeam(teamId);
    } catch (error) {
        console.warn('[getGames] Failed to load shared games for team', teamId, error);
    }

    return mergeGamesForTeam(teamGames, sharedGames, teamId);
}

export async function getAggregatedStatsForGames(teamId, gameIds) {
    const totalsByPlayer = {};
    const validGameIds = Array.isArray(gameIds) ? gameIds.filter(Boolean) : [];
    if (validGameIds.length === 0) return totalsByPlayer;

    const snapshots = await Promise.all(
        validGameIds.map(gameId =>
            getDocs(getGameSubcollectionRef(teamId, gameId, 'aggregatedStats'))
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

export async function getTeamStatsForGame(teamId, gameId) {
    try {
        const docRef = doc(db, `${getGameDocRef(teamId, gameId).path}/teamStats`, 'team');
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return {};
        const data = docSnap.data() || {};
        return data.stats || {};
    } catch (error) {
        console.error('[getTeamStatsForGame] failed to load team stats', {
            teamId,
            gameId,
            error,
        });
        throw new Error(`Unable to load team stats: ${error.message}`);
    }
}

export async function getAggregatedStatsForPlayer(teamId, gameId, playerId) {
    try {
        const docRef = doc(db, `${getGameDocRef(teamId, gameId).path}/aggregatedStats`, playerId);
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
    const docRef = getGameDocRef(teamId, gameId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (isSharedGameSyntheticId(gameId)) {
            return projectSharedGameForTeam({
                id: docSnap.id,
                ...data,
                _sharedGamePath: docRef.path
            }, teamId) || {
                id: gameId,
                ...data,
                sharedGameId: docSnap.id,
                sharedGamePath: docRef.path,
                isSharedGame: true
            };
        }
        return {
            id: docSnap.id,
            ...data
        };
    } else {
        return null;
    }
}

export function subscribeGame(teamId, gameId, callback, onError) {
    const docRef = getGameDocRef(teamId, gameId);
    return onSnapshot(docRef, (snapshot) => {
        if (!snapshot.exists()) {
            callback(null);
            return;
        }
        const data = snapshot.data();
        if (isSharedGameSyntheticId(gameId)) {
            callback(projectSharedGameForTeam({
                id: snapshot.id,
                ...data,
                _sharedGamePath: docRef.path
            }, teamId) || {
                id: gameId,
                ...data,
                sharedGameId: snapshot.id,
                sharedGamePath: docRef.path,
                isSharedGame: true
            });
            return;
        }
        callback({
            id: snapshot.id,
            ...data
        });
    }, onError);
}

export async function getGameEvents(teamId, gameId, { limit = 50 } = {}) {
    const q = query(
        getGameSubcollectionRef(teamId, gameId, 'events'),
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
    let createdCounterpartRef = null;

    if (counterpartRef && counterpartGameId) {
        await updateDoc(counterpartRef, mirrorPayload);
    } else {
        const newCounterpartRef = await addDoc(collection(db, `teams/${counterpartTeamId}/games`), mirrorPayload);
        counterpartGameId = newCounterpartRef.id;
        createdCounterpartRef = newCounterpartRef;
    }

    try {
        await updateDoc(sourceRef, buildSharedScheduleSourceUpdate({
            sharedScheduleId,
            counterpartTeamId,
            counterpartGameId
        }));
    } catch (error) {
        if (createdCounterpartRef) {
            try {
                await deleteDoc(createdCounterpartRef);
            } catch (rollbackError) {
                console.warn('Failed to roll back shared schedule counterpart:', rollbackError);
            }
        }
        throw error;
    }
}

export async function addGame(teamId, gameData) {
    gameData.createdAt = Timestamp.now();
    gameData.createdBy = gameData.createdBy || auth.currentUser?.uid || null;
    const docRef = await addDoc(getTeamGameCollectionRef(teamId), gameData);
    if (shouldMirrorSharedGame(gameData, teamId)) {
        try {
            await syncSharedScheduleCounterpart(teamId, docRef.id, { ...gameData, id: docRef.id });
        } catch (error) {
            console.warn('Failed to create shared schedule counterpart:', error);
            try {
                await deleteDoc(docRef);
            } catch (rollbackError) {
                console.warn('Failed to roll back shared schedule source game:', rollbackError);
            }
            const detail = error?.message ? ` ${error.message}` : '';
            throw new Error(`Shared matchup was not fully published.${detail}`);
        }
    }
    return docRef.id;
}

export async function saveGamePlan(teamId, gameId, gamePlan) {
    const docRef = getTeamGameDocRef(teamId, gameId);
    await updateDoc(docRef, { gamePlan });
}

export async function updateGame(teamId, gameId, gameData) {
    const previousGame = await getGame(teamId, gameId);
    const docRef = getGameDocRef(teamId, gameId);
    await updateDoc(docRef, gameData);
    if (isSharedGameSyntheticId(gameId)) {
        return;
    }
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

export async function applyTournamentAdvancementPatches(teamId, patches = [], existingGames = []) {
    const safePatches = Array.isArray(patches) ? patches.filter((patch) => patch?.gameId && patch?.tournament) : [];
    if (!safePatches.length) return 0;

    const existingGamesById = new Map((existingGames || []).filter((game) => game?.id).map((game) => [game.id, game]));
    const maxBatchOperations = 450;

    for (let i = 0; i < safePatches.length; i += maxBatchOperations) {
        const batch = writeBatch(db);
        safePatches.slice(i, i + maxBatchOperations).forEach(({ gameId, tournament }) => {
            const existingGame = existingGamesById.get(gameId);
            batch.update(getGameDocRef(teamId, gameId), {
                tournament: {
                    ...(existingGame?.tournament || {}),
                    ...tournament
                }
            });
        });
        await batch.commit();
    }

    return safePatches.length;
}

export async function deleteGame(teamId, gameId) {
    const existingGame = await getGame(teamId, gameId);
    await deleteDoc(getGameDocRef(teamId, gameId));
    if (!isSharedGameSyntheticId(gameId) && existingGame?.sharedScheduleId) {
        await deleteSharedScheduleCounterpart(existingGame);
    }
}

// Brackets
export async function getBrackets(teamId, options = {}) {
    const onlyPublished = !!options.onlyPublished;
    const bracketsRef = collection(db, `teams/${teamId}/brackets`);
    let brackets = [];
    try {
        const q = onlyPublished
            ? query(bracketsRef, where('status', '==', 'published'), orderBy("createdAt", "desc"))
            : query(bracketsRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        brackets = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    } catch (error) {
        const fallbackQuery = onlyPublished
            ? query(bracketsRef, where('status', '==', 'published'))
            : bracketsRef;
        const snapshot = await getDocs(fallbackQuery);
        brackets = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    }

    if (onlyPublished) {
        return brackets.filter(bracket => bracket.status === 'published');
    }
    return brackets;
}

export async function getBracket(teamId, bracketId) {
    const bracketRef = doc(db, `teams/${teamId}/brackets`, bracketId);
    const snapshot = await getDoc(bracketRef);
    if (!snapshot.exists()) return null;
    return { id: snapshot.id, ...snapshot.data() };
}

export async function addBracket(teamId, bracketData) {
    const payload = {
        ...bracketData,
        format: bracketData?.format || 'single_elimination',
        status: bracketData?.status || 'draft',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    };
    const bracketRef = await addDoc(collection(db, `teams/${teamId}/brackets`), payload);
    return bracketRef.id;
}

export async function updateBracket(teamId, bracketId, bracketData) {
    const bracketRef = doc(db, `teams/${teamId}/brackets`, bracketId);
    await updateDoc(bracketRef, {
        ...bracketData,
        updatedAt: Timestamp.now()
    });
}

export async function publishBracket(teamId, bracketId, options) {
    const bracketRef = doc(db, `teams/${teamId}/brackets`, bracketId);
    const bracketSnapshot = await getDoc(bracketRef);
    if (!bracketSnapshot.exists()) {
        throw new Error('Bracket not found');
    }

    const publishOptions = options || {};
    const existingBracket = { id: bracketSnapshot.id, ...bracketSnapshot.data() };
    const publishedAt = Timestamp.now();
    const publishedBy = publishOptions.publishedBy || auth?.currentUser?.uid || null;
    const publishedBracket = {
        ...existingBracket,
        status: 'published',
        publishedBy,
        publishedAt: publishedAt
    };
    const publishedView = buildPublishedBracketView(publishedBracket);

    await updateDoc(bracketRef, {
        status: 'published',
        publishedAt: publishedAt,
        publishedBy,
        publishedView,
        updatedAt: Timestamp.now()
    });

    return {
        ...publishedBracket,
        publishedView
    };
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
    const events = (await getGames(teamId)).map((event) => normalizeEvent(event));

    if (options.type && options.type !== 'all') {
        return events.filter(e => e.type === options.type);
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
    eventData.createdBy = eventData.createdBy || auth.currentUser?.uid || null;
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
    return snapshot.docs.map(doc => normalizeStatTrackerConfig({ id: doc.id, ...doc.data() }));
}

export async function createConfig(teamId, configData) {
    const normalizedConfig = normalizeStatTrackerConfig(configData);
    normalizedConfig.createdAt = Timestamp.now();
    const docRef = await addDoc(collection(db, `teams/${teamId}/statTrackerConfigs`), normalizedConfig);
    return docRef.id;
}

export async function updateConfig(teamId, configId, configData) {
    const normalizedConfig = normalizeStatTrackerConfig(configData);
    normalizedConfig.updatedAt = Timestamp.now();
    await updateDoc(doc(db, `teams/${teamId}/statTrackerConfigs`, configId), normalizedConfig);
}

// Backwards-compat helper: older pages import addConfig
// Route through createConfig so default templates can be created without breaking
export async function addConfig(teamId, configData) {
    return createConfig(teamId, configData);
}

export async function deleteConfig(teamId, configId) {
    const referencingGames = await getDocs(query(
        collection(db, `teams/${teamId}/games`),
        where("statTrackerConfigId", "==", configId),
        limit(1)
    ));
    if (!referencingGames.empty || await hasSharedGameUsingConfig(teamId, configId)) {
        throw new Error('This config is still assigned to one or more games. Remove it from those games before deleting the config.');
    }
    await deleteDoc(doc(db, `teams/${teamId}/statTrackerConfigs`, configId));
}

function isResetBlockingLocalGameAssignment(game = {}) {
    const status = String(game?.status || '').toLowerCase();
    const liveStatus = String(game?.liveStatus || '').toLowerCase();

    if (status === 'completed' || status === 'final' || status === 'cancelled' || liveStatus === 'completed') {
        return false;
    }

    return Boolean(String(game?.statTrackerConfigId || '').trim());
}

async function hasResetBlockingLocalGameUsingConfig(teamId, configId) {
    const referencingGames = await getDocs(query(
        collection(db, `teams/${teamId}/games`),
        where("statTrackerConfigId", "==", configId)
    ));

    return referencingGames.docs.some((gameDoc) => isResetBlockingLocalGameAssignment(gameDoc.data()));
}

async function hasResetBlockingSharedGameUsingConfig(teamId, configId) {
    const sharedGamesRef = collectionGroup(db, 'sharedGames');
    const queries = [
        query(sharedGamesRef, where('homeTeamId', '==', teamId), where('statTrackerConfigId', '==', configId)),
        query(sharedGamesRef, where('awayTeamId', '==', teamId), where('statTrackerConfigId', '==', configId)),
        query(sharedGamesRef, where('teamIds', 'array-contains', teamId), where('statTrackerConfigId', '==', configId))
    ];

    const snapshots = await Promise.allSettled(queries.map((q) => getDocs(q)));
    return snapshots.some((result) => (
        result.status === 'fulfilled'
        && result.value.docs.some((gameDoc) => isResetBlockingLocalGameAssignment(gameDoc.data()))
    ));
}

export async function resetTeamStatConfigs(teamId) {
    const configs = await getConfigs(teamId);

    for (const config of configs) {
        if (await hasResetBlockingLocalGameUsingConfig(teamId, config.id) || await hasResetBlockingSharedGameUsingConfig(teamId, config.id)) {
            throw new Error('One or more stat configs are still assigned to scheduled or shared games. Remove those assignments before resetting the stats setup.');
        }
    }

    const batch = writeBatch(db);
    configs.forEach((config) => {
        batch.delete(doc(db, `teams/${teamId}/statTrackerConfigs`, config.id));
    });

    await batch.commit();
    return configs.length;
}

// Stats
export async function logStatEvent(teamId, gameId, eventData) {
    eventData.timestamp = Timestamp.now();
    await addDoc(getGameSubcollectionRef(teamId, gameId, 'events'), eventData);
}

export async function updatePlayerStats(teamId, gameId, playerId, statKey, change, playerName, playerNumber, options = {}) {
    const normalizedStatKey = String(statKey || '').trim().toLowerCase();
    const split = splitPlayerStatsByVisibility(options.statTrackerConfig || {}, { [normalizedStatKey]: change });
    const subcollectionName = Object.prototype.hasOwnProperty.call(split.privateStats, normalizedStatKey) ? 'privatePlayerStats' : 'aggregatedStats';
    const docRef = doc(db, `${getGameDocRef(teamId, gameId).path}/${subcollectionName}`, playerId);
    await setDoc(docRef, {
        playerName,
        playerNumber,
        stats: {
            [normalizedStatKey]: increment(change)
        }
    }, { merge: true });
}

export async function setCompletedGamePlayerStats(teamId, gameId, playerId, statsPayload = {}) {
    const { publicStats, privateStats } = splitPlayerStatsByVisibility(
        statsPayload.statTrackerConfig || {},
        statsPayload.stats || {}
    );
    const basePayload = {
        playerName: statsPayload.playerName || '',
        playerNumber: statsPayload.playerNumber || '',
        timeMs: Number.isFinite(Number(statsPayload.timeMs)) ? Number(statsPayload.timeMs) : 0,
        didNotPlay: statsPayload.didNotPlay === true
    };
    const gameRef = getGameDocRef(teamId, gameId);
    const publicDocRef = doc(db, `${gameRef.path}/aggregatedStats`, playerId);
    const privateDocRef = doc(db, `${gameRef.path}/privatePlayerStats`, playerId);

    await setDoc(publicDocRef, {
        ...basePayload,
        stats: publicStats
    }, { merge: true });

    if (Object.keys(privateStats).length > 0) {
        await setDoc(privateDocRef, {
            ...basePayload,
            stats: privateStats
        }, { merge: true });
    }
}

export async function setCompletedGameTeamStats(teamId, gameId, statsPayload = {}) {
    const docRef = doc(db, `${getGameDocRef(teamId, gameId).path}/teamStats`, 'team');
    await setDoc(docRef, {
        stats: statsPayload.stats || {},
        updatedAt: serverTimestamp()
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

export function getTrackedCalendarEventUidsFromGames(games = []) {
    return games
        .filter(game => game.calendarEventUid)
        .map(game => game.calendarEventUid);
}

export async function getTrackedCalendarEventUids(teamId, preloadedGames = null) {
    const games = Array.isArray(preloadedGames) ? preloadedGames : await getGames(teamId);
    return getTrackedCalendarEventUidsFromGames(games);
}

// Access Codes
const ACCESS_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars like 0, O, I, 1
const ACCESS_CODE_LENGTH = 8;
const ACCESS_CODE_MAX_ATTEMPTS = 5;

function getCryptoRandomValues(length) {
    const cryptoApi = globalThis.crypto || globalThis.msCrypto;
    if (!cryptoApi?.getRandomValues) {
        throw new Error('Secure random number generation is not available in this browser.');
    }

    const values = new Uint8Array(length);
    cryptoApi.getRandomValues(values);
    return values;
}

export function generateAccessCode() {
    const maxUnbiasedValue = Math.floor(256 / ACCESS_CODE_CHARS.length) * ACCESS_CODE_CHARS.length;
    let code = '';

    while (code.length < ACCESS_CODE_LENGTH) {
        const randomValues = getCryptoRandomValues(ACCESS_CODE_LENGTH - code.length);
        for (const value of randomValues) {
            if (value >= maxUnbiasedValue) {
                continue;
            }
            code += ACCESS_CODE_CHARS.charAt(value % ACCESS_CODE_CHARS.length);
            if (code.length === ACCESS_CODE_LENGTH) {
                break;
            }
        }
    }

    return code;
}

async function createUniqueAccessCode(accessCodeData, preferredCode) {
    for (let attempt = 0; attempt < ACCESS_CODE_MAX_ATTEMPTS; attempt += 1) {
        const candidateCode = String(attempt === 0 && preferredCode ? preferredCode : generateAccessCode()).trim().toUpperCase();
        if (!candidateCode) {
            continue;
        }

        const codeRef = doc(db, "accessCodes", candidateCode);
        const created = await runTransaction(db, async (transaction) => {
            const codeSnapshot = await transaction.get(codeRef);
            if (codeSnapshot.exists()) {
                return null;
            }

            const payload = {
                ...accessCodeData,
                code: candidateCode
            };
            transaction.set(codeRef, payload);
            return {
                id: codeRef.id || candidateCode,
                code: candidateCode
            };
        });

        if (created) {
            return created;
        }
    }

    throw new Error('Could not generate a unique invite code. Please try again.');
}

export async function createAccessCode(userId, email, phone, code) {
    const accessCodeData = {
        generatedBy: userId,
        email: email || null,
        phone: phone || null,
        createdAt: Timestamp.now(),
        used: false,
        usedBy: null,
        usedAt: null
    };
    return createUniqueAccessCode(accessCodeData, code);
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

export async function getTeamAccessCodes(teamId) {
    const normalizedTeamId = String(teamId || '').trim();
    if (!normalizedTeamId) {
        return [];
    }

    const q = query(
        collection(db, "accessCodes"),
        where("teamId", "==", normalizedTeamId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function validateAccessCode(code) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) {
        return { valid: false, message: "Invalid access code" };
    }

    const callable = httpsCallable(functions, 'validateAccessCodeForAcceptance');
    const response = await callable({ code: normalizedCode });
    const payload = response?.data || response;
    return payload && typeof payload === 'object'
        ? payload
        : { valid: false, message: "Invalid access code" };
}

async function getValidatedAccessCodeDoc(code) {
    const validation = await validateAccessCode(code);
    if (!validation?.valid || !validation.codeId) {
        throw new Error(validation?.message || 'Invalid or used code');
    }

    const codeSnapshot = await getDoc(doc(db, "accessCodes", validation.codeId));
    if (!codeSnapshot.exists()) {
        throw new Error("Invalid or used code");
    }

    return codeSnapshot;
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

    const userRef = doc(db, "users", userId);
    const codeRef = doc(db, "accessCodes", codeId);
    let userGrantApplied = false;
    let userAlreadyCoachedTeam = false;
    let userAlreadyHadCoachRole = false;
    let resolvedTeamId = String(teamId || '').trim();
    try {
        const [codeSnapshot, userSnapshot] = await Promise.all([
            getDoc(codeRef),
            getDoc(userRef)
        ]);

        if (!codeSnapshot.exists()) {
            throw new Error('Access code not found for admin invite persistence');
        }

        const codeData = codeSnapshot.data() || {};
        if (codeData.type !== 'admin_invite') {
            throw new Error('Access code is not an admin invite');
        }

        resolvedTeamId = String(codeData.teamId || '').trim();
        if (!resolvedTeamId) {
            throw new Error('Admin invite is missing teamId');
        }
        if (teamId && resolvedTeamId !== teamId) {
            throw new Error('Access code team does not match admin invite target');
        }

        const teamRef = doc(db, "teams", resolvedTeamId);
        const teamSnapshot = await getDoc(teamRef);
        if (!teamSnapshot.exists()) {
            throw new Error('Team not found for admin invite persistence');
        }

        const invitedEmail = String(codeData.email || '').trim().toLowerCase();
        if (!invitedEmail) {
            throw new Error('Admin invite is missing invited email');
        }

        if (normalizedEmail !== invitedEmail) {
            throw new Error('Admin invite email does not match signed-in user');
        }

        if (codeData.used === true) {
            throw new Error('Access code has already been used');
        }
        if (isAccessCodeExpired(codeData.expiresAt)) {
            throw new Error('Code has expired');
        }

        const existingUserData = userSnapshot.exists() ? (userSnapshot.data() || {}) : {};
        const existingCoachOf = Array.isArray(existingUserData.coachOf) ? existingUserData.coachOf : [];
        const existingRoles = Array.isArray(existingUserData.roles) ? existingUserData.roles : [];
        userAlreadyCoachedTeam = existingCoachOf.includes(resolvedTeamId);
        userAlreadyHadCoachRole = existingRoles.includes('coach');

        const userGrantTimestamp = Timestamp.now();
        await setDoc(userRef, {
            coachOf: arrayUnion(resolvedTeamId),
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
            if ((latestCodeData.teamId || null) !== resolvedTeamId) {
                throw new Error('Access code team does not match admin invite target');
            }
            const latestInvitedEmail = String(latestCodeData.email || '').trim().toLowerCase();
            if (!latestInvitedEmail) {
                throw new Error('Admin invite is missing invited email');
            }
            if (normalizedEmail !== latestInvitedEmail) {
                throw new Error('Admin invite email does not match signed-in user');
            }
            if (latestCodeData.used === true) {
                throw new Error('Access code has already been used');
            }
            if (isAccessCodeExpired(latestCodeData.expiresAt)) {
                throw new Error('Code has expired');
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

        return {
            success: true,
            teamId: resolvedTeamId,
            teamName: teamSnapshot.data()?.name || null
        };
    } catch (error) {
        let rollbackError = null;
        if (userGrantApplied) {
            const rollbackUpdate = {
                updatedAt: Timestamp.now()
            };

            if (!userAlreadyCoachedTeam) {
                rollbackUpdate.coachOf = arrayRemove(resolvedTeamId);
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

        const invitedEmail = String(codeData.email || '').trim().toLowerCase();
        if (!invitedEmail) {
            throw new Error('Admin invite is missing invited email');
        }

        if (userEmail !== invitedEmail) {
            throw new Error('Admin invite email does not match signed-in user');
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

async function autoAcceptParentInviteForExistingUser(accessCodeId) {
    const autoAcceptParentInvite = httpsCallable(functions, 'autoAcceptParentInviteForExistingUser');
    const result = await autoAcceptParentInvite({ codeId: accessCodeId });
    return Boolean(result?.data?.autoLinked);
}

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

    const normalizedParentEmail = String(parentEmail || '').trim().toLowerCase();
    const accessCodeData = {
        type: 'parent_invite',
        teamId,
        playerId,
        playerNum, // Added for quick context
        playerName: player?.name || null,
        teamName: team?.name || null,
        relation,
        email: normalizedParentEmail || null,
        generatedBy: currentUser.uid,
        createdAt: Timestamp.now(),
        // 7 days from now
        expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
        used: false,
        usedBy: null,
        usedAt: null
    };
    const { id: accessCodeId, code } = await createUniqueAccessCode(accessCodeData);

    // Check if user with this email already exists
    let existingUser = null;
    let autoLinked = false;
    if (normalizedParentEmail) {
        existingUser = await getUserByEmail(normalizedParentEmail);
        if (existingUser) {
            try {
                autoLinked = await autoAcceptParentInviteForExistingUser(accessCodeId);
            } catch (error) {
                console.warn(`Could not auto-link existing parent invite: ${error?.message || 'Unknown error'}`);
            }
        }
    }

    return {
        id: accessCodeId,
        code,
        teamName: team?.name || null,
        playerName: player?.name || null,
        existingUser: !!existingUser,
        autoLinked
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

    const normalizedEmail = String(adminEmail || '').trim().toLowerCase();
    if (!normalizedEmail) {
        throw new Error('Admin email is required');
    }

    await assertVolunteerScreeningClearedForTeamGrant(teamId, { email: normalizedEmail });

    const team = await getTeam(teamId);
    if (!team) {
        throw new Error('Team not found');
    }

    const accessCodeData = {
        type: 'admin_invite',
        teamId,
        teamName: team.name || null,
        email: normalizedEmail,
        generatedBy: currentUser.uid,
        createdAt: Timestamp.now(),
        // 7 days from now
        expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
        used: false,
        usedBy: null,
        usedAt: null
    };
    const { id: accessCodeId, code } = await createUniqueAccessCode(accessCodeData);

    // Check if user already exists
    const existingUser = await getUserByEmail(normalizedEmail);

    return {
        id: accessCodeId,
        code,
        teamName: team.name || null,
        existingUser: !!existingUser
    };
}

/**
 * Invite a co-parent to a specific athlete.
 * This generates a special invite code that links a new parent/guardian
 * to an existing athlete profile.
 * @param {string} primaryParentUid - The user ID of the primary parent sending the invite
 * @param {string} teamId - The team ID of the athlete
 * @param {string} playerId - The player ID of the athlete
 * @param {string} coParentEmail - The email of the co-parent to invite
 * @param {string} playerName - The name of the athlete (for context)
 * @returns {Promise<{id: string, code: string, teamName: string, playerName: string, existingUser: boolean}>}
 */
export async function inviteCoParentToAthlete(primaryParentUid, teamId, playerId, coParentEmail, playerName) {
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== primaryParentUid) {
        throw new Error('You must be signed in as the primary parent to invite a co-parent');
    }

    const normalizedEmail = String(coParentEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error('Please enter a valid email address.');
    }

    // Get team and player info for the invite
    let team;
    let player;
    try {
        [team, player] = await Promise.all([
            getTeam(teamId),
            getPlayers(teamId).then(ps => ps.find(p => p.id === playerId))
        ]);
    } catch (error) {
        throw new Error(`Failed to fetch team or player data: ${error?.message || 'Unknown error'}`);
    }

    if (!team || !player) {
        throw new Error('Team or player not found');
    }

    const accessCodeData = {
        type: 'coparent_invite', // New type for co-parent invites
        teamId,
        playerId,
        playerName: player?.name || playerName || null,
        teamName: team?.name || null,
        email: normalizedEmail,
        generatedBy: primaryParentUid,
        createdAt: Timestamp.now(),
        // 7 days from now
        expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
        used: false,
        usedBy: null,
        usedAt: null
    };
    const { id: accessCodeId, code } = await createUniqueAccessCode(accessCodeData);

    // Check if user with this email already exists
    let existingUser = null;
    try {
        existingUser = await getUserByEmail(normalizedEmail);
    } catch (error) {
        console.warn(`Could not check for existing co-parent user: ${error?.message || 'Unknown error'}`);
    }

    return {
        id: accessCodeId,
        code,
        teamName: team?.name || null,
        playerName: player?.name || playerName || null,
        existingUser: !!existingUser
    };
}


function normalizeInviteEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function getInviteEmailMismatchMessage(invitedEmail) {
    return `This invite was sent to ${invitedEmail}. Sign in with that email to accept it.`;
}

export async function redeemParentInvite(userId, code, authEmail = null) {
    console.log('[redeemParentInvite] start', { userId, code });

    const codeDoc = await getValidatedAccessCodeDoc(code);
    const codeRef = codeDoc.ref;
    let codeData;

    const resolvedAuthEmail = normalizeInviteEmail(
        authEmail || auth.currentUser?.email || (await getUserProfile(userId))?.email
    );

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
        if (latestCodeData.used || latestCodeData.revoked === true || latestCodeData.status === 'removed') {
            throw new Error("Invalid or used code");
        }
        if (isAccessCodeExpired(latestCodeData.expiresAt)) {
            throw new Error("Code has expired");
        }

        const invitedEmail = normalizeInviteEmail(latestCodeData.email);
        if (invitedEmail && (!resolvedAuthEmail || invitedEmail !== resolvedAuthEmail)) {
            throw new Error(getInviteEmailMismatchMessage(invitedEmail));
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
    let team = null;
    let player = null;
    try {
        // 3. Get Team & Player details for caching
        console.log('[redeemParentInvite] fetching team & player', {
            teamId: codeData.teamId,
            playerId: codeData.playerId
        });
        [team, player] = await Promise.all([
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
            await syncPublicUserProfile(userId);
            console.log('[redeemParentInvite] user profile updated');
        } catch (err) {
            console.error('redeemParentInvite: error updating user profile', err);
            throw new Error('Unable to link parent (profile). ' + (err?.message || ''));
        }

        // 5. Update private player profile (household contact list)
        try {
            const privateProfileRef = doc(db, `teams/${codeData.teamId}/players/${codeData.playerId}/private/profile`);

            // Log current private parents state for debugging
            try {
                const snap = await getDoc(privateProfileRef);
                if (snap.exists()) {
                    const data = snap.data() || {};
                    console.log('[redeemParentInvite] current private player parents before update', {
                        teamId: codeData.teamId,
                        playerId: codeData.playerId,
                        parents: data.parents || []
                    });
                } else {
                    console.log('[redeemParentInvite] private player profile not found before parents update', {
                        teamId: codeData.teamId,
                        playerId: codeData.playerId
                    });
                }
            } catch (innerErr) {
                console.warn('[redeemParentInvite] failed to read private player profile before update (non-fatal)', innerErr);
            }

            await setDoc(privateProfileRef, {
                parents: arrayUnion({
                    userId,
                    email: codeData.email || 'pending', // Will be updated if email not provided in invite
                    relation: codeData.relation,
                    addedAt: Timestamp.now()
                })
            }, { merge: true });
            console.log('[redeemParentInvite] private player parents updated');
        } catch (err) {
            // If this fails (e.g., due to stricter live rules), we still
            // consider the parent linked via their user profile. Coaches
            // simply won't see the connection until rules are updated.
            console.error('redeemParentInvite: error updating private player parents (non-fatal)', {
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
    return {
        success: true,
        teamId: codeData.teamId,
        teamName: team?.name || null,
        playerId: codeData.playerId || null,
        playerName: player?.name || null,
        playerNum: player?.number ?? codeData.playerNum ?? null
    };
}

function normalizeHouseholdInviteEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function assertHouseholdInviteEmailMatches(codeData) {
    const invitedEmail = normalizeHouseholdInviteEmail(codeData?.email);
    if (!invitedEmail) {
        return;
    }

    const signedInEmail = normalizeHouseholdInviteEmail(auth.currentUser?.email);
    if (signedInEmail !== invitedEmail) {
        throw new Error(`This invite was sent to ${invitedEmail}. Sign in with that email to accept it.`);
    }
}

async function resetHouseholdInviteCodeClaim(codeRef, userId) {
    await runTransaction(db, async (transaction) => {
        const latestCodeSnapshot = await transaction.get(codeRef);
        if (!latestCodeSnapshot.exists()) return;

        const latestCodeData = latestCodeSnapshot.data() || {};
        if (latestCodeData.used === true && latestCodeData.usedBy === userId) {
            transaction.update(codeRef, {
                used: false,
                usedBy: null,
                usedAt: null
            });
        }
    });
}

async function rollbackHouseholdInviteSideEffects(userId, codeData, codeRef, rollbackState = {}) {
    const teamId = codeData?.teamId || null;
    const playerId = codeData?.playerId || null;
    const { userWasUpdated = false, playerWasUpdated = false, priorMembershipSnapshot = null, membershipWasUpdated = false } = rollbackState;

    if (userWasUpdated && teamId && playerId) {
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
                await syncPublicUserProfile(userId);
            }
        } catch (rollbackErr) {
            console.error('redeemHouseholdInvite: failed to rollback user profile updates', rollbackErr);
        }
    }

    if (playerWasUpdated && teamId && playerId) {
        try {
            const privateProfileRef = doc(db, `teams/${teamId}/players/${playerId}/private/profile`);
            const playerSnap = await getDoc(privateProfileRef);
            if (playerSnap.exists()) {
                const playerData = playerSnap.data() || {};
                const parents = Array.isArray(playerData.parents) ? playerData.parents : [];
                const filteredParents = parents.filter(parent => parent?.userId !== userId);
                await setDoc(privateProfileRef, { parents: filteredParents }, { merge: true });
            }
        } catch (rollbackErr) {
            console.error('redeemHouseholdInvite: failed to rollback player parent updates', rollbackErr);
        }
    }

    if (membershipWasUpdated && codeData?.organizerUserId && codeData?.familyMembershipId) {
        try {
            const membershipRef = doc(db, 'users', codeData.organizerUserId, 'familyMemberships', codeData.familyMembershipId);
            if (priorMembershipSnapshot?.exists()) {
                await setDoc(membershipRef, priorMembershipSnapshot.data() || {});
            } else {
                await deleteDoc(membershipRef);
            }
        } catch (rollbackErr) {
            console.error('redeemHouseholdInvite: failed to rollback family membership updates', rollbackErr);
        }
    }

    try {
        await resetHouseholdInviteCodeClaim(codeRef, userId);
    } catch (rollbackErr) {
        console.error('redeemHouseholdInvite: failed to rollback code claim', rollbackErr);
    }
}

export async function redeemHouseholdInvite(userId, code) {
    console.log('[redeemHouseholdInvite] start', { userId, code });

    const codeDoc = await getValidatedAccessCodeDoc(code);
    const codeRef = codeDoc.ref;
    let codeData;

    await runTransaction(db, async (transaction) => {
        const latestCodeSnapshot = await transaction.get(codeRef);
        if (!latestCodeSnapshot.exists()) {
            throw new Error("Invalid or used code");
        }

        const latestCodeData = latestCodeSnapshot.data() || {};
        if (latestCodeData.type !== 'household_invite') {
            throw new Error("Not a household invite code");
        }
        if (latestCodeData.used) {
            throw new Error("Invalid or used code");
        }
        if (latestCodeData.revoked) {
            throw new Error("Invite has been revoked");
        }
        if (isAccessCodeExpired(latestCodeData.expiresAt)) {
            throw new Error("Code has expired");
        }

        assertHouseholdInviteEmailMatches(latestCodeData);

        transaction.update(codeRef, {
            used: true,
            usedBy: userId,
            usedAt: Timestamp.now()
        });

        codeData = latestCodeData;
    });

    const rollbackState = {
        userWasUpdated: false,
        playerWasUpdated: false,
        priorMembershipSnapshot: null,
        membershipWasUpdated: false
    };

    try {
        assertHouseholdInviteEmailMatches(codeData);

        const [team, player] = await Promise.all([
            getTeam(codeData.teamId),
            getPlayers(codeData.teamId).then(ps => ps.find(p => p.id === codeData.playerId))
        ]);

        if (!team || !player) {
            throw new Error("Team or Player not found");
        }

        const userRef = doc(db, "users", userId);
        await setDoc(userRef, {
            parentOf: arrayUnion({
                teamId: codeData.teamId,
                playerId: codeData.playerId,
                teamName: team.name,
                playerName: player.name,
                playerNumber: player.number,
                playerPhotoUrl: player.photoUrl || null,
                relation: codeData.relation || 'Household contact'
            }),
            parentTeamIds: arrayUnion(codeData.teamId),
            parentPlayerKeys: arrayUnion(`${codeData.teamId}::${codeData.playerId}`),
            roles: arrayUnion('parent')
        }, { merge: true });
        await syncPublicUserProfile(userId);
        rollbackState.userWasUpdated = true;

        const privateProfileRef = doc(db, `teams/${codeData.teamId}/players/${codeData.playerId}/private/profile`);
        await setDoc(privateProfileRef, {
            parents: arrayUnion({
                userId,
                email: codeData.email || 'pending',
                relation: codeData.relation || 'Household contact',
                status: 'accepted',
                acceptedAt: Timestamp.now(),
                addedAt: Timestamp.now()
            })
        }, { merge: true });
        rollbackState.playerWasUpdated = true;

        if (codeData.organizerUserId && codeData.familyMembershipId) {
            const membershipRef = doc(db, 'users', codeData.organizerUserId, 'familyMemberships', codeData.familyMembershipId);
            rollbackState.priorMembershipSnapshot = await getDoc(membershipRef);
            await updateDoc(membershipRef, {
                status: 'active',
                userId,
                acceptedAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            rollbackState.membershipWasUpdated = true;
        }
    } catch (err) {
        await rollbackHouseholdInviteSideEffects(userId, codeData, codeRef, rollbackState);
        throw err;
    }

    console.log('[redeemHouseholdInvite] completed', { codeId: codeDoc.id });
    return { success: true, teamId: codeData.teamId, playerId: codeData.playerId };
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
            await syncPublicUserProfile(userId);
        }
    } catch (error) {
        console.warn('[rollbackParentInviteRedemption] failed to rollback user profile links (non-fatal)', error);
    }

    if (teamId && playerId) {
        try {
            const privateProfileRef = doc(db, `teams/${teamId}/players/${playerId}/private/profile`);
            const playerSnap = await getDoc(privateProfileRef);
            if (playerSnap.exists()) {
                const playerData = playerSnap.data() || {};
                const parents = Array.isArray(playerData.parents) ? playerData.parents : [];
                const filteredParents = parents.filter(parent => parent?.userId !== userId);
                await setDoc(privateProfileRef, { parents: filteredParents }, { merge: true });
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

function getTeamIdFromDocPath(ref) {
    const parts = String(ref?.path || '').split('/');
    const teamIndex = parts.indexOf('teams');
    return teamIndex >= 0 ? parts[teamIndex + 1] || '' : '';
}

function isAllowedParentFeeRecipient(data, userId, parentPlayerKeys) {
    if (!data || !userId) return false;
    if ([data.parentUserId, data.accountUserId, data.userId].includes(userId)) return true;
    const teamId = data.teamId || '';
    const playerId = data.playerId || data.childId || '';
    const playerKey = data.playerKey || (teamId && playerId ? `${teamId}::${playerId}` : '');
    return parentPlayerKeys.has(playerKey);
}

export async function listParentTeamFeeRecipients(userId, children = []) {
    if (!userId) return [];

    const parentPlayerKeys = new Set((children || [])
        .map((child) => (child?.teamId && child?.playerId ? `${child.teamId}::${child.playerId}` : ''))
        .filter(Boolean));
    const childLinks = [...parentPlayerKeys].map((key) => {
        const [teamId, playerId] = key.split('::');
        return { teamId, playerId };
    });
    const teamIds = [...new Set(childLinks.map((child) => child.teamId).filter(Boolean))];

    const recipientsRef = collectionGroup(db, 'feeRecipients');
    const queries = [
        ...teamIds.flatMap((teamId) => [
            query(recipientsRef, where('teamId', '==', teamId), where('parentUserId', '==', userId)),
            query(recipientsRef, where('teamId', '==', teamId), where('accountUserId', '==', userId)),
            query(recipientsRef, where('teamId', '==', teamId), where('userId', '==', userId))
        ]),
        ...childLinks.map((child) => query(
            recipientsRef,
            where('teamId', '==', child.teamId),
            where('playerId', '==', child.playerId)
        ))
    ];

    const results = await Promise.allSettled(queries.map((feeQuery) => getDocs(feeQuery)));
    const feesByPath = new Map();

    results.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        result.value.docs.forEach((docSnap) => {
            const data = { id: docSnap.id, ...docSnap.data() };
            data.teamId = data.teamId || getTeamIdFromDocPath(docSnap.ref);
            data.playerKey = data.playerKey || (data.teamId && data.playerId ? `${data.teamId}::${data.playerId}` : '');
            if (isAllowedParentFeeRecipient(data, userId, parentPlayerKeys)) {
                feesByPath.set(docSnap.ref.path, data);
            }
        });
    });

    return Array.from(feesByPath.values());
}

export async function getTeamFeeBatch(teamId, batchId) {
    if (!teamId || !batchId) return null;
    const batchRef = doc(db, 'teams', teamId, 'feeBatches', batchId);
    const batchSnap = await getDoc(batchRef);
    return batchSnap.exists() ? { id: batchSnap.id, ...batchSnap.data() } : null;
}

export async function listTeamFeeBatches(teamId) {
    if (!teamId) return [];
    const batchesRef = collection(db, 'teams', teamId, 'feeBatches');
    const snapshot = await getDocs(query(batchesRef, orderBy('createdAt', 'desc'), limit(25)));
    return snapshot.docs.map((batchDoc) => ({ id: batchDoc.id, ...batchDoc.data() }));
}

export async function listTeamFeeRecipients(teamId, batchId) {
    if (!teamId || !batchId) return [];
    const recipientsRef = collection(db, 'teams', teamId, 'feeBatches', batchId, 'feeRecipients');
    const snapshot = await getDocs(recipientsRef);
    const recipients = await Promise.all(snapshot.docs.map(async (recipientDoc) => {
        const recipient = { id: recipientDoc.id, ...recipientDoc.data() };
        if (recipient?.hasAdminBilling !== true) return recipient;

        try {
            const adminBillingRef = doc(db, 'teams', teamId, 'feeBatches', batchId, 'feeRecipients', recipientDoc.id, 'adminBilling', 'latest');
            const adminBillingSnap = await getDoc(adminBillingRef);
            if (!adminBillingSnap.exists()) return recipient;
            return {
                ...recipient,
                adminBilling: adminBillingSnap.data() || {}
            };
        } catch (error) {
            console.warn('Unable to load team fee admin billing metadata:', error);
            return recipient;
        }
    }));

    return recipients
        .sort((a, b) => String(a.playerName || a.childName || a.parentName || a.parentEmail || '').localeCompare(String(b.playerName || b.childName || b.parentName || b.parentEmail || '')));
}

const PRIVATE_TEAM_FEE_RECIPIENT_FIELDS = new Set([
    'stripeCheckoutSessionId',
    'stripePaymentIntentId',
    'stripeCustomerId',
    'stripeChargeId',
    'stripeRefundId',
    'stripeLastRefundId',
    'stripeEventId',
    'checkoutSessionId',
    'paymentIntentId',
    'receiptEmail',
    'eventId',
    'refundedBy',
    'recordedBy',
    'adjustedBy',
    'canceledBy',
    'internalNote',
    'adminNote',
    'note',
    'reason'
]);

function sanitizeTeamFeeRecipientValue(value, { topLevel = false } = {}) {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeTeamFeeRecipientValue(item));
    }
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => topLevel && key === 'notes' ? true : !PRIVATE_TEAM_FEE_RECIPIENT_FIELDS.has(key))
        .map(([key, childValue]) => [key, sanitizeTeamFeeRecipientValue(childValue)]));
}

function deriveTeamFeeAdminBillingPayload(recipientUpdates = {}, ledgerEntries = []) {
    const canceled = recipientUpdates?.canceled && typeof recipientUpdates.canceled === 'object'
        ? recipientUpdates.canceled
        : null;
    const cancellationEntry = Array.isArray(ledgerEntries)
        ? ledgerEntries.find((entry) => entry?.type === 'cancellation')
        : null;

    if ((recipientUpdates?.status || '') !== 'canceled' && !canceled && !cancellationEntry) {
        return null;
    }

    const reason = String(canceled?.note || cancellationEntry?.reason || '').trim();
    const canceledBy = canceled?.canceledBy || cancellationEntry?.canceledBy || null;
    if (!reason && !canceledBy) {
        return null;
    }

    return {
        type: 'cancellation',
        ...(reason ? { reason } : {}),
        ...(canceledBy ? { canceledBy } : {})
    };
}

export async function updateTeamFeeRecipient(teamId, batchId, recipientId, updates = {}) {
    if (!teamId || !batchId || !recipientId) {
        throw new Error('Missing fee recipient context.');
    }

    const recipientRef = doc(db, 'teams', teamId, 'feeBatches', batchId, 'feeRecipients', recipientId);
    const adminBillingRef = doc(db, 'teams', teamId, 'feeBatches', batchId, 'feeRecipients', recipientId, 'adminBilling', 'latest');
    const { ledgerEntries = [], adminBilling = null, ...unsafeRecipientUpdates } = updates;
    const recipientUpdates = sanitizeTeamFeeRecipientValue(unsafeRecipientUpdates, { topLevel: true });
    const safeLedgerEntries = Array.isArray(ledgerEntries) ? sanitizeTeamFeeRecipientValue(ledgerEntries) : [];
    const isManualPaymentUpdate = Object.prototype.hasOwnProperty.call(recipientUpdates, 'manualPayment')
        || safeLedgerEntries.some((entry) => entry?.type === 'offline_payment');
    const explicitAdminBilling = adminBilling && typeof adminBilling === 'object' && !Array.isArray(adminBilling)
        ? adminBilling
        : null;
    const adminBillingDetails = explicitAdminBilling || deriveTeamFeeAdminBillingPayload(unsafeRecipientUpdates, ledgerEntries);
    const hasAdminBilling = Boolean(adminBillingDetails);

    const updatePayload = {
        ...recipientUpdates,
        teamId,
        batchId,
        ...(hasAdminBilling ? { hasAdminBilling: true } : {}),
        updatedAt: serverTimestamp()
    };

    const adminBillingPayload = hasAdminBilling ? {
        ...adminBillingDetails,
        teamId,
        batchId,
        recipientId,
        updatedAt: serverTimestamp()
    } : null;

    const invalidatesOnlineCheckout = [
        'status',
        'amountDueCents',
        'balanceDueCents',
        'remainingBalanceCents',
        'amountPaidCents',
        'paidAmountCents',
        'amountRefundedCents',
        'refundedAmountCents',
        'manualPayment',
        'refunded',
        'adjustment',
        'paidAt',
        'lastRefundedAt'
    ].some((key) => Object.prototype.hasOwnProperty.call(recipientUpdates, key));

    if (invalidatesOnlineCheckout) {
        updatePayload.checkoutStatus = 'stale';
        updatePayload.checkoutAttemptToken = deleteField();
        updatePayload.checkoutUrl = deleteField();
        updatePayload.paymentLink = deleteField();
        updatePayload.stripeCheckoutSessionId = deleteField();
        updatePayload.checkoutAmountCents = deleteField();
    }

    if (safeLedgerEntries.length > 0) {
        updatePayload.paymentLedger = arrayUnion(...safeLedgerEntries);
    }

    if (isManualPaymentUpdate) {
        await runTransaction(db, async (transaction) => {
            const recipientSnapshot = await transaction.get(recipientRef);
            if (!recipientSnapshot.exists()) {
                throw new Error('Fee recipient not found.');
            }
            const recipient = recipientSnapshot.data() || {};
            const amountDueRaw = recipient.amountDueCents ?? recipient.adjustedAmountCents ?? recipient.amountCents ?? 0;
            const amountDueCents = Number.isFinite(Number(amountDueRaw)) ? Math.max(0, Number(amountDueRaw)) : 0;
            const priorPaidRaw = recipient.amountPaidCents ?? recipient.paidAmountCents ?? 0;
            const priorPaidCents = Number.isFinite(Number(priorPaidRaw)) ? Math.max(0, Number(priorPaidRaw)) : 0;
            const remainingBalanceCents = Math.max(0, amountDueCents - priorPaidCents);
            const manualPaymentAmountRaw = recipientUpdates.manualPayment?.amountPaidCents
                ?? safeLedgerEntries.find((entry) => entry?.type === 'offline_payment')?.amountCents;
            const manualPaymentAmountCents = Number(manualPaymentAmountRaw);

            if (!Number.isFinite(manualPaymentAmountCents)) {
                throw new Error('Manual payment amount is required.');
            }
            if (manualPaymentAmountCents > remainingBalanceCents) {
                throw new Error('Manual payment amount cannot exceed the remaining balance.');
            }

            transaction.update(recipientRef, updatePayload);
            if (adminBillingPayload) {
                transaction.set(adminBillingRef, adminBillingPayload, { merge: true });
            }
        });
        return;
    }

    await updateDoc(recipientRef, updatePayload);
    if (adminBillingPayload) {
        await setDoc(adminBillingRef, adminBillingPayload, { merge: true });
    }
}

export async function createTeamFeeBatch(teamId, feeDraft, recipients = [], user = {}) {
    if (!teamId) throw new Error('Team ID is required.');
    if (!feeDraft?.title) throw new Error('Fee title is required.');
    if (!feeDraft?.amountCents || feeDraft.amountCents <= 0) throw new Error('Fee amount is required.');
    if (!feeDraft?.dueDate) throw new Error('Due date is required.');
    if (!recipients.length) throw new Error('At least one recipient is required.');

    const batchRef = doc(collection(db, `teams/${teamId}/feeBatches`));
    const write = writeBatch(db);
    const now = serverTimestamp();
    const collectionMode = 'offline_manual';
    const offlinePaymentInstructions = feeDraft.offlinePaymentInstructions || 'Collect payment outside ALL PLAYS. No online payment is processed.';

    write.set(batchRef, {
        teamId,
        title: feeDraft.title,
        amountCents: feeDraft.amountCents,
        dueDate: feeDraft.dueDate,
        notes: feeDraft.notes || '',
        recipientCount: recipients.length,
        status: 'open',
        collectionMode,
        offlinePaymentInstructions,
        lineItems: feeDraft.lineItems || [],
        installments: feeDraft.installments || [],
        createdBy: user.uid || null,
        createdByEmail: user.email || user.profileEmail || null,
        createdAt: now,
        updatedAt: now
    });

    recipients.forEach((recipient) => {
        if (!recipient.playerId) return;
        const recipientRef = doc(db, `teams/${teamId}/feeBatches/${batchRef.id}/feeRecipients/${recipient.playerId}`);
        write.set(recipientRef, {
            ...recipient,
            batchId: batchRef.id,
            teamId,
            feeTitle: feeDraft.title,
            amountCents: feeDraft.amountCents,
            dueDate: feeDraft.dueDate,
            notes: feeDraft.notes || '',
            status: 'unpaid',
            collectionMode,
            offlinePaymentInstructions,
            lineItems: feeDraft.lineItems || [],
            installments: feeDraft.installments || [],
            createdAt: now,
            updatedAt: now
        });
    });

    await write.commit();
    return { id: batchRef.id };
}

function normalizeParentRegistrationEmail(value = '') {
    return String(value || '').trim().toLowerCase();
}

function formatParentRegistrationStatusLabel(status = '') {
    const normalized = normalizeRegistrationStatus(status);
    const labels = {
        pending: 'Pending Review',
        waitlisted: 'Waitlisted',
        'offer-extended': 'Offer Extended',
        'offer-accepted': 'Offer Accepted',
        enrolled: 'Enrolled',
        released: 'Released',
        rejected: 'Rejected'
    };
    return labels[normalized] || 'Pending Review';
}

async function listParentRegistrationApplicationsForProfile(userProfile = {}) {
    const email = normalizeParentRegistrationEmail(userProfile.email || auth.currentUser?.email);
    if (!email) return [];

    const snapshot = await getDocs(query(
        collectionGroup(db, 'registrations'),
        where('guardian.email', '==', email)
    ));

    const teamCache = new Map();
    const formCache = new Map();

    const applications = await Promise.all(snapshot.docs.map(async (registrationDoc) => {
        const registration = { id: registrationDoc.id, ...(registrationDoc.data() || {}) };
        const teamId = registration.teamId || '';
        const formId = registration.formId || '';
        const player = getRegistrationPlayerDraft(registration);
        const guardians = getRegistrationGuardianDrafts(registration);

        let team = null;
        if (teamId) {
            if (!teamCache.has(teamId)) teamCache.set(teamId, await getTeam(teamId));
            team = await teamCache.get(teamId);
        }

        let form = null;
        if (teamId && formId) {
            const formKey = `${teamId}::${formId}`;
            if (!formCache.has(formKey)) {
                formCache.set(formKey, getDoc(doc(db, `teams/${teamId}/registrationForms`, formId)).then((snap) => snap.exists() ? (snap.data() || {}) : null));
            }
            form = await formCache.get(formKey);
        }

        const selectedOption = registration.selectedOption || {};
        return {
            id: registration.id,
            teamId,
            formId,
            teamName: team?.name || registration.teamName || form?.teamName || 'Team registration',
            programName: registration.programName || form?.programName || form?.title || 'Registration',
            playerName: player.name || registration.participant?.name || 'Unnamed player',
            guardianEmail: guardians[0]?.email || registration.guardian?.email || '',
            status: normalizeRegistrationStatus(registration.status),
            statusLabel: formatParentRegistrationStatusLabel(registration.status),
            selectedOptionLabel: selectedOption.title || selectedOption.label || '',
            submittedAt: registration.submittedAt || registration.createdAt || null
        };
    }));

    return applications.sort((a, b) => {
        const aDate = a.submittedAt?.toDate ? a.submittedAt.toDate() : (a.submittedAt ? new Date(a.submittedAt) : new Date(0));
        const bDate = b.submittedAt?.toDate ? b.submittedAt.toDate() : (b.submittedAt ? new Date(b.submittedAt) : new Date(0));
        return bDate - aDate;
    });
}

export async function getParentDashboardData(userId) {
    const userProfile = await getUserProfile(userId);
    if (!userProfile || !userProfile.parentOf || userProfile.parentOf.length === 0) {
        const registrationApplications = await listParentRegistrationApplicationsForProfile(userProfile || {});
        return {
            upcomingGames: [],
            children: [],
            registrationApplications,
            dashboardState: {
                kind: 'no-links',
                blockedLinkCount: 0,
                staleLinkCount: 0,
                teamEventErrors: 0
            }
        };
    }

    const normalizedParentScope = await normalizeParentScopeLinks(userProfile.parentOf);
    const children = normalizedParentScope.activeLinks;
    const dashboardState = {
        kind: 'ready',
        blockedLinkCount: normalizedParentScope.blockedLinkCount || 0,
        staleLinkCount: normalizedParentScope.staleLinkCount || 0,
        teamEventErrors: 0
    };
    const existingParentTeamIds = Array.isArray(userProfile.parentTeamIds) ? userProfile.parentTeamIds : [];
    const existingParentPlayerKeys = Array.isArray(userProfile.parentPlayerKeys) ? userProfile.parentPlayerKeys : [];
    const normalizedParentTeamIds = normalizedParentScope.parentTeamIds;
    const expectedParentPlayerKeys = normalizedParentScope.parentPlayerKeys;
    const needsParentAccessBackfill =
        JSON.stringify(normalizedParentTeamIds.slice().sort()) !== JSON.stringify(existingParentTeamIds.slice().sort()) ||
        JSON.stringify(expectedParentPlayerKeys.slice().sort()) !== JSON.stringify(existingParentPlayerKeys.slice().sort());
    if (needsParentAccessBackfill) {
        try {
            await updateUserProfile(userId, {
                parentTeamIds: normalizedParentTeamIds,
                parentPlayerKeys: expectedParentPlayerKeys
            });
        } catch (error) {
            console.warn('[parent-dashboard] Failed to backfill parent access keys before loading roster:', error);
        }
    }

    const activeChildren = [];
    const upcomingGames = [];

    // Cache events per team to avoid duplicate reads when a parent
    // has multiple players on the same team.
    const eventsByTeam = new Map();

    // Use a single "today" boundary for all filtering
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const child of children) {
        activeChildren.push(child);

        let events = eventsByTeam.get(child.teamId);
        if (events === undefined) {
            try {
                events = await getEvents(child.teamId);
            } catch (error) {
                console.warn('[parent-dashboard] Failed to load team events for parent child link:', {
                    teamId: child.teamId,
                    playerId: child.playerId,
                    error
                });
                dashboardState.teamEventErrors += 1;
                events = [];
            }
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

    const registrationApplications = await listParentRegistrationApplicationsForProfile(userProfile);

    if (activeChildren.length === 0) {
        if (dashboardState.blockedLinkCount > 0) {
            dashboardState.kind = 'access-blocked';
        } else if (dashboardState.staleLinkCount > 0) {
            dashboardState.kind = 'stale-links';
        } else {
            dashboardState.kind = 'no-links';
        }
    } else if (dashboardState.blockedLinkCount > 0 || dashboardState.teamEventErrors > 0) {
        dashboardState.kind = 'degraded';
    }

    return { upcomingGames, children: activeChildren, registrationApplications, dashboardState };
}

export async function updatePlayerProfile(teamId, playerId, data) {
    // Restricted update for parents.
    // SECURITY: sensitive fields must never live on the public player doc.
    assertNoSensitivePlayerFields(data || {});
    const now = Timestamp.now();

    // Public player doc: allow photoUrl and non-sensitive roster profile fields.
    const publicUpdate = {};
    if (Object.prototype.hasOwnProperty.call(data, 'photoUrl')) {
        publicUpdate.photoUrl = data.photoUrl || null;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'profile')) {
        publicUpdate.profile = data.profile || {};
    }
    if (Object.keys(publicUpdate).length > 0) {
        await updateDoc(doc(db, `teams/${teamId}/players`, playerId), {
            ...publicUpdate,
            updatedAt: now
        });
    }
}

export async function updatePlayerPrivateProfile(teamId, playerId, data) {
    const privateUpdate = {};
    if (Object.prototype.hasOwnProperty.call(data, 'emergencyContact')) {
        privateUpdate.emergencyContact = data.emergencyContact || null;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'medicalInfo')) {
        privateUpdate.medicalInfo = data.medicalInfo || '';
    }
    if (Object.keys(privateUpdate).length > 0) {
        privateUpdate.updatedAt = Timestamp.now();
        const ref = doc(db, `teams/${teamId}/players/${playerId}/private/profile`);
        await setDoc(ref, privateUpdate, { merge: true });
    }
}

export async function getPlayerPrivateProfile(teamId, playerId) {
    const ref = doc(db, `teams/${teamId}/players/${playerId}/private/profile`);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() || {}) : null;
}

function buildParentSeasonKey(teamId, playerId) {
    return `${teamId || ''}::${playerId || ''}`;
}

function resolveAllowedAthleteSeasonLinks(parentLinks = []) {
    const allowed = new Map();
    (parentLinks || []).forEach((link) => {
        if (!link?.teamId || !link?.playerId) return;
        allowed.set(buildParentSeasonKey(link.teamId, link.playerId), link);
    });
    return allowed;
}

async function buildAthleteProfileSeasonSummary(link) {
    const [team, playerSnap, games] = await Promise.all([
        getTeam(link.teamId, { includeInactive: true }),
        getDoc(doc(db, `teams/${link.teamId}/players`, link.playerId)),
        getGames(link.teamId)
    ]);

    if (!team || !playerSnap.exists()) {
        return null;
    }

    const player = playerSnap.data() || {};
    let gamesPlayed = 0;
    let totalTimeMs = 0;
    const statTotals = {};

    for (const game of (games || [])) {
        const statsSnap = await getDoc(doc(db, `teams/${link.teamId}/games/${game.id}/aggregatedStats`, link.playerId));
        if (!statsSnap.exists()) continue;

        const statsData = statsSnap.data() || {};
        const stats = statsData.stats || {};

        gamesPlayed += 1;
        totalTimeMs += Number(statsData.timeMs || 0);
        Object.entries(stats).forEach(([statKey, value]) => {
            statTotals[statKey] = (statTotals[statKey] || 0) + Number(value || 0);
        });
    }

    return {
        seasonKey: buildParentSeasonKey(link.teamId, link.playerId),
        teamId: link.teamId,
        teamName: team.name || link.teamName || 'Team',
        playerId: link.playerId,
        playerName: link.playerName || player.name || 'Athlete',
        playerPhotoUrl: player.photoUrl || link.playerPhotoUrl || null,
        gamesPlayed,
        totalTimeMs,
        statTotals,
        gameClips: collectAthleteGameClipsForPlayer(games, {
            teamId: link.teamId,
            teamName: team.name || link.teamName || 'Team',
            playerId: link.playerId
        })
    };
}

function sanitizeAthleteProfileMediaName(fileName) {
    return String(fileName || 'media').replace(/[^\w.\-]+/g, '_');
}

export async function uploadAthleteProfileMedia(userId, profileId, file, options = {}) {
    if (!userId) {
        throw new Error('A signed-in parent account is required to upload athlete profile media.');
    }
    if (!profileId) {
        throw new Error('A profile id is required to upload athlete profile media.');
    }
    if (!file) {
        throw new Error('Select a media file to upload.');
    }

    await requireImageAuth();

    const safeName = sanitizeAthleteProfileMediaName(file.name);
    const kind = options.kind === 'profile-photo' ? 'profile-photo' : 'clip';
    const storagePath = `athlete-profile-media/${userId}/${profileId}/${Date.now()}_${kind}_${safeName}`;
    const storageRef = ref(imageStorage, storagePath);
    const snapshot = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);
    const mimeType = String(file.type || '').trim();
    const mediaType = kind === 'profile-photo'
        ? 'image'
        : (mimeType.startsWith('video/') ? 'video' : (mimeType.startsWith('image/') ? 'image' : 'link'));

    return {
        url,
        storagePath,
        mimeType,
        sizeBytes: Number.isFinite(file.size) ? file.size : null,
        uploadedAtMs: Date.now(),
        mediaType
    };
}

export async function deleteAthleteProfileMediaByPath(storagePath) {
    if (!storagePath) return;
    const storageRef = ref(imageStorage, storagePath);
    await deleteObject(storageRef);
}

export async function listAthleteProfilesForParent(userId) {
    const snapshot = await getDocs(query(
        collection(db, 'athleteProfiles'),
        where('parentUserId', '==', userId)
    ));

    return snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
        .sort((a, b) => {
            const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
            const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
            return bTime - aTime;
        });
}

export async function getAthleteProfile(profileId) {
    const profileRef = doc(db, 'athleteProfiles', profileId);
    const profileSnap = await getDoc(profileRef);
    if (!profileSnap.exists()) {
        return null;
    }

    const profile = { id: profileSnap.id, ...(profileSnap.data() || {}) };
    const currentUserId = auth.currentUser?.uid || null;
    const isOwner = currentUserId && profile.parentUserId === currentUserId;
    if (profile.privacy !== 'public' && !isOwner) {
        return null;
    }

    return profile;
}

export async function saveAthleteProfile(userId, draft, options = {}) {
    const userProfile = await getUserProfile(userId);
    const parentLinks = Array.isArray(userProfile?.parentOf) ? userProfile.parentOf : [];
    const allowedSeasons = resolveAllowedAthleteSeasonLinks(parentLinks);
    const normalized = normalizeAthleteProfileDraft(draft);
    const selectedSeasonKeys = normalized.selectedSeasonKeys.filter((key) => allowedSeasons.has(key));

    if (!selectedSeasonKeys.length) {
        throw new Error('Select at least one linked season to build an athlete profile.');
    }

    const seasonSummaries = [];
    for (const seasonKey of selectedSeasonKeys) {
        const seasonLink = allowedSeasons.get(seasonKey);
        if (!seasonLink) {
            console.warn(`Season key ${seasonKey} not found in allowed seasons, skipping`);
            continue;
        }

        const summary = await buildAthleteProfileSeasonSummary(seasonLink);
        if (summary) seasonSummaries.push(summary);
    }

    if (!seasonSummaries.length) {
        throw new Error('No eligible linked seasons were found for this athlete profile.');
    }

    const coverSeason = seasonSummaries.find((season) => season.playerPhotoUrl) || seasonSummaries[0];
    const profileRef = options.profileId
        ? doc(db, 'athleteProfiles', options.profileId)
        : doc(collection(db, 'athleteProfiles'));
    const existingSnap = options.profileId ? await getDoc(profileRef) : null;
    const existingProfile = existingSnap?.exists() ? { id: existingSnap.id, ...(existingSnap.data() || {}) } : null;
    if (existingProfile && existingProfile.parentUserId !== userId) {
        throw new Error('You do not have permission to edit this athlete profile.');
    }

    const cleanupPaths = collectAthleteProfileMediaCleanupPaths(existingProfile || {}, normalized);
    const payload = {
        parentUserId: userId,
        athlete: {
            name: normalized.athlete.name || coverSeason.playerName,
            headline: normalized.athlete.headline
        },
        bio: normalized.bio,
        privacy: normalized.privacy,
        clips: normalized.clips,
        gameClips: seasonSummaries.flatMap((season) => Array.isArray(season.gameClips) ? season.gameClips : []),
        seasons: seasonSummaries,
        careerSummary: summarizeAthleteProfileCareer(seasonSummaries),
        profilePhotoUrl: normalized.profilePhoto?.url || coverSeason.playerPhotoUrl || null,
        profilePhotoPath: normalized.profilePhoto?.storagePath || null,
        profilePhotoMimeType: normalized.profilePhoto?.mimeType || null,
        profilePhotoSizeBytes: normalized.profilePhoto?.sizeBytes ?? null,
        profilePhotoUploadedAtMs: normalized.profilePhoto?.uploadedAtMs ?? null,
        updatedAt: serverTimestamp()
    };

    if (!existingProfile) {
        payload.createdAt = serverTimestamp();
    }

    await setDoc(profileRef, payload, { merge: true });

    const cleanupResults = await Promise.allSettled(cleanupPaths.map((path) => deleteAthleteProfileMediaByPath(path)));
    cleanupResults.forEach((result) => {
        if (result.status === 'rejected') {
            console.warn('Failed to clean up removed athlete profile media', result.reason);
        }
    });

    return {
        id: profileRef.id,
        ...(existingProfile || {}),
        ...payload
    };
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

function getNormalizedCertificateEmail(user) {
    return String(user?.email || user?.profileEmail || '').trim().toLowerCase();
}

function hasCertificateCoachAccess(user, team) {
    if (!user || !team) return false;
    if (team.ownerId === user.uid) return true;
    if (user.isAdmin === true) return true;

    const email = getNormalizedCertificateEmail(user);
    const adminEmails = Array.isArray(team.adminEmails) ? team.adminEmails : [];
    return Boolean(email && adminEmails.map((item) => String(item || '').trim().toLowerCase()).includes(email));
}

function hasCertificateParentPlayerAccess(user, teamId, playerId) {
    if (!user || !teamId || !playerId) return false;
    const key = `${teamId}::${playerId}`;
    if (Array.isArray(user.parentPlayerKeys) && user.parentPlayerKeys.includes(key)) return true;
    return Array.isArray(user.parentOf) && user.parentOf.some((entry) => (
        entry?.teamId === teamId && entry?.playerId === playerId
    ));
}

export function canAccessCertificates(user, team) {
    return hasCertificateCoachAccess(user, team);
}

export function canViewSavedCertificate(user, team, certificate) {
    if (!user || !team || !certificate) return false;
    if (hasCertificateCoachAccess(user, team)) return true;
    return certificate.status === 'published'
        && hasCertificateParentPlayerAccess(user, team.id, certificate.playerId);
}

function getCertificateActor() {
    const user = auth.currentUser || {};
    return {
        actorId: user.uid || null,
        actorEmail: user.email || null
    };
}

function getCertificateTimestamp(value = null) {
    return value || Timestamp.now();
}

function getUpdatedCertificatePayload(data = {}, now = Timestamp.now()) {
    const actor = getCertificateActor();
    return {
        ...data,
        updatedAt: getCertificateTimestamp(data.updatedAt || now),
        updatedBy: data.updatedBy || actor.actorId
    };
}

async function writeCertificateAudit(teamId, certificateId, event = {}) {
    if (!teamId || !certificateId) return null;
    const actor = getCertificateActor();
    const eventRef = await addDoc(collection(db, 'teams', teamId, 'certificates', certificateId, 'audit'), {
        action: event.action || 'updated',
        format: event.format || null,
        actorId: event.actorId || actor.actorId,
        actorEmail: event.actorEmail || actor.actorEmail,
        at: event.at || Timestamp.now()
    });
    return eventRef.id;
}

export async function getCertificateDefaults(teamId) {
    if (!teamId) return null;
    const snap = await getDoc(doc(db, 'teams', teamId, 'settings', 'certificateDefaults'));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function setCertificateDefaults(teamId, defaults = {}) {
    if (!teamId) throw new Error('Missing team for certificate defaults');
    const actor = getCertificateActor();
    const payload = {
        ...defaults,
        updatedAt: Timestamp.now(),
        updatedBy: actor.actorId
    };
    await setDoc(doc(db, 'teams', teamId, 'settings', 'certificateDefaults'), payload, { merge: true });
    return payload;
}

export async function listCertificateAssets(teamId) {
    if (!teamId) return [];
    const assetsRef = collection(db, 'teams', teamId, 'certificateAssets');
    try {
        const snapshot = await getDocs(query(assetsRef, orderBy('uploadedAt', 'desc')));
        return snapshot.docs.map((assetDoc) => ({ id: assetDoc.id, ...assetDoc.data() }));
    } catch (error) {
        const snapshot = await getDocs(assetsRef);
        return snapshot.docs
            .map((assetDoc) => ({ id: assetDoc.id, ...assetDoc.data() }))
            .sort((a, b) => {
                const aTime = a.uploadedAt?.toMillis ? a.uploadedAt.toMillis() : 0;
                const bTime = b.uploadedAt?.toMillis ? b.uploadedAt.toMillis() : 0;
                return bTime - aTime;
            });
    }
}

export async function writeCertificateBatchAudit(teamId, batchId, event = {}) {
    if (!teamId || !batchId) return null;
    const actor = getCertificateActor();
    const eventRef = await addDoc(collection(db, 'teams', teamId, 'certificateBatches', batchId, 'audit'), {
        action: event.action || 'updated',
        actorId: event.actorId || actor.actorId,
        actorEmail: event.actorEmail || actor.actorEmail,
        at: event.at || Timestamp.now()
    });
    return eventRef.id;
}

export async function createCertificateBatch(teamId, data = {}) {
    if (!teamId) throw new Error('Missing team for certificate batch');
    const actor = getCertificateActor();
    const now = Timestamp.now();
    const docRef = await addDoc(collection(db, 'teams', teamId, 'certificateBatches'), {
        ...data,
        status: data.status || 'draft',
        createdBy: data.createdBy || actor.actorId,
        createdAt: data.createdAt || now,
        updatedBy: data.updatedBy || actor.actorId,
        updatedAt: data.updatedAt || now
    });
    await writeCertificateBatchAudit(teamId, docRef.id, { action: 'created' });
    return docRef.id;
}

export async function updateCertificateBatch(teamId, batchId, data = {}) {
    if (!teamId || !batchId) throw new Error('Missing certificate batch');
    const payload = getUpdatedCertificatePayload(data);
    await updateDoc(doc(db, 'teams', teamId, 'certificateBatches', batchId), payload);
    await writeCertificateBatchAudit(teamId, batchId, { action: data.status === 'published' ? 'published' : 'updated' });
}

export async function getCertificateBatch(teamId, batchId) {
    if (!teamId || !batchId) return null;
    const snap = await getDoc(doc(db, 'teams', teamId, 'certificateBatches', batchId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listCertificateBatches(teamId, options = {}) {
    if (!teamId) return [];
    const batchesRef = collection(db, 'teams', teamId, 'certificateBatches');
    const status = String(options.status || '').trim();
    try {
        const baseQuery = status
            ? query(batchesRef, where('status', '==', status), orderBy('updatedAt', 'desc'), limit(options.limit || 100))
            : query(batchesRef, orderBy('updatedAt', 'desc'), limit(options.limit || 100));
        const snapshot = await getDocs(baseQuery);
        return snapshot.docs.map((batchDoc) => ({ id: batchDoc.id, ...batchDoc.data() }));
    } catch (error) {
        const snapshot = await getDocs(batchesRef);
        return snapshot.docs
            .map((batchDoc) => ({ id: batchDoc.id, ...batchDoc.data() }))
            .filter((batch) => !status || batch.status === status)
            .sort((a, b) => {
                const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
                const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
                return bTime - aTime;
            })
            .slice(0, options.limit || 100);
    }
}

export async function createCertificate(teamId, data = {}) {
    if (!teamId) throw new Error('Missing team for certificate');
    const actor = getCertificateActor();
    const now = Timestamp.now();
    const docRef = await addDoc(collection(db, 'teams', teamId, 'certificates'), {
        ...data,
        status: data.status || 'draft',
        createdBy: data.createdBy || actor.actorId,
        createdAt: data.createdAt || now,
        updatedBy: data.updatedBy || actor.actorId,
        updatedAt: data.updatedAt || now
    });
    await writeCertificateAudit(teamId, docRef.id, { action: 'created' });
    return docRef.id;
}

export async function updateCertificate(teamId, certificateId, data = {}, auditEvent = null) {
    if (!teamId || !certificateId) throw new Error('Missing certificate');
    const payload = getUpdatedCertificatePayload(data);
    await updateDoc(doc(db, 'teams', teamId, 'certificates', certificateId), payload);
    await writeCertificateAudit(teamId, certificateId, auditEvent || { action: data.status === 'published' ? 'published' : 'updated' });
}

export async function getCertificate(teamId, certificateId) {
    if (!teamId || !certificateId) return null;
    const snap = await getDoc(doc(db, 'teams', teamId, 'certificates', certificateId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listCertificates(teamId, options = {}) {
    if (!teamId) return [];
    const certsRef = collection(db, 'teams', teamId, 'certificates');
    const status = String(options.status || '').trim();
    try {
        const baseQuery = status
            ? query(certsRef, where('status', '==', status), orderBy('updatedAt', 'desc'), limit(options.limit || 250))
            : query(certsRef, orderBy('updatedAt', 'desc'), limit(options.limit || 250));
        const snapshot = await getDocs(baseQuery);
        return snapshot.docs.map((certDoc) => ({ id: certDoc.id, ...certDoc.data() }));
    } catch (error) {
        const snapshot = await getDocs(certsRef);
        return snapshot.docs
            .map((certDoc) => ({ id: certDoc.id, ...certDoc.data() }))
            .filter((cert) => !status || cert.status === status)
            .sort((a, b) => {
                const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
                const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
                return bTime - aTime;
            })
            .slice(0, options.limit || 250);
    }
}

export async function listCertificatesForPlayer(teamId, playerId, options = {}) {
    if (!teamId || !playerId) return [];
    const certsRef = collection(db, 'teams', teamId, 'certificates');
    const status = String(options.status || 'published').trim();
    try {
        const snapshot = await getDocs(query(
            certsRef,
            where('playerId', '==', playerId),
            where('status', '==', status),
            orderBy('updatedAt', 'desc'),
            limit(options.limit || 25)
        ));
        return snapshot.docs.map((certDoc) => ({ id: certDoc.id, ...certDoc.data() }));
    } catch (error) {
        const snapshot = await getDocs(certsRef);
        return snapshot.docs
            .map((certDoc) => ({ id: certDoc.id, ...certDoc.data() }))
            .filter((cert) => cert.playerId === playerId && (!status || cert.status === status))
            .sort((a, b) => {
                const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
                const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
                return bTime - aTime;
            })
            .slice(0, options.limit || 25);
    }
}

export async function archiveCertificate(teamId, certificateId) {
    await updateCertificate(teamId, certificateId, { status: 'archived' }, { action: 'archived' });
}


function getTeamEmailDraftsRef(teamId) {
    return collection(db, 'teams', teamId, 'emailDrafts');
}

function getTeamEmailTemplatesRef(teamId) {
    return collection(db, 'teams', teamId, 'emailTemplates');
}

function normalizeEmailDraftRecipient(recipient = {}) {
    const email = String(recipient.email || '').trim().toLowerCase();
    return {
        key: String(recipient.key || `email:${email}`).trim(),
        email,
        name: String(recipient.name || email).trim(),
        detail: String(recipient.detail || '').trim()
    };
}

function normalizeTeamEmailTemplatePayload(template = {}) {
    const name = String(template.name || '').trim();
    const subject = String(template.subject || '').trim();
    const body = String(template.body || '').trim();

    if (!name) throw new Error('Enter a template name before saving.');
    if (!subject) throw new Error('Enter a subject before saving.');
    if (!body) throw new Error('Enter a body before saving.');

    return {
        name,
        subject,
        body,
        authorId: template.authorId || auth.currentUser?.uid || null,
        authorEmail: template.authorEmail || auth.currentUser?.email || null,
        authorName: template.authorName || null
    };
}

function normalizeTeamEmailDraftPayload(draft = {}) {
    const subject = String(draft.subject || '').trim();
    const body = String(draft.body || '').trim();
    const recipients = Array.isArray(draft.recipients)
        ? draft.recipients.map(normalizeEmailDraftRecipient).filter((recipient) => (
            recipient.key && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)
        ))
        : [];
    const recipientIds = Array.from(new Set(
        (Array.isArray(draft.recipientIds) ? draft.recipientIds : recipients.map((recipient) => recipient.key))
            .map((recipientId) => String(recipientId || '').trim())
            .filter(Boolean)
    ));

    if (recipientIds.length === 0) throw new Error('Choose at least one recipient before saving.');
    if (!subject) throw new Error('Enter a subject before saving.');
    if (!body) throw new Error('Enter a body before saving.');

    return {
        subject,
        body,
        recipientIds,
        recipients,
        recipientEmails: recipients.map((recipient) => recipient.email),
        authorId: draft.authorId || auth.currentUser?.uid || null,
        authorEmail: draft.authorEmail || auth.currentUser?.email || null,
        authorName: draft.authorName || null,
        status: 'draft'
    };
}

export async function getTeamEmailTemplates(teamId) {
    if (!teamId) return [];
    const templatesRef = getTeamEmailTemplatesRef(teamId);
    try {
        const snapshot = await getDocs(query(templatesRef, orderBy('updatedAt', 'desc')));
        return snapshot.docs.map((templateDoc) => ({ id: templateDoc.id, ...templateDoc.data() }));
    } catch (error) {
        const snapshot = await getDocs(templatesRef);
        return snapshot.docs
            .map((templateDoc) => ({ id: templateDoc.id, ...templateDoc.data() }))
            .sort((a, b) => {
                const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
                const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
                return bTime - aTime;
            });
    }
}

export async function saveTeamEmailTemplate(teamId, template, { templateId = null } = {}) {
    if (!teamId) throw new Error('Team is required to save an email template.');
    const now = Timestamp.now();
    const payload = {
        ...normalizeTeamEmailTemplatePayload(template),
        updatedAt: now
    };

    if (templateId) {
        const templateRef = doc(db, 'teams', teamId, 'emailTemplates', templateId);
        await setDoc(templateRef, payload, { merge: true });
        return { id: templateId, ...payload };
    }

    const templateRef = await addDoc(getTeamEmailTemplatesRef(teamId), {
        ...payload,
        createdAt: now
    });
    return { id: templateRef.id, ...payload, createdAt: now };
}

export async function deleteTeamEmailTemplate(teamId, templateId) {
    if (!teamId || !templateId) throw new Error('Team and template are required.');
    await deleteDoc(doc(db, 'teams', teamId, 'emailTemplates', templateId));
}

export async function getTeamEmailDrafts(teamId) {
    if (!teamId) return [];
    const draftsRef = getTeamEmailDraftsRef(teamId);
    try {
        const snapshot = await getDocs(query(draftsRef, orderBy('updatedAt', 'desc')));
        return snapshot.docs.map((draftDoc) => ({ id: draftDoc.id, ...draftDoc.data() }));
    } catch (error) {
        const snapshot = await getDocs(draftsRef);
        return snapshot.docs
            .map((draftDoc) => ({ id: draftDoc.id, ...draftDoc.data() }))
            .sort((a, b) => {
                const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
                const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
                return bTime - aTime;
            });
    }
}

export async function saveTeamEmailDraft(teamId, draft, { draftId = null } = {}) {
    const now = Timestamp.now();
    const payload = {
        ...normalizeTeamEmailDraftPayload(draft),
        updatedAt: now
    };
    if (Array.isArray(draft?.attachments)) {
        const attachments = normalizeTeamEmailAttachments(draft.attachments);
        payload.attachments = attachments;
        payload.attachmentTotalBytes = getTeamEmailAttachmentTotalBytes(attachments);
    }

    if (draftId) {
        const draftRef = doc(db, 'teams', teamId, 'emailDrafts', draftId);
        await setDoc(draftRef, payload, { merge: true });
        return { id: draftId, ...payload };
    }

    const draftRef = await addDoc(getTeamEmailDraftsRef(teamId), {
        ...payload,
        createdAt: now
    });
    return { id: draftRef.id, ...payload, createdAt: now };
}

function getTeamChatMessagesRef(teamId, conversationId = DEFAULT_TEAM_CONVERSATION_ID) {
    if (isDefaultTeamConversation(conversationId)) {
        return collection(db, 'teams', teamId, 'chatMessages');
    }
    return collection(db, 'teams', teamId, 'chatConversations', conversationId, 'chatMessages');
}

/**
 * Get conversations for a team. The default team-wide channel is virtual and keeps
 * using teams/{teamId}/chatMessages for backwards compatibility.
 */
export async function getChatConversations(teamId, user = null, { team = null, canModerate = false } = {}) {
    const conversationsRef = collection(db, 'teams', teamId, 'chatConversations');
    const normalizedEmail = user?.email ? String(user.email).trim().toLowerCase() : '';
    const participantQueries = canModerate
        ? [query(conversationsRef, orderBy('updatedAt', 'desc'))]
        : [
            ...(user?.uid ? [
                query(conversationsRef, where('participantIds', 'array-contains', user.uid), orderBy('updatedAt', 'desc')),
                query(conversationsRef, where('participantIds', 'array-contains', `user:${user.uid}`), orderBy('updatedAt', 'desc'))
            ] : []),
            ...(normalizedEmail ? [
                query(conversationsRef, where('participantIds', 'array-contains', `email:${normalizedEmail}`), orderBy('updatedAt', 'desc'))
            ] : [])
        ];
    const snapshots = participantQueries.length > 0
        ? await Promise.all(participantQueries.map((conversationQuery) => getDocs(conversationQuery)))
        : [];
    const conversationsById = new Map();
    snapshots.forEach((snapshot) => {
        snapshot.docs.forEach((d) => {
            conversationsById.set(d.id, { id: d.id, ...d.data() });
        });
    });
    const stored = Array.from(conversationsById.values())
        .filter((conversation) => !user || isUserInConversation(conversation, user, { canModerate }));
    stored.sort((a, b) => {
        const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : new Date(a.updatedAt || 0).getTime();
        const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : new Date(b.updatedAt || 0).getTime();
        return bTime - aTime;
    });

    return [buildDefaultTeamConversation(team), ...stored];
}

/**
 * Create or update a lightweight conversation record.
 */
export async function upsertChatConversation(teamId, conversation = {}) {
    const {
        type = 'group',
        participantIds = [],
        participantRoles = [],
        mutedBy = [],
        name = null
    } = conversation;
    const normalizedType = normalizeConversationType(type);
    const normalizedParticipantIds = normalizeConversationParticipantIds(participantIds);
    const conversationId = buildConversationId(normalizedType, normalizedParticipantIds);
    const now = Timestamp.now();
    const conversationRef = doc(db, 'teams', teamId, 'chatConversations', conversationId);
    const existing = await getDoc(conversationRef);
    const normalizedParticipantRoles = Array.from(new Set((Array.isArray(participantRoles) ? participantRoles : [])
        .map((role) => String(role || '').trim())
        .filter(Boolean)))
        .sort();
    const normalizedMutedBy = Array.from(new Set(Array.isArray(mutedBy) ? mutedBy : []));
    const hasMutedByUpdate = Object.prototype.hasOwnProperty.call(conversation, 'mutedBy');

    if (existing.exists()) {
        if (hasMutedByUpdate) {
            await setDoc(conversationRef, {
                mutedBy: normalizedMutedBy,
                updatedAt: now
            }, { merge: true });
        }
        return {
            id: conversationId,
            ...existing.data(),
            ...(hasMutedByUpdate ? {
                mutedBy: normalizedMutedBy,
                updatedAt: now
            } : {}),
            participantIds: existing.data()?.participantIds || normalizedParticipantIds,
            participantRoles: existing.data()?.participantRoles || normalizedParticipantRoles,
            name: existing.data()?.name || name || null
        };
    }

    const payload = {
        type: normalizedType,
        participantIds: normalizedParticipantIds,
        participantRoles: normalizedParticipantRoles,
        mutedBy: normalizedMutedBy,
        updatedAt: now
    };
    if (name) {
        payload.name = name;
    }
    payload.createdAt = now;
    await setDoc(conversationRef, payload, { merge: true });
    return { id: conversationId, ...payload };
}

/**
 * Get chat messages for a team with pagination support.
 * Returns messages ordered by createdAt descending (newest first).
 */
export async function getChatMessages(teamId, { limit = 50, startAfterDoc = null, conversationId = DEFAULT_TEAM_CONVERSATION_ID } = {}) {
    const messagesRef = getTeamChatMessagesRef(teamId, conversationId);
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
export function subscribeToChatMessages(teamId, { limit = 50, conversationId = DEFAULT_TEAM_CONVERSATION_ID } = {}, onMessages, onError = null) {
    const messagesRef = getTeamChatMessagesRef(teamId, conversationId);
    const q = query(messagesRef, orderBy('createdAt', 'desc'), limitQuery(limit));
    return onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data(), _doc: d }));
        const oldestDoc = snapshot.docs.length ? snapshot.docs[snapshot.docs.length - 1] : null;
        onMessages(docs, oldestDoc);
    }, (error) => {
        if (onError) {
            onError(error);
        } else {
            console.error('Error subscribing to chat messages:', error);
        }
    });
}

export async function sendTeamEmail(teamId, {
    subject,
    body,
    targetType = 'full_team',
    recipientIds = []
} = {}) {
    const callable = httpsCallable(functions, 'sendTeamEmail');
    const result = await callable({
        teamId,
        subject,
        body,
        targetType,
        recipientIds
    });
    return result.data;
}

export async function postSharedGameCancellationNotification({
    teamId,
    gameId,
    counterpartTeamId,
    text,
    senderName,
    senderEmail
} = {}) {
    const callable = httpsCallable(functions, 'postSharedGameCancellationNotification');
    const result = await callable({
        teamId,
        gameId,
        counterpartTeamId,
        text,
        senderName,
        senderEmail
    });
    return result.data;
}

export async function createRegistrationCheckoutSession(
    teamId,
    formId,
    registrationId,
    selectedOptionId,
    paymentPlanId,
    quantity,
    amountCents,
    currency,
    checkoutAttemptToken = '',
    retryPayment = false
) {
    const callable = httpsCallable(functions, 'createStripeRegistrationCheckout');
    const result = await callable({
        teamId,
        formId,
        registrationId,
        selectedOptionId,
        paymentPlanId,
        quantity,
        amountCents,
        currency,
        checkoutAttemptToken,
        retryPayment
    });
    return result.data;
}

export async function getSentTeamEmails(teamId, { limit = 25 } = {}) {
    const emailsRef = collection(db, 'teams', teamId, 'teamEmails');
    const snapshot = await getDocs(query(emailsRef, orderBy('sentAt', 'desc'), limitQuery(limit)));
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data(), _doc: d }));
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
    attachments = [],
    imageUrl = null,
    imagePath = null,
    imageName = null,
    imageType = null,
    imageSize = null,
    ai = false,
    aiName = null,
    aiQuestion = null,
    aiMeta = null,
    targetType = 'full_team',
    recipientIds = [],
    targetRole = null,
    conversationId = DEFAULT_TEAM_CONVERSATION_ID
}) {
    const messagesRef = getTeamChatMessagesRef(teamId, conversationId);
    const createdAt = Timestamp.now();
    const normalizedMedia = normalizeChatAttachments(
        attachments.length > 0
            ? attachments
            : (imageUrl ? [{
                url: imageUrl,
                path: imagePath,
                name: imageName,
                type: imageType || 'image/*',
                size: imageSize
            }] : [])
    );
    const storedAttachments = normalizedMedia.attachments.map((attachment) => ({
        ...attachment,
        uploadedAt: createdAt
    }));
    const allowedTargetTypes = new Set(['full_team', 'staff', 'individuals']);
    const normalizedTargetType = allowedTargetTypes.has(targetType) ? targetType : 'full_team';
    const normalizedRecipientIds = normalizedTargetType === 'individuals'
        ? Array.from(new Set((Array.isArray(recipientIds) ? recipientIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)))
        : [];
    const effectiveTargetType = normalizedTargetType === 'individuals' && normalizedRecipientIds.length === 0
        ? 'full_team'
        : normalizedTargetType;
    if (isDefaultTeamConversation(conversationId) && effectiveTargetType !== 'full_team') {
        throw new Error('Targeted team chat messages must use a non-default conversation.');
    }
    const docRef = await addDoc(messagesRef, {
        text,
        senderId,
        senderName: senderName || null,
        senderEmail: senderEmail || null,
        senderPhotoUrl: senderPhotoUrl || null,
        attachments: storedAttachments,
        imageUrl: normalizedMedia.legacyImage.imageUrl || imageUrl || null,
        imagePath: normalizedMedia.legacyImage.imagePath || imagePath || null,
        imageName: normalizedMedia.legacyImage.imageName || imageName || null,
        imageType: normalizedMedia.legacyImage.imageType || imageType || null,
        imageSize: Number.isFinite(normalizedMedia.legacyImage.imageSize)
            ? normalizedMedia.legacyImage.imageSize
            : (Number.isFinite(imageSize) ? imageSize : null),
        createdAt,
        editedAt: null,
        deleted: false,
        ai: ai === true,
        aiName: aiName || null,
        aiQuestion: aiQuestion || null,
        aiMeta: aiMeta || null,
        targetType: effectiveTargetType,
        recipientIds: normalizedRecipientIds,
        targetRole: effectiveTargetType === 'staff' ? (targetRole || 'staff') : null,
        conversationId: isDefaultTeamConversation(conversationId) ? null : conversationId
    });

    if (!isDefaultTeamConversation(conversationId)) {
        const conversationRef = doc(db, 'teams', teamId, 'chatConversations', conversationId);
        await setDoc(conversationRef, {
            lastMessageAt: createdAt,
            updatedAt: createdAt
        }, { merge: true });
    }

    return docRef;
}

/**
 * Edit an existing chat message (sender only).
 */
export async function editChatMessage(teamId, messageId, newText, { conversationId = DEFAULT_TEAM_CONVERSATION_ID } = {}) {
    const messageRef = isDefaultTeamConversation(conversationId)
        ? doc(db, 'teams', teamId, 'chatMessages', messageId)
        : doc(db, 'teams', teamId, 'chatConversations', conversationId, 'chatMessages', messageId);
    return await updateDoc(messageRef, {
        text: newText,
        editedAt: Timestamp.now()
    });
}

/**
 * Soft-delete a chat message.
 */
export async function deleteChatMessage(teamId, messageId, { conversationId = DEFAULT_TEAM_CONVERSATION_ID } = {}) {
    const messageRef = isDefaultTeamConversation(conversationId)
        ? doc(db, 'teams', teamId, 'chatMessages', messageId)
        : doc(db, 'teams', teamId, 'chatConversations', conversationId, 'chatMessages', messageId);
    return await updateDoc(messageRef, {
        deleted: true
    });
}

export async function toggleChatReaction(teamId, messageId, reactionKey, userId, { conversationId = DEFAULT_TEAM_CONVERSATION_ID } = {}) {
    if (!CHAT_REACTION_KEYS.has(reactionKey)) {
        throw new Error('Unsupported reaction key');
    }
    if (!userId) {
        throw new Error('Missing userId for reaction');
    }

    const messageRef = isDefaultTeamConversation(conversationId)
        ? doc(db, 'teams', teamId, 'chatMessages', messageId)
        : doc(db, 'teams', teamId, 'chatConversations', conversationId, 'chatMessages', messageId);
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
    const lastReadAt = Timestamp.now();
    return await updateDoc(userRef, {
        [`chatLastRead.${teamId}`]: lastReadAt,
        [`teamChatState.${teamId}.lastReadAt`]: lastReadAt
    });
}

export async function updateChatMuted(userId, teamId, conversationId = DEFAULT_TEAM_CONVERSATION_ID) {
    const userRef = doc(db, 'users', userId);
    const mutedAt = Timestamp.now();
    const updates = {
        teamChatState: {
            [teamId]: {
                mutedConversations: {
                    [conversationId]: mutedAt
                }
            }
        }
    };
    if (isDefaultTeamConversation(conversationId)) {
        updates.chatMuted = {
            [teamId]: mutedAt
        };
    }
    return await setDoc(userRef, updates, { merge: true });
}

export async function clearChatMuted(userId, teamId, conversationId = DEFAULT_TEAM_CONVERSATION_ID) {
    const userRef = doc(db, 'users', userId);
    const updates = {
        teamChatState: {
            [teamId]: {
                mutedConversations: {
                    [conversationId]: deleteField()
                }
            }
        }
    };
    if (isDefaultTeamConversation(conversationId)) {
        updates.chatMuted = {
            [teamId]: deleteField()
        };
    }
    return await setDoc(userRef, updates, { merge: true });
}

/**
 * Get unread message count for a team chat
 * @param {string} userId - The user's ID
 * @param {string} teamId - The team ID
 * @returns {Promise<number>} Number of unread messages
 */
export async function getUnreadChatCount(userId, teamId) {
    const userDoc = await getDoc(doc(db, 'users', userId));
    const userData = userDoc.data();
    const lastRead = userData?.teamChatState?.[teamId]?.lastReadAt || userData?.chatLastRead?.[teamId] || null;
    const messagesRef = collection(db, 'teams', teamId, 'chatMessages');
    const unreadConstraints = [];

    if (lastRead) {
        unreadConstraints.push(where('createdAt', '>', lastRead));
    }

    const totalUnreadQuery = query(messagesRef, ...unreadConstraints);
    const ownUnreadQuery = query(messagesRef, ...unreadConstraints, where('senderId', '==', userId));

    const [totalUnreadSnapshot, ownUnreadSnapshot] = await Promise.all([
        getCountFromServer(totalUnreadQuery),
        getCountFromServer(ownUnreadQuery)
    ]);

    const totalUnread = Number(totalUnreadSnapshot?.data?.().count || 0);
    const ownUnread = Number(ownUnreadSnapshot?.data?.().count || 0);
    return Math.max(0, totalUnread - ownUnread);
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
 * Subscribe to manager-only team stats for a game.
 */
export function subscribeTeamStats(teamId, gameId, callback, onError) {
    const ref = getGameSubcollectionRef(teamId, gameId, 'teamStats');
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
function isExcludedHomepageUpcomingStatus(status) {
    if (typeof status !== 'string') {
        return false;
    }

    const normalizedStatus = status.trim().toLowerCase();
    return normalizedStatus === 'completed'
        || normalizedStatus === 'cancelled'
        || normalizedStatus === 'canceled'
        || normalizedStatus === 'deleted';
}

export async function getUpcomingLiveGames(limitCount = 10) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const fetchBatchSize = Math.max(limitCount * 3, 20);

    const gamesRef = collectionGroup(db, 'games');
    const queryConstraints = [
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
                if (gameData.type === 'practice' || isExcludedHomepageUpcomingStatus(gameData.status) || gameData.liveStatus === 'completed') {
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
            if (gameData.type === 'practice' || isExcludedHomepageUpcomingStatus(gameData.status) || gameData.liveStatus === 'completed') {
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
                && !isExcludedHomepageUpcomingStatus(game.status)
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

export async function uploadDrillDiagram(teamId, drillId, file) {
    await ensureImageAuth();
    const userId = auth.currentUser?.uid;
    const { imagePath, fallbackPath } = buildDrillDiagramUploadPaths(teamId, drillId, userId, file?.name, Date.now());
    try {
        const storageRef = ref(imageStorage, imagePath);
        const snapshot = await uploadBytes(storageRef, file);
        return await getDownloadURL(snapshot.ref);
    } catch (error) {
        const code = error?.code || '';
        if (code === 'storage/unauthorized' || code === 'storage/unauthenticated' || code === 'storage/unknown') {
            // Match fallback behavior used by chat/stat-sheet uploads.
            if (!teamId || !userId) {
                throw new Error('Team-scoped drill fallback upload requires a signed-in team user.');
            }
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

function isEligibleOpenOfficiatingSlotParticipant(team = {}, userProfile = {}, user = {}) {
    const uid = String(user?.uid || '').trim();
    const email = String(user?.email || '').trim().toLowerCase();
    if (!uid) return false;
    if (team.ownerId === uid) return true;
    if (email && Array.isArray(team.adminEmails) && team.adminEmails.map((adminEmail) => String(adminEmail || '').trim().toLowerCase()).includes(email)) return true;
    if (userProfile?.isAdmin === true) return true;
    if (Array.isArray(userProfile?.parentTeamIds) && userProfile.parentTeamIds.includes(team.id)) return true;
    return false;
}

export async function claimOpenOfficiatingSlot(teamId, gameId, slotId, official = auth.currentUser) {
    const [team, userProfile] = await Promise.all([
        getTeam(teamId, { includeInactive: true }),
        official?.uid ? getUserProfile(official.uid) : Promise.resolve(null)
    ]);
    if (!isEligibleOpenOfficiatingSlotParticipant(team || {}, userProfile || {}, official || {})) {
        throw new Error('Only team owners, admins, or parents can claim open officiating slots.');
    }

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

export async function submitOfficiatingAssignmentResult(teamId, gameId, slotId, result, official = auth.currentUser) {
    const docRef = getGameDocRef(teamId, gameId);
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists()) throw new Error('Game not found');

        const game = snap.data() || {};
        if (String(game.status || '').trim().toLowerCase() === 'cancelled') {
            throw new Error('Cancelled games cannot accept final results.');
        }

        const timestamp = Timestamp.now();
        const officiatingSlots = updateOfficiatingSlotResult(game.officiatingSlots || [], slotId, result, official, {
            submittedAt: timestamp
        });
        const submittedResult = officiatingSlots.find((slot) => slot.id === slotId)?.submittedResult;
        if (!submittedResult) {
            throw new Error('Final result submission could not be recorded.');
        }

        transaction.update(docRef, {
            homeScore: submittedResult.homeScore,
            awayScore: submittedResult.awayScore,
            status: 'completed',
            liveStatus: 'completed',
            scoreUpdatedAt: timestamp,
            scoreUpdatedBy: submittedResult.submittedByUserId || String(official?.uid || '').trim() || null,
            officiatingSlots,
            officiatingCoverageStatus: computeOfficiatingCoverageStatus(officiatingSlots),
            officiatingUpdatedAt: timestamp
        });
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

async function getEventDateForAvailabilityCutoff(teamId, gameId) {
    const [masterId, instanceDate] = String(gameId || '').split('__');
    const gameRef = doc(db, `teams/${teamId}/games`, masterId || gameId);
    const snap = await getDoc(gameRef);
    if (!snap.exists()) return null;
    return resolveAvailabilityCutoffEventDate(snap.data(), instanceDate);
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
    const offerRef = doc(db, `teams/${teamId}/games/${gameId}/rideOffers`, offerId);
    const requestRef = doc(db, `teams/${teamId}/games/${gameId}/rideOffers/${offerId}/requests`, requestId);

    return runTransaction(db, async (tx) => {
        const [offerSnap, existingRequestSnap] = await Promise.all([tx.get(offerRef), tx.get(requestRef)]);
        if (!offerSnap.exists()) throw new Error('Ride offer not found.');

        const offer = offerSnap.data() || {};
        const offerStatus = normalizeRideOfferStatus(offer.status);
        if (offerStatus !== RIDE_OFFER_STATUS.OPEN) throw new Error('Ride offer is closed.');

        if (existingRequestSnap.exists()) {
            const existingRequest = existingRequestSnap.data() || {};
            const existingStatus = normalizeRideRequestStatus(existingRequest.status);
            if (existingStatus && existingStatus !== RIDE_REQUEST_STATUS.DECLINED && existingStatus !== RIDE_REQUEST_STATUS.WAITLISTED) {
                throw new Error('Ride request is already active.');
            }
        }

        const seatCapacity = toNonNegativeInteger(offer.seatCapacity, 0);
        const currentSeatCountConfirmed = toNonNegativeInteger(offer.seatCountConfirmed, 0);
        if (currentSeatCountConfirmed >= seatCapacity) throw new Error('Offer is full.');

        const requestedAt = Timestamp.now();
        const updatedAt = Timestamp.now();
        const requestPayload = {
            childName: childName || null,
            status: RIDE_REQUEST_STATUS.PENDING,
            requestedAt: requestedAt,
            respondedAt: null,
            updatedAt
        };

        if (existingRequestSnap.exists()) {
            tx.update(requestRef, requestPayload);
            return requestId;
        }

        tx.set(requestRef, {
            parentUserId: user.uid,
            childId,
            ...requestPayload
        });
        return requestId;
    });
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
    const playersWithPrivateContacts = await mergePlayerPrivateProfileParents(teamId, players);
    const fallbackByUser = await buildFallbackPlayerIdsByUser(teamId, rsvps);
    const breakdown = buildGameDayRsvpBreakdown({ players: playersWithPrivateContacts, rsvps, fallbackByUser });
    return { ...breakdown, players: playersWithPrivateContacts, rsvps };
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

// ===== ASSIGNMENT CLAIMS (snack sign-up) =====

/**
 * Claim an open assignment slot on behalf of the signed-in parent.
 * Fails if the slot is already claimed by someone else.
 */
export async function claimAssignmentSlot(teamId, gameId, role, { name } = {}) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error('You must be signed in to claim a slot.');
    const trimmedRole = (role || '').toString().trim();
    if (!trimmedRole) throw new Error('Role is required.');
    const trimmedName = (name || '').toString().trim();
    if (!trimmedName) throw new Error('Name is required.');

    const claimRef = doc(db, `teams/${teamId}/games/${gameId}/assignmentClaims`, trimmedRole);

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(claimRef);
        if (snap.exists()) throw new Error('This slot has already been claimed.');
        tx.set(claimRef, {
            claimedByUserId: user.uid,
            claimedByName: trimmedName.slice(0, 100),
            claimedAt: Timestamp.now()
        });
    });
}

/**
 * Release a claim on an assignment slot.
 * Parents may only release their own claim; admins may release any claim
 * (enforced by Firestore rules).
 */
export async function releaseAssignmentClaim(teamId, gameId, role) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error('You must be signed in to release a claim.');
    const trimmedRole = (role || '').toString().trim();
    if (!trimmedRole) throw new Error('Role is required.');

    const claimRef = doc(db, `teams/${teamId}/games/${gameId}/assignmentClaims`, trimmedRole);
    const snap = await getDoc(claimRef);
    if (!snap.exists()) return;
    await deleteDoc(claimRef);
}

/**
 * Load all assignment claims for a game/event.
 * Returns a plain object keyed by role name.
 */
export async function getAssignmentClaims(teamId, gameId) {
    const snap = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/assignmentClaims`));
    const claims = {};
    snap.forEach((docSnap) => {
        claims[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
    });
    return claims;
}

// ── Family Share Tokens ──────────────────────────────────────────────────────

function generateShareToken() {
    const bytes = new Uint8Array(20);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createFamilyShareToken(ownerUserId, children, label, extraCalendarUrls = []) {
    const normalizedChildren = normalizeFamilyShareChildren(children);
    if (!ownerUserId) {
        throw new Error('Sign in before creating a family share link.');
    }
    if (!normalizedChildren.length) {
        throw new Error('No linked players are available to share yet.');
    }
    const tokenId = generateShareToken();
    const now = Timestamp.now();
    await setDoc(doc(db, 'familyShareTokens', tokenId), {
        ownerUserId,
        label: String(label || '').trim().slice(0, 60),
        children: normalizedChildren,
        extraCalendarUrls: normalizeFamilyShareCalendarUrls(extraCalendarUrls),
        createdAt: now,
        updatedAt: now,
        active: true
    });
    return tokenId;
}

export async function updateFamilyShareTokenCalendars(tokenId, urls) {
    await updateDoc(doc(db, 'familyShareTokens', tokenId), {
        extraCalendarUrls: normalizeFamilyShareCalendarUrls(urls),
        updatedAt: Timestamp.now()
    });
}

export async function getFamilyShareToken(tokenId) {
    if (!tokenId) return null;
    const snap = await getDoc(doc(db, 'familyShareTokens', tokenId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

export async function listFamilyShareTokens(ownerUserId) {
    const q = query(
        collection(db, 'familyShareTokens'),
        where('ownerUserId', '==', ownerUserId)
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(token => token.active !== false)
        .sort((a, b) => {
            const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
            const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
            return bTime - aTime;
        });
}

export async function revokeFamilyShareToken(tokenId) {
    await updateDoc(doc(db, 'familyShareTokens', tokenId), {
        active: false,
        revokedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });
}
