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

async function openPrivateAi(page) {
    const trigger = page.getByTitle('Private AI').first();

    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 1000 });
        await expect(trigger).toBeVisible({ timeout: 1000 });
        await trigger.click();
        await expect(page).toHaveURL(/#\/ai$/, { timeout: 1000 });
    }).toPass({ timeout: 30000 });
}

async function mockPrivateAiModules(page, { firstRun = false } = {}) {
    await page.addInitScript(() => {
        window.__privateAiCalls = [];
    });

    await page.route(/\/src\/lib\/useAuth\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function useAuth() {
                    const user = {
                        uid: 'user-1',
                        email: 'parent@example.com',
                        displayName: 'Pat Parent',
                        roles: ['parent']
                    };
                    return {
                        user,
                        profile: { fullName: 'Pat Parent' },
                        loading: false,
                        error: null,
                        roles: user.roles,
                        isParent: true,
                        isCoach: false,
                        isAdmin: false,
                        isPlatformAdmin: false,
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

                export async function sendPrivateAiMessage(user, text, conversationId = 'default') {
                    window.__privateAiCalls.push({ uid: user.uid, text, conversationId });
                    const savedConversationId = conversationId === 'default' && !conversations.some((conversation) => conversation.id === conversationId)
                        ? 'conversation-2'
                        : conversationId;
                    const userMessage = {
                        id: 'msg-2',
                        role: 'user',
                        text,
                        conversationId: savedConversationId,
                        createdAt: new Date('2026-05-21T12:01:00Z')
                    };
                    const assistantMessage = {
                        id: 'msg-3',
                        role: 'assistant',
                        text: '**Bears** play Monday at 6:00 PM.',
                        conversationId: savedConversationId,
                        createdAt: new Date('2026-05-21T12:01:02Z'),
                        toolNames: ['get_schedule']
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
                        toolResults: [{ name: 'get_schedule', ok: true }]
                    };
                }
            `
        });
    });
}

test.describe('private AI chat', () => {
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
});
