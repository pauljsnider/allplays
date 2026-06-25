import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function readText(path) {
    return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assertIncludes(text, expected, label) {
    if (!text.includes(expected)) {
        throw new Error(`${label} is missing: ${expected}`);
    }
}

function assertMatches(text, pattern, label) {
    if (!pattern.test(text)) {
        throw new Error(`${label} did not match ${pattern}`);
    }
}

export function extractMatchBlock(text, startMarker) {
    const start = text.indexOf(startMarker);
    if (start === -1) {
        throw new Error(`Rule block is missing: ${startMarker}`);
    }

    const remainingText = text.slice(start);
    const nextMatch = remainingText.indexOf('\n    match /', startMarker.length);
    return nextMatch === -1 ? remainingText : remainingText.slice(0, nextMatch);
}

export function validateFirebaseRulesCi() {
    const firebaseJson = JSON.parse(readText('firebase.json'));
    const firestoreRules = readText('firestore.rules');
    const storageRules = readText('storage.rules');
    const legacyGameClipRules = extractMatchBlock(storageRules, 'match /game-clips/{fileName} {');
    const collectionGroupGamesHelper = (firestoreRules.match(/function canReadCollectionGroupGameDocument\(teamPath, data\) \{[\s\S]*?\n\s*}/) || [''])[0];
    const gameEventsRules = (firestoreRules.match(/match \/events\/\{eventId} \{[\s\S]*?\n\s*}/) || [''])[0];
    const aggregatedStatsRules = (firestoreRules.match(/match \/aggregatedStats\/\{statId} \{[\s\S]*?\n\s*}/) || [''])[0];
    const deployProd = readText('.github/workflows/deploy-prod.yml');
    const deployPreview = readText('.github/workflows/deploy-preview.yml');
    const regressionGuards = readText('.github/workflows/regression-guards.yml');

    if (firebaseJson.firestore?.rules !== 'firestore.rules') {
        throw new Error('firebase.json must deploy firestore.rules.');
    }

    if (firebaseJson.firestore?.indexes !== 'firestore.indexes.json') {
        throw new Error('firebase.json must deploy firestore.indexes.json.');
    }

    if (firebaseJson.storage?.rules !== 'storage.rules') {
        throw new Error('firebase.json must deploy storage.rules.');
    }

    assertIncludes(firestoreRules, 'match /mediaFolders/{folderId}', 'Firestore media folder rules');
    assertIncludes(firestoreRules, 'match /mediaItems/{itemId}', 'Firestore media item rules');
    assertIncludes(firestoreRules, 'function canReadTeamMediaFolder(teamId, folderData)', 'Firestore media folder visibility rules');
    assertIncludes(firestoreRules, 'function canReadTeamMediaItem(teamId, itemData)', 'Firestore media item visibility rules');
    assertIncludes(firestoreRules, 'allow read: if canReadTeamMediaFolder(teamId, resource.data);', 'Firestore media folder read rules');
    assertIncludes(firestoreRules, 'allow read: if canReadTeamMediaItem(teamId, resource.data);', 'Firestore media item read rules');
    assertIncludes(firestoreRules, 'function canReadGameDocument(teamId, gameId, data)', 'Firestore game visibility helper');
    assertIncludes(firestoreRules, 'function canReadGameSubcollectionDocument(teamId, gameId)', 'Firestore game subcollection visibility helper');
    assertIncludes(firestoreRules, 'function canReadCollectionGroupGameDocument(teamPath, data)', 'Firestore collection-group game visibility helper');
    assertIncludes(collectionGroupGamesHelper, 'let parentTeamPath = /databases/$(database)/documents/$(teamPath);', 'Firestore collection-group team path reuse');
    assertIncludes(collectionGroupGamesHelper, 'let parentTeam = get(parentTeamPath).data;', 'Firestore collection-group parent team lookup reuse');
    assertIncludes(collectionGroupGamesHelper, 'return parentTeam != null &&', 'Firestore collection-group parent team existence guard');
    if ((collectionGroupGamesHelper.match(/get\(parentTeamPath\)/g) || []).length !== 1) {
        throw new Error('Firestore collection-group game visibility helper must resolve the parent team document exactly once.');
    }
    if (collectionGroupGamesHelper.includes('exists(parentTeamPath)')) {
        throw new Error('Firestore collection-group game visibility helper must not re-read the parent team document with exists(parentTeamPath).');
    }
    assertIncludes(firestoreRules, 'allow read: if canReadGameDocument(teamId, gameId, resource.data);', 'Firestore team game read rules');
    assertIncludes(firestoreRules, 'allow read: if canReadGameSubcollectionDocument(teamId, gameId);', 'Firestore game subcollection read rules');
    assertIncludes(firestoreRules, 'allow read: if canReadCollectionGroupGameDocument(path, resource.data);', 'Firestore collection-group game read rules');
    if (gameEventsRules.includes('allow read: if true;')) {
        throw new Error('Firestore game events read rules must not allow unconditional public reads.');
    }
    if (aggregatedStatsRules.includes('allow read: if true;')) {
        throw new Error('Firestore aggregated stats read rules must not allow unconditional public reads.');
    }
    assertIncludes(firestoreRules, 'allow create, update, delete: if isTeamOwnerOrAdmin(teamId);', 'Firestore media folder write rules');
    assertIncludes(firestoreRules, 'allow create: if isTeamOwnerOrAdmin(teamId) || isTeamMediaUploadCreate(teamId, request.resource.data);', 'Firestore media item create rules');
    assertIncludes(firestoreRules, 'allow update: if isTeamOwnerOrAdmin(teamId) || isOwnTeamMediaUploadSoftDelete(teamId) || isTeamMediaTitleUpdate(teamId);', 'Firestore media item update rules');
    assertIncludes(firestoreRules, 'allow delete: if isTeamOwnerOrAdmin(teamId);', 'Firestore media item delete rules');
    assertIncludes(firestoreRules, 'match /adminBilling/{billingId}', 'Firestore team fee admin billing rules');
    assertIncludes(firestoreRules, 'allow read, create, update, delete: if isTeamOwnerOrAdmin(teamId);', 'Firestore team fee admin billing admin-only rules');
    assertIncludes(firestoreRules, 'match /rsvpNotes/{rsvpId}', 'Firestore restricted RSVP note rules');
    assertIncludes(firestoreRules, 'function isRsvpStatusPayloadSafe(data)', 'Firestore RSVP status note exclusion helper');
    assertIncludes(firestoreRules, 'allow read: if canReadRsvpNote(teamId, resource.data);', 'Firestore restricted RSVP note read rules');

    assertIncludes(deployProd, 'firestore:rules', 'Production deploy');
    assertIncludes(deployProd, 'firestore:indexes', 'Production deploy');
    assertMatches(deployProd, /needs:\s*\[\s*unit-tests\s*,\s*regression-guards\s*\]/, 'Production deploy gate');

    assertMatches(deployPreview, /needs:\s*\[\s*unit-tests\s*,\s*regression-guards\s*\]/, 'Preview deploy gate');

    assertIncludes(storageRules, 'match /game-clips/{teamId}/{gameId}/{userId}/{fileName}', 'Scoped Storage game clip rules');
    assertIncludes(storageRules, 'allow get: if canAccessTeamMedia(teamId);', 'Scoped Storage game clip read rules');
    assertIncludes(storageRules, 'allow create: if canAccessTeamMedia(teamId) &&', 'Scoped Storage game clip create rules');
    assertIncludes(storageRules, 'request.auth.uid == userId', 'Scoped Storage uploader match rules');
    assertIncludes(storageRules, 'request.resource.contentType.matches(\'video/.*\')', 'Scoped Storage video content-type rules');
    assertIncludes(storageRules, 'match /game-clips/{fileName} {', 'Legacy Storage game clip rules');
    assertIncludes(legacyGameClipRules, 'allow get, create, delete: if false;', 'Legacy Storage deny-all rule');

    assertIncludes(regressionGuards, 'npm run ci:firebase-rules', 'Regression guard workflow');
    assertIncludes(regressionGuards, 'npm run test:smoke:team-fallback', 'Regression guard workflow');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    validateFirebaseRulesCi();
}
