import { expect, test } from '@playwright/test';

function appUrl(baseURL, hashPath) {
    const url = new URL('/', baseURL);
    url.hash = hashPath;
    return url.toString();
}

async function mockPrivateAiModules(page) {
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
                let messages = [
                    {
                        id: 'msg-1',
                        role: 'assistant',
                        text: 'I can look up your ALL PLAYS schedule and messages.',
                        createdAt: new Date('2026-05-21T12:00:00Z'),
                        toolNames: []
                    }
                ];

                export async function loadPrivateAiMessages() {
                    return messages;
                }

                export async function sendPrivateAiMessage(user, text) {
                    window.__privateAiCalls.push({ uid: user.uid, text });
                    const userMessage = {
                        id: 'msg-2',
                        role: 'user',
                        text,
                        createdAt: new Date('2026-05-21T12:01:00Z')
                    };
                    const assistantMessage = {
                        id: 'msg-3',
                        role: 'assistant',
                        text: '**Bears** play Monday at 6:00 PM.',
                        createdAt: new Date('2026-05-21T12:01:02Z'),
                        toolNames: ['get_schedule']
                    };
                    messages = [...messages, userMessage, assistantMessage];
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
    test('desktop top nav opens private AI and sends a message', async ({ page, baseURL }) => {
        await mockPrivateAiModules(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await page.getByRole('button', { name: 'AI' }).click();
        await expect(page).toHaveURL(/#\/ai$/);
        await expect(page.getByRole('heading', { name: 'Ask ALL PLAYS' })).toBeVisible();
        await expect(page.getByText('I can look up your ALL PLAYS schedule and messages.')).toBeVisible();

        await page.getByPlaceholder('Ask about schedules, teams, players, messages...').fill('What is next?');
        await page.getByRole('button', { name: 'Send AI message' }).click();

        await expect(page.getByText('Bears play Monday at 6:00 PM.')).toBeVisible();
        await expect(page.getByText('Looked up get_schedule')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__privateAiCalls)).toEqual([
            { uid: 'user-1', text: 'What is next?' }
        ]);
    });

    test('mobile AI chat uses the chat layout without horizontal overflow', async ({ page, baseURL }) => {
        await mockPrivateAiModules(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await page.getByRole('button', { name: 'Private AI' }).click();
        await expect(page).toHaveURL(/#\/ai$/);
        await expect(page.getByRole('heading', { name: 'Ask ALL PLAYS' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Home' })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

        const textarea = page.getByPlaceholder('Ask about schedules, teams, players, messages...');
        await expect(textarea).toBeVisible();
        await expect.poll(() => textarea.evaluate((element) => window.getComputedStyle(element).fontSize)).toBe('16px');
    });
});
