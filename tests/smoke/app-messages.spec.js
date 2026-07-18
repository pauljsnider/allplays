import { expect, test } from '@playwright/test';
import { expectVisualSnapshot, installVisualNetworkGuard } from './helpers/visual-regression.js';

test.skip(
    process.env.SMOKE_SUITE === 'production',
    'Module-mocked app specs need the Vite dev server; production runs cover the deployed bundle via app-production-bootstrap.spec.js'
);

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

function appUrl(baseURL, hashPath) {
    const appBaseURL = process.env.SMOKE_APP_BASE_URL || baseURL;
    const url = new URL('/', appBaseURL);
    url.hash = hashPath;
    return url.toString();
}

async function waitForMessagesRoute(page, readyLocator) {
    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
        await expect(readyLocator).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30000 });
}

async function openTeamThread(page, teamName) {
    const teamLink = page.getByRole('link', { name: new RegExp(teamName) }).first();

    await expect(async () => {
        await expect(teamLink).toBeVisible({ timeout: 3000 });
        await teamLink.click();
        await expect(page.getByPlaceholder(`Message ${teamName}`)).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30000 });
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function staffActionsButton(page) {
    return page.getByRole('button', { name: 'Open staff actions' });
}

function audienceMenuItem(page, summary) {
    return page
        .getByRole('menu', { name: 'Staff actions' })
        .getByRole('menuitem', { name: new RegExp(`Message audience.*Current:\\s*${escapeRegExp(summary)}`, 'i') });
}

async function openStaffActions(page) {
    const trigger = staffActionsButton(page);

    await expect(trigger).toBeVisible();
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
        await trigger.click();
    }
    await expect(page.getByRole('menu', { name: 'Staff actions' })).toBeVisible();
}

async function expectAudienceSummary(page, summary) {
    await openStaffActions(page);
    await expect(audienceMenuItem(page, summary)).toBeVisible();
    await staffActionsButton(page).click();
}

async function openAudienceSheet(page, summary) {
    await openStaffActions(page);
    await audienceMenuItem(page, summary).click();
    await expect(page.getByRole('dialog', { name: 'Message audience' })).toBeVisible();
}

function buildDefaultThreadMessagesScript() {
    return `
        const filler = Array.from({ length: 28 }, (_, index) => msg({
            id: 'filler-' + index,
            senderId: index % 2 ? 'user-1' : 'coach-1',
            senderName: index % 2 ? 'Pat Parent' : 'Coach Jamie',
            text: 'Schedule update ' + (index + 1),
            createdAt: new Date(Date.UTC(2026, 4, 21, 14, index + 3))
        }));
        onMessages([
            msg({ id: 'msg-1', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bring both jerseys.' }),
            ...filler,
            msg({ id: 'msg-2', senderId: 'user-1', senderName: 'Pat Parent', text: 'We can bring snacks.', createdAt: new Date('2026-05-21T14:40:00Z') }),
            msg({ id: 'msg-3', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Latest ride update.', createdAt: new Date('2026-05-21T14:45:00Z') })
        ], { id: 'cursor' });
    `;
}

function buildDeferredMediaThreadMessagesScript() {
    return `
        const filler = Array.from({ length: 40 }, (_, index) => msg({
            id: 'filler-' + index,
            senderId: index % 2 ? 'user-1' : 'coach-1',
            senderName: index % 2 ? 'Pat Parent' : 'Coach Jamie',
            text: 'Long schedule update ' + (index + 1) + ' with extra context to keep earlier media offscreen on first render.',
            createdAt: new Date(Date.UTC(2026, 4, 21, 14, index + 3))
        }));
        onMessages([
            msg({
                id: 'msg-deferred-photo-1',
                text: 'Deferred lineup board',
                attachments: [{ type: 'image', url: 'https://media.example.test/deferred-lineup-1.jpg', name: 'Deferred lineup 1' }],
                createdAt: new Date('2026-05-21T13:58:00Z')
            }),
            msg({
                id: 'msg-deferred-photo-2',
                text: 'Deferred huddle photo',
                attachments: [{ type: 'image', url: 'https://media.example.test/deferred-huddle-2.jpg', name: 'Deferred huddle 2' }],
                createdAt: new Date('2026-05-21T13:59:00Z')
            }),
            msg({
                id: 'msg-deferred-video',
                text: 'Deferred warmups clip',
                attachments: [{ type: 'video', url: 'https://media.example.test/deferred-warmups.mp4', name: 'Deferred warmups clip' }],
                createdAt: new Date('2026-05-21T14:00:00Z')
            }),
            ...filler,
            msg({ id: 'msg-2', senderId: 'user-1', senderName: 'Pat Parent', text: 'We can bring snacks.', createdAt: new Date('2026-05-21T14:40:00Z') }),
            msg({ id: 'msg-3', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Latest ride update.', createdAt: new Date('2026-05-21T14:45:00Z') })
        ], { id: 'cursor' });
    `;
}

