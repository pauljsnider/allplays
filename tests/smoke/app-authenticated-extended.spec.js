import { expect, test } from '@playwright/test';
import {
    buildAppSmokeUrl,
    collectAppRuntimeIssues,
    createAuthenticatedStorageState,
    getAppSmokeConfig,
    redactSmokeDiagnostic
} from './helpers/app-auth.js';
import {
    createFirebaseRestSession,
    deleteFirestoreDocument,
    deleteFirestoreDocumentsByStringField,
    deleteFirestoreDocumentsByStringFields,
    deleteSmokeMediaByTitle,
    findFirestoreDocumentsByStringField,
    getFirestoreDocument,
    getFirestoreDocumentPath,
    restoreFirestoreDocument,
    runSmokeCleanup
} from './helpers/firebase-rest.js';

const config = getAppSmokeConfig();
const extendedEnabled = process.env.SMOKE_EXTENDED_WRITES === '1';
const runId = String(config.runId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
const smokePrefix = `allplays-smoke-${runId}`;
const secretValues = [
    config.staffEmail,
    config.staffPassword,
    config.parentEmail,
    config.parentPassword
];

test.skip(!extendedEnabled, 'SMOKE_EXTENDED_WRITES=1 is required');
test.describe.configure({ mode: 'serial' });

let staffStorageState;
let parentStorageState;
let staffRestSession;
let parentRestSession;

test.beforeAll(async ({ browser }) => {
    for (const [name, value] of Object.entries({
        SMOKE_RUN_ID: runId,
        SMOKE_APP_BASE_URL: config.appBaseUrl,
        SMOKE_TEAM_ID: config.teamId,
        SMOKE_PLAYER_ID: config.playerId,
        SMOKE_GAME_ID: config.gameId,
        SMOKE_EVENT_ID: config.eventId,
        SMOKE_REGISTRATION_FORM_ID: config.registrationFormId,
        SMOKE_STAFF_EMAIL: config.staffEmail,
        SMOKE_STAFF_PASSWORD: config.staffPassword,
        SMOKE_PARENT_EMAIL: config.parentEmail,
        SMOKE_PARENT_PASSWORD: config.parentPassword
    })) {
        expect(value, `${name} is required for the reversible production suite`).toBeTruthy();
    }

    [staffStorageState, parentStorageState] = await Promise.all([
        createAuthenticatedStorageState(browser, {
            appBaseUrl: config.appBaseUrl,
            email: config.staffEmail,
            password: config.staffPassword,
            roleLabel: 'staff'
        }),
        createAuthenticatedStorageState(browser, {
            appBaseUrl: config.appBaseUrl,
            email: config.parentEmail,
            password: config.parentPassword,
            roleLabel: 'parent'
        })
    ]);
    [staffRestSession, parentRestSession] = await Promise.all([
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

async function withAuthenticatedPage(browser, storageState, callback) {
    const context = await browser.newContext({
        storageState,
        serviceWorkers: 'block'
    });
    const page = await context.newPage();
    const issues = collectAppRuntimeIssues(page, secretValues);
    try {
        await callback(page);
        expect(issues.map((issue) => redactSmokeDiagnostic(issue, secretValues))).toEqual([]);
    } finally {
        await context.close();
    }
}

async function openRoute(page, route) {
    await page.goto(buildAppSmokeUrl(config.appBaseUrl, route), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 25_000 });
    await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toContain(`#${route.split('?')[0]}`);
}

test('staff smoke writes are deterministic and removed after validation', async ({ browser }) => {
    test.setTimeout(300_000);
    const playerName = `${smokePrefix}-player`;
    const opponentName = `${smokePrefix}-opponent`;
    const chatText = `${smokePrefix}-chat`;
    const editedChatText = `${chatText}-edited`;
    const mediaName = `${smokePrefix}-media.png`;
    const cleanupTasks = [
        {
            recordType: 'roster-player',
            cleanup: () => deleteFirestoreDocumentsByStringField(
                staffRestSession,
                `teams/${config.teamId}/players`,
                'name',
                playerName
            )
        },
        {
            recordType: 'schedule-event',
            cleanup: () => deleteFirestoreDocumentsByStringField(
                staffRestSession,
                `teams/${config.teamId}/games`,
                'opponent',
                opponentName
            )
        },
        {
            recordType: 'team-media',
            cleanup: () => deleteSmokeMediaByTitle(
                staffRestSession,
                `teams/${config.teamId}/mediaItems`,
                mediaName
            )
        }
    ];

    try {
        await withAuthenticatedPage(browser, staffStorageState, async (page) => {
            await openRoute(page, `/teams/${encodeURIComponent(config.teamId)}?tab=roster`);
            await page.getByRole('button', { name: 'Add player' }).click();
            await page.getByPlaceholder('Player name').fill(playerName);
            await page.getByRole('button', { name: 'Save player' }).click();
            await expect(page.getByText(`${playerName} added to roster.`)).toBeVisible({ timeout: 20_000 });
            await expect(page.getByText(playerName, { exact: true })).toBeVisible();

            await openRoute(
                page,
                `/schedule?scope=staff&staffTools=1&staffSection=add&teamId=${encodeURIComponent(config.teamId)}`
            );
            const createGame = page.locator('section[aria-label="Create game"]');
            await expect(createGame).toBeVisible({ timeout: 25_000 });
            await createGame.getByLabel('Opponent').fill(opponentName);
            await createGame.getByRole('button', { name: 'Create game' }).click();
            await expect(page.getByText('Game created and schedule refreshed.')).toBeVisible({ timeout: 30_000 });
            await expect(page.getByText(opponentName, { exact: false }).first()).toBeVisible();
            const createdEvents = await findFirestoreDocumentsByStringField(
                staffRestSession,
                `teams/${config.teamId}/games`,
                'opponent',
                opponentName
            );
            expect(createdEvents).toHaveLength(1);
            const createdEventId = getFirestoreDocumentPath(createdEvents[0]).split('/').pop();
            expect(createdEventId).toBeTruthy();
            await openRoute(
                page,
                `/schedule/${encodeURIComponent(config.teamId)}/${encodeURIComponent(createdEventId)}?section=game`
            );
            await expect(page.locator('main')).toContainText(opponentName);

            await openRoute(page, `/messages/${encodeURIComponent(config.teamId)}`);
            const composer = page.locator('.chat-composer-textarea');
            await expect(composer).toBeVisible({ timeout: 25_000 });
            await composer.fill(chatText);
            await page.getByRole('button', { name: 'Send message' }).click();
            await expect(page.getByText(chatText, { exact: true })).toBeVisible({ timeout: 25_000 });

            const chatDocuments = await findFirestoreDocumentsByStringField(
                staffRestSession,
                `teams/${config.teamId}/chatMessages`,
                'text',
                chatText
            );
            expect(chatDocuments).toHaveLength(1);
            const chatDocumentPath = getFirestoreDocumentPath(chatDocuments[0]);
            cleanupTasks.push({
                recordType: 'chat-message',
                cleanup: () => deleteFirestoreDocument(staffRestSession, chatDocumentPath)
            });

            const messageRow = page.locator('.message-row-measure').filter({ hasText: chatText });
            await messageRow.getByRole('button', { name: /^Open actions for / }).click();
            await messageRow.getByRole('button', { name: 'Edit' }).click();
            const editDialog = page.getByRole('dialog', { name: 'Edit message' });
            await editDialog.locator('textarea').fill(editedChatText);
            await editDialog.getByRole('button', { name: 'Save' }).click();
            await expect(page.getByText(editedChatText, { exact: true })).toBeVisible({ timeout: 20_000 });
            const editedRow = page.locator('.message-row-measure').filter({ hasText: editedChatText });
            await editedRow.getByRole('button', { name: /^Open actions for / }).click();
            page.once('dialog', (dialog) => dialog.accept());
            await editedRow.getByRole('button', { name: 'Delete' }).click();
            await expect(editedRow.getByText('Message removed')).toBeVisible({ timeout: 20_000 });

            await openRoute(page, `/schedule/${encodeURIComponent(config.teamId)}/${encodeURIComponent(config.eventId)}?section=game`);
            const trackerLaunch = page.getByTestId('standard-tracker-launch');
            await expect(trackerLaunch, 'The smoke event must have a tracker configuration').toBeVisible({ timeout: 25_000 });
            await trackerLaunch.click();
            const trackerGrid = page.getByTestId('standard-tracker-grid');
            await expect(trackerGrid).toBeVisible({ timeout: 25_000 });
            const statButton = trackerGrid.locator('button[aria-label$="add one"]').first();
            await expect(statButton).toBeVisible();
            await statButton.click();
            await expect(page.getByText(/\+1 recorded\./).first()).toBeVisible({ timeout: 20_000 });
            await page.getByRole('button', { name: 'Undo last' }).click();
            await expect(page.getByText(/^Undid /).first()).toBeVisible({ timeout: 20_000 });

            await openRoute(page, `/teams/${encodeURIComponent(config.teamId)}/media`);
            const photoButton = page.getByRole('button', { name: 'Photo' });
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

test('parent smoke writes restore or remove every touched record', async ({ browser }) => {
    test.setTimeout(240_000);
    const rideNote = `${smokePrefix}-ride`;
    const shareLabel = `${smokePrefix}-share`;
    const rsvpDocumentPath = `teams/${config.teamId}/games/${config.eventId}/rsvps/${parentRestSession.localId}__${config.playerId}`;
    const rsvpNoteDocumentPath = `teams/${config.teamId}/games/${config.eventId}/rsvpNotes/${parentRestSession.localId}__${config.playerId}`;
    const [originalRsvpDocument, originalRsvpNoteDocument] = await Promise.all([
        getFirestoreDocument(parentRestSession, rsvpDocumentPath),
        getFirestoreDocument(parentRestSession, rsvpNoteDocumentPath)
    ]);
    const cleanupTasks = [
        {
            recordType: 'rsvp-response',
            cleanup: async () => {
                await restoreFirestoreDocument(parentRestSession, rsvpDocumentPath, originalRsvpDocument);
                await restoreFirestoreDocument(parentRestSession, rsvpNoteDocumentPath, originalRsvpNoteDocument);
            }
        },
        {
            recordType: 'ride-offer',
            cleanup: () => deleteFirestoreDocumentsByStringField(
                parentRestSession,
                `teams/${config.teamId}/games/${config.eventId}/rideOffers`,
                'note',
                rideNote
            )
        },
        {
            recordType: 'family-share',
            cleanup: () => deleteFirestoreDocumentsByStringFields(
                parentRestSession,
                'familyShareTokens',
                {
                    ownerUid: parentRestSession.localId,
                    label: shareLabel
                }
            )
        }
    ];

    try {
        await withAuthenticatedPage(browser, parentStorageState, async (page) => {
            await openRoute(
                page,
                `/schedule/${encodeURIComponent(config.teamId)}/${encodeURIComponent(config.eventId)}?childId=${encodeURIComponent(config.playerId)}&section=availability`
            );
            const availability = page.locator('section').filter({
                has: page.getByRole('heading', { name: 'Availability' })
            });
            const responseButtons = [
                availability.getByRole('button', { name: 'Going', exact: true }).first(),
                availability.getByRole('button', { name: 'Maybe', exact: true }).first(),
                availability.getByRole('button', { name: /Can't Go/i, exact: true }).first()
            ];
            const pressed = await Promise.all(responseButtons.map((button) => button.getAttribute('aria-pressed')));
            const originalIndex = pressed.findIndex((value) => value === 'true');
            expect(originalIndex, 'The smoke player/event must have a seeded RSVP so it can be restored').toBeGreaterThanOrEqual(0);
            const changedIndex = (originalIndex + 1) % responseButtons.length;
            await responseButtons[changedIndex].click();
            await expect(responseButtons[changedIndex]).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
            await responseButtons[originalIndex].click();
            await expect(responseButtons[originalIndex]).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });

            await page.getByRole('button', { name: 'Rideshare', exact: true }).click();
            const rideshare = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Rideshare' }) });
            await rideshare.getByRole('button', { name: 'Offer Ride' }).click();
            await rideshare.getByLabel('Seats').fill('2');
            await rideshare.getByLabel('Direction').selectOption('round-trip');
            await rideshare.getByLabel('Note').fill(rideNote);
            await rideshare.getByRole('button', { name: 'Save' }).click();
            await expect(rideshare.getByText('Ride offer saved.')).toBeVisible({ timeout: 20_000 });
            await expect(rideshare.getByText(rideNote, { exact: true })).toBeVisible();

            await openRoute(page, '/parent-tools/share');
            await page.getByPlaceholder('Label, like Grandma or babysitter').fill(shareLabel);
            await page.getByRole('button', { name: 'Create share link' }).click();
            await expect(page.getByText('Copied.')).toBeVisible({ timeout: 25_000 });
            const tokenCard = page.locator('section.app-card').filter({ hasText: shareLabel }).last();
            await expect(tokenCard).toBeVisible();
            await tokenCard.getByRole('button', { name: 'Revoke' }).click();
            await page.getByRole('button', { name: 'Revoke link' }).click();
            await expect(page.getByText('Family link revoked.')).toBeVisible({ timeout: 25_000 });
        });
    } finally {
        await runSmokeCleanup(runId, cleanupTasks);
    }
});

test('read-only fixtures cover registrations, fees, opportunities, and notification deep links', async ({ browser }) => {
    await withAuthenticatedPage(browser, parentStorageState, async (page) => {
        await openRoute(page, '/parent-tools/registrations');
        await expect(page.getByText('Registrations', { exact: true })).toBeVisible();
        await expect(page.locator(`a[href*="${config.registrationFormId}"]`).first()).toBeVisible({ timeout: 20_000 });

        await openRoute(page, '/parent-tools/fees');
        await expect(page.getByText('Team fees', { exact: true })).toBeVisible();
        await expect(page.locator('main')).toContainText(/Balance|Paid|Due/);

        if (config.opportunityListingId) {
            await openRoute(page, `/discover/opportunities/${encodeURIComponent(config.opportunityListingId)}`);
            await expect(page.locator('main')).not.toContainText(/not found|unavailable/i);
        }
        if (config.opportunityInquiryId) {
            await openRoute(page, `/messages?inquiry=${encodeURIComponent(config.opportunityInquiryId)}`);
            const conversation = page.getByLabel(/Opportunity conversation:/);
            await expect(conversation).toBeVisible({ timeout: 20_000 });
            await expect(conversation.locator('.whitespace-pre-wrap').first()).toBeVisible();
            await expect(page.getByPlaceholder('Write a private reply')).toBeVisible();
        }

        await page.getByRole('button', { name: 'Notifications' }).first().click();
        const inbox = page.getByRole('dialog', { name: 'Notifications' });
        await expect(inbox).toBeVisible();
        const messageDeepLink = inbox.locator('li').filter({ hasText: smokePrefix }).first();
        await expect(
            messageDeepLink,
            'The new smoke chat message must create a notification for the parent account'
        ).toBeVisible({ timeout: 25_000 });
        await messageDeepLink.getByRole('button').click();
        await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toMatch(/^#\/messages(?:\/|\?)/);

        if (config.opportunityInquiryId) {
            await page.getByRole('button', { name: 'Notifications' }).first().click();
            const opportunityDeepLink = page
                .getByRole('dialog', { name: 'Notifications' })
                .locator('li')
                .filter({ hasText: /Opportunity inquiry reply/i })
                .first();
            await expect(
                opportunityDeepLink,
                'The pre-seeded inquiry must have a reversible reply notification fixture'
            ).toBeVisible({ timeout: 25_000 });
            await opportunityDeepLink.getByRole('button').click();
            await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toContain(
                `#/messages?inquiry=${encodeURIComponent(config.opportunityInquiryId)}`
            );
        }
    });
});
