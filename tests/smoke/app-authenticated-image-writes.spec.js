import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
    AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS,
    buildAppSmokeUrl,
    closeAuthenticatedAppSession,
    createAuthenticatedAppSession,
    getAppSmokeConfig,
    redactSmokeDiagnostic
} from './helpers/app-auth.js';
import {
    createFirestoreDocument,
    createFirebaseRestSession,
    deleteFirebaseStorageObject,
    deleteSmokeMediaByTitle,
    getFirestoreDocument,
    getFirestoreStringField,
    patchFirestoreDocumentFields,
    restoreFirestoreDocumentFields,
    runSmokeCleanup,
    uploadFirebaseStorageObject
} from './helpers/firebase-rest.js';

const config = getAppSmokeConfig();
const extendedEnabled = process.env.SMOKE_EXTENDED_WRITES === '1';
const runId = String(config.runId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
const attemptNonce = randomUUID().replace(/-/g, '');
const smokePrefix = `allplays-smoke-${runId}-${attemptNonce}`;
const secretValues = [config.staffEmail, config.staffPassword, config.parentEmail, config.parentPassword];

test.skip(!extendedEnabled, 'SMOKE_EXTENDED_WRITES=1 is required');

let staffSession;
let staffRestSession;
let parentRestSession;

test.beforeAll(async ({ browser }) => {
    test.setTimeout(AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS);
    for (const [name, value] of Object.entries({
        SMOKE_RUN_ID: runId,
        SMOKE_APP_BASE_URL: config.appBaseUrl,
        SMOKE_TEAM_ID: config.teamId,
        SMOKE_PLAYER_ID: config.playerId,
        SMOKE_STAFF_EMAIL: config.staffEmail,
        SMOKE_STAFF_PASSWORD: config.staffPassword,
        SMOKE_PARENT_EMAIL: config.parentEmail,
        SMOKE_PARENT_PASSWORD: config.parentPassword
    })) {
        expect(value, `${name} is required for the reversible image suite`).toBeTruthy();
    }

    [staffSession, staffRestSession, parentRestSession] = await Promise.all([
        createAuthenticatedAppSession(browser, {
            appBaseUrl: config.appBaseUrl,
            email: config.staffEmail,
            password: config.staffPassword,
            roleLabel: 'staff image writes'
        }),
        createFirebaseRestSession({
            appBaseUrl: config.appBaseUrl,
            email: config.staffEmail,
            password: config.staffPassword
        }),
        createFirebaseRestSession({
            appBaseUrl: config.appBaseUrl,
            email: config.parentEmail,
            password: config.parentPassword
        })
    ]);
});

test.afterAll(async () => {
    await closeAuthenticatedAppSession(staffSession);
});

async function withAuthenticatedPage(callback) {
    const { page, issues } = staffSession;
    await callback(page);
    expect(issues.map((issue) => redactSmokeDiagnostic(issue, secretValues))).toEqual([]);
}

async function openRoute(page, route) {
    await page.goto(buildAppSmokeUrl(config.appBaseUrl, route), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 25_000 });
    await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toContain(`#${route.split('?')[0]}`);
}

async function restoreImageFieldsIfUnchanged(documentState, fieldNames = Object.keys(documentState.expectedFields)) {
    const expectedEntries = Object.entries(documentState.expectedFields)
        .filter(([fieldName]) => fieldNames.includes(fieldName));
    if (!expectedEntries.length) return;

    for (const [fieldName, fieldValue] of expectedEntries) {
        const currentDocument = await getFirestoreDocument(documentState.restSession, documentState.documentPath);
        if (!currentDocument) continue;
        if (getFirestoreStringField(currentDocument, fieldName) === fieldValue.stringValue) {
            await restoreFirestoreDocumentFields(
                documentState.restSession,
                documentState.documentPath,
                documentState.originalDocument,
                [fieldName],
                { updateTime: currentDocument.updateTime }
            );
        }
        const restoredDocument = await getFirestoreDocument(documentState.restSession, documentState.documentPath);
        expect(getFirestoreStringField(restoredDocument, fieldName)).not.toBe(fieldValue.stringValue);
    }
}

