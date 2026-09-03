#!/usr/bin/env node

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import {
    getMigrationAdminAppOptions,
    getMigrationFirestore
} from './firebase-admin-credential.mjs';
import { transformReplayClipValue } from '../js/replay-clip-sanitizer.js';

const require = createRequire(import.meta.url);
const {
    REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH,
    REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
    REPLAY_CLIP_IDENTITY_COLLECTION,
    REPLAY_COMPATIBILITY_DOCUMENT,
    REPLAY_PRIVATE_SCHEMA_VERSION,
    REPLAY_PROTECTED_IDENTITY_COLLECTION,
    REPLAY_READABLE_FIELDS,
    extractYouTubeVideoIdForProtection,
    getCompatibleReplayLifecycle,
    getExactReplayLifecycle,
    getReadableReplayArchiveState,
    getReplayClipYouTubeIdentityRecord,
    getReplayIdentityHash,
    getReplayUrlIdentityCandidates,
    getReplayProtectedUrlIdentityRecord,
    getReplayProtectedYouTubeIdentityRecord,
    getReplayProtectedYouTubeIdentityRecordFromHash,
    getReplayCompatibilityParentFingerprint,
    getReplayCompatibilityReceiptPath,
    getReplayCompatibilityState,
    inspectLegacyReplayArchive,
    normalizeReplayClipIdentity,
    normalizeReplayArchiveMigrationControl,
    normalizeReplayCompatibilityReceipt,
    normalizeReplayProtectedIdentity,
    normalizeStoredReplayArchive
} = require('../functions/replay-private-archive-core.cjs');
const {
    ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH,
    ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA,
    ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION,
    isAthleteProfileProjectionBoundaryReady
} = require('../functions/athlete-profile-projection-core.cjs');
const {
    GAME_FIXED_VIDEO_ID_FIELDS,
    GAME_FIXED_VIDEO_URL_FIELDS,
    STRUCTURED_REPLAY_CLIP_SCAN_TARGETS,
    STRUCTURED_REPLAY_CLIP_SOURCE_ROLES,
    buildStructuredReplayClipIdentityReport,
    extractStructuredReplayIdentitySources
} = require('../functions/replay-structured-media-core.cjs');

const APPLY = process.argv.includes('--apply');
const CLOSE_GATE = process.argv.includes('--close-gate');
const ACTIVATE_PROFILE_BOUNDARY = process.argv.includes('--activate-profile-boundary');
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'game-flow-c6311';
const DEFAULT_PAGE_SIZE = 200;
const REPLAY_CLIP_COLLECTION_FIELDS = Object.freeze([
    'clipRecords',
    'gameClips',
    'videoClips',
    'clips',
    'mediaClips',
    'highlightClips',
    'clipMetadata',
    'replayHighlights'
]);
const REPLAY_IDENTITY_CONTAINER_FIELDS = Object.freeze([
    'replayVideo',
    'recordedVideo',
    'videoReplay'
]);
const REPLAY_IDENTITY_FLAT_FIELDS = Object.freeze([
    'replayVideoUrl',
    'recordedVideoUrl',
    'videoReplayUrl',
    'archivedVideoUrl',
    'replayVideoPublicUrl'
]);
const REPLAY_COMPAT_MARKER_FIELDS = Object.freeze([
    'hasReplayVideo',
    'replayArchiveState',
    'replayMediaVersion',
    'replayMediaState',
    'replayMediaRevision'
]);

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function getMigrationReplayLifecycle(game = {}) {
    return getCompatibleReplayLifecycle(game);
}

function getMigrationInspectionGame(game = {}) {
    const lifecycle = getMigrationReplayLifecycle(game);
    if (!lifecycle.isCompleted || getExactReplayLifecycle(game).isCompleted) return game;
    return {
        ...game,
        ...(lifecycle.status ? { status: lifecycle.status } : { status: null }),
        ...(lifecycle.liveStatus ? { liveStatus: lifecycle.liveStatus } : { liveStatus: null })
    };
}

function hasNonemptyValue(value) {
    if (value === null || value === undefined) return false;
    return typeof value !== 'string' || Boolean(value.trim());
}

export function isCanonicalTeamGamePath(path) {
    return /^teams\/[^/]+\/games\/[^/]+$/.test(path || '');
}

export function isSharedGamePath(path) {
    return /(^|\/)sharedGames\/[^/]+$/.test(path || '');
}

export function isReplayPrivateArchivePath(path) {
    const suffix = '/privateReplay/archive';
    if (typeof path !== 'string' || !path.endsWith(suffix)) return false;
    const parentPath = path.slice(0, -suffix.length);
    return isCanonicalTeamGamePath(parentPath) || isSharedGamePath(parentPath);
}

export function sanitizeReplayArchiveAttribution(value) {
    return transformReplayClipValue(value, {
        onProperty(_entry, { key }) {
            return key === 'linkedBy' || key === 'updatedBy';
        }
    });
}

export function getReplayPrivateRef(gameRef) {
    return gameRef.collection('privateReplay').doc('archive');
}

function makeRevision(randomUUID) {
    const value = randomUUID();
    if (typeof value !== 'string' || !/^[A-Fa-f0-9-]{36}$/.test(value)) {
        throw new Error('Secure replay migration revision generation failed.');
    }
    return `r:${value}`;
}

function makeMigrationAttemptId(randomUUID) {
    const value = randomUUID();
    if (typeof value !== 'string' || !/^[A-Fa-f0-9-]{36}$/.test(value)) {
        throw new Error('Secure replay migration attempt generation failed.');
    }
    return `migration:${value}`;
}

export async function beginReplayArchiveMigration({
    db,
    fieldValue = FieldValue,
    randomUUID = crypto.randomUUID
}) {
    const controlRef = db.doc(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH);
    const attemptId = makeMigrationAttemptId(randomUUID);
    await db.runTransaction(async (transaction) => {
        transaction.set(controlRef, {
            schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
            status: 'migrating',
            version: REPLAY_PRIVATE_SCHEMA_VERSION,
            attemptId,
            updatedAt: fieldValue.serverTimestamp()
        }, { merge: false });
    });
    return attemptId;
}

export async function completeReplayArchiveMigration({
    db,
    attemptId,
    fieldValue = FieldValue
}) {
    const controlRef = db.doc(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH);
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(controlRef);
        const control = snapshot.exists
            ? normalizeReplayArchiveMigrationControl(snapshot.data() || {})
            : null;
        if (!control || control.status !== 'migrating' || control.attemptId !== attemptId) {
            throw new Error('Replay archive migration ownership changed before verification completed.');
        }
        transaction.set(controlRef, {
            schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
            status: 'ready',
            version: REPLAY_PRIVATE_SCHEMA_VERSION,
            attemptId,
            verifiedAt: fieldValue.serverTimestamp(),
            updatedAt: fieldValue.serverTimestamp()
        }, { merge: false });
    });
}

export async function verifyAthleteProfileProjectionBoundary(db) {
    const snapshot = await db.doc(ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH).get();
    if (!snapshot.exists || !isAthleteProfileProjectionBoundaryReady(snapshot.data() || {})) {
        throw new Error('The athlete profile replay projection boundary is not ready.');
    }
    return true;
}

export async function activateAthleteProfileProjectionBoundary({
    db,
    fieldValue = FieldValue
}) {
    const controlRef = db.doc(ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH);
    await db.runTransaction(async (transaction) => {
        transaction.set(controlRef, {
            schema: ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA,
            version: ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION,
            status: 'ready',
            activatedAt: fieldValue.serverTimestamp(),
            updatedAt: fieldValue.serverTimestamp()
        }, { merge: false });
    });
    return true;
}

function getLegacyLinkedAt(game = {}) {
    for (const field of ['replayVideo', 'recordedVideo', 'videoReplay']) {
        const value = game[field];
        if (value && typeof value === 'object' && !Array.isArray(value) && value.linkedAt != null) {
            return value.linkedAt;
        }
    }
    return null;
}

function getLegacyReplayHighlights(game = {}) {
    const highlights = game?.replayVideo?.highlights;
    return Array.isArray(highlights) ? highlights : null;
}

function stableReplayHighlightValue(value) {
    if (Array.isArray(value)) return value.map(stableReplayHighlightValue);
    if (!value || typeof value !== 'object') return value;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
        key,
        stableReplayHighlightValue(value[key])
    ]));
}

function mergeReplayHighlights(existing, nested) {
    const merged = [];
    const seen = new Set();
    for (const entry of [...(existing || []), ...(nested || [])]) {
        const key = JSON.stringify(stableReplayHighlightValue(entry));
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(entry);
    }
    return merged;
}

function createReplayIdentityInventory() {
    return {
        exactUrls: new Set(),
        youtubeVideoIds: new Set(),
        youtubeIdentityHashes: new Set(),
        identityHashes: new Set()
    };
}

