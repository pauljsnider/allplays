const { test, expect } = require('@playwright/test');

const noopModuleSources = {
  firebaseApp: String.raw`
export function getApp() {
  return {};
}
`,
  firebaseAi: String.raw`
export const GoogleAIBackend = {};
export function getAI() {
  return {};
}
export function getGenerativeModel() {
  return {};
}
`
};

function fakeTimestamp(iso) {
  return {
    toDate() {
      return new Date(iso);
    }
  };
}

async function installTeamChatMocks(page, state = {}) {
  await page.addInitScript((initState) => {
    window.__securityIsolationState = initState;
    window.__securityIsolationCalls = {
      postChatMessage: [],
      editChatMessage: [],
      deleteChatMessage: [],
      updateChatLastRead: [],
      toggleChatReaction: []
    };
  }, state);

  const authSource = String.raw`
const getState = () => globalThis.__securityIsolationState || {};

export function checkAuth(callback) {
  setTimeout(() => callback(getState().authUser ?? { uid: 'user-1', email: 'user@example.com' }), 0);
  return () => {};
}
`;

  const utilsSource = String.raw`
export function renderHeader(container) {
  if (container) container.setAttribute('data-rendered', 'header');
}

export function renderFooter(container) {
  if (container) container.setAttribute('data-rendered', 'footer');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
`;

  const dbSource = String.raw`
const getState = () => globalThis.__securityIsolationState || {};
const calls = () => globalThis.__securityIsolationCalls || {
  postChatMessage: [],
  editChatMessage: [],
  deleteChatMessage: [],
  updateChatLastRead: [],
  toggleChatReaction: []
};

export async function getTeam(teamId) {
  if (Object.prototype.hasOwnProperty.call(getState(), 'team')) {
    return getState().team;
  }
  return {
    id: teamId,
    ownerId: 'owner-1',
    name: 'All Stars',
    sport: 'Basketball',
    adminEmails: []
  };
}

export async function getUserProfile(userId) {
  const state = getState();
  if (state.profilesByUid && state.profilesByUid[userId]) {
    return state.profilesByUid[userId];
  }
  return state.currentUserProfile || {};
}

export async function getPlayers() { return []; }
export async function getGames() { return []; }
export async function getGameEvents() { return []; }
export async function getAggregatedStatsForGames() { return []; }

export async function getChatMessages() {
  return [];
}

export async function postChatMessage(teamId, payload) {
  calls().postChatMessage.push({ teamId, payload });
}

export async function editChatMessage(teamId, messageId, text) {
  calls().editChatMessage.push({ teamId, messageId, text });
}

export async function deleteChatMessage(teamId, messageId) {
  calls().deleteChatMessage.push({ teamId, messageId });
}

export function canAccessTeamChat(user, team) {
  const state = getState();
  if (typeof state.canAccess === 'boolean') return state.canAccess;
  if (!user || !team) return false;
  if (team.ownerId === user.uid) return true;
  if (user.isAdmin) return true;
  const userEmail = String(user.email || '').toLowerCase();
  if ((team.adminEmails || []).map(e => String(e || '').toLowerCase()).includes(userEmail)) return true;
  return Array.isArray(user.parentOf) && user.parentOf.some(link => link && link.teamId === team.id);
}

export function canModerateChat(user, team) {
  const state = getState();
  if (typeof state.canModerate === 'boolean') return state.canModerate;
  if (!user || !team) return false;
  if (team.ownerId === user.uid) return true;
  if (user.isAdmin) return true;
  const userEmail = String(user.email || '').toLowerCase();
  return (team.adminEmails || []).map(e => String(e || '').toLowerCase()).includes(userEmail);
}

export async function updateChatLastRead(userId, teamId) {
  calls().updateChatLastRead.push({ userId, teamId });
}

export function subscribeToChatMessages(teamId, options, onMessages) {
  const state = getState();
  const messages = Array.isArray(state.messages) ? state.messages : [];
  setTimeout(() => onMessages(messages, null), 0);
  return () => {};
}

export async function uploadChatImage() {
  return { url: null, path: null, name: null, type: null, size: null };
}

export async function toggleChatReaction(teamId, messageId, reactionKey, uid) {
  calls().toggleChatReaction.push({ teamId, messageId, reactionKey, uid });
}
`;

  await page.route(/\/js\/auth\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: authSource });
  });
  await page.route(/\/js\/utils\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsSource });
  });
  await page.route(/\/js\/db\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: dbSource });
  });
  await page.route(/\/js\/vendor\/firebase-app\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: noopModuleSources.firebaseApp });
  });
  await page.route(/\/js\/vendor\/firebase-ai\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: noopModuleSources.firebaseAi });
  });
  await page.route('https://www.googletagmanager.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
}

