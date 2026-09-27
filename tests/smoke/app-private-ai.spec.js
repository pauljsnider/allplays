import { expect, test } from '@playwright/test';

test.skip(
    process.env.SMOKE_SUITE === 'production',
    'Module-mocked app specs need the Vite dev server; production runs cover the deployed bundle via app-production-bootstrap.spec.js'
);

function appUrl(baseURL, hashPath) {
    const appBaseURL = process.env.SMOKE_APP_BASE_URL || baseURL;
    const url = new URL('/', appBaseURL);
    url.hash = hashPath;
    return url.toString();
}

function captureUnexpectedPageErrors(page) {
    const pageErrors = [];
    page.on('pageerror', (error) => {
        if (/Installations:.*API key not valid/i.test(error.message)) return;
        pageErrors.push(error.message);
    });
    return pageErrors;
}

async function openPrivateAi(page) {
    const trigger = page.getByTitle('Private AI').first();

    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 1000 });
        await expect(trigger).toBeVisible({ timeout: 1000 });
        await trigger.click();
        await expect(page).toHaveURL(/#\/ai$/, { timeout: 1000 });
    }).toPass({ timeout: 30000 });
}

async function mockPrivateAiModules(page, { firstRun = false, roles = ['parent'] } = {}) {
    await page.addInitScript(() => {
        window.__privateAiCalls = [];
    });

    await page.route(/\/src\/lib\/useAuth\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function useAuth() {
                    const roles = ${JSON.stringify(roles)};
                    const user = {
                        uid: 'user-1',
                        email: 'parent@example.com',
                        displayName: 'Pat Parent',
                        roles,
                        coachOf: roles.includes('coach') ? ['team-1'] : [],
                        parentPlayerKeys: roles.includes('parent') ? ['team-1:player-1'] : []
                    };
                    return {
                        user,
                        profile: { fullName: 'Pat Parent' },
                        loading: false,
                        error: null,
                        roles: user.roles,
                        isParent: roles.includes('parent'),
                        isCoach: roles.includes('coach'),
                        isAdmin: roles.includes('admin'),
                        isPlatformAdmin: roles.includes('platformAdmin'),
                        refresh: async () => {},
                        signOut: async () => {}
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/homeService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function loadParentHomeSummary(...args) {
                    return loadParentHome(...args);
                }

                export async function loadParentHomeSummaryBootstrap(...args) {
                    const home = await loadParentHome(...args);
                    return { home, schedule: [] };
                }

                export async function loadParentScheduleSummary() {
                    return [];
                }

                export async function loadParentHomeWithSecondaryData(...args) {
                    return loadParentHome(...args);
                }

                export async function loadParentHome() {
                    return {
                        players: [],
                        teams: [],
                        upcomingEvents: [],
                        actionItems: [],
                        fees: [],
                        metrics: {
                            players: 0,
                            teams: 0,
                            rsvpNeeded: 0,
                            unreadMessages: 0,
                            packetsReady: 0
                        }
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/privateAiService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export const DEFAULT_PRIVATE_AI_CONVERSATION_ID = 'default';
                export const DRAFT_PRIVATE_AI_CONVERSATION_ID = '__draft__';

                export async function loadPrivateAiRoleCapabilities() {
                    const roles = ${JSON.stringify(roles)};
                    const isTeamManager = roles.some((role) =>
                        ['coach', 'admin', 'platformAdmin'].includes(role)
                    );
                    return {
                        isTeamManager,
                        managedTeamCount: isTeamManager ? 1 : 0
                    };
                }
 
                let conversations = ${firstRun ? '[]' : `[
                    {
                        id: 'default',
                        title: 'Recent chat',
                        createdAt: new Date('2026-05-21T12:00:00Z'),
                        updatedAt: new Date('2026-05-21T12:00:00Z'),
                        lastMessagePreview: 'I can look up your ALL PLAYS schedule and messages.'
                    }
                ]`};

                let messages = ${firstRun ? '[]' : `[
                    {
                        id: 'msg-1',
                        role: 'assistant',
                        text: 'I can look up your ALL PLAYS schedule and messages.',
                        conversationId: 'default',
                        createdAt: new Date('2026-05-21T12:00:00Z'),
                        toolNames: []
                    }
                ]`};
                let nextMessageNumber = 2;
                let pendingWrite = '';
                let awaitingGameDetails = false;

                export async function loadPrivateAiConversations() {
                    return conversations;
                }

                export async function createPrivateAiConversation() {
                    const conversation = {
                        id: 'conversation-2',
                        title: 'New chat',
                        createdAt: new Date('2026-05-21T12:02:00Z'),
                        updatedAt: new Date('2026-05-21T12:02:00Z'),
                        lastMessagePreview: ''
                    };
                    conversations = [conversation, ...conversations];
                    return conversation;
                }

                export async function loadPrivateAiMessages(user, limit, conversationId = 'default') {
                    return messages.filter((message) => (message.conversationId || 'default') === conversationId);
                }

                export async function revisePrivateAiRosterImportProposal(user, revision) {
                    return revision.rows.reduce((summary, row) => {
                        summary.total += 1;
                        summary[row.action] += 1;
                        summary.invitations += row.inviteCount || 0;
                        summary.errors += (row.errors || []).length;
                        return summary;
                    }, { total: 0, add: 0, update: 0, deactivate: 0, reactivate: 0, invitations: 0, errors: 0 });
                }

                export async function revisePrivateAiScheduleImportProposal(user, revision) {
                    return {
                        rows: revision.rows,
                        summary: revision.rows.reduce((summary, row) => {
                            summary.total += 1;
                            summary[row.normalized.eventType === 'practice' ? 'practices' : 'games'] += 1;
                            summary.errors += (row.errors || []).length;
                            return summary;
                        }, { total: 0, games: 0, practices: 0, errors: 0 })
                    };
                }

                export function getPrivateAiAttachmentValidationError() {
                    return '';
                }

                export async function sendPrivateAiAttachmentMessage(user, input, conversationId = 'default') {
                    window.__privateAiCalls.push({
                        uid: user.uid,
                        text: input.text,
                        conversationId,
                        fileName: input.file.name
                    });
                    const userMessage = {
                        id: 'attachment-user',
                        role: 'user',
                        text: input.text + ' (' + input.file.name + ')',
                        conversationId,
                        createdAt: new Date('2026-05-21T12:01:00Z')
                    };
                    const assistantMessage = {
                        id: 'attachment-assistant',
                        role: 'assistant',
                        text: 'I analyzed the attached file.',
                        conversationId,
                        createdAt: new Date('2026-05-21T12:01:02Z'),
                        toolNames: [],
                        artifacts: [{
                            type: 'document-analysis',
                            confirmationId: '',
                            teamId: '',
                            teamName: '',
                            source: 'pdf',
                            fileName: input.file.name,
                            mimeType: input.file.type,
                            summary: { total: 1, errors: 0 }
                        }]
                    };
                    messages = [...messages, userMessage, assistantMessage];
                    return { userMessage, assistantMessage, toolResults: [] };
                }

                export async function sendPrivateAiMessage(user, text, conversationId = 'default') {
                    window.__privateAiCalls.push({ uid: user.uid, text, conversationId });
                    const savedConversationId = conversationId === 'default' && !conversations.some((conversation) => conversation.id === conversationId)
                        ? 'conversation-2'
                        : conversationId;
                    const normalizedText = text.trim().toLowerCase();
                    let assistantText = '**Bears** play Monday at 6:00 PM.';
                    let toolNames = ['get_schedule'];
                    let pendingActionIds = [];
                    let toolResults = [{ name: 'get_schedule', ok: true }];

                    if (/^(yes|confirm|confirm it)[.!]?$/.test(normalizedText) && pendingWrite === 'team') {
                        assistantText = 'Confirmed. Team paul score test created with the Soccer stat template.';
                        toolNames = ['create_team'];
                        toolResults = [{ name: 'create_team', ok: true }];
                        pendingWrite = '';
                    } else if (/^(yes|confirm|confirm it)[.!]?$/.test(normalizedText) && pendingWrite === 'game') {
                        assistantText = 'Confirmed. Game for Test Team against Vipers was created for Saturday, August 15, 2026 at 3:00 PM CDT.';
                        toolNames = ['create_schedule_event'];
                        toolResults = [{ name: 'create_schedule_event', ok: true }];
                        pendingWrite = '';
                    } else if (normalizedText.includes('create a new team called paul score test')) {
                        assistantText = 'Team paul score test is ready for review with the Soccer stat template. Reply yes to create it.';
                        toolNames = ['create_team'];
                        pendingActionIds = ['ai_team1234'];
                        toolResults = [{
                            name: 'create_team',
                            ok: true,
                            requiresConfirmation: true,
                            confirmationId: 'ai_team1234'
                        }];
                        pendingWrite = 'team';
                    } else if (normalizedText.includes('create a new game for test team for saturday 3pm')) {
                        assistantText = 'What time zone, opponent, and location should I use for Saturday at 3:00 PM?';
                        toolNames = [];
                        toolResults = [];
                        awaitingGameDetails = true;
                    } else if (awaitingGameDetails && normalizedText.includes('america/chicago')) {
                        assistantText = 'Game for Test Team against Vipers at South Field on Saturday, August 15, 2026 at 3:00 PM CDT is ready for review. Reply yes to create it.';
                        toolNames = ['create_schedule_event'];
                        pendingActionIds = ['ai_game1234'];
                        toolResults = [{
                            name: 'create_schedule_event',
                            ok: true,
                            requiresConfirmation: true,
                            confirmationId: 'ai_game1234'
                        }];
                        awaitingGameDetails = false;
                        pendingWrite = 'game';
                    }

                    const userMessage = {
                        id: 'msg-' + nextMessageNumber++,
                        role: 'user',
                        text,
                        conversationId: savedConversationId,
                        createdAt: new Date('2026-05-21T12:01:00Z')
                    };
                    const assistantMessage = {
                        id: 'msg-' + nextMessageNumber++,
                        role: 'assistant',
                        text: assistantText,
                        conversationId: savedConversationId,
                        createdAt: new Date('2026-05-21T12:01:02Z'),
                        toolNames,
                        pendingActionIds
                    };
                    messages = [...messages, userMessage, assistantMessage];
                    const savedConversation = {
                        id: savedConversationId,
                        title: text,
                        createdAt: new Date('2026-05-21T12:01:00Z'),
                        updatedAt: new Date('2026-05-21T12:01:02Z'),
                        lastMessagePreview: assistantMessage.text
                    };
                    conversations = conversations.some((conversation) => conversation.id === savedConversationId)
                        ? conversations.map((conversation) => conversation.id === savedConversationId ? { ...conversation, ...savedConversation } : conversation)
                        : [savedConversation, ...conversations];
                    return {
                        userMessage,
                        assistantMessage,
                        toolResults
                    };
                }
            `
        });
    });
}

test.describe('private AI chat', () => {
    test('stages and confirms a new team from the reported mobile request', async ({ page, baseURL }) => {
        const pageErrors = captureUnexpectedPageErrors(page);
        await mockPrivateAiModules(page, { roles: ['coach'] });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(appUrl(baseURL, '/ai'), { waitUntil: 'networkidle' });

        expect(pageErrors).toEqual([]);
        await page.getByPlaceholder('Ask ALL PLAYS...').fill('Create a new team called paul score test with soccer template');
        await page.getByRole('button', { name: 'Send AI message' }).click();
        await expect.poll(() => page.evaluate(() => window.__privateAiCalls.length)).toBe(1);
        expect(pageErrors).toEqual([]);
        await expect(page.getByText('Team paul score test is ready for review with the Soccer stat template. Reply yes to create it.')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__privateAiCalls)).toEqual([
            {
                uid: 'user-1',
                text: 'Create a new team called paul score test with soccer template',
                conversationId: 'default'
            }
        ]);

        await page.getByPlaceholder('Ask ALL PLAYS...').fill('yes');
        await page.getByRole('button', { name: 'Send AI message' }).click();
        await expect.poll(() => page.evaluate(() => window.__privateAiCalls.length)).toBe(2);
        expect(pageErrors).toEqual([]);
        await expect(page.getByText('Confirmed. Team paul score test created with the Soccer stat template.')).toBeVisible();
    });

    test('clarifies then stages and confirms the reported relative-date game request', async ({ page, baseURL }) => {
        const pageErrors = captureUnexpectedPageErrors(page);
        await mockPrivateAiModules(page, { roles: ['coach'] });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(appUrl(baseURL, '/ai'), { waitUntil: 'networkidle' });

        expect(pageErrors).toEqual([]);
        await page.getByPlaceholder('Ask ALL PLAYS...').fill('Create a new game for test team for Saturday 3pm.');
        await page.getByRole('button', { name: 'Send AI message' }).click();
        await expect.poll(() => page.evaluate(() => window.__privateAiCalls.length)).toBe(1);
        expect(pageErrors).toEqual([]);
        await expect(page.getByText('What time zone, opponent, and location should I use for Saturday at 3:00 PM?')).toBeVisible();

        await page.getByPlaceholder('Ask ALL PLAYS...').fill('America/Chicago, against Vipers at South Field.');
        await page.getByRole('button', { name: 'Send AI message' }).click();
        await expect.poll(() => page.evaluate(() => window.__privateAiCalls.length)).toBe(2);
        expect(pageErrors).toEqual([]);
        await expect(page.getByText('Game for Test Team against Vipers at South Field on Saturday, August 15, 2026 at 3:00 PM CDT is ready for review. Reply yes to create it.')).toBeVisible();

        await page.getByPlaceholder('Ask ALL PLAYS...').fill('yes');
        await page.getByRole('button', { name: 'Send AI message' }).click();
        await expect.poll(() => page.evaluate(() => window.__privateAiCalls.length)).toBe(3);
        expect(pageErrors).toEqual([]);
        await expect(page.getByText('Confirmed. Game for Test Team against Vipers was created for Saturday, August 15, 2026 at 3:00 PM CDT.')).toBeVisible();
    });

    test('desktop first run defers history controls until the first saved conversation', async ({ page, baseURL }) => {
        await mockPrivateAiModules(page, { firstRun: true });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await page.getByTitle('Private AI').first().click();
        await expect(page).toHaveURL(/#\/ai$/);
        await expect(page.getByText('What do you need from ALL PLAYS?')).toBeVisible();
        await expect(page.locator('.private-ai-first-run')).toBeVisible();
        await expect(page.locator('.private-ai-rail')).toHaveCount(0);
        await expect(page.getByLabel('AI conversations')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveCount(0);
        await expect(page.getByText('No saved chats', { exact: true })).toHaveCount(0);

        await page.getByPlaceholder('Ask ALL PLAYS...').fill('What is next?');
        await page.getByRole('button', { name: 'Send AI message' }).click();

        await expect(page.getByText('Bears play Monday at 6:00 PM.')).toBeVisible();
        await expect(page.locator('.private-ai-rail')).toBeVisible();
        const conversationList = page.getByLabel('AI conversations');
        await expect(conversationList).toBeVisible();
        await expect(conversationList.getByRole('button', { name: /What is next\?/ })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText('Bears play Monday at 6:00 PM.')).toBeVisible();
    });

    test('desktop top nav opens private AI and sends a message', async ({ page, baseURL }) => {
        await mockPrivateAiModules(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await page.getByTitle('Private AI').first().click();
        await expect(page).toHaveURL(/#\/ai$/);
        await expect(page.getByRole('heading', { name: 'Ask ALL PLAYS' })).toBeVisible();
        await expect(page.getByText('Saved chats', { exact: true })).toBeVisible();
        await expect(page.locator('.private-ai-card')).toContainText(/I can look up your ALL PLAYS schedule and messages\.|Ask about your teams, schedule, messages, fees, player development, coaching ideas, registrations, and profile\./);
        await expect.poll(() => page.locator('.private-ai-rail').evaluate((element) => window.getComputedStyle(element).overflowY)).toBe('auto');
        await expect.poll(() => page.locator('.private-ai-composer').evaluate((element) => window.getComputedStyle(element).paddingBottom)).toBe('6px');

        await page.getByPlaceholder('Ask ALL PLAYS...').fill('What is next?');
        await page.getByRole('button', { name: 'Send AI message' }).click();

        await expect(page.getByText('Bears play Monday at 6:00 PM.')).toBeVisible();
        await expect(page.getByText('Looked up get_schedule')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__privateAiCalls)).toEqual([
            { uid: 'user-1', text: 'What is next?', conversationId: 'default' }
        ]);
    });

    test('chat accepts a PDF and shows a private analysis artifact', async ({ page, baseURL }) => {
        await mockPrivateAiModules(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await openPrivateAi(page);
        await page.getByLabel('Attach image, CSV, or PDF').setInputFiles({
            name: 'team-handbook.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('sample PDF')
        });

        await expect(page.getByText('team-handbook.pdf')).toBeVisible();
        await expect(page.getByText('PDF · AI decides roster, schedule, or analysis')).toBeVisible();
        await page.getByPlaceholder('What should AI do with this file?').fill('Summarize the action items.');
        await page.getByRole('button', { name: 'Send AI message' }).click();

        await expect(page.getByText('Attachment analyzed')).toBeVisible();
        await expect(page.getByText('No app data was changed.')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__privateAiCalls)).toEqual([
            {
                uid: 'user-1',
                text: 'Summarize the action items.',
                conversationId: 'default',
                fileName: 'team-handbook.pdf'
            }
        ]);
    });

    test('mobile AI chat uses the chat layout without horizontal overflow', async ({ page, baseURL }) => {
        await mockPrivateAiModules(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await openPrivateAi(page);
        await expect(page.getByRole('heading', { name: 'Ask ALL PLAYS' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Home' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Go to home' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'New AI chat' })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

        const topbarBox = await page.locator('.chat-topbar').boundingBox();
        expect(topbarBox.y).toBeGreaterThanOrEqual(8);

        const textarea = page.getByPlaceholder('Ask ALL PLAYS...');
        await expect(textarea).toBeVisible();
        await expect.poll(() => textarea.evaluate((element) => window.getComputedStyle(element).fontSize)).toBe('16px');
        await expect.poll(() => textarea.evaluate((element) => window.getComputedStyle(element).paddingLeft)).toBe('12px');

        const voiceButton = page.getByRole('button', { name: 'Voice to text' });
        await expect(voiceButton).toBeVisible();
        const textareaBox = await textarea.boundingBox();
        const voiceBox = await voiceButton.boundingBox();
        expect(voiceBox.y).toBeGreaterThan(textareaBox.y + textareaBox.height - 2);
    });

    test('mobile conversation strip shows the active draft after tapping new chat', async ({ page, baseURL }) => {
        await mockPrivateAiModules(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await openPrivateAi(page);
        await page.getByRole('button', { name: 'New AI chat' }).click();

        const draftChip = page.locator('.private-ai-conversation-chip').filter({ hasText: 'New chat' });
        await expect(draftChip).toBeVisible();
        await expect(draftChip).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.private-ai-conversation-strip')).toContainText('Recent chat');
    });

    test('desktop Schedule shows family and team-management submenus for combined roles', async ({ page, baseURL }) => {
        await mockPrivateAiModules(page, { roles: ['parent', 'coach'] });
        await page.goto(appUrl(baseURL, '/schedule?scope=staff'), { waitUntil: 'domcontentloaded' });

        const submenu = page.getByTestId('schedule-role-submenu');
        await expect(submenu).toBeVisible();
        await expect(submenu.getByText('Family schedule', { exact: true })).toBeVisible();
        await expect(submenu.getByText('Team management', { exact: true })).toBeVisible();
        await expect(submenu.getByRole('link', { name: 'RSVP needed' })).toBeVisible();
        await expect(submenu.getByRole('link', { name: 'Add event' })).toBeVisible();
        await expect(submenu.getByRole('link', { name: 'Manage with AI' })).toBeVisible();
    });
});
