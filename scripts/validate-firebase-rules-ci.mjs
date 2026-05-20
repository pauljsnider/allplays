import { readFileSync } from 'node:fs';

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

const firebaseJson = JSON.parse(readText('firebase.json'));
const firestoreRules = readText('firestore.rules');
const deployProd = readText('.github/workflows/deploy-prod.yml');
const deployPreview = readText('.github/workflows/deploy-preview.yml');
const regressionGuards = readText('.github/workflows/regression-guards.yml');

if (firebaseJson.firestore?.rules !== 'firestore.rules') {
    throw new Error('firebase.json must deploy firestore.rules.');
}

if (firebaseJson.firestore?.indexes !== 'firestore.indexes.json') {
    throw new Error('firebase.json must deploy firestore.indexes.json.');
}

assertIncludes(firestoreRules, 'match /mediaFolders/{folderId}', 'Firestore media folder rules');
assertIncludes(firestoreRules, 'match /mediaItems/{itemId}', 'Firestore media item rules');
assertIncludes(firestoreRules, 'function canReadTeamMediaFolder(teamId, folderData)', 'Firestore media folder visibility rules');
assertIncludes(firestoreRules, 'function canReadTeamMediaItem(teamId, itemData)', 'Firestore media item visibility rules');
assertIncludes(firestoreRules, 'allow read: if canReadTeamMediaFolder(teamId, resource.data);', 'Firestore media folder read rules');
assertIncludes(firestoreRules, 'allow read: if canReadTeamMediaItem(teamId, resource.data);', 'Firestore media item read rules');
assertIncludes(firestoreRules, 'allow create, update, delete: if isTeamOwnerOrAdmin(teamId);', 'Firestore media folder write rules');
assertIncludes(firestoreRules, 'allow create: if isTeamOwnerOrAdmin(teamId) || isTeamMediaUploadCreate(teamId, request.resource.data);', 'Firestore media item create rules');
assertIncludes(firestoreRules, 'allow update: if isTeamOwnerOrAdmin(teamId) || isOwnTeamMediaUploadSoftDelete(teamId) || isTeamMediaTitleUpdate(teamId);', 'Firestore media item update rules');
assertIncludes(firestoreRules, 'allow delete: if isTeamOwnerOrAdmin(teamId);', 'Firestore media item delete rules');

assertIncludes(deployProd, 'firestore:rules', 'Production deploy');
assertIncludes(deployProd, 'firestore:indexes', 'Production deploy');
assertMatches(deployProd, /needs:\s*\[\s*unit-tests\s*,\s*regression-guards\s*\]/, 'Production deploy gate');

assertMatches(deployPreview, /needs:\s*\[\s*unit-tests\s*,\s*regression-guards\s*\]/, 'Preview deploy gate');

assertIncludes(regressionGuards, 'npm run ci:firebase-rules', 'Regression guard workflow');
assertIncludes(regressionGuards, 'npm run test:smoke:team-fallback', 'Regression guard workflow');