async function mockMessagesModules(page, options = {}) {
    await page.addInitScript(({ speech }) => {
        window.__chatCalls = {
            sends: [],
            reactions: [],
            edits: [],
            deletes: [],
            reads: [],
            ai: [],
            chatAiModuleRequests: [],
            subscriptions: []
        };
        if (speech) {
            class MockSpeechRecognition {
                constructor() {
                    window.__speechRecognitionInstance = this;
                }

                start() {
                    window.__speechRecognitionStarted = true;
                }

                stop() {
                    window.__speechRecognitionStopped = true;
                    if (this.onend) this.onend();
                }

                abort() {
                    window.__speechRecognitionAborted = true;
                    if (this.onend) this.onend();
                }
            }

            window.SpeechRecognition = MockSpeechRecognition;
            window.webkitSpeechRecognition = MockSpeechRecognition;
        }
    }, { speech: Boolean(options.speech) });

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
                        roles: ['parent', 'admin']
                    };
                    return {
                        user,
                        profile: { fullName: 'Pat Parent' },
                        loading: false,
                        error: null,
                        roles: user.roles,
                        isParent: true,
                        isCoach: false,
                        isAdmin: true,
                        isPlatformAdmin: false,
                        refresh: async () => {},
                        signOut: async () => {}
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/notificationInboxService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                const notificationItems = [
                    {
                        id: 'notif-1',
                        text: 'Game starts in 30 minutes',
                        type: 'game_alert',
                        appRoute: '/schedule/game-1',
                        readAt: null
                    }
                ];

                export function subscribeToUnreadNotificationCount(_uid, onCount, _onError) {
                    onCount(notificationItems.filter((item) => !item.readAt).length);
                    return () => {};
                }

                export function subscribeToNotificationInbox(_uid, onItems, _onError) {
                    onItems(notificationItems);
                    return () => {};
                }

                export async function markNotificationRead(_uid, itemId) {
                    const item = notificationItems.find((entry) => entry.id === itemId);
                    if (item) item.readAt = new Date().toISOString();
                }

                export async function markAllNotificationsRead() {
                    notificationItems.forEach((item) => {
                        item.readAt = new Date().toISOString();
                    });
                }
            `
        });
    });

    await page.route(/\/src\/lib\/chatService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                function msg(overrides = {}) {
                    return {
                        id: overrides.id || 'msg-1',
                        text: overrides.text || 'Bring both jerseys.',
                        senderId: overrides.senderId || 'coach-1',
                        senderName: overrides.senderName || 'Coach Jamie',
                        senderEmail: 'coach@example.com',
                        createdAt: overrides.createdAt || new Date('2026-05-21T14:00:00Z'),
                        reactions: overrides.reactions || {},
                        deleted: false,
                        ...overrides
                    };
                }

                export function getChatInboxPreview(message) {
                    return message ? (message.senderName || 'Unknown') + ': ' + (message.text || 'Attachment') : 'No messages yet';
                }

                export async function loadChatInbox(_user, options = {}) {
                    const teams = [
                        {
                            id: 'team-1',
                            name: 'Bears',
                            sport: 'Basketball',
                            role: 'Admin',
                            canModerate: true,
                            unreadCount: 4,
                            lastMessage: options.includeLastMessages === false ? null : msg({ id: 'last-1', text: 'Practice packet is posted.' })
                        },
                        {
                            id: 'team-2',
                            name: 'Thunder',
                            sport: 'Soccer',
                            role: 'Parent',
                            canModerate: false,
                            unreadCount: 0,
                            lastMessage: options.includeLastMessages === false ? null : msg({ id: 'last-2', text: 'Tournament schedule changed.', senderName: 'Morgan' })
                        },
                        {
                            id: 'team-3',
                            name: 'Falcons',
                            sport: 'Baseball',
                            role: 'Coach',
                            canModerate: true,
                            unreadCount: 1,
                            lastMessage: options.includeLastMessages === false ? null : msg({ id: 'last-3', text: 'Lineup card is ready.', senderName: 'Coach Lee' })
                        }
                    ];
                    if (options.includeLastMessages === false && options.onPreview) {
                        setTimeout(() => options.onPreview({
                            teamId: 'team-1',
                            lastMessage: msg({ id: 'last-1', text: 'Practice packet is posted.' }),
                            preferredConversationId: null,
                            isMuted: false
                        }), ${options.previewDelayMs || 0});
                        setTimeout(() => options.onPreview({
                            teamId: 'team-2',
                            lastMessage: msg({ id: 'last-2', text: 'Tournament schedule changed.', senderName: 'Morgan' }),
                            preferredConversationId: null,
                            isMuted: false
                        }), ${options.previewDelayMs || 0});
                        setTimeout(() => options.onPreview({
                            teamId: 'team-3',
                            lastMessage: msg({ id: 'last-3', text: 'Lineup card is ready.', senderName: 'Coach Lee' }),
                            preferredConversationId: null,
                            isMuted: true
                        }), ${options.previewDelayMs || 0});
                    }
                    return { teams };
                }

                export async function loadChatTeamContext() {
                    return {
                        team: { id: 'team-1', name: 'Bears', sport: 'Basketball' },
                        profile: { fullName: 'Pat Parent', photoUrl: '' },
                        canModerate: true
                    };
                }

                export async function loadChatConversations() {
                    if (${options.conversationDelayMs || 0} > 0) {
                        await new Promise((resolve) => setTimeout(resolve, ${options.conversationDelayMs || 0}));
                    }
                    return [
                        { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] },
                        { id: 'group_role%3Astaff', type: 'group', name: 'Staff only', participantIds: ['user-1'], participantRoles: ['staff'] }
                    ];
                }

                export async function ensureStaffChatConversation() {
                    return { id: 'group_role%3Astaff', type: 'group', name: 'Staff only', participantIds: ['user-1'], participantRoles: ['staff'] };
                }

                export async function loadChatRecipientOptions() {
                    return [
                        { id: 'user:coach-1', name: 'Coach Jamie', detail: 'Staff' },
                        { id: 'player:player-1', name: 'Pat', detail: '#9' }
                    ];
                }

                export function subscribeToTeamChatMessages(teamId, conversationId, onMessages, onError) {
                    window.__chatCalls.subscriptions.push({ teamId, conversationId });
                    if (${Boolean(options.failFirstThreadLoad)}) {
                        window.__threadSubscriptionAttempts = (window.__threadSubscriptionAttempts || 0) + 1;
                        if (window.__threadSubscriptionAttempts <= ${options.failFirstThreadLoadAttempts || 1}) {
                            setTimeout(() => onError(new Error('Unable to load chat messages.')), 0);
                            return { unsubscribe: () => {} };
                        }
                    }
                    if (${options.threadMessagesDelayMs || 0} > 0) {
                        setTimeout(() => {
                            ${options.threadMessagesScript || buildDefaultThreadMessagesScript()}
                        }, ${options.threadMessagesDelayMs || 0});
                    } else {
                        ${options.threadMessagesScript || buildDefaultThreadMessagesScript()}
                    }
                    return { unsubscribe: () => {} };
                }

                export async function loadOlderTeamChatMessages() {
                    return [];
                }

                export async function sendTeamChatMessage(input) {
                    window.__chatCalls.sends.push({
                        text: input.text,
                        selectedConversationId: input.selectedConversationId,
                        selectedConversationRoles: input.selectedConversation?.participantRoles || [],
                        selectedRecipientTarget: input.selectedRecipientTarget,
                        selectedRecipientIds: input.selectedRecipientIds,
                        fileCount: input.files?.length || 0
                    });
                    return { conversationId: 'team', createdConversation: null, wantsAi: input.text.includes('@ALL PLAYS') };
                }

                export async function toggleTeamChatReaction(teamId, messageId, reactionKey, userId, conversationId) {
                    window.__chatCalls.reactions.push({ teamId, messageId, reactionKey, userId, conversationId });
                    return true;
                }

                export async function editTeamChatMessage(teamId, messageId, text, conversationId) {
                    window.__chatCalls.edits.push({ teamId, messageId, text, conversationId });
                }

                export async function deleteTeamChatMessage(teamId, messageId, conversationId) {
                    window.__chatCalls.deletes.push({ teamId, messageId, conversationId });
                }

                export async function markTeamChatRead(userId, teamId) {
                    window.__chatCalls.reads.push({ userId, teamId });
                }

                export async function muteTeamChat() {
                    return true;
                }

                export async function unmuteTeamChat() {
                    return true;
                }

                export async function sendTeamEmailMessage() {
                    return { recipientCount: 1, status: 'queued' };
                }

                export async function loadSentTeamEmails() {
                    return [];
                }

                export async function loadTeamEmailDrafts() {
                    return [];
                }

                export async function loadTeamEmailTemplates() {
                    return [];
                }

                export async function saveTeamEmailDraft(input) {
                    return {
                        id: input.draftId || 'draft-1',
                        subject: input.subject || 'Draft subject',
                        body: input.body || 'Draft body',
                        recipientIds: input.recipientIds || [],
                        recipients: (input.recipientIds || []).map((id) => ({
                            key: id,
                            email: 'coach@example.com',
                            name: 'Coach Jamie'
                        })),
                        updatedAt: new Date('2026-05-21T14:50:00Z')
                    };
                }

                export async function saveTeamEmailTemplate() {
                    return { id: 'template-1', name: 'Template', subject: 'Subject', body: 'Body' };
                }

                export async function uploadTeamChatAttachment(teamId, file) {
                    return {
                        id: 'attachment-' + file.name,
                        name: file.name,
                        type: file.type || 'application/octet-stream',
                        size: file.size || 0,
                        url: 'https://media.example.test/' + file.name
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/chatAiService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                window.__chatCalls.chatAiModuleRequests.push(new URL(import.meta.url).pathname);

                export async function sendAllPlaysChatAnswer(input) {
                    window.__chatCalls.ai.push({
                        question: input.question,
                        selectedConversationId: input.selectedConversationId,
                        selectedRecipientTarget: input.selectedRecipientTarget,
                        selectedRecipientIds: input.selectedRecipientIds
                    });
                }
            `
        });
    });
}