function addReplayIdentityValue(inventory, value, { videoId = false } = {}) {
    if (typeof value !== 'string' || !value.trim()) return;
    const normalizedValue = value.trim();
    if (videoId && /^[A-Za-z0-9_-]{11}$/.test(normalizedValue) && normalizedValue !== 'live_stream') {
        const identityHash = getReplayIdentityHash('youtube', normalizedValue);
        inventory.youtubeVideoIds.add(normalizedValue);
        inventory.youtubeIdentityHashes.add(identityHash);
        inventory.identityHashes.add(identityHash);
        return;
    }
    const protectedVideoId = extractYouTubeVideoIdForProtection(normalizedValue);
    if (protectedVideoId) {
        const identityHash = getReplayIdentityHash('youtube', protectedVideoId);
        inventory.youtubeVideoIds.add(protectedVideoId);
        inventory.youtubeIdentityHashes.add(identityHash);
        inventory.identityHashes.add(identityHash);
    }
    getReplayUrlIdentityCandidates(normalizedValue).forEach((candidate) => {
        inventory.exactUrls.add(candidate);
        inventory.identityHashes.add(getReplayIdentityHash('url', candidate));
    });
}

function addReplayIdentityState(inventory, state = {}, game = {}) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return;
    for (const field of REPLAY_IDENTITY_CONTAINER_FIELDS) {
        const container = state[field];
        if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
        addReplayIdentityValue(inventory, container.videoId, { videoId: true });
        for (const urlField of ['publicUrl', 'embedUrl', 'url', 'src']) {
            addReplayIdentityValue(inventory, container[urlField]);
        }
    }
    for (const field of REPLAY_IDENTITY_FLAT_FIELDS) {
        addReplayIdentityValue(inventory, state[field]);
    }
    if (getMigrationReplayLifecycle(game).isCompleted) {
        addReplayIdentityValue(inventory, state.videoUrl);
    }
}

function addYouTubeClipIdentityValue(inventory, value) {
    transformReplayClipValue(value, {
        onString(entry, { key }) {
            const normalizedValue = entry.trim();
            const protectedVideoId = extractYouTubeVideoIdForProtection(normalizedValue);
            if (protectedVideoId) {
                const identityHash = getReplayIdentityHash('youtube', protectedVideoId);
                inventory.youtubeVideoIds.add(protectedVideoId);
                inventory.youtubeIdentityHashes.add(identityHash);
                inventory.identityHashes.add(identityHash);
            }
            if (key === 'videoId'
                && /^[A-Za-z0-9_-]{11}$/.test(normalizedValue)
                && normalizedValue !== 'live_stream') {
                const identityHash = getReplayIdentityHash('youtube', normalizedValue);
                inventory.youtubeVideoIds.add(normalizedValue);
                inventory.youtubeIdentityHashes.add(identityHash);
                inventory.identityHashes.add(identityHash);
            }
            return false;
        }
    });
}

function addAllYouTubeClipIdentities(inventory, document = {}) {
    const nestedReplayHighlights = document?.replayVideo?.highlights;
    if (Array.isArray(nestedReplayHighlights)) {
        addYouTubeClipIdentityValue(inventory, nestedReplayHighlights);
    }
    for (const field of REPLAY_CLIP_COLLECTION_FIELDS) {
        if (Array.isArray(document?.[field])) {
            addYouTubeClipIdentityValue(inventory, document[field]);
        }
    }
    if (Array.isArray(document?.seasons)) {
        document.seasons.forEach((season) => {
            if (!season || typeof season !== 'object' || Array.isArray(season)) return;
            for (const field of REPLAY_CLIP_COLLECTION_FIELDS) {
                if (Array.isArray(season[field])) {
                    addYouTubeClipIdentityValue(inventory, season[field]);
                }
            }
        });
    }
}

export function collectSensitiveReplayIdentityInventory(game = {}, privateArchive = null) {
    const inventory = createReplayIdentityInventory();
    const normalizedPrivate = normalizeStoredReplayArchive(privateArchive);
    if (normalizedPrivate?.state === 'ready') {
        addReplayIdentityValue(inventory, normalizedPrivate.videoId, { videoId: true });
    }
    const privateLegacyState = privateArchive?.state === 'quarantine'
        && privateArchive?.legacyState
        && typeof privateArchive.legacyState === 'object'
        && !Array.isArray(privateArchive.legacyState)
        ? privateArchive.legacyState
        : null;
    addReplayIdentityState(inventory, getReadableReplayArchiveState(game), game);
    if (privateLegacyState) addReplayIdentityState(inventory, privateLegacyState, game);
    return inventory;
}

function mergeReplayIdentityInventory(target, source) {
    source.exactUrls.forEach((value) => target.exactUrls.add(value));
    source.youtubeVideoIds.forEach((value) => target.youtubeVideoIds.add(value));
    source.youtubeIdentityHashes?.forEach((value) => target.youtubeIdentityHashes.add(value));
    source.identityHashes?.forEach((value) => target.identityHashes.add(value));
    return target;
}

function hasReplayIdentityInventory(inventory) {
    return inventory.exactUrls.size > 0
        || inventory.youtubeVideoIds.size > 0
        || inventory.youtubeIdentityHashes.size > 0
        || inventory.identityHashes.size > 0;
}

function isSensitiveReplayUrl(value, inventory) {
    if (typeof value !== 'string' || !value.trim()) return false;
    const normalizedValue = value.trim();
    if (getReplayUrlIdentityCandidates(normalizedValue).some((candidate) => (
        inventory.exactUrls.has(candidate)
        || inventory.identityHashes.has(getReplayIdentityHash('url', candidate))
    ))) return true;
    const videoId = extractYouTubeVideoIdForProtection(normalizedValue);
    return Boolean(videoId && (
        inventory.youtubeVideoIds.has(videoId)
        || inventory.identityHashes.has(getReplayIdentityHash('youtube', videoId))
    ));
}

function isSensitiveReplayClipIdentity(field, value, inventory) {
    if (field === 'videoId') {
        return typeof value === 'string'
            && (inventory.youtubeVideoIds.has(value.trim())
                || (/^[A-Za-z0-9_-]{11}$/.test(value.trim())
                    && value.trim() !== 'live_stream'
                    && inventory.identityHashes.has(getReplayIdentityHash('youtube', value.trim()))));
    }
    return isSensitiveReplayUrl(value, inventory);
}

function sanitizeReplayClipArray(entries, inventory) {
    if (!Array.isArray(entries) || !hasReplayIdentityInventory(inventory)) {
        return { changed: false, value: entries };
    }
    const sanitized = transformReplayClipValue(entries, {
        onString(value, { key }) {
            return isSensitiveReplayClipIdentity(key, value, inventory);
        }
    });
    return { changed: sanitized.changed, value: sanitized.value };
}

function getReplayClipScrub(game = {}, privateArchive = null) {
    const inventory = collectSensitiveReplayIdentityInventory(game, privateArchive);
    const update = {};
    for (const field of REPLAY_CLIP_COLLECTION_FIELDS) {
        const sanitized = sanitizeReplayClipArray(game[field], inventory);
        if (sanitized.changed) update[field] = sanitized.value;
    }
    return { inventory, update };
}

function hasSensitiveReplayClipCopies(game = {}, privateArchive = null) {
    return Object.keys(getReplayClipScrub(game, privateArchive).update).length > 0;
}

function sanitizeReadableReplayCopies(document = {}, inventory) {
    const update = {};
    for (const field of REPLAY_CLIP_COLLECTION_FIELDS) {
        const sanitized = sanitizeReplayClipArray(document[field], inventory);
        if (sanitized.changed) update[field] = sanitized.value;
    }
    if (Array.isArray(document.seasons)) {
        let seasonsChanged = false;
        const seasons = document.seasons.map((season) => {
            if (!season || typeof season !== 'object' || Array.isArray(season)) return season;
            const next = { ...season };
            for (const field of REPLAY_CLIP_COLLECTION_FIELDS) {
                const sanitized = sanitizeReplayClipArray(season[field], inventory);
                if (sanitized.changed) {
                    next[field] = sanitized.value;
                    seasonsChanged = true;
                }
            }
            return next;
        });
        if (seasonsChanged) update.seasons = seasons;
    }
    return update;
}

export function buildMigratedPrivateArchive({
    inspection,
    game,
    revision,
    timestamp,
    compatibilityState = null
}) {
    const replayedCompatibilityMutation = Boolean(
        compatibilityState?.receiptMatches
        && compatibilityState.receipt
        && compatibilityState.receipt.state === inspection.state
    );
    const common = {
        schemaVersion: REPLAY_PRIVATE_SCHEMA_VERSION,
        state: inspection.state,
        revision,
        lastMutationId: replayedCompatibilityMutation
            ? compatibilityState.receipt.lastMutationId
            : `migration:${revision}`,
        ...(replayedCompatibilityMutation
            ? { lastMutationHash: compatibilityState.receipt.lastMutationHash }
            : {}),
        updatedAt: timestamp,
        migratedAt: timestamp,
        migrationSource: 'readable-game-archive-v1'
    };
    if (inspection.state === 'ready') {
        const linkedAt = getLegacyLinkedAt(game) || timestamp;
        return {
            ...common,
            provider: 'youtube',
            videoId: inspection.replay.videoId,
            ...(inspection.replay.title ? { title: inspection.replay.title } : {}),
            linkedAt
        };
    }
    if (inspection.state === 'removed') return common;
    if (inspection.state === 'quarantine') {
        const legacyState = transformReplayClipValue(inspection.rawState || {}, {
            onProperty(_value, { key }) {
                return key === 'linkedBy' || key === 'updatedBy';
            }
        }).value;
        return {
            ...common,
            reason: inspection.reason || 'unrecognized-replay-evidence',
            legacyState
        };
    }
    throw new Error(`Cannot migrate replay inspection state ${inspection.state}.`);
}

