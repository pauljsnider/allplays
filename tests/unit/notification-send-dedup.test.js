import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function getSendCategoryNotification() {
    const start = functionsSource.indexOf('async function sendCategoryNotification(');
    const end = functionsSource.indexOf('async function sendDirectTargetsNotification');
    const slice = functionsSource.slice(start, end);

    return new Function(
        'NOTIFICATION_CATEGORIES',
        'getTargetsForCategory',
        'buildNotificationLink',
        'buildNotificationAppRoute',
        'admin',
        'WEB_PUSH_NOTIFICATION_ASSETS',
        'pruneInvalidTokens',
        `${slice}; return sendCategoryNotification;`
    )(
        ['liveChat', 'mentions'],
        async () => [{ uid: 'user-1', token: 'token-1', teamId: 'team-1' }],
        () => '/team.html?teamId=team-1',
        () => '/app/messages',
        {
            messaging: () => ({
                sendEachForMulticast: vi.fn().mockResolvedValue({
                    responses: [{ success: true }],
                    successCount: 1,
                    failureCount: 0
                })
            })
        },
        { icon: '/img/logo_small.png', badge: '/img/logo_small.png' },
        vi.fn()
    );
}

describe('notification send dedup guard compatibility', () => {
    it('does not require delivery metadata helpers for liveChat sends', async () => {
        const sendCategoryNotification = getSendCategoryNotification();

        await expect(sendCategoryNotification({
            teamId: 'team-1',
            gameId: 'game-1',
            category: 'liveChat',
            title: 'New message',
            body: 'Hello team'
        })).resolves.toEqual(expect.objectContaining({
            successCount: 1,
            failureCount: 0
        }));
    });

    it('does not require delivery metadata helpers for mentions sends', async () => {
        const sendCategoryNotification = getSendCategoryNotification();

        await expect(sendCategoryNotification({
            teamId: 'team-1',
            gameId: 'game-1',
            eventId: 'message-1',
            category: 'mentions',
            title: 'Mention',
            body: 'You were mentioned'
        })).resolves.toEqual(expect.objectContaining({
            successCount: 1,
            failureCount: 0
        }));
    });
});
