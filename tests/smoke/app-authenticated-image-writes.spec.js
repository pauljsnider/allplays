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
const secretValues = [config.staffEmail, config.staffPassword];

test.skip(!extendedEnabled, 'SMOKE_EXTENDED_WRITES=1 is required');

let staffSession;
let staffRestSession;

test.beforeAll(async ({ browser }) => {
    test.setTimeout(AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS);
    for (const [name, value] of Object.entries({
        SMOKE_RUN_ID: runId,
        SMOKE_APP_BASE_URL: config.appBaseUrl,
        SMOKE_TEAM_ID: config.teamId,
        SMOKE_PLAYER_ID: config.playerId,
        SMOKE_STAFF_EMAIL: config.staffEmail,
        SMOKE_STAFF_PASSWORD: config.staffPassword
    })) {
        expect(value, `${name} is required for the reversible image suite`).toBeTruthy();
    }

    [staffSession, staffRestSession] = await Promise.all([
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
    const currentDocument = await getFirestoreDocument(staffRestSession, documentState.documentPath);
    if (!currentDocument) return;
    const expectedEntries = Object.entries(documentState.expectedFields)
        .filter(([fieldName]) => fieldNames.includes(fieldName));
    if (!expectedEntries.length) return;
    const stillOwnsTestValues = expectedEntries.every(
        ([fieldName, fieldValue]) => getFirestoreStringField(currentDocument, fieldName) === fieldValue.stringValue
    );
    if (!stillOwnsTestValues) return;

    await restoreFirestoreDocumentFields(
        staffRestSession,
        documentState.documentPath,
        documentState.originalDocument,
        expectedEntries.map(([fieldName]) => fieldName),
        { updateTime: currentDocument.updateTime }
    );
    const restoredDocument = await getFirestoreDocument(staffRestSession, documentState.documentPath);
    for (const [fieldName] of expectedEntries) {
        expect(restoredDocument?.fields?.[fieldName]).toEqual(
            documentState.originalDocument?.fields?.[fieldName]
        );
    }
}

function isAbandonedSmokeImageValue(value) {
    return String(value || '').includes('allplays-smoke-')
        || String(value || '').startsWith('https://allplays.ai/img/logo_small.png?smoke=');
}

async function clearAbandonedField(documentPath, fieldName, expectedValue) {
    const currentDocument = await getFirestoreDocument(staffRestSession, documentPath);
    if (getFirestoreStringField(currentDocument, fieldName) !== expectedValue) return false;
    await restoreFirestoreDocumentFields(
        staffRestSession,
        documentPath,
        { fields: {} },
        [fieldName],
        { updateTime: currentDocument.updateTime }
    );
    return true;
}

async function reconcileDedicatedImageFixture(target) {
    const abandonedPaths = [];

    for (const documentTarget of target.documents) {
        const document = await getFirestoreDocument(staffRestSession, documentTarget.documentPath);
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
        const document = await getFirestoreDocument(staffRestSession, documentTarget.documentPath);
        const abandonedUrl = getFirestoreStringField(document, 'photoUrl');
        if (isAbandonedSmokeImageValue(abandonedUrl)) {
            await clearAbandonedField(documentTarget.documentPath, 'photoUrl', abandonedUrl);
        }
    }
    for (const abandonedPath of [...new Set(abandonedPaths)]) {
        await deleteFirebaseStorageObject(staffRestSession, abandonedPath);
    }
    for (const documentTarget of target.documents) {
        if (!Object.hasOwn(documentTarget.expectedFields, 'photoPath')) continue;
        const document = await getFirestoreDocument(staffRestSession, documentTarget.documentPath);
        const abandonedPath = getFirestoreStringField(document, 'photoPath');
        if (isAbandonedSmokeImageValue(abandonedPath)) {
            await clearAbandonedField(documentTarget.documentPath, 'photoPath', abandonedPath);
        }
    }

    for (const documentTarget of target.documents) {
        const document = await getFirestoreDocument(staffRestSession, documentTarget.documentPath);
        for (const fieldName of Object.keys(documentTarget.expectedFields)) {
            expect(getFirestoreStringField(document, fieldName)).toBe('');
        }
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
            storagePath: linkedPlayerPath,
            documents: [
                {
                    documentPath: `teams/${config.teamId}/players/${config.playerId}/private/profile`,
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
                const originalDocument = await getFirestoreDocument(staffRestSession, documentTarget.documentPath);
                expect(originalDocument, `${target.recordType} fixture document must exist`).toBeTruthy();
                documentStates.push({ ...documentTarget, originalDocument });
            }
            cleanupTasks.push({
                recordType: target.recordType,
                cleanup: async () => {
                    for (const documentState of [...documentStates].reverse()) {
                        await restoreImageFieldsIfUnchanged(documentState, ['photoUrl']);
                    }
                    await deleteFirebaseStorageObject(staffRestSession, target.storagePath);
                    for (const documentState of [...documentStates].reverse()) {
                        await restoreImageFieldsIfUnchanged(documentState, ['photoPath']);
                    }
                }
            });

            for (const documentState of documentStates) {
                await patchFirestoreDocumentFields(
                    staffRestSession,
                    documentState.documentPath,
                    documentState.expectedFields,
                    { updateTime: documentState.originalDocument.updateTime }
                );
                const savedDocument = await getFirestoreDocument(staffRestSession, documentState.documentPath);
                for (const [fieldName, fieldValue] of Object.entries(documentState.expectedFields)) {
                    expect(getFirestoreStringField(savedDocument, fieldName)).toBe(fieldValue.stringValue);
                }
            }
            const uploaded = await uploadFirebaseStorageObject(
                staffRestSession,
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
