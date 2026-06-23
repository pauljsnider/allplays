// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mountedRoots = [];

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn(),
    loadParentHomeSummary: vi.fn(),
    loadParentHomeSummaryBootstrap: vi.fn(),
    loadParentHomeWithSecondaryData: vi.fn()
}));

const socialMocks = vi.hoisted(() => ({
    loadSocialHome: vi.fn(),
    createSocialPost: vi.fn(),
    reactToSocialPost: vi.fn(),
    commentOnSocialPost: vi.fn(),
    hideSocialPost: vi.fn(),
    reportSocialPost: vi.fn(),
    searchSocialUsers: vi.fn(),
    sendFriendRequest: vi.fn(),
    respondToFriendRequest: vi.fn(),
    removeFriend: vi.fn(),
    blockFriend: vi.fn(),
    uploadSocialPostMedia: vi.fn()
}));

const playerMocks = vi.hoisted(() => ({
    loadParentPlayerDetail: vi.fn(),
    markParentPlayerIncentivePaid: vi.fn(),
    retireParentPlayerIncentiveRule: vi.fn(),
    saveParentAthleteProfileDraft: vi.fn(),
    saveParentPlayerIncentiveCap: vi.fn(),
    saveParentPlayerIncentiveRule: vi.fn(),
    sendParentCoParentInvite: vi.fn(),
    toggleParentPlayerIncentiveRule: vi.fn(),
    updateParentPlayerEditableProfile: vi.fn()
}));

const profilePhotoServiceMocks = vi.hoisted(() => ({
    acquireProfilePhoto: vi.fn(),
    normalizeProfilePhoto: vi.fn(async (file) => file)
}));

vi.mock('../../apps/app/src/lib/homeService.ts', () => homeMocks);
vi.mock('../../apps/app/src/lib/socialService.ts', () => socialMocks);
vi.mock('../../apps/app/src/lib/playerService.ts', () => playerMocks);
vi.mock('../../apps/app/src/lib/profilePhotoService', () => profilePhotoServiceMocks);

import { Home } from '../../apps/app/src/pages/Home.tsx';
import { PlayerDetail } from '../../apps/app/src/pages/PlayerDetail.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent'
    },
    profile: {},
    loading: false,
    error: null,
    roles: ['parent'],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: async () => {},
    signOut: async () => {}
};

function event(overrides = {}) {
    const teamId = overrides.teamId || 'team-1';
    const id = overrides.id || 'game-1';
    const childId = overrides.childId || 'player-1';
    return {
        eventKey: overrides.eventKey || `${teamId}::${id}::${childId}`,
        id,
        teamId,
        teamName: overrides.teamName || 'Bears',
        type: overrides.type || 'game',
        date: overrides.date || new Date('2100-06-01T18:00:00Z'),
        location: overrides.location || 'Main Gym',
        opponent: overrides.opponent || 'Falcons',
        title: overrides.title || null,
        childId,
        childName: overrides.childName || 'Pat',
        isDbGame: overrides.isDbGame !== false,
        isCancelled: overrides.isCancelled === true,
        myRsvp: overrides.myRsvp || 'not_responded',
        assignments: overrides.assignments || [],
        ...overrides
    };
}

async function renderApp(initialEntry = '/home') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: [initialEntry] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: '/home', element: React.createElement(Home, { auth }) }),
                React.createElement(Route, { path: '/players/:teamId/:playerId', element: React.createElement(PlayerDetail, { auth }) }),
                React.createElement(Route, { path: '/players/:playerId', element: React.createElement(PlayerDetail, { auth }) })
            )
        ));
    });

    mountedRoots.push(root);
    await flush();
    return { container, root };
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function waitForText(container, text) {
    for (let index = 0; index < 25; index += 1) {
        if (container.textContent.includes(text)) return;
        await flush();
    }
    throw new Error(`Timed out waiting for text: ${text}`);
}

function buttonByText(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.trim() === text);
    if (!button) {
        throw new Error(`Button not found: ${text}`);
    }
    return button;
}

function buttonByAriaLabel(container, label) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.getAttribute('aria-label') === label);
    if (!button) {
        throw new Error(`Button not found: ${label}`);
    }
    return button;
}