test('@visual messages inbox and team chat exercise real migrated chat UX', async ({ page, baseURL }) => {
    const url = appUrl(baseURL, '/messages');
    await installVisualNetworkGuard(page, url);
    await mockMessagesModules(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    await waitForMessagesRoute(page, page.getByRole('heading', { name: 'Team chats' }));
    await expect(page.getByRole('link', { name: /Bears/ }).first()).toBeVisible();
    await expect(page.getByText('Coach Jamie: Practice packet is posted.')).toBeVisible();
    await expectVisualSnapshot(page, 'messages-inbox-mobile.png');
    const searchInput = page.getByPlaceholder('Search team chats');
    await expect(searchInput).toBeVisible();
    await expect.poll(() => searchInput.evaluate((element) => window.getComputedStyle(element).fontSize)).toBe('16px');
    await searchInput.click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await searchInput.fill('volleyball');
    await expect(page.getByText('No team chats match “volleyball”')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();
    await expect(page.getByText('No team chats yet')).toBeHidden();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(searchInput).toHaveValue('');
    await expect(page.getByRole('link', { name: /Bears/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Thunder/ }).first()).toBeVisible();

    await openTeamThread(page, 'Bears');
    const thread = page.locator('.chat-messages-scroll');
    const bottomNav = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(thread).toContainText('Bring both jerseys.');
    await expect(thread).toContainText('We can bring snacks.');
    await expect(page.getByText('Latest ride update.')).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: 'Schedule' })).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: 'Messages' })).toBeVisible();
    await expect.poll(() => thread.evaluate((element) => (
        element.scrollHeight - element.scrollTop - element.clientHeight <= 96
    ))).toBe(true);
    const mobileFrame = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Primary navigation"]');
        const composer = document.querySelector('.chat-composer');
        const toolbar = document.querySelector('.chat-composer-toolbar');
        const textarea = document.querySelector('.chat-composer-textarea');
        const navBox = nav.getBoundingClientRect();
        const composerBox = composer.getBoundingClientRect();
        const textareaBox = textarea.getBoundingClientRect();
        return {
            composerBottom: composerBox.bottom,
            composerHeight: composerBox.height,
            navTop: navBox.top,
            toolbarMarginTop: Number.parseFloat(window.getComputedStyle(toolbar).marginTop),
            textareaHeight: textareaBox.height
        };
    });
    expect(mobileFrame.composerBottom).toBeLessThanOrEqual(mobileFrame.navTop + 2);
    expect(mobileFrame.composerHeight).toBeLessThan(132);
    expect(mobileFrame.textareaHeight).toBeLessThanOrEqual(50);
    expect(mobileFrame.toolbarMarginTop).toBeLessThanOrEqual(8);
    const notificationTrigger = page.getByTestId('app-shell-notifications-trigger');
    await expect(notificationTrigger).toBeVisible();
    await expect(page.getByTestId('notification-unread-badge')).toHaveText('1');
    await notificationTrigger.click();
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
    await page.getByRole('button', { name: 'Close notifications' }).click();
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeHidden();
    await expect(page).toHaveURL(/#\/messages\/team-1$/);
    await expectAudienceSummary(page, 'Full team');
    const quickSwitcher = page.getByTestId('mobile-conversation-chips');
    await expect(quickSwitcher).toBeVisible();
    await expect(quickSwitcher.getByRole('button', { name: /Switch to .*Team Chat/i })).toBeVisible();
    await expect(quickSwitcher.getByRole('button', { name: 'Switch to Staff only' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Conversations' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.getByRole('button', { name: 'Add attachment' }).click();
    await expect(page.getByRole('dialog', { name: 'Add to message' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Photo/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Video/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Link/ })).toBeVisible();

    const photoChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Photo/ }).click();
    const photoChooser = await photoChooserPromise;
    await photoChooser.setFiles({
        name: 'chat-photo.png',
        mimeType: 'image/png',
        buffer: Buffer.from('photo')
    });
    await expect(page.getByText('1 attachment ready')).toBeVisible();
    await page.getByRole('button', { name: 'Remove attachment' }).click();

    await page.getByRole('button', { name: 'Add attachment' }).click();
    const videoChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Video/ }).click();
    const videoChooser = await videoChooserPromise;
    await videoChooser.setFiles({
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        buffer: Buffer.from('video')
    });
    await expect(page.getByText('1 attachment ready')).toBeVisible();
    await page.getByRole('button', { name: 'Remove attachment' }).click();

    await page.getByRole('button', { name: 'Add attachment' }).click();
    await page.getByRole('button', { name: /Link/ }).click();
    await page.getByPlaceholder('https://example.com').fill('www.allplays.ai/game.html');
    await page.getByRole('button', { name: 'Add link', exact: true }).click();
    await expect(page.getByPlaceholder('Message Bears')).toHaveValue('https://www.allplays.ai/game.html');
    await page.getByPlaceholder('Message Bears').fill('');

    await openAudienceSheet(page, 'Full team');
    const audienceDialog = page.getByRole('dialog', { name: 'Message audience' });
    await expect(audienceDialog.getByRole('button', { name: 'Staff only' })).toBeHidden();
    await page.getByRole('button', { name: 'Close Message audience' }).click();

    await page.getByPlaceholder('Message Bears').fill('See you at practice');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => page.evaluate(() => window.__chatCalls.sends[0])).toMatchObject({
        text: 'See you at practice',
        selectedConversationId: 'team',
        selectedRecipientTarget: 'full_team',
        selectedRecipientIds: [],
        fileCount: 0
    });
    await expect.poll(() => page.evaluate(() => window.__chatCalls.chatAiModuleRequests)).toEqual([]);

    await quickSwitcher.getByRole('button', { name: 'Switch to Staff only' }).click();
    await expect(page.getByRole('dialog', { name: 'Conversations' })).toHaveCount(0);
    await expect(quickSwitcher.getByRole('button', { name: 'Switch to Staff only' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByPlaceholder('Message Bears').fill('@ALL PLAYS who needs RSVP help?');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect.poll(() => page.evaluate(() => window.__chatCalls.sends)).toEqual([
        {
            text: 'See you at practice',
            selectedConversationId: 'team',
            selectedConversationRoles: ['team'],
            selectedRecipientTarget: 'full_team',
            selectedRecipientIds: [],
            fileCount: 0
        },
        {
            text: '@ALL PLAYS who needs RSVP help?',
            selectedConversationId: 'group_role%3Astaff',
            selectedConversationRoles: ['staff'],
            selectedRecipientTarget: 'full_team',
            selectedRecipientIds: [],
            fileCount: 0
        }
    ]);
    await expect.poll(() => page.evaluate(() => window.__chatCalls.chatAiModuleRequests.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__chatCalls.ai)).toEqual([{
        question: 'who needs RSVP help?',
        selectedConversationId: 'team',
        selectedRecipientTarget: 'full_team',
        selectedRecipientIds: []
    }]);

    await page.getByRole('button', { name: 'Add reaction' }).last().click();
    await expect(page.locator('.chat-reaction-picker')).toBeVisible();
    await page.getByRole('button', { name: 'Like' }).click();
    await expect.poll(() => page.evaluate(() => window.__chatCalls.reactions[0])).toMatchObject({
        teamId: 'team-1',
        messageId: 'msg-3',
        reactionKey: 'thumbs_up',
        userId: 'user-1',
        conversationId: 'team'
    });
});

test('messages team thread renders before deferred conversation hydration finishes', async ({ page, baseURL }) => {
    await mockMessagesModules(page, { conversationDelayMs: 1500 });
    await page.goto(appUrl(baseURL, '/messages/team-1'), { waitUntil: 'domcontentloaded' });

    await waitForMessagesRoute(page, page.getByPlaceholder('Message Bears'));
    await expect(page.getByText('Bring both jerseys.')).toBeVisible();
    await expect(page.getByText('Latest ride update.')).toBeVisible();
    await expect(page.getByPlaceholder('Message Bears')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Team chat' })).toBeVisible();

    await page.getByRole('button', { name: 'Team chat' }).click();
    await expect(page.getByRole('dialog', { name: 'Conversations' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Staff only Group conversation' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Latest ride update.')).toBeVisible();
});

test('messages team thread retries a failed subscription in place on mobile', async ({ page, baseURL }) => {
    await mockMessagesModules(page, { failFirstThreadLoad: true, threadMessagesDelayMs: 1000 });
    await page.goto(appUrl(baseURL, '/messages/team-1'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 30000 });
    await expect(page.getByText('Unable to load chat messages.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to messages' })).toBeVisible();

    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByText('Loading messages...')).toBeVisible();
    await expect(page.getByText('Bring both jerseys.')).toBeVisible();
    await expect(page.getByPlaceholder('Message Bears')).toBeVisible();
    await expect(page).toHaveURL(/#\/messages\/team-1$/);
    await expect.poll(() => page.evaluate(() => window.__chatCalls.subscriptions.length)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.evaluate(() => window.__chatCalls.subscriptions.at(-1))).toEqual({ teamId: 'team-1', conversationId: 'team' });
});

test('messages inbox stays interactive while previews hydrate on inbox and desktop routes', async ({ page, baseURL }) => {
    await mockMessagesModules(page, { previewDelayMs: 600 });
    await page.goto(appUrl(baseURL, '/messages'), { waitUntil: 'domcontentloaded' });

    await waitForMessagesRoute(page, page.getByRole('heading', { name: 'Team chats' }));
    const bearsInboxRow = page.getByRole('link', { name: /Bears/ }).first();
    await expect(bearsInboxRow).toBeVisible();
    await expect(bearsInboxRow).toContainText('No messages yet');
    await expect(page.getByRole('button', { name: 'Refresh messages' })).toBeVisible();
    await page.getByPlaceholder('Search team chats').fill('Falcons');
    await expect(page.getByRole('link', { name: /Falcons/ }).first()).toBeVisible();
    await page.getByPlaceholder('Search team chats').fill('');
    await expect(bearsInboxRow).toContainText('Coach Jamie: Practice packet is posted.', { timeout: 5000 });
    await expect(page.getByRole('link', { name: /Falcons/ }).first()).toContainText('Coach Lee: Lineup card is ready.');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(appUrl(baseURL, '/messages/team-1'), { waitUntil: 'domcontentloaded' });

    await waitForMessagesRoute(page, page.locator('.messages-list-pane'));
    await expect(page.getByRole('link', { name: /Bears/ }).first()).toBeVisible();
    await expect(page.locator('.messages-chat-pane')).toContainText('Bring both jerseys.');
    await expect(page.locator('.messages-list-pane')).toContainText('No messages yet');
    await expect(page.locator('.messages-list-pane')).toContainText('Coach Jamie: Practice packet is posted.', { timeout: 5000 });
    await expect(page.locator('.messages-list-pane')).toContainText('Coach Lee: Lineup card is ready.');
});

test('messages selected-member, dictation, and validation flows stay usable on mobile', async ({ page, baseURL }) => {
    await mockMessagesModules(page, { speech: true });
    await page.goto(appUrl(baseURL, '/messages/team-1'), { waitUntil: 'domcontentloaded' });

    const thread = page.locator('.chat-messages-scroll');
    await waitForMessagesRoute(page, staffActionsButton(page));
    await expectAudienceSummary(page, 'Full team');
    await expect(thread).toContainText('Latest ride update.');
    await openAudienceSheet(page, 'Full team');
    await page.getByRole('button', { name: /Selected members/ }).click();
    await page.locator('label').filter({ hasText: 'Coach Jamie' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expectAudienceSummary(page, 'Coach Jamie');

    await page.getByRole('button', { name: 'Voice to text' }).click();
    await expect(page.getByText('Listening...')).toBeVisible();
    await page.evaluate(() => {
        const recognition = window.__speechRecognitionInstance;
        recognition.onresult({
            results: [
                [{ transcript: 'Running five minutes late' }]
            ]
        });
        recognition.onend();
    });
    await expect(page.getByPlaceholder('Message Bears')).toHaveValue('Running five minutes late');
    await expect(page.getByRole('button', { name: 'Voice to text' })).toBeVisible();

    await page.getByPlaceholder('Message Bears').fill('Can you confirm arrival time?');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => page.evaluate(() => window.__chatCalls.sends[0])).toMatchObject({
        text: 'Can you confirm arrival time?',
        selectedConversationId: 'team',
        selectedRecipientTarget: 'individuals',
        selectedRecipientIds: ['user:coach-1'],
        fileCount: 0
    });

    await page.getByRole('button', { name: 'Add attachment' }).click();
    await page.getByRole('button', { name: /Link/ }).click();
    await page.getByPlaceholder('https://example.com').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Add link', exact: true }).click();
    await expect(page.getByText('Use a valid http or https link.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Add attachment' }).click();
    const photoChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Photo/ }).click();
    const photoChooser = await photoChooserPromise;
    await photoChooser.setFiles({
        name: 'notes.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('not media')
    });
    await expect(page.getByText('Choose image or video files only.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('messages native back closes an open sheet without leaving the thread or clearing drafts', async ({ page, baseURL }) => {
    await mockMessagesModules(page);
    await page.goto(appUrl(baseURL, '/messages/team-1'), { waitUntil: 'domcontentloaded' });

    await waitForMessagesRoute(page, staffActionsButton(page));
    const composer = page.getByPlaceholder('Message Bears');
    await composer.fill('Hold this draft while I pick recipients');

    await openAudienceSheet(page, 'Full team');

    await expect.poll(() => page.evaluate(() => {
        const event = new Event('allplays:native-back-dismiss', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
    })).toBe(true);

    await expect(page.getByRole('dialog', { name: 'Message audience' })).toBeHidden();
    await expect(page).toHaveURL(/#\/messages\/team-1$/);
    await expect(composer).toHaveValue('Hold this draft while I pick recipients');

    const consumedAfterSheetClosed = await page.evaluate(() => {
        const event = new Event('allplays:native-back-dismiss', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
    });
    expect(consumedAfterSheetClosed).toBe(false);
});

test('messages defer offscreen media requests until scroll or video interaction', async ({ page, baseURL }) => {
    const mediaRequests = [];
    await page.route('https://media.example.test/**', async (route) => {
        const url = new URL(route.request().url());
        mediaRequests.push(url.pathname);
        const isVideo = url.pathname.endsWith('.mp4');
        await route.fulfill({
            status: 200,
            contentType: isVideo ? 'video/mp4' : 'image/png',
            body: isVideo ? Buffer.from('0000', 'utf8') : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9W6l8AAAAASUVORK5CYII=', 'base64')
        });
    });
    await mockMessagesModules(page, { threadMessagesScript: buildDeferredMediaThreadMessagesScript() });
    await page.goto(appUrl(baseURL, '/messages/team-1'), { waitUntil: 'domcontentloaded' });

    const thread = page.locator('.chat-messages-scroll');
    await waitForMessagesRoute(page, staffActionsButton(page));
    await expect(thread).toContainText('Latest ride update.');
    await expect.poll(async () => {
        const sampleRequestCount = async () => {
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            return mediaRequests.length;
        };

        return {
            latestMessageVisible: await page.getByText('Latest ride update.').isVisible(),
            requestCounts: [await sampleRequestCount(), await sampleRequestCount()]
        };
    }, { timeout: 3000 }).toEqual({
        latestMessageVisible: true,
        requestCounts: [0, 0]
    });
    expect(mediaRequests).not.toContain('/deferred-lineup-1.jpg');
    expect(mediaRequests).not.toContain('/deferred-huddle-2.jpg');
    expect(mediaRequests).not.toContain('/deferred-warmups.mp4');

    await thread.evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect(page.getByAltText('Deferred lineup 1')).toBeVisible();
    await expect.poll(() => mediaRequests.filter((path) => path.endsWith('.jpg')).sort()).toEqual([
        '/deferred-huddle-2.jpg',
        '/deferred-lineup-1.jpg'
    ]);
    expect(mediaRequests).not.toContain('/deferred-warmups.mp4');

    await page.evaluate(() => {
        const video = document.querySelector('video[data-chat-attachment-url="https://media.example.test/deferred-warmups.mp4"]');
        if (!video) throw new Error('Video element not found');
        video.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    await expect.poll(() => mediaRequests.includes('/deferred-warmups.mp4')).toBe(true);
});

test.describe('desktop messages workspace', () => {
    test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false });

    test('keeps inbox, thread, and composer inside the browser workspace', async ({ page, baseURL }) => {
        await mockMessagesModules(page);
        await page.goto(appUrl(baseURL, '/messages'), { waitUntil: 'domcontentloaded' });

        await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Messages' })).toBeVisible();
        await expect(page.locator('.messages-list-pane')).toBeVisible();
        await expect(page.locator('.chat-window-embedded')).toBeVisible();
        await expect(page.getByText('Latest ride update.')).toBeVisible();

        const metrics = await page.evaluate(() => {
            const pageRoot = document.querySelector('.desktop-app-page-messages');
            const main = document.querySelector('.desktop-main-messages');
            const shellGrid = document.querySelector('.desktop-shell-grid-messages');
            const chatPane = document.querySelector('.messages-chat-pane');
            const topbar = document.querySelector('.chat-topbar');
            const thread = document.querySelector('.chat-messages-scroll');
            const composer = document.querySelector('.chat-composer');
            const body = document.querySelector('.chat-body');

            const rect = (element) => {
                const box = element.getBoundingClientRect();
                return {
                    top: box.top,
                    bottom: box.bottom,
                    left: box.left,
                    right: box.right,
                    height: box.height,
                    width: box.width
                };
            };

            return {
                documentFitsViewport: document.documentElement.scrollHeight <= window.innerHeight + 2,
                pageOverflowHidden: window.getComputedStyle(pageRoot).overflow === 'hidden',
                mainOverflowHidden: window.getComputedStyle(main).overflow === 'hidden',
                shellHeight: rect(shellGrid).height,
                chatPane: rect(chatPane),
                topbar: rect(topbar),
                body: rect(body),
                thread: rect(thread),
                composer: rect(composer),
                threadHasInternalScroll: thread.scrollHeight > thread.clientHeight,
                threadPinnedToLatest: thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 4
            };
        });

        expect(metrics.documentFitsViewport).toBe(true);
        expect(metrics.pageOverflowHidden).toBe(true);
        expect(metrics.mainOverflowHidden).toBe(true);
        expect(metrics.shellHeight).toBeGreaterThan(700);
        expect(metrics.chatPane.bottom).toBeLessThanOrEqual(900);
        expect(metrics.topbar.top).toBeGreaterThanOrEqual(metrics.chatPane.top);
        expect(metrics.body.top).toBeGreaterThanOrEqual(metrics.topbar.bottom - 1);
        expect(metrics.thread.bottom).toBeLessThanOrEqual(metrics.composer.top + 1);
        expect(metrics.composer.bottom).toBeLessThanOrEqual(metrics.chatPane.bottom + 1);
        expect(metrics.threadHasInternalScroll).toBe(true);
        expect(metrics.threadPinnedToLatest).toBe(true);
    });
});