export function buildReadableReplayScrub({
    game,
    privateArchive,
    fieldValue = FieldValue,
    timestamp
}) {
    const lifecycle = getMigrationReplayLifecycle(game);
    const update = { updatedAt: timestamp };
    if (privateArchive.state === 'quarantine') {
        // A quarantined capability is server-private operator evidence, not a
        // playable archive. Leaving even a false marker/revision on the parent
        // would make bounded public/list readers treat the malformed child as
        // an authoritative archive and poison the whole response while the
        // rollout is deliberately blocked for repair.
        update.hasRecordedReplay = fieldValue.delete();
        update.replayArchiveRevision = fieldValue.delete();
    } else {
        update.hasRecordedReplay = privateArchive.state === 'ready';
        update.replayArchiveRevision = privateArchive.revision;
    }
    for (const field of REPLAY_READABLE_FIELDS) {
        if (field === 'videoUrl' && !lifecycle.isCompleted) continue;
        update[field] = fieldValue.delete();
    }
    REPLAY_COMPAT_MARKER_FIELDS.forEach((field) => {
        update[field] = fieldValue.delete();
    });

    const clipScrub = getReplayClipScrub(game, privateArchive);
    Object.assign(update, clipScrub.update);
    const migratedHighlights = sanitizeReplayClipArray(
        getLegacyReplayHighlights(game),
        clipScrub.inventory
    ).value;
    if (migratedHighlights) {
        const existingHighlights = sanitizeReplayClipArray(
            Array.isArray(game.replayHighlights) ? game.replayHighlights : [],
            clipScrub.inventory
        ).value;
        update.replayHighlights = mergeReplayHighlights(existingHighlights, migratedHighlights);
    }
    return update;
}

function isPrivateQuarantine(value) {
    return value
        && typeof value === 'object'
        && value.schemaVersion === REPLAY_PRIVATE_SCHEMA_VERSION
        && value.state === 'quarantine'
        && typeof value.revision === 'string'
        && value.revision.length > 0
        && value.legacyState
        && typeof value.legacyState === 'object';
}

function getExistingPrivateArchive(value) {
    return normalizeStoredReplayArchive(value) || (isPrivateQuarantine(value) ? value : null);
}

function hasReadableReplayKeys(game = {}) {
    return [...REPLAY_READABLE_FIELDS, ...REPLAY_COMPAT_MARKER_FIELDS].some((field) => {
        if (!hasOwn(game, field)) return false;
        if (field === 'videoUrl' && !getMigrationReplayLifecycle(game).isCompleted) return false;
        return true;
    });
}

export function classifyReplayMigration(
    game = {},
    existingPrivate = null,
    compatibilityReceipt = null
) {
    const privateArchive = getExistingPrivateArchive(existingPrivate);
    if (existingPrivate && !privateArchive) {
        return { action: 'blocked', reason: 'invalid-existing-private-archive' };
    }
    const inspection = inspectLegacyReplayArchive(getMigrationInspectionGame(game));
    const lifecycle = getMigrationReplayLifecycle(game);
    if ((privateArchive?.state === 'ready' || inspection.state === 'ready')
        && !lifecycle.isCompleted) {
        return { action: 'blocked', reason: 'ready-replay-on-nonfinal-game', inspection };
    }
    const hasReadableKeys = hasReadableReplayKeys(game);
    const hasSensitiveClipCopies = hasSensitiveReplayClipCopies(game, privateArchive);
    const hasCanonicalParentMarker = hasOwn(game, 'hasRecordedReplay')
        || hasOwn(game, 'replayArchiveRevision');
    const markerMismatch = privateArchive && (
        game.hasRecordedReplay !== (privateArchive.state === 'ready')
        || game.replayArchiveRevision !== privateArchive.revision
    );
    if (privateArchive) {
        return {
            action: hasReadableKeys || markerMismatch || hasSensitiveClipCopies || compatibilityReceipt
                ? 'repair'
                : 'none',
            privateArchive,
            inspection,
            compatibilityReceipt
        };
    }
    if (hasCanonicalParentMarker && !compatibilityReceipt) {
        return { action: 'blocked', reason: 'parent-marker-without-private-archive', inspection };
    }
    if (compatibilityReceipt) {
        return { action: 'migrate', inspection, compatibilityReceipt };
    }
    if (inspection.state === 'none' && !hasReadableKeys) return { action: 'none', inspection };
    if (inspection.state === 'none') {
        return { action: 'scrub-empty', inspection };
    }
    return { action: 'migrate', inspection };
}

async function* iterateCollectionGroup(db, collectionId, pageSize = DEFAULT_PAGE_SIZE) {
    let cursor = null;
    while (true) {
        let query = db.collectionGroup(collectionId)
            .orderBy(FieldPath.documentId())
            .limit(pageSize);
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.get();
        const docs = snapshot.docs || [];
        if (!docs.length) return;
        for (const docSnapshot of docs) yield docSnapshot;
        if (docs.length < pageSize) return;
        cursor = docs[docs.length - 1];
    }
}

export async function scrubReplayArchiveAttribution({
    db,
    apply = APPLY,
    logger = console,
    pageSize = DEFAULT_PAGE_SIZE
}) {
    const result = { scanned: 0, matched: 0, scrubbed: 0 };
    for await (const archiveDoc of iterateCollectionGroup(db, 'privateReplay', pageSize)) {
        if (!isReplayPrivateArchivePath(archiveDoc.ref.path)) continue;
        result.scanned += 1;
        const sanitized = sanitizeReplayArchiveAttribution(archiveDoc.data());
        if (!sanitized.changed) continue;
        result.matched += 1;
        logger.log(
            `[backfill-game-replay-archives] ${apply ? 'Scrub' : 'Would scrub'} private replay attribution at ${archiveDoc.ref.path}`
        );
        if (!apply) continue;
        const changed = await db.runTransaction(async (transaction) => {
            const current = await transaction.get(archiveDoc.ref);
            if (!current.exists) return false;
            const currentSanitized = sanitizeReplayArchiveAttribution(current.data());
            if (!currentSanitized.changed) return false;
            transaction.set(archiveDoc.ref, currentSanitized.value, { merge: false });
            return true;
        });
        if (changed) result.scrubbed += 1;
    }
    return result;
}

function getReplayCompatibilityReceiptBinding(documentPath) {
    const match = String(documentPath || '').match(
        /^teams\/([^/]+)\/games\/([^/]+)\/privateReplay\/compatibility$/
    );
    if (!match) return null;
    return {
        teamId: match[1],
        gameId: match[2],
        parentPath: `teams/${match[1]}/games/${match[2]}`
    };
}

function normalizeBoundReplayCompatibilityReceipt(documentPath, value) {
    const binding = getReplayCompatibilityReceiptBinding(documentPath);
    const receipt = normalizeReplayCompatibilityReceipt(value);
    if (!binding || !receipt
        || receipt.teamId !== binding.teamId
        || receipt.gameId !== binding.gameId
        || getReplayCompatibilityReceiptPath(binding.parentPath) !== documentPath) {
        const error = new Error(`Malformed or misbound replay compatibility receipt at ${documentPath}.`);
        error.code = 'failed-precondition';
        throw error;
    }
    return { ...binding, receipt };
}

export async function collectReplayCompatibilityReceiptInventory(
    db,
    pageSize = DEFAULT_PAGE_SIZE
) {
    const inventory = createReplayIdentityInventory();
    const receipts = new Map();
    for await (const receiptDoc of iterateCollectionGroup(db, 'privateReplay', pageSize)) {
        if (receiptDoc.id !== REPLAY_COMPATIBILITY_DOCUMENT
            && !receiptDoc.ref.path.endsWith(`/privateReplay/${REPLAY_COMPATIBILITY_DOCUMENT}`)) continue;
        const bound = normalizeBoundReplayCompatibilityReceipt(
            receiptDoc.ref.path,
            receiptDoc.data() || {}
        );
        bound.receipt.protectedIdentityHashes.forEach((identityHash) => {
            inventory.youtubeIdentityHashes.add(identityHash);
            inventory.identityHashes.add(identityHash);
        });
        receipts.set(receiptDoc.ref.path, {
            ...bound,
            ref: receiptDoc.ref
        });
    }
    return { inventory, receipts };
}