function isAbandonedSmokeImageValue(value) {
    return String(value || '').includes('allplays-smoke-')
        || String(value || '').startsWith('https://allplays.ai/img/logo_small.png?smoke=');
}

async function clearAbandonedField(restSession, documentPath, fieldName, expectedValue) {
    const currentDocument = await getFirestoreDocument(restSession, documentPath);
    if (getFirestoreStringField(currentDocument, fieldName) !== expectedValue) return false;
    await restoreFirestoreDocumentFields(
        restSession,
        documentPath,
        { fields: {} },
        [fieldName],
        { updateTime: currentDocument.updateTime }
    );
    const restoredDocument = await getFirestoreDocument(restSession, documentPath);
    expect(getFirestoreStringField(restoredDocument, fieldName)).not.toBe(expectedValue);
    return true;
}

async function reconcileDedicatedImageFixture(target) {
    const abandonedPaths = [];

    for (const documentTarget of target.documents) {
        const document = await getFirestoreDocument(target.restSession, documentTarget.documentPath);
        if (!document && documentTarget.allowMissing) continue;
        expect(document, `${target.recordType} fixture document must exist`).toBeTruthy();
        for (const fieldName of Object.keys(documentTarget.expectedFields)) {
            const fieldValue = getFirestoreStringField(document, fieldName);
            if (!fieldValue) continue;
            expect(
                isAbandonedSmokeImageValue(fieldValue),
                `${target.recordType} is a dedicated smoke fixture and must have an empty ${fieldName} baseline`
            ).toBe(true);
            if (fieldName === 'photoPath') abandonedPaths.push(fieldValue);
        }
    }

    for (const documentTarget of target.documents) {
        if (!Object.hasOwn(documentTarget.expectedFields, 'photoUrl')) continue;
        const document = await getFirestoreDocument(target.restSession, documentTarget.documentPath);
        const abandonedUrl = getFirestoreStringField(document, 'photoUrl');
        if (isAbandonedSmokeImageValue(abandonedUrl)) {
            await clearAbandonedField(target.restSession, documentTarget.documentPath, 'photoUrl', abandonedUrl);
        }
    }
    for (const documentTarget of target.documents) {
        if (!Object.hasOwn(documentTarget.expectedFields, 'photoPath')) continue;
        const document = await getFirestoreDocument(target.restSession, documentTarget.documentPath);
        const abandonedPath = getFirestoreStringField(document, 'photoPath');
        if (isAbandonedSmokeImageValue(abandonedPath)) {
            await clearAbandonedField(target.restSession, documentTarget.documentPath, 'photoPath', abandonedPath);
        }
    }

    for (const documentTarget of target.documents) {
        const document = await getFirestoreDocument(target.restSession, documentTarget.documentPath);
        if (!document && documentTarget.allowMissing) continue;
        for (const fieldName of Object.keys(documentTarget.expectedFields)) {
            expect(getFirestoreStringField(document, fieldName)).toBe('');
        }
    }
    for (const abandonedPath of [...new Set(abandonedPaths)]) {
        await deleteFirebaseStorageObject(target.restSession, abandonedPath);
    }
}

test('staff image upload is persisted and removed after validation', async () => {
    test.setTimeout(240_000);
    const mediaName = `${smokePrefix}-media.png`;
    const cleanupTasks = [{
        recordType: 'team-media',
        cleanup: () => deleteSmokeMediaByTitle(
            staffRestSession,
            `teams/${config.teamId}/mediaItems`,
            mediaName
        )
    }];

    try {
        await withAuthenticatedPage(async (page) => {
            await openRoute(page, `/teams/${encodeURIComponent(config.teamId)}/media`);
            const photoButton = page.getByRole('button', { name: 'Photo', exact: true });
            await expect(photoButton, 'The smoke team must have an existing writable media album').toBeVisible({ timeout: 25_000 });
            const photoInput = page.locator('input[type="file"][accept="image/*"]');
            await photoInput.setInputFiles({
                name: mediaName,
                mimeType: 'image/png',
                buffer: Buffer.from(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                    'base64'
                )
            });
            await expect(page.getByText('Uploaded', { exact: true })).toBeVisible({ timeout: 35_000 });
            const deleteMedia = page.getByRole('button', { name: `Delete ${mediaName}` });
            await expect(deleteMedia).toBeVisible({ timeout: 25_000 });
            page.once('dialog', (dialog) => dialog.accept());
            await deleteMedia.click();
            await expect(page.getByText('Media item deleted.')).toBeVisible({ timeout: 25_000 });
        });
    } finally {
        await runSmokeCleanup(runId, cleanupTasks);
    }
});