async function clickButton(container, text) {
    await act(async () => {
        buttonByText(container, text).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

async function clickButtonByAriaLabel(container, label) {
    await act(async () => {
        buttonByAriaLabel(container, label).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

async function clickAllButtonsByAriaLabel(container, label) {
    while (Array.from(container.querySelectorAll('button')).some((candidate) => candidate.getAttribute('aria-label') === label)) {
        await clickButtonByAriaLabel(container, label);
    }
}

async function clickLastButton(container, text) {
    const buttons = Array.from(container.querySelectorAll('button')).filter((candidate) => candidate.textContent.trim() === text);
    if (!buttons.length) {
        throw new Error(`Button not found: ${text}`);
    }
    await act(async () => {
        buttons[buttons.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

async function clickLinkByHref(container, href) {
    const link = Array.from(container.querySelectorAll('a')).find((candidate) => candidate.getAttribute('href') === href);
    if (!link) {
        throw new Error(`Link not found: ${href}`);
    }
    await act(async () => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
}

async function attachAthleteHeadshotFile(container, fileName = 'headshot.png', type = 'image/png') {
    const input = container.querySelector('.athlete-profile-editor input[accept="image/*"]');
    if (!input) {
        throw new Error('Athlete headshot input not found');
    }
    const file = new File(['headshot-bytes'], fileName, { type });
    Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file]
    });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    return file;
}

async function attachAthleteHighlightClipFile(container, fileName = 'highlight.mp4', type = 'video/mp4') {
    const input = container.querySelector('.athlete-profile-editor input[accept="video/*,image/*"]');
    if (!input) {
        throw new Error('Athlete highlight clip input not found');
    }
    const file = new File(['highlight-bytes'], fileName, { type });
    Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file]
    });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    return file;
}

async function attachComposerFile(container, fileName = 'social.png') {
    const input = container.querySelector('input[type="file"]');
    if (!input) {
        throw new Error('File input not found');
    }
    const file = new File(['image-bytes'], fileName, { type: 'image/png' });
    Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file]
    });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    return file;
}

function findLabel(container, text) {
    const normalized = text.trim().toLowerCase();
    return Array.from(container.querySelectorAll('label')).find((candidate) => {
        const heading = candidate.querySelector('span');
        return heading?.textContent?.trim().toLowerCase() === normalized;
    }) || null;
}

function getSelectByLabel(container, text) {
    const label = findLabel(container, text);
    const select = label?.querySelector('select') || null;
    if (!select) {
        throw new Error(`Select not found for label: ${text}`);
    }
    return select;
}

async function changeSelectByLabel(container, text, value) {
    const select = getSelectByLabel(container, text);
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
}

beforeEach(() => {
    vi.clearAllMocks();
    window.requestAnimationFrame = (callback) => {
        callback(0);
        return 0;
    };
    window.URL.createObjectURL = vi.fn((file) => `blob:${file.name}`);
    window.URL.revokeObjectURL = vi.fn();
    window.scrollTo = vi.fn();
    homeMocks.loadParentHomeSummary.mockImplementation((user) => homeMocks.loadParentHome(user));
    homeMocks.loadParentHomeSummaryBootstrap.mockImplementation(async (user) => ({
        home: await homeMocks.loadParentHome(user),
        schedule: { children: [], events: [] }
    }));
    homeMocks.loadParentHomeWithSecondaryData.mockImplementation((user) => homeMocks.loadParentHome(user));

    const nextEvent = event({ id: 'game-next', opponent: 'Falcons' });
    const practice = event({
        id: 'practice-1',
        type: 'practice',
        title: 'Practice',
        date: new Date('2100-06-02T19:00:00Z'),
        myRsvp: 'going',
        practiceHomePacketSummary: '2 drills · 20 min'
    });
    const statEvent = event({
        id: 'game-final',
        date: new Date('2000-06-01T18:00:00Z'),
        status: 'completed',
        myRsvp: 'going'
    });

    homeMocks.loadParentHome.mockResolvedValue({
        players: [
            {
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Pat Star',
                nextEvent,
                rsvpNeeded: 1,
                packetsReady: 1,
                openAssignments: 0,
                unreadCount: 2
            }
        ],
        teams: [
            {
                teamId: 'team-1',
                teamName: 'Bears',
                role: 'Parent',
                sport: 'Basketball',
                players: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' }],
                nextEvent,
                eventCount: 2,
                unreadCount: 2,
                openActions: 2
            }
        ],
        upcomingEvents: [nextEvent, practice],
        actionItems: [
            {
                id: 'rsvp:game-next',
                kind: 'rsvp',
                tone: 'amber',
                title: 'Pat Star needs availability',
                detail: 'Bears vs. Falcons',
                to: '/schedule/team-1/game-next?childId=player-1&section=availability',
                priority: 10,
                date: nextEvent.date
            }
        ],
        fees: [],
        metrics: {
            players: 1,
            teams: 1,
            rsvpNeeded: 1,
            unreadMessages: 2,
            packetsReady: 1
        }
    });

    socialMocks.loadSocialHome.mockResolvedValue({
        feedItems: [
            {
                id: 'post-1',
                type: 'player_moment',
                visibility: 'friends',
                authorId: 'friend-1',
                authorName: 'Jamie Friend',
                authorPhotoUrl: null,
                teamId: 'team-1',
                teamName: 'Bears',
                playerIds: ['player-1'],
                playerNames: ['Pat Star'],
                sourceType: 'player',
                sourceId: 'player-1',
                title: 'Pat Star highlight',
                detail: 'Player moment · Pat Star · Bears',
                caption: 'Great ball movement in the second half.',
                media: [],
                route: '/players/team-1/player-1',
                createdAt: new Date('2100-06-01T18:00:00Z'),
                reactionCounts: { like: 2 },
                commentCount: 1
            }
        ],
        friends: [
            {
                id: 'friendship-1',
                userId: 'friend-1',
                name: 'Jamie Friend',
                email: 'jamie@example.com',
                photoUrl: null,
                sharedTeamIds: ['team-1'],
                sharedTeamNames: ['Bears'],
                status: 'accepted',
                requesterId: 'user-1',
                recipientId: 'friend-1'
            }
        ],
        suggestions: [
            {
                id: 'friendship-2',
                userId: 'friend-2',
                name: 'Morgan Parent',
                email: 'morgan@example.com',
                photoUrl: null,
                sharedTeamIds: ['team-1'],
                sharedTeamNames: ['Bears'],
                status: 'none',
                requesterId: null,
                recipientId: 'friend-2'
            }
        ],
        incomingRequests: [
            {
                id: 'friendship-3',
                userId: 'friend-3',
                name: 'Casey Parent',
                email: 'casey@example.com',
                photoUrl: null,
                sharedTeamIds: ['team-1'],
                sharedTeamNames: ['Bears'],
                status: 'pending',
                requesterId: 'friend-3',
                recipientId: 'user-1'
            }
        ],
        outgoingRequests: [],
        metrics: {
            feedItems: 1,
            friends: 1,
            incomingRequests: 1,
            suggestions: 1
        }
    });
    socialMocks.createSocialPost.mockResolvedValue('post-new');
    socialMocks.sendFriendRequest.mockResolvedValue('friendship-new');
    socialMocks.respondToFriendRequest.mockResolvedValue();
    socialMocks.searchSocialUsers.mockResolvedValue([
        {
            id: 'friendship-search',
            userId: 'friend-search',
            name: 'Taylor Search',
            email: 'taylor@example.com',
            photoUrl: null,
            sharedTeamIds: ['team-1'],
            sharedTeamNames: ['Bears'],
            status: 'none',
            requesterId: null,
            recipientId: 'friend-search'
        }
    ]);
    socialMocks.uploadSocialPostMedia.mockResolvedValue({
        type: 'image',
        url: 'https://img.example.test/social.png',
        name: 'social.png',
        thumbnailUrl: null
    });

    playerMocks.loadParentPlayerDetail.mockResolvedValue({
        child: { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' },
        player: { id: 'player-1', name: 'Pat Star', teamId: 'team-1', teamName: 'Bears', number: '9', photoUrl: 'https://example.test/linked-season.jpg' },
        team: { id: 'team-1', name: 'Bears', sport: 'basketball' },
        access: {
            isLinkedParent: true,
            isTeamStaff: false,
            canEditCustomRosterFields: false
        },
        events: [statEvent, nextEvent, practice],
        nextEvent,
        actionCounts: {
            rsvpNeeded: 1,
            packetsReady: 1,
            openAssignments: 0
        },
        statRows: [{ event: statEvent, stats: { pts: 12, reb: 4 } }],
        clips: [{ title: 'Fast break', url: 'https://video.example.test/clip', gameLabel: 'vs. Falcons' }],
        certificates: [{ id: 'cert-1', title: 'Hustle Award' }],
        trackingSummary: [{ playerId: 'player-1', items: [{ id: 'item-1', title: 'Bring ball', isComplete: true }] }],
        privateProfile: {
            emergencyContact: { name: 'Jamie Parent', phone: '555-0100' },
            medicalInfo: 'Peanut allergy'
        },
        incentives: {
            rules: [{ id: 'rule-1', statKey: 'pts', type: 'per_unit', amountCents: 100, active: true }],
            currentRules: [{ id: 'rule-1', statKey: 'pts', type: 'per_unit', amountCents: 100, active: true }],
            statOptions: [{ key: 'pts', label: 'PTS' }],
            maxPerGameCents: null,
            seasonGameEarnings: [{
                event: statEvent,
                stats: { pts: 12, reb: 4 },
                totalCents: 1200,
                uncappedTotalCents: 1200,
                wasCapped: false,
                breakdown: [{ rule: { statKey: 'pts', type: 'per_unit', amountCents: 100 }, statValue: 12, earned: 1200 }],
                paid: false,
                paidAmountCents: 0
            }],
            totalEarnedCents: 1200,
            totalPaidCents: 0,
            unpaidCents: 1200
        },
        customRosterFields: undefined,
        athleteProfile: {
            profile: {
                id: 'profile-1',
                athlete: { name: 'Pat Star', headline: '2028 Guard' },
                bio: { position: 'Guard' },
                privacy: 'public',
                seasons: [{ teamId: 'team-1', playerId: 'player-1' }],
                profilePhotoUrl: 'https://example.test/custom-headshot.jpg',
                profilePhotoPath: 'athlete-profile-media/user-1/profile-1/custom.jpg',
                profilePhotoMimeType: 'image/jpeg',
                profilePhotoSizeBytes: 42,
                profilePhotoUploadedAtMs: 1234,
                clips: [{ id: 'clip-old', source: 'upload', title: 'Old clip', url: 'https://example.test/old.mp4' }]
            },
            shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
            builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-1&playerId=player-1&profileId=profile-1'
        }
    });
    playerMocks.updateParentPlayerEditableProfile.mockResolvedValue();
    playerMocks.saveParentAthleteProfileDraft.mockResolvedValue({
        shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1'
    });
    playerMocks.saveParentPlayerIncentiveRule.mockResolvedValue('rule-2');
    playerMocks.saveParentPlayerIncentiveCap.mockResolvedValue();
    playerMocks.markParentPlayerIncentivePaid.mockResolvedValue();
});

afterEach(async () => {
    await act(async () => {
        while (mountedRoots.length) {
            mountedRoots.pop()?.unmount();
        }
        await Promise.resolve();
    });
    document.body.innerHTML = '';
});

describe('React app Home and player drill-in integration', () => {
    it('uses the section submenu pattern and navigates from Home to the team-scoped player page', async () => {
        const { container } = await renderApp('/home');
        await waitForText(container, 'Today for your players');
        await waitForText(container, 'Do first');
        expect(container.textContent).toContain('Team chats');
        expect(container.textContent).toContain('2 unread messages');
        expect(container.textContent).toContain('Team feed');
        expect(container.textContent).toContain('Pat Star highlight');
        expect(container.textContent).toContain('Next up');
        await waitForText(container, 'More to do');
        expect(homeMocks.loadParentHome).toHaveBeenCalledWith(auth.user);
        expect(socialMocks.loadSocialHome).toHaveBeenCalledWith(auth.user, expect.objectContaining({
            players: expect.any(Array),
            teams: expect.any(Array)
        }));

        await clickButton(container, 'Teams');
        await waitForText(container, 'Teams');
        const teamLink = Array.from(container.querySelectorAll('a')).find((link) => link.getAttribute('href') === '/teams?selectedTeamId=team-1&from=home');
        expect(teamLink?.getAttribute('href')).toBe('/teams?selectedTeamId=team-1&from=home');
        expect(teamLink?.getAttribute('aria-label')).toBe('Open Bears in My Teams');

        await clickButton(container, 'Feed');
        await waitForText(container, 'Quick shares');
        expect(container.textContent).toContain('Jamie Friend');
        expect(container.textContent).toContain('Great ball movement in the second half.');
        expect(Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual(expect.arrayContaining([
            '/players/team-1/player-1',
            '/home?section=friends'
        ]));
        await clickButton(container, 'Player moment');
        await waitForText(container, 'What happened?');
        expect(container.textContent).not.toContain('Pick one');
        expect(container.textContent).toContain('Change share type');
        expect(container.textContent).toContain('Write one short note');
        expect(container.textContent).toContain('Proud of the effort today.');
        expect(container.textContent).not.toContain('Post type');
        expect(container.textContent).not.toContain('Title');
        await clickButton(container, 'Proud of the effort today.');
        await clickLastButton(container, 'Post');
        expect(socialMocks.createSocialPost).toHaveBeenCalledWith(auth.user, expect.objectContaining({
            type: 'player_moment',
            title: 'Pat Star moment',
            caption: 'Proud of the effort today.',
            teamId: 'team-1',
            playerIds: ['player-1']
        }));

        await clickButton(container, 'Friends');
        await waitForText(container, 'Needs response');
        expect(container.textContent).toContain('Casey Parent');
        expect(container.textContent).toContain('Morgan Parent');
        expect(container.textContent).toContain('Jamie Friend');
        await clickButton(container, 'Accept');
        expect(socialMocks.respondToFriendRequest).toHaveBeenCalledWith('friendship-3', 'accepted');

        await clickButton(container, 'Players');
        await waitForText(container, 'Player Drill-In');
        const playerLink = Array.from(container.querySelectorAll('a')).find((link) => link.getAttribute('href') === '/players/team-1/player-1');
        expect(playerLink?.getAttribute('href')).toBe('/players/team-1/player-1');

        await clickLinkByHref(container, '/players/team-1/player-1');
        await waitForText(container, 'Pat Star');
        expect(playerMocks.loadParentPlayerDetail).toHaveBeenCalledWith(auth.user, 'team-1', 'player-1');
        expect(container.textContent).toContain('Availability needed');

        await clickButton(container, 'Reports');
        await waitForText(container, 'Player reports');
        expect(container.textContent).toContain('Game Stats');
        expect(container.textContent).toContain('Season Averages');
        expect(container.textContent).toContain('Bring ball');
        await clickButton(container, 'Video Clips');
        expect(container.textContent).toContain('Fast break');

        await clickButton(container, 'Profile');
        await waitForText(container, 'Edit Profile');
        expect(container.textContent).toContain('Athlete Profile');
        expect(container.textContent).toContain('Family');
        expect(container.textContent).toContain('Incentives');
        expect(container.textContent).toContain('Certificates');
        await clickButton(container, 'Family');
        expect(container.textContent).toContain('Invite Co-Parent');
        await clickButton(container, 'Incentives');
        await waitForText(container, 'Incentive wallet');
        expect(container.textContent).toContain('Payouts need attention');
        expect(container.textContent).toContain('Active rules');
        await clickButton(container, 'Payouts');
        await waitForText(container, 'Game payouts');
        expect(container.textContent).toContain('Mark Paid');
        expect(container.textContent).toContain('12 PTS x $1.00 = +$12.00');
        await clickButton(container, 'Rules');
        await waitForText(container, 'Rules and limits');
        expect(container.textContent).toContain('PTS: +$1.00 per pts');
        expect(container.textContent).toContain('Max earned per game');
        expect(window.scrollTo).toHaveBeenCalled();
    });

    it('requires media for photo quick shares and submits a compact media post payload', async () => {
        const { container } = await renderApp('/home?section=feed&social=create&type=team_media');
        await waitForText(container, 'What happened?');

        expect(container.textContent).toContain('Photo or video');
        expect(container.textContent).toContain('Choose photo or video');
        expect(container.textContent).toContain('Optional unless this is a media post.');

        await clickLastButton(container, 'Post');
        await waitForText(container, 'Add a photo or video for this share.');
        expect(socialMocks.uploadSocialPostMedia).not.toHaveBeenCalled();
        expect(socialMocks.createSocialPost).not.toHaveBeenCalled();

        await attachComposerFile(container, 'team-photo.png');
        expect(container.textContent).toContain('team-photo.png');
        await clickLastButton(container, 'Post');

        expect(socialMocks.uploadSocialPostMedia).toHaveBeenCalledWith('team-1', expect.objectContaining({
            name: 'team-photo.png',
            type: 'image/png'
        }));
        expect(socialMocks.createSocialPost).toHaveBeenCalledWith(auth.user, expect.objectContaining({
            type: 'team_media',
            visibility: 'friends_and_team',
            title: 'Bears team photo',
            teamId: 'team-1',
            teamName: 'Bears',
            playerIds: [],
            media: [expect.objectContaining({ url: 'https://img.example.test/social.png' })],
            visibleUserIds: ['friend-1']
        }));
    });

    it('keeps team-first presets player-free by default and submits a team-scoped payload', async () => {
        const { container } = await renderApp('/home?section=feed&social=create&type=practice_packet');
        await waitForText(container, 'What happened?');

        expect(container.textContent).toContain('Practice update');
        expect(container.textContent).toContain('Bears');
        expect(container.textContent).toContain('Team');
        expect(container.textContent).not.toContain('Audience');

        await clickButton(container, 'Team');
        await waitForText(container, 'Audience');
        expect(findLabel(container, 'Player')).toBeNull();
        expect(container.textContent).toContain('Tag a player');

        await clickButton(container, 'Practice packet is ready.');
        await clickLastButton(container, 'Post');
        expect(socialMocks.createSocialPost).toHaveBeenCalledWith(auth.user, expect.objectContaining({
            type: 'practice_packet',
            visibility: 'team',
            title: 'Bears practice packet',
            caption: 'Practice packet is ready.',
            teamId: 'team-1',
            playerIds: [],
            playerNames: [],
            sourceType: 'team',
            route: '/schedule?teamId=team-1',
            visibleUserIds: []
        }));
    });

    it('shows the player selector only after explicit opt-in on team-first presets', async () => {
        const { container } = await renderApp('/home?section=feed&social=create&type=game_recap');
        await waitForText(container, 'What happened?');

        await clickButton(container, 'Bears');
        await waitForText(container, 'Audience');
        expect(findLabel(container, 'Player')).toBeNull();

        await clickButton(container, 'Tag a player');
        await waitForText(container, 'Remove player tag');
        expect(getSelectByLabel(container, 'Player').value).toBe('team-1::player-1');

        await clickButton(container, 'Hard fought game today.');
        await clickLastButton(container, 'Post');
        expect(socialMocks.createSocialPost).toHaveBeenCalledWith(auth.user, expect.objectContaining({
            type: 'game_recap',
            title: 'Bears game recap',
            caption: 'Hard fought game today.',
            teamId: 'team-1',
            playerIds: ['player-1'],
            playerNames: ['Pat Star'],
            sourceType: 'player',
            sourceId: 'player-1'
        }));
    });

    it('lets team changes stick on team-first presets until player tagging is explicitly enabled', async () => {
        homeMocks.loadParentHome.mockResolvedValue({
            players: [
                {
                    teamId: 'team-1',
                    teamName: 'Bears',
                    playerId: 'player-1',
                    playerName: 'Pat Star',
                    nextEvent: null,
                    rsvpNeeded: 0,
                    packetsReady: 0,
                    openAssignments: 0,
                    unreadCount: 0
                },
                {
                    teamId: 'team-2',
                    teamName: 'Wolves',
                    playerId: 'player-2',
                    playerName: 'Sam Swift',
                    nextEvent: null,
                    rsvpNeeded: 0,
                    packetsReady: 0,
                    openAssignments: 0,
                    unreadCount: 0
                }
            ],
            teams: [
                {
                    teamId: 'team-1',
                    teamName: 'Bears',
                    role: 'Parent',
                    sport: 'Basketball',
                    players: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' }],
                    nextEvent: null,
                    eventCount: 2,
                    unreadCount: 0,
                    openActions: 0
                },
                {
                    teamId: 'team-2',
                    teamName: 'Wolves',
                    role: 'Parent',
                    sport: 'Soccer',
                    players: [{ teamId: 'team-2', teamName: 'Wolves', playerId: 'player-2', playerName: 'Sam Swift' }],
                    nextEvent: null,
                    eventCount: 1,
                    unreadCount: 0,
                    openActions: 0
                }
            ],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: {
                players: 2,
                teams: 2,
                rsvpNeeded: 0,
                unreadMessages: 0,
                packetsReady: 0
            }
        });

        const { container } = await renderApp('/home?section=feed&social=create&type=player_moment');
        await waitForText(container, 'What happened?');
        await clickButton(container, 'Change share type');
        await clickButton(container, 'Recap');
        await clickButton(container, 'Bears');
        await waitForText(container, 'Audience');

        expect(findLabel(container, 'Player')).toBeNull();
        await changeSelectByLabel(container, 'Team', 'team-2');
        expect(getSelectByLabel(container, 'Team').value).toBe('team-2');

        await clickButton(container, 'Great team win today.');
        await clickLastButton(container, 'Post');
        expect(socialMocks.createSocialPost).toHaveBeenCalledWith(auth.user, expect.objectContaining({
            type: 'game_recap',
            title: 'Wolves game recap',
            caption: 'Great team win today.',
            teamId: 'team-2',
            teamName: 'Wolves',
            playerIds: [],
            playerNames: [],
            sourceType: 'team',
            sourceId: 'team-2',
            route: '/schedule?teamId=team-2'
        }));
    });

    it('keeps the current player profile subview after saves refresh player data', async () => {
        const { container } = await renderApp('/players/team-1/player-1');
        await waitForText(container, 'Pat Star');

        await clickButton(container, 'Profile');
        await clickButton(container, 'Athlete Profile');
        await waitForText(container, 'Athlete Profile Builder');
        expect(buttonByText(container, 'Athlete Profile').getAttribute('aria-pressed')).toBe('true');

        expect(container.textContent).toContain('Custom athlete profile headshot');
        expect(container.textContent).toContain('Highlight clips');
        expect(container.textContent).toContain('Uploaded clip');
        expect(container.textContent).toContain('Clip title');
        expect(container.textContent).toContain('Note');
        await attachAthleteHeadshotFile(container, 'new-headshot.png');
        await waitForText(container, 'New headshot selected. Save to publish it.');
        await waitForText(container, 'new-headshot.png');
        await attachAthleteHighlightClipFile(container, 'highlight.mp4');
        await waitForText(container, 'Pending upload');
        await waitForText(container, 'highlight.mp4');
        await clickButton(container, 'Publish Athlete Profile');
        await waitForText(container, 'Saved');
        expect(playerMocks.saveParentAthleteProfileDraft).toHaveBeenCalledWith(expect.objectContaining({
            user: auth.user,
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            profilePhotoFile: expect.objectContaining({ name: 'new-headshot.png', type: 'image/png' }),
            resetProfilePhoto: false,
            highlightClipUploads: [expect.objectContaining({
                file: expect.objectContaining({ name: 'highlight.mp4', type: 'video/mp4' })
            })],
            draft: expect.objectContaining({
                clips: [
                    expect.objectContaining({ id: 'clip-old', source: 'upload', title: 'Old clip', url: 'https://example.test/old.mp4' }),
                    expect.objectContaining({ source: 'upload', pendingUpload: true })
                ]
            })
        }));
        expect(playerMocks.loadParentPlayerDetail).toHaveBeenCalledTimes(2);
        expect(buttonByText(container, 'Athlete Profile').getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('Athlete Profile Builder');
        expect(container.textContent).not.toContain('Parents can update the player photo');
        expect(container.textContent).not.toContain('Loading player');

        await attachAthleteHeadshotFile(container, 'notes.txt', 'text/plain');
        await waitForText(container, 'Choose an image file for the athlete headshot.');
        await attachAthleteHighlightClipFile(container, 'notes.txt', 'text/plain');
        await waitForText(container, 'Choose image or video files for highlight clips.');
        await clickButton(container, 'Use linked season photo');
        await clickAllButtonsByAriaLabel(container, 'Remove clip');
        await clickButton(container, 'Publish Athlete Profile');
        expect(playerMocks.saveParentAthleteProfileDraft).toHaveBeenLastCalledWith(expect.objectContaining({
            profilePhotoFile: null,
            resetProfilePhoto: true,
            highlightClipUploads: []
        }));

        await clickButton(container, 'Incentives');
        await waitForText(container, 'Incentive wallet');
        await clickButton(container, 'Rules');
        await waitForText(container, 'Rules and limits');
        await clickButton(container, 'Add Rule');
        await clickButton(container, 'Add Rule');
        await waitForText(container, 'Rule added.');
        expect(buttonByText(container, 'Incentives').getAttribute('aria-pressed')).toBe('true');
        expect(buttonByText(container, 'Rules').getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('Rules and limits');
        expect(container.textContent).not.toContain('Loading player');
    });

    it('surfaces chat-access teams without linked players so Home and Messages stay aligned', async () => {
        homeMocks.loadParentHome.mockResolvedValue({
            players: [],
            teams: [
                {
                    teamId: 'team-staff',
                    teamName: 'Staff Wolves',
                    role: 'Coach',
                    sport: 'Soccer',
                    players: [],
                    nextEvent: null,
                    eventCount: 0,
                    unreadCount: 3,
                    openActions: 1
                }
            ],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: {
                players: 0,
                teams: 1,
                rsvpNeeded: 0,
                unreadMessages: 3,
                packetsReady: 0
            }
        });

        const { container } = await renderApp('/home');
        await waitForText(container, 'Today for your players');
        expect(container.textContent).toContain('3 unread messages');
        expect(container.textContent).toContain('Staff Wolves');
        expect(container.textContent).toContain('All caught up');
        expect(container.textContent).toContain('No upcoming events');

        await clickButton(container, 'Teams');
        await waitForText(container, 'Coach · Soccer');
        const teamLink = Array.from(container.querySelectorAll('a')).find((link) => link.getAttribute('href') === '/teams?selectedTeamId=team-staff&from=home');
        expect(teamLink).toBeTruthy();
        expect(teamLink?.getAttribute('aria-label')).toBe('Open Staff Wolves in My Teams');

        await clickButton(container, 'Players');
        await waitForText(container, 'No players linked yet');
    });

    it('shows a retryable Home error state and recovers on retry after an initial failure', async () => {
        homeMocks.loadParentHome.mockRejectedValueOnce(new Error('Home service down'));

        const { container } = await renderApp('/home');

        await waitForText(container, 'Home service down');
        expect(container.textContent).toContain('Home could not load');
        expect(container.textContent).toContain('Try loading Home again to restore your dashboard.');
        expect(buttonByAriaLabel(container, 'Retry loading Home')).toBeTruthy();
        expect(container.textContent).not.toContain('No upcoming events');

        await clickButtonByAriaLabel(container, 'Retry loading Home');

        await waitForText(container, 'Pat Star highlight');
        expect(container.textContent).toContain('Team chats');
        expect(homeMocks.loadParentHome).toHaveBeenCalledTimes(3);
    });

    it('keeps the last loaded Home visible when a refresh fails', async () => {
        const { container } = await renderApp('/home');

        await waitForText(container, 'Pat Star highlight');
        homeMocks.loadParentHome.mockRejectedValueOnce(new Error('Refresh failed.'));
        await clickButtonByAriaLabel(container, 'Refresh Home');

        await waitForText(container, 'Unable to refresh Home. Showing the last loaded Home. Try again.');
        expect(container.textContent).toContain('Pat Star highlight');
        expect(container.textContent).toContain('Team chats');
        expect(container.textContent).not.toContain('Home could not load');
    });
});