export async function verifyNoReplayCompatibilityReceipts({
    db,
    logger = console,
    pageSize = DEFAULT_PAGE_SIZE
}) {
    const { receipts } = await collectReplayCompatibilityReceiptInventory(db, pageSize);
    if (receipts.size) {
        [...receipts.keys()].slice(0, 20).forEach((path) => logger.error(
            `[backfill-game-replay-archives] Replay compatibility receipt remains at ${path}`
        ));
        const error = new Error(
            `Replay compatibility receipt verification failed for ${receipts.size} document(s).`
        );
        error.code = 'failed-precondition';
        throw error;
    }
    logger.log('[backfill-game-replay-archives] Verified zero replay compatibility receipts.');
    return { remaining: 0 };
}

async function* iterateStructuredReplayScanTarget(db, target, pageSize = DEFAULT_PAGE_SIZE) {
    let cursor = null;
    while (true) {
        const source = target.mode === 'collection'
            ? db.collection(target.collectionId)
            : db.collectionGroup(target.collectionId);
        let query = source.orderBy(FieldPath.documentId()).limit(pageSize);
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.get();
        const docs = snapshot.docs || [];
        if (!docs.length) return;
        for (const docSnapshot of docs) yield docSnapshot;
        if (docs.length < pageSize) return;
        cursor = docs[docs.length - 1];
    }
}

export async function collectStructuredReplayClipIdentityReport({
    db,
    pageSize = DEFAULT_PAGE_SIZE,
    protectedIdentityInventory = null
}) {
    const sources = [];
    for (const target of STRUCTURED_REPLAY_CLIP_SCAN_TARGETS) {
        for await (const documentSnapshot of iterateStructuredReplayScanTarget(
            db,
            target,
            pageSize
        )) {
            sources.push(...extractStructuredReplayIdentitySources(
                documentSnapshot.ref.path,
                documentSnapshot.data() || {}
            ));
        }
    }
    return buildStructuredReplayClipIdentityReport(sources, {
        protectedVideoIds: protectedIdentityInventory?.youtubeVideoIds || [],
        protectedIdentityHashes: protectedIdentityInventory?.identityHashes || []
    });
}

function assertNoIndependentStructuredReplayOverlap(report) {
    if (!report.independentProtectedSources.length) return report;
    const paths = report.independentProtectedSources
        .filter((source) => source.sourceRole === STRUCTURED_REPLAY_CLIP_SOURCE_ROLES.INDEPENDENT)
        .map((source) => source.sourcePath);
    const error = new Error(
        `Independent structured media overlaps protected replay state at ${paths.length} source(s).`
    );
    error.code = 'failed-precondition';
    error.sourcePaths = [...new Set(paths)].sort();
    throw error;
}

function buildStructuredReplayClipExclusionInventory(report, protectedIdentityInventory) {
    const inventory = createReplayIdentityInventory();
    report.videoIds.forEach((videoId) => {
        if (!protectedIdentityInventory.youtubeVideoIds.has(videoId)
            && !protectedIdentityInventory.identityHashes.has(getReplayIdentityHash('youtube', videoId))) {
            inventory.youtubeVideoIds.add(videoId);
            inventory.identityHashes.add(getReplayIdentityHash('youtube', videoId));
        }
    });
    return inventory;
}

function getAutomatedStructuredSources(report) {
    return report.automatedCopies;
}

function buildStructuredAutomatedCopyScrub(document, sources, fieldValue = FieldValue) {
    const update = {};
    const providerFields = new Set();
    const directGameFields = new Set([
        'videoUrl',
        ...GAME_FIXED_VIDEO_ID_FIELDS,
        ...GAME_FIXED_VIDEO_URL_FIELDS
    ]);
    sources.forEach((source) => {
        if (directGameFields.has(source.fieldPath)) {
            update[source.fieldPath] = fieldValue.delete();
        }
        if (source.fieldPath.startsWith('broadcastSession.provider.')) {
            providerFields.add(source.fieldPath.slice('broadcastSession.provider.'.length));
        }
    });
    if (providerFields.size > 0
        && document?.broadcastSession
        && typeof document.broadcastSession === 'object'
        && !Array.isArray(document.broadcastSession)
        && document.broadcastSession.provider
        && typeof document.broadcastSession.provider === 'object'
        && !Array.isArray(document.broadcastSession.provider)) {
        const provider = { ...document.broadcastSession.provider };
        providerFields.forEach((field) => delete provider[field]);
        update.broadcastSession = {
            ...document.broadcastSession,
            provider
        };
    }
    return update;
}

export async function migrateStructuredReplayAutomatedCopies({
    db,
    report,
    protectedIdentityInventory,
    apply = APPLY,
    fieldValue = FieldValue,
    logger = console
}) {
    assertNoIndependentStructuredReplayOverlap(report);
    const sourcesByPath = new Map();
    getAutomatedStructuredSources(report).forEach((source) => {
        const sources = sourcesByPath.get(source.documentPath) || [];
        sources.push(source);
        sourcesByPath.set(source.documentPath, sources);
    });
    const result = { matched: sourcesByPath.size, migrated: 0 };
    for (const [documentPath] of sourcesByPath) {
        logger.log(
            `[backfill-game-replay-archives] ${apply ? 'Scrub' : 'Would scrub'} protected replay identity from automated structured media at ${documentPath}`
        );
        if (!apply) continue;
        const documentRef = db.doc(documentPath);
        const changed = await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(documentRef);
            if (!snapshot.exists) return false;
            const current = snapshot.data() || {};
            const currentReport = buildStructuredReplayClipIdentityReport(
                extractStructuredReplayIdentitySources(documentPath, current),
                {
                    protectedVideoIds: protectedIdentityInventory.youtubeVideoIds,
                    protectedIdentityHashes: protectedIdentityInventory.identityHashes
                }
            );
            assertNoIndependentStructuredReplayOverlap(currentReport);
            const update = buildStructuredAutomatedCopyScrub(
                current,
                getAutomatedStructuredSources(currentReport),
                fieldValue
            );
            if (!Object.keys(update).length) return false;
            transaction.set(documentRef, update, { merge: true });
            return true;
        });
        if (changed) result.migrated += 1;
    }
    return result;
}

export async function collectPersistedProtectedReplayIdentityInventory(
    db,
    pageSize = DEFAULT_PAGE_SIZE
) {
    const inventory = createReplayIdentityInventory();
    for await (const identityDoc of iterateCollectionGroup(
        db,
        REPLAY_PROTECTED_IDENTITY_COLLECTION,
        pageSize
    )) {
        if (!new RegExp(`^${REPLAY_PROTECTED_IDENTITY_COLLECTION}/[^/]+$`).test(identityDoc.ref.path)) continue;
        const identity = normalizeReplayProtectedIdentity(identityDoc.data() || {});
        if (!identity) {
            throw new Error(`Malformed protected replay identity at ${identityDoc.ref.path}.`);
        }
        const expectedPath = `${REPLAY_PROTECTED_IDENTITY_COLLECTION}/${identity.kind}:${identity.identityHash}`;
        if (expectedPath !== identityDoc.ref.path) {
            throw new Error(`Misbound protected replay identity at ${identityDoc.ref.path}.`);
        }
        inventory.identityHashes.add(identity.identityHash);
        if (identity.kind === 'youtube') {
            inventory.youtubeIdentityHashes.add(identity.identityHash);
        }
    }
    return inventory;
}

export async function collectProtectedReplayIdentityInventory(db, pageSize = DEFAULT_PAGE_SIZE) {
    const inventory = await collectPersistedProtectedReplayIdentityInventory(db, pageSize);
    for (const collectionId of ['games', 'sharedGames']) {
        for await (const gameDoc of iterateCollectionGroup(db, collectionId, pageSize)) {
            if (collectionId === 'games' && !isCanonicalTeamGamePath(gameDoc.ref.path)) continue;
            if (collectionId === 'sharedGames' && !isSharedGamePath(gameDoc.ref.path)) continue;
            const privateSnapshot = await getReplayPrivateRef(gameDoc.ref).get();
            mergeReplayIdentityInventory(inventory, collectSensitiveReplayIdentityInventory(
                gameDoc.data() || {},
                privateSnapshot.exists ? (privateSnapshot.data() || {}) : null
            ));
        }
    }
    return inventory;
}

export async function collectReadableReplayClipIdentityInventory(db, pageSize = DEFAULT_PAGE_SIZE) {
    const inventory = createReplayIdentityInventory();
    for (const collectionId of ['games', 'sharedGames', 'athleteProfiles']) {
        for await (const documentSnapshot of iterateCollectionGroup(db, collectionId, pageSize)) {
            if (collectionId === 'games' && !isCanonicalTeamGamePath(documentSnapshot.ref.path)) continue;
            if (collectionId === 'sharedGames' && !isSharedGamePath(documentSnapshot.ref.path)) continue;
            if (collectionId === 'athleteProfiles'
                && !/^athleteProfiles\/[^/]+$/.test(documentSnapshot.ref.path || '')) continue;
            addAllYouTubeClipIdentities(inventory, documentSnapshot.data() || {});
        }
    }
    return inventory;
}

function addIndependentReplayClipIdentities(inventory, value) {
    transformReplayClipValue(value, {
        onString(entry, { key }) {
            addReplayIdentityValue(inventory, entry, { videoId: key === 'videoId' });
            return false;
        }
    });
}

