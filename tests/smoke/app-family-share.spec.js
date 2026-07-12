import { expect, test } from '@playwright/test';

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || '';

test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL is required for React app smoke tests');
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

function appUrl(hashPath) {
    const url = new URL('/', appBaseUrl);
    url.hash = hashPath;
    return url.toString();
}

async function mockPublicFamilyShareModules(page) {
    await page.route(/\/src\/lib\/useAuth\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function useAuth() {
                    return {
                        user: null,
                        profile: null,
                        loading: false,
                        error: null,
                        roles: [],
                        isParent: false,
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

    await page.route(/\/src\/lib\/familyShareViewerService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export class FamilyShareTokenError extends Error {
                    constructor(reason, message) {
                        super(message);
                        this.name = 'FamilyShareTokenError';
                        this.reason = reason;
                    }
                }
                export async function loadFamilyShareView(tokenId) {
                    if (tokenId === 'expired-token') {
                        throw new FamilyShareTokenError('expired', 'Expired token');
                    }
                    return {
                        tokenId,
                        label: 'Grandma',
                        expiresAt: new Date('2100-06-01T18:00:00Z'),
                        children: [{
                            teamId: 'team-1',
                            teamName: 'Bears',
                            playerId: 'player-1',
                            playerName: 'Pat Star',
                            playerNumber: '9',
                            playerPhotoUrl: null
                        }],
                        teams: [{ teamId: 'team-1', teamName: 'Bears', playerNames: ['Pat Star'] }],
                        events: [],
                        upcomingEvents: [{
                            eventKey: 'team-1:game-1',
                            id: 'game-1',
                            teamId: 'team-1',
                            teamName: 'Bears',
                            type: 'game',
                            date: new Date('2100-06-01T18:00:00Z'),
                            title: '',
                            opponent: 'Comets',
                            location: 'Court 1',
                            status: 'scheduled',
                            isCancelled: false,
                            isDbGame: true,
                            childIds: ['player-1'],
                            childNames: ['Pat Star'],
                            homeScore: null,
                            awayScore: null,
                            notes: null,
                            sourceLabel: null
                        }],
                        recentResults: [{
                            eventKey: 'team-1:game-0',
                            id: 'game-0',
                            teamId: 'team-1',
                            teamName: 'Bears',
                            type: 'game',
                            date: new Date('2026-05-01T18:00:00Z'),
                            title: '',
                            opponent: 'Hawks',
                            location: 'Court 2',
                            status: 'final',
                            isCancelled: false,
                            isDbGame: true,
                            childIds: ['player-1'],
                            childNames: ['Pat Star'],
                            homeScore: 12,
                            awayScore: 8,
                            notes: null,
                            sourceLabel: null
                        }],
                        calendarWarnings: []
                    };
                }
            `
        });
    });
}

test('public family share route renders without signed-in auth', async ({ page }) => {
    await mockPublicFamilyShareModules(page);
    await page.goto(appUrl('/family/token-1'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Grandma' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Pat Star').first()).toBeVisible();
    await expect(page.getByText('vs Comets')).toBeVisible();
    await expect(page.getByText('Final 12-8')).toBeVisible();
});

test('public family share route shows friendly expired-token state', async ({ page }) => {
    await mockPublicFamilyShareModules(page);
    await page.goto(appUrl('/family/expired-token'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Ask the parent to create a new family share link')).toBeVisible();
});