test('profile image paths accept authenticated storage and document writes', async () => {
    test.setTimeout(120_000);
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    );
    const ownProfilePath = `profile-photos/users/${staffRestSession.localId}/${smokePrefix}-profile.png`;
    const linkedPlayerPath = `profile-photos/teams/${config.teamId}/players/${config.playerId}/${smokePrefix}-player.png`;
    // Exercise the same photoUrl field authorization without temporarily exposing
    // the disposable object URL to consumers that persist profile snapshots.
    const safeDocumentPhotoUrl = `https://allplays.ai/img/logo_small.png?smoke=${attemptNonce}`;
    const targets = [
        {
            recordType: 'own-profile-image',
            restSession: staffRestSession,
            storagePath: ownProfilePath,
            documents: [{
                documentPath: `users/${staffRestSession.localId}`,
                expectedFields: {
                    photoPath: { stringValue: ownProfilePath },
                    photoUrl: { stringValue: safeDocumentPhotoUrl }
                }
            }]
        },
        {
            recordType: 'linked-player-image',
            restSession: parentRestSession,
            storagePath: linkedPlayerPath,
            documents: [
                {
                    documentPath: `teams/${config.teamId}/players/${config.playerId}/private/profile`,
                    allowMissing: true,
                    expectedFields: { photoPath: { stringValue: linkedPlayerPath } }
                },
                {
                    documentPath: `teams/${config.teamId}/players/${config.playerId}`,
                    expectedFields: { photoUrl: { stringValue: safeDocumentPhotoUrl } }
                }
            ]
        }
    ];
    const cleanupTasks = [];

    try {
        for (const target of targets) {
            await reconcileDedicatedImageFixture(target);
            const documentStates = [];
            for (const documentTarget of target.documents) {
                const originalDocument = await getFirestoreDocument(target.restSession, documentTarget.documentPath);
                if (!documentTarget.allowMissing) {
                    expect(originalDocument, `${target.recordType} fixture document must exist`).toBeTruthy();
                }
                documentStates.push({ ...documentTarget, originalDocument, restSession: target.restSession });
            }
            cleanupTasks.push({
                recordType: target.recordType,
                cleanup: async () => {
                    for (const documentState of [...documentStates].reverse()) {
                        await restoreImageFieldsIfUnchanged(documentState);
                    }
                    await deleteFirebaseStorageObject(target.restSession, target.storagePath);
                }
            });

            for (const documentState of documentStates) {
                if (documentState.originalDocument) {
                    await patchFirestoreDocumentFields(
                        target.restSession,
                        documentState.documentPath,
                        documentState.expectedFields,
                        { updateTime: documentState.originalDocument.updateTime }
                    );
                } else {
                    await createFirestoreDocument(
                        target.restSession,
                        documentState.documentPath,
                        documentState.expectedFields
                    );
                }
                const savedDocument = await getFirestoreDocument(target.restSession, documentState.documentPath);
                for (const [fieldName, fieldValue] of Object.entries(documentState.expectedFields)) {
                    expect(getFirestoreStringField(savedDocument, fieldName)).toBe(fieldValue.stringValue);
                }
            }
            const uploaded = await uploadFirebaseStorageObject(
                target.restSession,
                target.storagePath,
                png,
                'image/png'
            );
            expect(uploaded.name).toBe(target.storagePath);
        }
    } finally {
        await runSmokeCleanup(runId, cleanupTasks);
    }
});