function addIndependentDocumentClipIdentities(
    inventory,
    document = {},
    { generatedProfile = false } = {}
) {
    for (const field of REPLAY_CLIP_COLLECTION_FIELDS) {
        if (generatedProfile && field === 'gameClips') continue;
        if (Array.isArray(document[field])) {
            addIndependentReplayClipIdentities(inventory, document[field]);
        }
    }
    if (!Array.isArray(document.seasons)) return;
    document.seasons.forEach((season) => {
        if (!season || typeof season !== 'object' || Array.isArray(season)) return;
        for (const field of REPLAY_CLIP_COLLECTION_FIELDS) {
            if (generatedProfile && field === 'gameClips') continue;
            if (Array.isArray(season[field])) {
                addIndependentReplayClipIdentities(inventory, season[field]);
            }
        }
    });
}

export async function collectIndependentReadableReplayIdentityInventory(
    db,
    pageSize = DEFAULT_PAGE_SIZE
) {
    const inventory = createReplayIdentityInventory();
    for (const collectionId of ['games', 'sharedGames', 'athleteProfiles']) {
        for await (const documentSnapshot of iterateCollectionGroup(db, collectionId, pageSize)) {
            if (collectionId === 'games' && !isCanonicalTeamGamePath(documentSnapshot.ref.path)) continue;
            if (collectionId === 'sharedGames' && !isSharedGamePath(documentSnapshot.ref.path)) continue;
            if (collectionId === 'athleteProfiles'
                && !/^athleteProfiles\/[^/]+$/.test(documentSnapshot.ref.path || '')) continue;
            addIndependentDocumentClipIdentities(
                inventory,
                documentSnapshot.data() || {},
                { generatedProfile: collectionId === 'athleteProfiles' }
            );
        }
    }
    return inventory;
}

function assertNoIndependentReadableReplayOverlap(
    protectedIdentityInventory,
    independentIdentityInventory
) {
    const overlaps = [...independentIdentityInventory.identityHashes]
        .filter((identityHash) => protectedIdentityInventory.identityHashes.has(identityHash))
        .sort();
    if (!overlaps.length) return;
    const error = new Error(
        `Independent readable media overlaps protected replay state for ${overlaps.length} identity record(s).`
    );
    error.code = 'failed-precondition';
    error.overlapCount = overlaps.length;
    throw error;
}

export async function collectPersistedReplayClipIdentityInventory(db, pageSize = DEFAULT_PAGE_SIZE) {
    const inventory = createReplayIdentityInventory();
    for await (const identityDoc of iterateCollectionGroup(
        db,
        REPLAY_CLIP_IDENTITY_COLLECTION,
        pageSize
    )) {
        if (!new RegExp(`^${REPLAY_CLIP_IDENTITY_COLLECTION}/[^/]+$`).test(identityDoc.ref.path)) continue;
        const identity = normalizeReplayClipIdentity(identityDoc.data() || {});
        if (!identity) {
            throw new Error(`Malformed replay clip identity at ${identityDoc.ref.path}.`);
        }
        const expectedPath = `${REPLAY_CLIP_IDENTITY_COLLECTION}/youtube:${identity.identityHash}`;
        if (expectedPath !== identityDoc.ref.path) {
            throw new Error(`Misbound replay clip identity at ${identityDoc.ref.path}.`);
        }
        inventory.identityHashes.add(identity.identityHash);
    }
    return inventory;
}

function assertNoProtectedReplayClipIdentityOverlap(
    protectedIdentityInventory,
    persistedClipIdentityInventory
) {
    const overlaps = [...persistedClipIdentityInventory.identityHashes]
        .filter((identityHash) => protectedIdentityInventory.identityHashes.has(identityHash))
        .sort();
    if (overlaps.length) {
        const error = new Error(
            `Replay identity ledgers overlap for ${overlaps.length} protected identity record(s).`
        );
        error.code = 'failed-precondition';
        error.overlapCount = overlaps.length;
        throw error;
    }
}

function buildReplayClipExclusionInventory(clipInventory, protectedIdentityInventory) {
    const inventory = createReplayIdentityInventory();
    clipInventory.youtubeVideoIds.forEach((videoId) => {
        if (!protectedIdentityInventory.youtubeVideoIds.has(videoId)
            && !protectedIdentityInventory.identityHashes.has(getReplayIdentityHash('youtube', videoId))) {
            inventory.youtubeVideoIds.add(videoId);
            inventory.identityHashes.add(getReplayIdentityHash('youtube', videoId));
        }
    });
    return inventory;
}

export async function persistReplayClipIdentityInventory({
    db,
    inventory,
    fieldValue = FieldValue
}) {
    const records = [...inventory.youtubeVideoIds]
        .sort()
        .map((videoId) => getReplayClipYouTubeIdentityRecord(videoId));
    for (const record of records) {
        await db.runTransaction(async (transaction) => {
            transaction.set(db.doc(record.path), {
                ...record.data,
                updatedAt: fieldValue.serverTimestamp()
            }, { merge: false });
        });
    }
    return { persisted: records.length };
}

export async function persistProtectedReplayIdentityInventory({
    db,
    inventory,
    fieldValue = FieldValue
}) {
    const records = [
        ...[...inventory.youtubeVideoIds]
            .sort()
            .map((videoId) => getReplayProtectedYouTubeIdentityRecord(videoId)),
        ...[...inventory.youtubeIdentityHashes]
            .sort()
            .map((identityHash) => getReplayProtectedYouTubeIdentityRecordFromHash(identityHash)),
        ...[...inventory.exactUrls]
            .sort()
            .map((exactUrl) => getReplayProtectedUrlIdentityRecord(exactUrl))
    ];
    const recordsByPath = new Map(records.map((record) => [record.path, record]));
    for (const record of recordsByPath.values()) {
        await db.runTransaction(async (transaction) => {
            transaction.set(db.doc(record.path), {
                ...record.data,
                updatedAt: fieldValue.serverTimestamp()
            }, { merge: false });
        });
    }
    return { persisted: recordsByPath.size };
}

function buildProtectedReplayIdentityRecords(inventory) {
    return new Map([
        ...[...inventory.youtubeVideoIds]
            .map((videoId) => getReplayProtectedYouTubeIdentityRecord(videoId)),
        ...[...inventory.youtubeIdentityHashes]
            .map((identityHash) => getReplayProtectedYouTubeIdentityRecordFromHash(identityHash)),
        ...[...inventory.exactUrls]
            .map((exactUrl) => getReplayProtectedUrlIdentityRecord(exactUrl))
    ].map((record) => [record.path, record]));
}

async function verifyPersistedCurrentReplayIdentities({
    transaction,
    db,
    game,
    privateArchive,
    protectedIdentityInventory
}) {
    const currentInventory = collectSensitiveReplayIdentityInventory(game, privateArchive);
    const missingFrozenHashes = [...currentInventory.identityHashes]
        .filter((identityHash) => !protectedIdentityInventory.identityHashes.has(identityHash));
    if (missingFrozenHashes.length) {
        throw new Error('Replay identity changed after the frozen migration inventory.');
    }
    const records = [...buildProtectedReplayIdentityRecords(currentInventory).values()];
    const snapshots = await Promise.all(records.map((record) => transaction.get(db.doc(record.path))));
    snapshots.forEach((snapshot, index) => {
        const record = records[index];
        const identity = snapshot.exists
            ? normalizeReplayProtectedIdentity(snapshot.data() || {})
            : null;
        if (!identity
            || identity.kind !== record.data.kind
            || identity.identityHash !== record.data.identityHash
            || snapshot.ref.path !== record.path) {
            throw new Error(`Current replay identity is not durably protected at ${record.path}.`);
        }
    });
}

async function migrateReplayCopiesInCollection({
    db,
    apply,
    inventory,
    logger,
    pageSize,
    collectionId,
    acceptsPath
}) {
    const result = { scanned: 0, matched: 0, migrated: 0 };
    if (!hasReplayIdentityInventory(inventory)) return result;
    for await (const documentSnapshot of iterateCollectionGroup(db, collectionId, pageSize)) {
        if (!acceptsPath(documentSnapshot.ref.path)) continue;
        result.scanned += 1;
        const preliminaryUpdate = sanitizeReadableReplayCopies(
            documentSnapshot.data() || {},
            inventory
        );
        if (!Object.keys(preliminaryUpdate).length) continue;
        result.matched += 1;
        logger.log(`[backfill-game-replay-archives] ${apply ? 'Scrub' : 'Would scrub'} protected replay copies in ${documentSnapshot.ref.path}`);
        if (!apply) continue;
        const outcome = await db.runTransaction(async (transaction) => {
            const current = await transaction.get(documentSnapshot.ref);
            if (!current.exists) return false;
            const update = sanitizeReadableReplayCopies(current.data() || {}, inventory);
            if (!Object.keys(update).length) return false;
            transaction.set(documentSnapshot.ref, update, { merge: true });
            return true;
        });
        if (outcome) result.migrated += 1;
    }
    return result;
}