async function gotoTeamChat(page, { state = {}, hash = '#teamId=team-a' } = {}) {
  await installTeamChatMocks(page, state);
  await page.goto(`/team-chat.html${hash}`);
}

test.describe('Security/isolation negative suite @extended', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await gotoTeamChat(page, {
      state: {
        authUser: null
      }
    });

    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('rejects missing team context and routes back to dashboard', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });

    await gotoTeamChat(page, {
      hash: ''
    });

    await expect(page).toHaveURL(/\/dashboard\.html$/);
    expect(dialogs).toContain('No team specified');
  });

  test('rejects unknown team id and routes back to dashboard', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });

    await gotoTeamChat(page, {
      state: {
        team: null
      }
    });

    await expect(page).toHaveURL(/\/dashboard\.html$/);
    expect(dialogs).toContain('Team not found');
  });

  test('denies unauthorized user even when team exists', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });

    await gotoTeamChat(page, {
      state: {
        authUser: { uid: 'outsider-1', email: 'outsider@example.com' },
        currentUserProfile: { parentOf: [], isAdmin: false },
        team: {
          id: 'team-a',
          ownerId: 'owner-1',
          name: 'All Stars',
          adminEmails: ['coach@example.com']
        },
        canAccess: false
      }
    });

    await expect(page).toHaveURL(/\/dashboard\.html$/);
    expect(dialogs).toContain('You do not have access to this team chat');
  });

  test('parent access keeps banner in read-only mode', async ({ page }) => {
    await gotoTeamChat(page, {
      state: {
        authUser: { uid: 'parent-1', email: 'parent@example.com' },
        currentUserProfile: {
          parentOf: [{ teamId: 'team-a', playerId: 'player-9' }],
          isAdmin: false
        },
        canAccess: true,
        canModerate: false
      }
    });

    const banner = page.locator('#team-banner');
    await expect(banner.locator('a[href="parent-dashboard.html"]')).toBeVisible();
    await expect(banner.locator('a[href="edit-team.html#teamId=team-a"]')).toHaveCount(0);
    await expect(banner.locator('a[href="edit-roster.html#teamId=team-a"]')).toHaveCount(0);
  });

  test('full-access moderator gets management navigation', async ({ page }) => {
    await gotoTeamChat(page, {
      state: {
        authUser: { uid: 'coach-1', email: 'coach@example.com' },
        currentUserProfile: { parentOf: [], isAdmin: false },
        team: {
          id: 'team-a',
          ownerId: 'owner-1',
          name: 'All Stars',
          adminEmails: ['coach@example.com']
        },
        canAccess: true,
        canModerate: true
      }
    });

    const banner = page.locator('#team-banner');
    await expect(banner.locator('a[href="dashboard.html"]')).toBeVisible();
    await expect(banner.locator('a[href="edit-team.html#teamId=team-a"]')).toBeVisible();
    await expect(banner.locator('a[href="edit-roster.html#teamId=team-a"]')).toBeVisible();
  });

  test('parent cannot delete another users message', async ({ page }) => {
    await gotoTeamChat(page, {
      state: {
        authUser: { uid: 'parent-1', email: 'parent@example.com' },
        currentUserProfile: { parentOf: [{ teamId: 'team-a', playerId: 'p1' }], isAdmin: false },
        canAccess: true,
        canModerate: false,
        messages: [
          {
            id: 'msg-other-1',
            senderId: 'coach-1',
            senderName: 'Coach',
            text: 'Parent cannot delete this',
            createdAt: fakeTimestamp('2026-02-21T15:00:00.000Z')
          }
        ]
      }
    });

    await expect(page.getByText('Parent cannot delete this')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });

  test('parent can delete own message', async ({ page }) => {
    await gotoTeamChat(page, {
      state: {
        authUser: { uid: 'parent-1', email: 'parent@example.com' },
        currentUserProfile: { parentOf: [{ teamId: 'team-a', playerId: 'p1' }], isAdmin: false },
        canAccess: true,
        canModerate: false,
        messages: [
          {
            id: 'msg-own-1',
            senderId: 'parent-1',
            senderName: 'Parent One',
            text: 'Own message can be deleted',
            createdAt: fakeTimestamp('2026-02-21T15:01:00.000Z')
          }
        ]
      }
    });

    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(1);
  });

  test('parent can edit own text message only', async ({ page }) => {
    await gotoTeamChat(page, {
      state: {
        authUser: { uid: 'parent-1', email: 'parent@example.com' },
        currentUserProfile: { parentOf: [{ teamId: 'team-a', playerId: 'p1' }], isAdmin: false },
        canAccess: true,
        canModerate: false,
        messages: [
          {
            id: 'msg-own-edit',
            senderId: 'parent-1',
            senderName: 'Parent One',
            text: 'Own text can be edited',
            createdAt: fakeTimestamp('2026-02-21T15:02:00.000Z')
          }
        ]
      }
    });

    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
  });

  test('parent cannot edit own image-only message', async ({ page }) => {
    await gotoTeamChat(page, {
      state: {
        authUser: { uid: 'parent-1', email: 'parent@example.com' },
        currentUserProfile: { parentOf: [{ teamId: 'team-a', playerId: 'p1' }], isAdmin: false },
        canAccess: true,
        canModerate: false,
        messages: [
          {
            id: 'msg-own-image',
            senderId: 'parent-1',
            senderName: 'Parent One',
            text: '',
            imageUrl: 'https://example.com/photo.jpg',
            imageName: 'photo.jpg',
            createdAt: fakeTimestamp('2026-02-21T15:03:00.000Z')
          }
        ]
      }
    });

    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  });

  test('moderator can delete another users message', async ({ page }) => {
    await gotoTeamChat(page, {
      state: {
        authUser: { uid: 'admin-1', email: 'admin@example.com' },
        currentUserProfile: { parentOf: [], isAdmin: true },
        canAccess: true,
        canModerate: true,
        messages: [
          {
            id: 'msg-other-mod',
            senderId: 'coach-2',
            senderName: 'Coach Two',
            text: 'Moderator should be able to remove this',
            createdAt: fakeTimestamp('2026-02-21T15:04:00.000Z')
          }
        ]
      }
    });

    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(1);
  });

  test('deleted messages render as tombstones without edit/delete actions', async ({ page }) => {
    await gotoTeamChat(page, {
      state: {
        authUser: { uid: 'admin-1', email: 'admin@example.com' },
        currentUserProfile: { parentOf: [], isAdmin: true },
        canAccess: true,
        canModerate: true,
        messages: [
          {
            id: 'msg-deleted',
            senderId: 'coach-2',
            senderName: 'Coach Two',
            text: 'Old text',
            deleted: true,
            createdAt: fakeTimestamp('2026-02-21T15:05:00.000Z')
          }
        ]
      }
    });

    await expect(page.getByText('Message removed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });
});