async function migrateAllReadableReplayCopies({
    db,
    apply,
    inventory,
    logger,
    pageSize
}) {
    const groups = [
        ['games', isCanonicalTeamGamePath],
        ['sharedGames', isSharedGamePath],
        ['athleteProfiles', (path) => /^athleteProfiles\/[^/]+$/.test(path || '')]
    ];
    const total = { scanned: 0, matched: 0, migrated: 0 };
    for (const [collectionId, acceptsPath] of groups) {
        const result = await migrateReplayCopiesInCollection({
            db,
            apply,
            inventory,
            logger,
            pageSize,
            collectionId,
            acceptsPath
        });
        total.scanned += result.scanned;
        total.matched += result.matched;
        total.migrated += result.migrated;
    }
    return total;
}

function replayCompatibilityReceiptsEqual(left, right) {
    return Boolean(left && right && JSON.stringify(left) === JSON.stringify(right));
}

function getReplayMigrationDocumentFingerprint(game, privateSnapshot) {
    const parentFingerprint = getReplayCompatibilityParentFingerprint(game || {});
    const privateFingerprint = privateSnapshot?.exists
        ? getReplayCompatibilityParentFingerprint({
            replayVideo: privateSnapshot.data()
        })
        : 'missing';
    return `${parentFingerprint}:${privateFingerprint}`;
}

async function verifyPersistedReplayCompatibilityHistory({
    transaction,
    db,
    receipt,
    protectedIdentityInventory
}) {
    const records = receipt.protectedIdentityHashes.map(
        (identityHash) => getReplayProtectedYouTubeIdentityRecordFromHash(identityHash)
    );
    for (const record of records) {
        if (!protectedIdentityInventory.youtubeIdentityHashes.has(record.data.identityHash)) {
            throw new Error('Replay compatibility history is absent from the frozen migration inventory.');
        }
    }
    const snapshots = await Promise.all(records.map((record) => transaction.get(db.doc(record.path))));
    snapshots.forEach((snapshot, index) => {
        const record = records[index];
        const identity = snapshot.exists
            ? normalizeReplayProtectedIdentity(snapshot.data() || {})
            : null;
        if (!identity
            || identity.kind !== 'youtube'
            || identity.identityHash !== record.data.identityHash
            || snapshot.ref.path !== record.path) {
            throw new Error(`Replay compatibility history is not durably protected at ${record.path}.`);
        }
    });
}

async function migrateReplayDocument({
    db,
    gameDoc,
    apply,
    fieldValue,
    randomUUID,
    logger,
    compatibilityReceipts = new Map(),
    protectedIdentityInventory = null,
    receiptIdentityRecordsPersisted = false
}) {
    const privateRef = getReplayPrivateRef(gameDoc.ref);
    const receiptPath = getReplayCompatibilityReceiptPath(gameDoc.ref.path);
    const receiptRef = db.doc(receiptPath);
    const frozenReceiptEntry = compatibilityReceipts.get(receiptPath) || null;
    const [existingPrivateSnapshot, existingReceiptSnapshot] = await Promise.all([
        privateRef.get(),
        receiptRef.get()
    ]);
    const frozenDocumentFingerprint = getReplayMigrationDocumentFingerprint(
        gameDoc.data() || {},
        existingPrivateSnapshot
    );
    let preliminaryReceipt = null;
    if (existingReceiptSnapshot.exists) {
        const bound = normalizeBoundReplayCompatibilityReceipt(
            receiptPath,
            existingReceiptSnapshot.data() || {}
        );
        preliminaryReceipt = bound.receipt;
        if (!frozenReceiptEntry
            || !replayCompatibilityReceiptsEqual(preliminaryReceipt, frozenReceiptEntry.receipt)) {
            return { status: 'blocked', reason: 'compatibility-receipt-not-in-frozen-inventory' };
        }
    } else if (frozenReceiptEntry) {
        return { status: 'blocked', reason: 'compatibility-receipt-changed-after-inventory' };
    }
    const preliminary = classifyReplayMigration(
        gameDoc.data() || {},
        existingPrivateSnapshot.exists ? (existingPrivateSnapshot.data() || {}) : null,
        preliminaryReceipt
    );
    if (preliminary.action === 'none') return { status: 'none' };
    if (preliminary.action === 'blocked') {
        logger.error(`[backfill-game-replay-archives] BLOCKED ${gameDoc.ref.path}: ${preliminary.reason}`);
        return { status: 'blocked', reason: preliminary.reason };
    }
    logger.log(`[backfill-game-replay-archives] ${apply ? 'Migrate' : 'Would migrate'} ${gameDoc.ref.path} (${preliminary.action})`);
    if (!apply) {
        return {
            status: preliminary.inspection?.state === 'quarantine' ? 'quarantine' : 'matched'
        };
    }
    if (preliminaryReceipt && !receiptIdentityRecordsPersisted) {
        throw new Error('Compatibility receipts require the complete replay migration orchestrator.');
    }

    const reservedRevision = makeRevision(randomUUID);
    return db.runTransaction(async (transaction) => {
        const [currentGameSnapshot, currentPrivateSnapshot, currentReceiptSnapshot] = await Promise.all([
            transaction.get(gameDoc.ref),
            transaction.get(privateRef),
            transaction.get(receiptRef)
        ]);
        if (!currentGameSnapshot.exists) return { status: 'gone' };
        if (getReplayMigrationDocumentFingerprint(
            currentGameSnapshot.data() || {},
            currentPrivateSnapshot
        ) !== frozenDocumentFingerprint) {
            return { status: 'blocked', reason: 'replay-state-changed-after-document-inventory' };
        }
        let receipt = null;
        if (currentReceiptSnapshot.exists) {
            receipt = normalizeBoundReplayCompatibilityReceipt(
                receiptPath,
                currentReceiptSnapshot.data() || {}
            ).receipt;
            if (!frozenReceiptEntry
                || !replayCompatibilityReceiptsEqual(receipt, frozenReceiptEntry.receipt)) {
                return { status: 'blocked', reason: 'compatibility-receipt-changed-after-inventory' };
            }
        } else if (frozenReceiptEntry) {
            return { status: 'blocked', reason: 'compatibility-receipt-changed-after-inventory' };
        }
        if (receipt) {
            await verifyPersistedReplayCompatibilityHistory({
                transaction,
                db,
                receipt,
                protectedIdentityInventory
            });
        }

        const game = currentGameSnapshot.data() || {};
        const existingPrivate = currentPrivateSnapshot.exists
            ? (currentPrivateSnapshot.data() || {})
            : null;
        if (receiptIdentityRecordsPersisted && protectedIdentityInventory) {
            await verifyPersistedCurrentReplayIdentities({
                transaction,
                db,
                game,
                privateArchive: existingPrivate,
                protectedIdentityInventory
            });
        }
        const classification = classifyReplayMigration(game, existingPrivate, receipt);
        if (classification.action === 'none') return { status: 'none' };
        if (classification.action === 'blocked') {
            return { status: 'blocked', reason: classification.reason };
        }

        const timestamp = fieldValue.serverTimestamp();
        let privateArchive = classification.privateArchive;
        if (!privateArchive) {
            let inspection = classification.inspection;
            const compatibilityState = receipt
                ? getReplayCompatibilityState(game, receipt, {
                    teamId: receipt.teamId,
                    gameId: receipt.gameId
                })
                : null;
            if (inspection.state === 'none' && receipt) {
                inspection = { state: 'removed' };
            } else if (inspection.state === 'none') {
                // Empty legacy keys have no identity to preserve, but they still
                // need to be scrubbed before the final Rules boundary.
                const update = { updatedAt: timestamp };
                for (const field of REPLAY_READABLE_FIELDS) {
                    if (field === 'videoUrl' && !getMigrationReplayLifecycle(game).isCompleted) continue;
                    update[field] = fieldValue.delete();
                }
                REPLAY_COMPAT_MARKER_FIELDS.forEach((field) => {
                    update[field] = fieldValue.delete();
                });
                transaction.set(gameDoc.ref, update, { merge: true });
                return { status: 'migrated', state: 'none' };
            }
            const revision = compatibilityState?.receiptMatches
                ? receipt.revision
                : reservedRevision;
            privateArchive = buildMigratedPrivateArchive({
                inspection,
                game,
                revision,
                timestamp,
                compatibilityState
            });
            transaction.set(privateRef, privateArchive, { merge: false });
        }

        transaction.set(gameDoc.ref, buildReadableReplayScrub({
            game,
            privateArchive,
            fieldValue,
            timestamp
        }), { merge: true });
        if (receipt) transaction.delete(receiptRef);
        return {
            status: privateArchive.state === 'quarantine' ? 'quarantine' : 'migrated',
            state: privateArchive.state
        };
    });
}

export async function consumeOrphanReplayCompatibilityReceipts({
    db,
    compatibilityReceipts,
    protectedIdentityInventory,
    apply = APPLY,
    logger = console
}) {
    const result = { scanned: 0, matched: 0, deleted: 0 };
    for (const [receiptPath, frozenReceiptEntry] of compatibilityReceipts) {
        result.scanned += 1;
        const parentRef = db.doc(frozenReceiptEntry.parentPath);
        const receiptRef = db.doc(receiptPath);
        const [parentSnapshot, receiptSnapshot] = await Promise.all([
            parentRef.get(),
            receiptRef.get()
        ]);
        if (!receiptSnapshot.exists || parentSnapshot.exists) continue;
        result.matched += 1;
        logger.log(
            `[backfill-game-replay-archives] ${apply ? 'Consume' : 'Would consume'} orphan replay compatibility receipt at ${receiptPath}`
        );
        if (!apply) continue;
        const deleted = await db.runTransaction(async (transaction) => {
            const [currentParent, currentReceipt] = await Promise.all([
                transaction.get(parentRef),
                transaction.get(receiptRef)
            ]);
            if (currentParent.exists || !currentReceipt.exists) return false;
            const receipt = normalizeBoundReplayCompatibilityReceipt(
                receiptPath,
                currentReceipt.data() || {}
            ).receipt;
            if (!replayCompatibilityReceiptsEqual(receipt, frozenReceiptEntry.receipt)) {
                throw new Error(`Replay compatibility receipt changed after inventory at ${receiptPath}.`);
            }
            await verifyPersistedReplayCompatibilityHistory({
                transaction,
                db,
                receipt,
                protectedIdentityInventory
            });
            transaction.delete(receiptRef);
            return true;
        });
        if (deleted) result.deleted += 1;
    }
    return result;
}

export async function backfillGameReplayArchives({
    db,
    apply = APPLY,
    fieldValue = FieldValue,
    randomUUID = crypto.randomUUID,
    logger = console,
    pageSize = DEFAULT_PAGE_SIZE,
    protectedIdentityInventory = null,
    compatibilityReceiptInventory = null,
    receiptIdentityRecordsPersisted = false
}) {
    const result = {
        scanned: 0,
        matched: 0,
        migrated: 0,
        quarantined: 0,
        blocked: 0,
        secondaryScanned: 0,
        secondaryMatched: 0,
        secondaryMigrated: 0,
        orphanReceiptsDeleted: 0
    };
    const receiptCollection = compatibilityReceiptInventory
        || await collectReplayCompatibilityReceiptInventory(db, pageSize);
    if (apply && receiptCollection.receipts.size && !receiptIdentityRecordsPersisted) {
        throw new Error('Compatibility receipts require the complete replay migration orchestrator.');
    }
    // Capture the complete identity set before any source alias can be scrubbed.
    // A caller may pass a set captured immediately before this function so the
    // same frozen inventory can also be used by post-migration verification.
    const protectedIdentities = createReplayIdentityInventory();
    mergeReplayIdentityInventory(
        protectedIdentities,
        protectedIdentityInventory
            || await collectProtectedReplayIdentityInventory(db, pageSize)
    );
    mergeReplayIdentityInventory(protectedIdentities, receiptCollection.inventory);
    const secondary = await migrateAllReadableReplayCopies({
        db,
        apply,
        inventory: protectedIdentities,
        logger,
        pageSize
    });
    result.secondaryScanned = secondary.scanned;
    result.secondaryMatched = secondary.matched;
    result.secondaryMigrated = secondary.migrated;
    for (const collectionId of ['games', 'sharedGames']) {
        for await (const gameDoc of iterateCollectionGroup(db, collectionId, pageSize)) {
            if (collectionId === 'games' && !isCanonicalTeamGamePath(gameDoc.ref.path)) continue;
            if (collectionId === 'sharedGames' && !isSharedGamePath(gameDoc.ref.path)) continue;
            result.scanned += 1;
            const outcome = await migrateReplayDocument({
                db,
                gameDoc,
                apply,
                fieldValue,
                randomUUID,
                logger,
                compatibilityReceipts: receiptCollection.receipts,
                protectedIdentityInventory: protectedIdentities,
                receiptIdentityRecordsPersisted
            });
            if (outcome.status === 'matched') result.matched += 1;
            if (outcome.status === 'migrated') {
                result.matched += 1;
                result.migrated += 1;
            }
            if (outcome.status === 'quarantine') {
                result.matched += 1;
                result.quarantined += 1;
                if (apply) result.migrated += 1;
            }
            if (outcome.status === 'blocked') result.blocked += 1;
        }
    }
    const orphanReceipts = await consumeOrphanReplayCompatibilityReceipts({
        db,
        compatibilityReceipts: receiptCollection.receipts,
        protectedIdentityInventory: protectedIdentities,
        apply,
        logger
    });
    result.orphanReceiptsDeleted = orphanReceipts.deleted;
    logger.log(`[backfill-game-replay-archives] Done: ${JSON.stringify(result)}`);
    if (result.blocked > 0) {
        throw new Error(`Replay archive migration blocked for ${result.blocked} document(s).`);
    }
    return result;
}

export async function verifyReadableReplayArchiveInventory({
    db,
    logger = console,
    pageSize = DEFAULT_PAGE_SIZE,
    protectedIdentityInventory = null
}) {
    const paths = [];
    // Verification uses both the frozen pre-migration set and a fresh inventory.
    // The union detects copies of a source deleted during the migration as well
    // as identities introduced concurrently after the initial capture.
    const protectedIdentities = createReplayIdentityInventory();
    if (protectedIdentityInventory) {
        mergeReplayIdentityInventory(protectedIdentities, protectedIdentityInventory);
    }
    mergeReplayIdentityInventory(
        protectedIdentities,
        await collectProtectedReplayIdentityInventory(db, pageSize)
    );
    for (const collectionId of ['games', 'sharedGames']) {
        for await (const gameDoc of iterateCollectionGroup(db, collectionId, pageSize)) {
            if (collectionId === 'games' && !isCanonicalTeamGamePath(gameDoc.ref.path)) continue;
            if (collectionId === 'sharedGames' && !isSharedGamePath(gameDoc.ref.path)) continue;
            const game = gameDoc.data() || {};
            if (hasReadableReplayKeys(game)
                || Object.keys(sanitizeReadableReplayCopies(game, protectedIdentities)).length > 0) {
                paths.push(gameDoc.ref.path);
            }
        }
    }
    for await (const profileDoc of iterateCollectionGroup(db, 'athleteProfiles', pageSize)) {
        if (!/^athleteProfiles\/[^/]+$/.test(profileDoc.ref.path)) continue;
        if (Object.keys(sanitizeReadableReplayCopies(
            profileDoc.data() || {},
            protectedIdentities
        )).length > 0) {
            paths.push(profileDoc.ref.path);
        }
    }
    if (paths.length) {
        paths.slice(0, 20).forEach((path) => logger.error(
            `[backfill-game-replay-archives] Readable replay state remains at ${path}`
        ));
        throw new Error(`Readable replay archive verification failed for ${paths.length} document(s).`);
    }
    logger.log('[backfill-game-replay-archives] Verified zero readable replay archive aliases.');
    return { remaining: 0 };
}

export async function verifyProtectedReplayIdentityInventory({
    db,
    logger = console,
    pageSize = DEFAULT_PAGE_SIZE
}) {
    const persistedIdentities = await collectPersistedProtectedReplayIdentityInventory(db, pageSize);
    const missing = [];
    for (const collectionId of ['games', 'sharedGames']) {
        for await (const gameDoc of iterateCollectionGroup(db, collectionId, pageSize)) {
            if (collectionId === 'games' && !isCanonicalTeamGamePath(gameDoc.ref.path)) continue;
            if (collectionId === 'sharedGames' && !isSharedGamePath(gameDoc.ref.path)) continue;
            const privateSnapshot = await getReplayPrivateRef(gameDoc.ref).get();
            const current = collectSensitiveReplayIdentityInventory(
                gameDoc.data() || {},
                privateSnapshot.exists ? (privateSnapshot.data() || {}) : null
            );
            const missingHashes = [...current.identityHashes]
                .filter((identityHash) => !persistedIdentities.identityHashes.has(identityHash));
            if (missingHashes.length) {
                missing.push({ path: gameDoc.ref.path, count: missingHashes.length });
            }
        }
    }
    if (missing.length) {
        missing.slice(0, 20).forEach(({ path, count }) => logger.error(
            `[backfill-game-replay-archives] ${count} replay identity ledger record(s) are missing for ${path}`
        ));
        throw new Error(
            `Protected replay identity verification failed for ${missing.length} document(s).`
        );
    }
    logger.log('[backfill-game-replay-archives] Verified every current replay identity is durably protected.');
    return { remaining: 0 };
}

export async function verifyReplayClipIdentityInventory({
    db,
    logger = console,
    pageSize = DEFAULT_PAGE_SIZE,
    protectedIdentityInventory = null
}) {
    const protectedIdentities = createReplayIdentityInventory();
    if (protectedIdentityInventory) {
        mergeReplayIdentityInventory(protectedIdentities, protectedIdentityInventory);
    }
    mergeReplayIdentityInventory(
        protectedIdentities,
        await collectProtectedReplayIdentityInventory(db, pageSize)
    );
    const [readableClipIdentities, persistedClipIdentities] = await Promise.all([
        collectReadableReplayClipIdentityInventory(db, pageSize),
        collectPersistedReplayClipIdentityInventory(db, pageSize)
    ]);
    assertNoProtectedReplayClipIdentityOverlap(protectedIdentities, persistedClipIdentities);
    const missingVideoIds = [...readableClipIdentities.youtubeVideoIds]
        .filter((videoId) => !protectedIdentities.youtubeVideoIds.has(videoId)
            && !protectedIdentities.identityHashes.has(getReplayIdentityHash('youtube', videoId)))
        .filter((videoId) => !persistedClipIdentities.identityHashes.has(
            getReplayIdentityHash('youtube', videoId)
        ))
        .sort();
    if (missingVideoIds.length) {
        missingVideoIds.slice(0, 20).forEach((videoId) => logger.error(
            `[backfill-game-replay-archives] Replay clip identity is not reserved: youtube:${videoId}`
        ));
        throw new Error(`Replay clip identity verification failed for ${missingVideoIds.length} video(s).`);
    }
    logger.log('[backfill-game-replay-archives] Verified every standalone YouTube clip identity is reserved.');
    return { remaining: 0 };
}

export async function verifyStructuredReplayClipIdentityInventory({
    db,
    logger = console,
    pageSize = DEFAULT_PAGE_SIZE,
    protectedIdentityInventory = null
}) {
    const protectedIdentities = createReplayIdentityInventory();
    if (protectedIdentityInventory) {
        mergeReplayIdentityInventory(protectedIdentities, protectedIdentityInventory);
    }
    mergeReplayIdentityInventory(
        protectedIdentities,
        await collectProtectedReplayIdentityInventory(db, pageSize)
    );
    const [report, persistedClipIdentities] = await Promise.all([
        collectStructuredReplayClipIdentityReport({
            db,
            pageSize,
            protectedIdentityInventory: protectedIdentities
        }),
        collectPersistedReplayClipIdentityInventory(db, pageSize)
    ]);
    if (report.protectedOverlaps.length
        || report.protectedUrlOverlaps.length
        || report.automatedCopies.length) {
        throw new Error(
            `Structured replay identity verification found ${report.protectedOverlaps.length + report.protectedUrlOverlaps.length} protected overlap(s) and ${report.automatedCopies.length} automated copy source(s).`
        );
    }
    const missingVideoIds = report.videoIds
        .filter((videoId) => !persistedClipIdentities.identityHashes.has(
            getReplayIdentityHash('youtube', videoId)
        ));
    if (missingVideoIds.length) {
        logger.error(
            `[backfill-game-replay-archives] ${missingVideoIds.length} structured media identity reservation(s) are missing.`
        );
        throw new Error(
            `Structured replay identity verification failed for ${missingVideoIds.length} video(s).`
        );
    }
    logger.log('[backfill-game-replay-archives] Verified every finite structured media identity is reserved and disjoint from protected replay state.');
    return { remaining: 0 };
}

export async function verifyNoReplayArchiveAttribution({
    db,
    logger = console,
    pageSize = DEFAULT_PAGE_SIZE
}) {
    const paths = [];
    for await (const archiveDoc of iterateCollectionGroup(db, 'privateReplay', pageSize)) {
        if (!isReplayPrivateArchivePath(archiveDoc.ref.path)) continue;
        if (sanitizeReplayArchiveAttribution(archiveDoc.data()).changed) {
            paths.push(archiveDoc.ref.path);
        }
    }
    if (paths.length) {
        paths.slice(0, 20).forEach((path) => logger.error(
            `[backfill-game-replay-archives] Personal replay attribution remains at ${path}`
        ));
        throw new Error(
            `Private replay attribution verification failed for ${paths.length} archive(s).`
        );
    }
    logger.log('[backfill-game-replay-archives] Verified zero personal replay attribution fields.');
    return { remaining: 0 };
}

export async function runReplayArchiveMigration({
    db,
    apply = APPLY,
    fieldValue = FieldValue,
    randomUUID = crypto.randomUUID,
    logger = console,
    pageSize = DEFAULT_PAGE_SIZE
}) {
    // The durable gate is deliberately closed before the first identity read.
    // A failed or interrupted apply leaves it closed until a complete retry
    // owns the attempt and passes the authoritative zero-alias verification.
    if (apply) await verifyAthleteProfileProjectionBoundary(db);
    const attemptId = apply
        ? await beginReplayArchiveMigration({ db, fieldValue, randomUUID })
        : null;
    const attribution = await scrubReplayArchiveAttribution({
        db,
        apply,
        logger,
        pageSize
    });
    const protectedIdentityInventory = await collectProtectedReplayIdentityInventory(db, pageSize);
    const compatibilityReceiptInventory = await collectReplayCompatibilityReceiptInventory(
        db,
        pageSize
    );
    mergeReplayIdentityInventory(
        protectedIdentityInventory,
        compatibilityReceiptInventory.inventory
    );
    const [persistedClipIdentityInventory, independentReadableIdentityInventory] = await Promise.all([
        collectPersistedReplayClipIdentityInventory(db, pageSize),
        collectIndependentReadableReplayIdentityInventory(db, pageSize)
    ]);
    assertNoProtectedReplayClipIdentityOverlap(
        protectedIdentityInventory,
        persistedClipIdentityInventory
    );
    assertNoIndependentReadableReplayOverlap(
        protectedIdentityInventory,
        independentReadableIdentityInventory
    );
    const structuredIdentityReport = await collectStructuredReplayClipIdentityReport({
        db,
        pageSize,
        protectedIdentityInventory
    });
    assertNoIndependentStructuredReplayOverlap(structuredIdentityReport);
    const readableClipIdentityInventory = await collectReadableReplayClipIdentityInventory(db, pageSize);
    const replayClipIdentityInventory = buildReplayClipExclusionInventory(
        readableClipIdentityInventory,
        protectedIdentityInventory
    );
    mergeReplayIdentityInventory(
        replayClipIdentityInventory,
        buildStructuredReplayClipExclusionInventory(
            structuredIdentityReport,
            protectedIdentityInventory
        )
    );
    if (apply) {
        await persistProtectedReplayIdentityInventory({
            db,
            inventory: protectedIdentityInventory,
            fieldValue
        });
        await persistReplayClipIdentityInventory({
            db,
            inventory: replayClipIdentityInventory,
            fieldValue
        });
    }
    const structuredCopies = await migrateStructuredReplayAutomatedCopies({
        db,
        report: structuredIdentityReport,
        protectedIdentityInventory,
        apply,
        fieldValue,
        logger
    });
    const result = await backfillGameReplayArchives({
        db,
        apply,
        fieldValue,
        randomUUID,
        logger,
        pageSize,
        protectedIdentityInventory,
        compatibilityReceiptInventory,
        receiptIdentityRecordsPersisted: apply
    });
    result.structuredSecondaryMatched = structuredCopies.matched;
    result.structuredSecondaryMigrated = structuredCopies.migrated;
    result.attributionScanned = attribution.scanned;
    result.attributionMatched = attribution.matched;
    result.attributionScrubbed = attribution.scrubbed;
    if (apply) {
        if (result.quarantined > 0) {
            throw new Error(
                `Replay archive migration quarantined ${result.quarantined} document(s); resolve every private quarantine before retrying.`
            );
        }
        await verifyReadableReplayArchiveInventory({
            db,
            logger,
            pageSize,
            protectedIdentityInventory
        });
        await verifyProtectedReplayIdentityInventory({
            db,
            logger,
            pageSize
        });
        await verifyReplayClipIdentityInventory({
            db,
            logger,
            pageSize,
            protectedIdentityInventory
        });
        await verifyStructuredReplayClipIdentityInventory({
            db,
            logger,
            pageSize,
            protectedIdentityInventory
        });
        await verifyNoReplayCompatibilityReceipts({ db, logger, pageSize });
        await verifyNoReplayArchiveAttribution({ db, logger, pageSize });
        await completeReplayArchiveMigration({ db, attemptId, fieldValue });
    }
    return result;
}

async function main() {
    if (!getApps().length) initializeApp(getMigrationAdminAppOptions({ projectId: FIREBASE_PROJECT_ID }));
    const db = getMigrationFirestore({ projectId: FIREBASE_PROJECT_ID });
    if ([APPLY, CLOSE_GATE, ACTIVATE_PROFILE_BOUNDARY].filter(Boolean).length > 1) {
        throw new Error('Choose only one replay archive migration action.');
    }
    if (CLOSE_GATE) {
        await beginReplayArchiveMigration({ db });
        console.log('[backfill-game-replay-archives] Replay archive mutation gate is migrating.');
        return;
    }
    if (ACTIVATE_PROFILE_BOUNDARY) {
        await activateAthleteProfileProjectionBoundary({ db });
        console.log('[backfill-game-replay-archives] Athlete profile replay projection boundary is ready.');
        return;
    }
    await runReplayArchiveMigration({ db });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error('[backfill-game-replay-archives] Failed:', error);
        process.exitCode = 1;
    });
}
