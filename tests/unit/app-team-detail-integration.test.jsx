// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const teamDetailMocks = vi.hoisted(() => ({
    loadParentTeamDetail: vi.fn(),
    loadTeamDetailInsights: vi.fn(),
    loadTeamDetailSponsors: vi.fn(),
    loadTeamRosterParentInvites: vi.fn(),
    loadTeamStaffPermissions: vi.fn(),
    createRosterParentInviteForApp: vi.fn(),
    deactivateRosterPlayerForApp: vi.fn(),
    reactivateRosterPlayerForApp: vi.fn(),
    grantScorekeeperAccessForApp: vi.fn(),
    revokeScorekeeperAccessForApp: vi.fn(),
    grantVideographerAccessForApp: vi.fn(),
    revokeVideographerAccessForApp: vi.fn(),
    inviteTeamAdminForApp: vi.fn(),
    saveTeamScheduleNotificationsForApp: vi.fn(),
    buildPublicTeamGamesIcsUrl: vi.fn((teamId) => `https://us-central1-all-plays-prod.cloudfunctions.net/publicTeamGamesIcs?teamId=${encodeURIComponent(teamId)}`),
    canExposePublicFanFeed: vi.fn((team, events = []) => (events || []).some((event) => event?.type === 'game' && event?.visibility !== 'private' && event?.isPrivate !== true && event?.status !== 'deleted' && event?.liveStatus !== 'deleted' && ((team?.isPublic !== false && team?.active !== false) || event?.isPublic === true || event?.shareable === true || event?.publicCalendar === true)))
}));
const publicActionMocks = vi.hoisted(() => ({
    copyPublicText: vi.fn(),
    openPublicUrl: vi.fn(),
    sharePublicUrl: vi.fn()
}));
const parentToolsMocks = vi.hoisted(() => ({
    buildPrivateTeamCalendarFeedUrl: vi.fn(),
    getAppleCalendarFeedUrl: vi.fn((url) => String(url).replace(/^https?:\/\//i, 'webcal://')),
    getGoogleCalendarFeedUrl: vi.fn((url) => `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(url)}`)
}));
const scheduleServiceMocks = vi.hoisted(() => ({
    createStaffRsvpReminderPreviewLoader: vi.fn(),
    loadPreview: vi.fn(),
    sendStaffRsvpReminder: vi.fn()
}));

vi.mock('../../apps/app/src/lib/teamDetailService.ts', () => ({
    loadParentTeamDetail: teamDetailMocks.loadParentTeamDetail,
    loadTeamDetailInsights: teamDetailMocks.loadTeamDetailInsights,
    loadTeamDetailSponsors: teamDetailMocks.loadTeamDetailSponsors,
    loadTeamRosterParentInvites: teamDetailMocks.loadTeamRosterParentInvites,
    loadTeamStaffPermissions: teamDetailMocks.loadTeamStaffPermissions,
    createRosterParentInviteForApp: teamDetailMocks.createRosterParentInviteForApp,
    deactivateRosterPlayerForApp: teamDetailMocks.deactivateRosterPlayerForApp,
    reactivateRosterPlayerForApp: teamDetailMocks.reactivateRosterPlayerForApp,
    grantScorekeeperAccessForApp: teamDetailMocks.grantScorekeeperAccessForApp,
    revokeScorekeeperAccessForApp: teamDetailMocks.revokeScorekeeperAccessForApp,
    grantVideographerAccessForApp: teamDetailMocks.grantVideographerAccessForApp,
    revokeVideographerAccessForApp: teamDetailMocks.revokeVideographerAccessForApp,
    inviteTeamAdminForApp: teamDetailMocks.inviteTeamAdminForApp,
    saveTeamScheduleNotificationsForApp: teamDetailMocks.saveTeamScheduleNotificationsForApp,
    buildPublicTeamGamesIcsUrl: teamDetailMocks.buildPublicTeamGamesIcsUrl,
    canExposePublicFanFeed: teamDetailMocks.canExposePublicFanFeed
}));
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../apps/app/src/lib/parentToolsService.ts', () => parentToolsMocks);
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => ({
    createStaffRsvpReminderPreviewLoader: scheduleServiceMocks.createStaffRsvpReminderPreviewLoader,
    sendStaffRsvpReminder: scheduleServiceMocks.sendStaffRsvpReminder
}));

import { buildScoreboardWidgetEmbedCode, buildScoreboardWidgetUrl, TeamDetail } from '../../apps/app/src/pages/TeamDetail.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
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

function model() {
    const nextDate = new Date('2100-06-01T18:00:00Z');
    return {
        team: {
            id: 'team-1',
            name: 'Bears',
            sport: 'Basketball',
            photoUrl: 'https://img.example.test/team.png',
            description: 'Fast, parent-friendly team page.',
            zip: '66210',
            isPublic: true,
            active: true,
            leagueUrl: 'https://league.example.test/standings',
            streamUrl: 'https://youtube.example.test/watch',
            websiteUrl: 'https://allplays.ai/team.html#teamId=team-1',
            mediaUrl: 'https://allplays.ai/team-media.html#teamId=team-1',
            registrationProvider: [{ label: 'Provider', value: 'Sports Connect' }],
            scheduleNotifications: {
                enabled: true,
                reminderHours: 24,
                delivery: 'team_chat',
                hasExplicitReminderHours: false,
                summary: 'Fallback reminder window: 24 hours before event start. No team default is set yet.'
            }
        },
        players: [
            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://img.example.test/player.png', position: 'Guard', isLinked: true },
            { id: 'player-2', name: 'Sam Wing', number: '12', photoUrl: null, position: 'Forward', isLinked: false }
        ],
        linkedPlayers: [
            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://img.example.test/player.png', position: 'Guard', isLinked: true }
        ],
        upcomingEvents: [
            { id: 'game-1', type: 'game', title: 'vs. Falcons', date: nextDate, location: 'Main Gym', opponent: 'Falcons', status: '', liveStatus: '', visibility: '', isPrivate: false, isPublic: false, shareable: true, publicCalendar: false, homeScore: null, awayScore: null, isCancelled: false }
        ],
        recentResults: [
            { id: 'game-final', type: 'game', title: 'vs. Wolves', date: new Date('2026-05-01T18:00:00Z'), location: 'Main Gym', opponent: 'Wolves', status: 'completed', liveStatus: '', visibility: '', isPrivate: false, isPublic: false, shareable: false, publicCalendar: false, homeScore: 42, awayScore: 35, isCancelled: false }
        ],
        nextEvent: { id: 'game-1', type: 'game', title: 'vs. Falcons', date: nextDate, location: 'Main Gym', opponent: 'Falcons', status: '', liveStatus: '', visibility: '', isPrivate: false, isPublic: false, shareable: true, publicCalendar: false, homeScore: null, awayScore: null, isCancelled: false },
        record: { label: '2100', wins: 4, losses: 2, ties: 1, gamesPlayed: 7, winPercentage: 64.3 },
        standings: {
            enabled: true,
            label: 'Points table',
            rows: [{ team: 'Bears', rank: 1, record: '4-2-1', pf: 180, pa: 150 }],
            currentRow: { team: 'Bears', rank: 1, record: '4-2-1', pf: 180, pa: 150 }
        },
        leaderboards: [{
            id: 'pts',
            label: 'Points',
            leaders: [{ playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', photoUrl: 'https://img.example.test/player.png', rank: 1, formattedValue: '88' }]
        }],
        trackingSummaries: [{
            playerId: 'player-1',
            playerName: 'Pat Star',
            photoUrl: 'https://img.example.test/player.png',
            items: [{ id: 'item-1', title: 'Bring ball', description: 'For warmups', isComplete: false }]
        }],
        sponsors: [{ id: 'sponsor-1', name: 'Pizza Place', description: 'After the game', imageUrl: 'https://img.example.test/pizza.png', websiteUrl: 'https://pizza.example.test' }],
        canManageTeam: false,
        staffPermissions: null,
        counts: { games: 8, practices: 3, completedGames: 7 }
    };
}

function coreModel() {
    return {
        ...model(),
        leaderboards: [],
        trackingSummaries: [],
        sponsors: []
    };
}

function deferredInsightsModel() {
    const fullModel = model();
    return {
        leaderboards: fullModel.leaderboards,
        trackingSummaries: fullModel.trackingSummaries
    };
}

function deferredSponsorsModel() {
    return {
        sponsors: model().sponsors
    };
}

async function renderTeamDetail(authOverride = auth) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: ['/teams/team-1'] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: '/teams/:teamId', element: React.createElement(TeamDetail, { auth: authOverride }) })
            )
        ));
    });

    await flush();
    return { container, root };
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function clickButton(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

async function clickButtonInCard(container, cardTitle, text) {
    const card = Array.from(container.querySelectorAll('section')).find((candidate) => candidate.textContent.includes(cardTitle));
    if (!card) throw new Error(`Card not found: ${cardTitle}`);
    const button = Array.from(card.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Button not found in ${cardTitle}: ${text}`);
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

async function clickLink(container, text) {
    const link = Array.from(container.querySelectorAll('a')).find((candidate) => candidate.textContent.includes(text));
    if (!link) throw new Error(`Link not found: ${text}`);
    await act(async () => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
}

async function changeSelect(container, label, value) {
    const select = Array.from(container.querySelectorAll('select')).find((candidate) => candidate.getAttribute('aria-label') === label);
    if (!select) throw new Error(`Select not found: ${label}`);
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
}

async function toggleCheckbox(container, text) {
    const label = Array.from(container.querySelectorAll('label')).find((candidate) => candidate.textContent.includes(text));
    const checkbox = label?.querySelector('input[type="checkbox"]');
    if (!checkbox) throw new Error(`Checkbox not found: ${text}`);
    await act(async () => {
        checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

function hrefs(container) {
    return Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'));
}

beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = (callback) => {
        callback(0);
        return 0;
    };
    publicActionMocks.copyPublicText.mockResolvedValue('copied');
    publicActionMocks.sharePublicUrl.mockResolvedValue('copied');
    parentToolsMocks.buildPrivateTeamCalendarFeedUrl.mockReturnValue('https://feed.example.test/private-team.ics?teamId=team-1&token=abc123');
    scheduleServiceMocks.loadPreview.mockResolvedValue({
        missingPlayerCount: 0,
        eligibleEmailCount: 0,
        eligibleEmails: [],
        players: []
    });
    scheduleServiceMocks.createStaffRsvpReminderPreviewLoader.mockReturnValue({
        loadPreview: scheduleServiceMocks.loadPreview
    });
    scheduleServiceMocks.sendStaffRsvpReminder.mockResolvedValue({
        missingPlayerCount: 0,
        eligibleEmailCount: 0,
        eligibleEmails: [],
        players: [],
        emailSentCount: 0
    });
    teamDetailMocks.loadTeamRosterParentInvites.mockResolvedValue([]);
    teamDetailMocks.createRosterParentInviteForApp.mockResolvedValue({ code: 'ABCD1234', inviteUrl: 'https://allplays.ai/app#/accept-invite?code=ABCD1234&type=parent', status: 'pending', existingUser: false, autoLinked: false, teamName: 'Bears', playerName: 'Pat Star' });
    teamDetailMocks.deactivateRosterPlayerForApp.mockResolvedValue(undefined);
    teamDetailMocks.reactivateRosterPlayerForApp.mockResolvedValue(undefined);
    teamDetailMocks.grantScorekeeperAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.revokeScorekeeperAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.grantVideographerAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.revokeVideographerAccessForApp.mockResolvedValue(undefined);
    teamDetailMocks.inviteTeamAdminForApp.mockResolvedValue({ status: 'sent', email: 'coach@example.com' });
    teamDetailMocks.saveTeamScheduleNotificationsForApp.mockResolvedValue({
        enabled: true,
        reminderHours: 24,
        delivery: 'team_chat',
        hasExplicitReminderHours: true,
        summary: 'Team default reminder window: 24 hours before event start.'
    });
    teamDetailMocks.loadTeamStaffPermissions.mockResolvedValue(null);
    teamDetailMocks.loadParentTeamDetail.mockResolvedValue(coreModel());
    teamDetailMocks.loadTeamDetailInsights.mockResolvedValue(deferredInsightsModel());
    teamDetailMocks.loadTeamDetailSponsors.mockResolvedValue(deferredSponsorsModel());
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('React app TeamDetail page', () => {
    it('builds scoreboard widget URL and iframe embed code', () => {
        expect(buildScoreboardWidgetUrl('team 1/blue', 'https://club.example.test/app/')).toBe('https://club.example.test/widget-scoreboard.html?teamId=team+1%2Fblue');
        expect(buildScoreboardWidgetEmbedCode({ id: 'team 1/blue', name: 'Bears & Wolves' }, 'https://club.example.test/app/')).toBe('<iframe src="https://club.example.test/widget-scoreboard.html?teamId=team+1%2Fblue" title="Bears &amp; Wolves live scoreboard" style="width: 100%; max-width: 720px; height: 480px; border: 0;" loading="lazy"></iframe>');
    });

    it('loads parent-facing team.html features with team and player photos', async () => {
        const { container } = await renderTeamDetail();

        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledWith('team-1', auth.user, { includeDeferredData: false });
        expect(container.textContent).toContain('Bears');
        expect(container.querySelector('img[src="https://img.example.test/team.png"]')).toBeTruthy();
        expect(container.textContent).toContain('Season record (2100)');
        expect(container.textContent).toContain('Parent actions');
        expect(container.textContent).toContain('Team Pass');
        expect(Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toContain('/schedule?teamId=team-1&filter=availability');

        await clickButton(container, 'Roster');
        expect(container.textContent).toContain('Pat Star');
        expect(container.textContent).toContain('Yours');
        expect(container.querySelector('img[src="https://img.example.test/player.png"]')).toBeTruthy();
        expect(Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toContain('/players/team-1/player-1');

        await clickButton(container, 'Insights');
        expect(teamDetailMocks.loadTeamDetailInsights).toHaveBeenCalledTimes(1);
        expect(teamDetailMocks.loadTeamDetailInsights).toHaveBeenCalledWith('team-1', auth.user);
        expect(container.textContent).toContain('Bring ball');
        expect(container.textContent).toContain('Points');
        expect(container.textContent).toContain('88');

        await clickButton(container, 'More');
        expect(teamDetailMocks.loadTeamDetailSponsors).toHaveBeenCalledTimes(1);
        expect(teamDetailMocks.loadTeamDetailSponsors).toHaveBeenCalledWith('team-1');
        expect(container.textContent).toContain('Website team page');
        expect(container.textContent).toContain('Media albums');
        expect(container.textContent).toContain('Watch stream');
        expect(container.textContent).toContain('League page');
        expect(container.textContent).toContain('Sports Connect');
        expect(container.textContent).toContain('Pizza Place');

        await clickLink(container, 'Watch stream');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://youtube.example.test/watch');
        await clickLink(container, 'Pizza Place');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://pizza.example.test');
    });

    it('renders private calendar sync separately from the public fan feed and wires copy/open actions', async () => {
        const fanModel = model();
        fanModel.team.id = 'team 1/blue';
        fanModel.team.name = 'Bears & Wolves';
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(fanModel);
        parentToolsMocks.buildPrivateTeamCalendarFeedUrl.mockReturnValue('https://feed.example.test/private-team.ics?teamId=team%201%2Fblue&token=abc123');

        const { container } = await renderTeamDetail();

        await clickButton(container, 'More');
        expect(container.textContent).toContain('Private calendar sync');
        expect(container.textContent).toContain('Fan Feed');
        expect(container.textContent).toContain('Open team schedule for one-time .ics export');

        await clickButtonInCard(container, 'Private calendar sync', 'Copy Link');
        expect(parentToolsMocks.buildPrivateTeamCalendarFeedUrl).toHaveBeenCalledWith('team 1/blue', expect.objectContaining({ id: 'team 1/blue' }));
        expect(publicActionMocks.copyPublicText).toHaveBeenCalledWith('https://feed.example.test/private-team.ics?teamId=team%201%2Fblue&token=abc123');
        expect(container.textContent).toContain('Private calendar link copied.');

        await clickButtonInCard(container, 'Private calendar sync', 'Apple Calendar');
        expect(parentToolsMocks.getAppleCalendarFeedUrl).toHaveBeenCalledWith('https://feed.example.test/private-team.ics?teamId=team%201%2Fblue&token=abc123');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('webcal://feed.example.test/private-team.ics?teamId=team%201%2Fblue&token=abc123');

        await clickButtonInCard(container, 'Private calendar sync', 'Google Calendar');
        expect(parentToolsMocks.getGoogleCalendarFeedUrl).toHaveBeenCalledWith('https://feed.example.test/private-team.ics?teamId=team%201%2Fblue&token=abc123');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://calendar.google.com/calendar/render?cid=https%3A%2F%2Ffeed.example.test%2Fprivate-team.ics%3FteamId%3Dteam%25201%252Fblue%26token%3Dabc123');
    });

    it('renders and shares the public fan feed when at least one game is public or shareable', async () => {
        const fanModel = model();
        fanModel.team.id = 'team 1/blue';
        fanModel.team.name = 'Bears & Wolves';
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(fanModel);

        const { container } = await renderTeamDetail();

        await clickButton(container, 'More');
        expect(container.textContent).toContain('Fan Feed');
        expect(container.textContent).toContain('public games-only calendar link for fans');

        await clickButton(container, 'Copy or Share Fan Feed');
        expect(publicActionMocks.sharePublicUrl).toHaveBeenCalledWith({
            title: 'Bears & Wolves fan feed',
            text: 'Bears & Wolves public games calendar feed',
            url: 'https://us-central1-all-plays-prod.cloudfunctions.net/publicTeamGamesIcs?teamId=team%201%2Fblue',
            clipboardText: 'https://us-central1-all-plays-prod.cloudfunctions.net/publicTeamGamesIcs?teamId=team%201%2Fblue'
        });
        expect(container.textContent).toContain('Fan feed link copied.');

        const hiddenModel = model();
        hiddenModel.team.isPublic = false;
        hiddenModel.upcomingEvents = [
            { id: 'private-game', type: 'game', title: 'vs. Tigers', date: new Date('2100-06-03T18:00:00Z'), location: 'Gym', opponent: 'Tigers', status: '', liveStatus: '', visibility: 'private', isPrivate: true, isPublic: false, shareable: false, publicCalendar: false, homeScore: null, awayScore: null, isCancelled: false },
            { id: 'practice-1', type: 'practice', title: 'Practice', date: new Date('2100-06-04T18:00:00Z'), location: 'Gym', opponent: '', status: '', liveStatus: '', visibility: '', isPrivate: false, isPublic: true, shareable: false, publicCalendar: false, homeScore: null, awayScore: null, isCancelled: false }
        ];
        hiddenModel.recentResults = [];
        hiddenModel.nextEvent = hiddenModel.upcomingEvents[0];
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(hiddenModel);
        const hidden = await renderTeamDetail();
        await clickButton(hidden.container, 'More');
        expect(hidden.container.textContent).not.toContain('Fan Feed');
    });

    it('shows a private calendar sync error and hides sync actions without a signed-in user', async () => {
        parentToolsMocks.buildPrivateTeamCalendarFeedUrl.mockImplementationOnce(() => { throw new Error('Unable to create private calendar feed. Sign in again and retry.'); });
        const { container } = await renderTeamDetail();

        await clickButton(container, 'More');
        await clickButtonInCard(container, 'Private calendar sync', 'Copy Link');
        expect(container.textContent).toContain('Unable to create private calendar feed. Sign in again and retry.');

        const signedOut = await renderTeamDetail({
            ...auth,
            user: null,
            roles: [],
            isParent: false
        });
        await clickButton(signedOut.container, 'More');
        expect(signedOut.container.textContent).not.toContain('Private calendar sync');
    });

    it('renders scoreboard widget copy tools only for managers', async () => {
        const managerModel = model();
        managerModel.canManageTeam = true;
        managerModel.team.id = 'team 1/blue';
        managerModel.team.name = 'Bears & Wolves';
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(managerModel);

        const { container } = await renderTeamDetail();

        await clickButton(container, 'More');
        expect(container.textContent).toContain('Scoreboard widget');
        const expectedUrl = 'http://localhost:3000/widget-scoreboard.html?teamId=team+1%2Fblue';
        const expectedEmbed = '<iframe src="http://localhost:3000/widget-scoreboard.html?teamId=team+1%2Fblue" title="Bears &amp; Wolves live scoreboard" style="width: 100%; max-width: 720px; height: 480px; border: 0;" loading="lazy"></iframe>';
        expect(container.querySelector('#scoreboard-widget-embed').value).toBe(expectedEmbed);

        await clickButton(container, 'Copy Embed Code');
        expect(publicActionMocks.copyPublicText).toHaveBeenCalledWith(expectedEmbed);
        expect(container.textContent).toContain('Embed code copied.');

        await clickButtonInCard(container, 'Scoreboard widget', 'Copy Link');
        expect(publicActionMocks.copyPublicText).toHaveBeenLastCalledWith(expectedUrl);
        expect(container.textContent).toContain('Widget link copied.');

        const parentModel = model();
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(parentModel);
        const hidden = await renderTeamDetail();
        await clickButton(hidden.container, 'More');
        expect(hidden.container.textContent).not.toContain('Scoreboard widget');
    });

    it('lets team managers load and save reminder timing defaults from the More tab', async () => {
        const managerModel = model();
        managerModel.canManageTeam = true;
        managerModel.team.scheduleNotifications = {
            enabled: false,
            reminderHours: 72,
            delivery: 'team_chat',
            hasExplicitReminderHours: true,
            summary: 'Team default reminder window: 72 hours before event start.'
        };
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(managerModel).mockResolvedValueOnce({
            ...managerModel,
            team: {
                ...managerModel.team,
                scheduleNotifications: {
                    enabled: true,
                    reminderHours: 48,
                    delivery: 'team_chat',
                    hasExplicitReminderHours: true,
                    summary: 'Team default reminder window: 48 hours before event start.'
                }
            }
        });

        const { container } = await renderTeamDetail();
        await clickButton(container, 'More');

        expect(container.textContent).toContain('Reminder timing defaults');
        expect(container.textContent).toContain('Team default reminder window: 72 hours before event start.');
        expect(container.querySelector('select').value).toBe('72');
        expect(container.querySelector('input[type="checkbox"]').checked).toBe(false);

        await toggleCheckbox(container, 'Enable team-wide pre-event reminders');
        await changeSelect(container, 'Reminder window', '48');
        await clickButton(container, 'Save Timing Defaults');

        expect(teamDetailMocks.saveTeamScheduleNotificationsForApp).toHaveBeenCalledWith('team-1', {
            enabled: true,
            reminderHours: 48,
            delivery: 'team_chat'
        });
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Reminder timing defaults saved.');
        expect(container.textContent).toContain('Team default reminder window: 48 hours before event start.');

        const parentModel = model();
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(parentModel);
        const hidden = await renderTeamDetail();
        await clickButton(hidden.container, 'More');
        expect(hidden.container.textContent).not.toContain('Reminder timing defaults');
    });

    it('renders overview content before deferred staff permissions resolve and keeps More lazy', async () => {
        const managerModel = model();
        managerModel.canManageTeam = true;
        managerModel.staffPermissions = null;
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(managerModel);
        let resolveStaffPermissions;
        teamDetailMocks.loadTeamStaffPermissions.mockImplementationOnce(() => new Promise((resolve) => {
            resolveStaffPermissions = resolve;
        }));

        const { container } = await renderTeamDetail({
            ...auth,
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
            roles: ['coach'],
            isParent: false,
            isCoach: true
        });

        expect(container.textContent).toContain('Bears');
        expect(container.textContent).toContain('Season record (2100)');
        expect(teamDetailMocks.loadTeamStaffPermissions).not.toHaveBeenCalled();
        expect(teamDetailMocks.loadTeamDetailSponsors).not.toHaveBeenCalled();

        await clickButton(container, 'More');

        expect(teamDetailMocks.loadTeamStaffPermissions).toHaveBeenCalledTimes(1);
        expect(teamDetailMocks.loadTeamStaffPermissions).toHaveBeenCalledWith('team-1', expect.objectContaining({ uid: 'coach-1' }));
        expect(teamDetailMocks.loadTeamDetailSponsors).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Loading team staff permissions');
        expect(container.textContent).not.toContain('Team Staff & Permissions');

        await act(async () => {
            resolveStaffPermissions({
                staff: [{ label: 'coach@example.com', role: 'Admin' }],
                pendingInvites: ['pending@example.com'],
                helperPermissions: [],
                scorekeepingMode: '',
                scorekeeperGrantTargets: [],
                videographerGrantTargets: [],
                hasAnyStaff: true
            });
        });
        await flush();

        expect(container.textContent).not.toContain('Loading team staff permissions');
        expect(container.textContent).toContain('Team Staff & Permissions');
        expect(container.textContent).toContain('coach@example.com · Admin');
    });

    it('loads deferred insights and sponsors once, then reuses them across tab switches', async () => {
        const { container } = await renderTeamDetail();

        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(1);
        expect(teamDetailMocks.loadTeamDetailInsights).not.toHaveBeenCalled();
        expect(teamDetailMocks.loadTeamDetailSponsors).not.toHaveBeenCalled();

        await clickButton(container, 'Insights');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(1);
        expect(teamDetailMocks.loadTeamDetailInsights).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Bring ball');

        await clickButton(container, 'Overview');
        await clickButton(container, 'Insights');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(1);
        expect(teamDetailMocks.loadTeamDetailInsights).toHaveBeenCalledTimes(1);

        await clickButton(container, 'More');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(1);
        expect(teamDetailMocks.loadTeamDetailSponsors).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Pizza Place');

        await clickButton(container, 'Schedule');
        await clickButton(container, 'More');
        expect(teamDetailMocks.loadParentTeamDetail).toHaveBeenCalledTimes(1);
        expect(teamDetailMocks.loadTeamDetailSponsors).toHaveBeenCalledTimes(1);
    });

    it('applies deferred insights and sponsors after async loads resolve', async () => {
        let resolveInsights;
        let resolveSponsors;
        teamDetailMocks.loadTeamDetailInsights.mockImplementationOnce(() => new Promise((resolve) => {
            resolveInsights = resolve;
        }));
        teamDetailMocks.loadTeamDetailSponsors.mockImplementationOnce(() => new Promise((resolve) => {
            resolveSponsors = resolve;
        }));

        const { container } = await renderTeamDetail();

        await clickButton(container, 'Insights');
        expect(container.textContent).toContain('Loading player tracking…');

        await act(async () => {
            resolveInsights(deferredInsightsModel());
        });
        await flush();

        expect(container.textContent).toContain('Bring ball');
        expect(container.textContent).not.toContain('Loading player tracking…');

        await clickButton(container, 'More');
        expect(container.textContent).toContain('Loading local attractions and sponsors…');

        await act(async () => {
            resolveSponsors(deferredSponsorsModel());
        });
        await flush();

        expect(container.textContent).toContain('Pizza Place');
        expect(container.textContent).not.toContain('Loading local attractions and sponsors…');
    });

    it('keeps the page usable when deferred Insights or More hydration fails', async () => {
        teamDetailMocks.loadTeamDetailInsights.mockRejectedValueOnce(new Error('Insights offline'));
        teamDetailMocks.loadTeamDetailSponsors.mockRejectedValueOnce(new Error('Sponsors offline'));

        const { container } = await renderTeamDetail();

        expect(container.textContent).toContain('Season record (2100)');

        await clickButton(container, 'Insights');
        expect(container.textContent).toContain('Player checklist unavailable');
        expect(container.textContent).toContain('Insights offline');
        expect(container.textContent).toContain('Leaderboards unavailable');

        await clickButton(container, 'Overview');
        expect(container.textContent).toContain('Season record (2100)');

        await clickButton(container, 'More');
        expect(container.textContent).toContain('Sponsors unavailable');
        expect(container.textContent).toContain('Sponsors offline');
        expect(container.textContent).toContain('Website team page');
    });

    it('exposes schedule, parent action links, and recent scores', async () => {
        const { container } = await renderTeamDetail();

        expect(hrefs(container)).toContain('/schedule?teamId=team-1&filter=availability');
        expect(hrefs(container)).toContain('/schedule?teamId=team-1');
        expect(hrefs(container)).toContain('/messages/team-1');
        await clickButton(container, 'Open website team page');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/team.html#teamId=team-1');

        await clickButton(container, 'Schedule');
        expect(container.textContent).toContain('vs. Falcons');
        expect(container.textContent).toContain('vs. Wolves');
        expect(container.textContent).toContain('42-35');
        expect(hrefs(container)).toContain('/schedule/team-1/game-1');
        expect(hrefs(container)).toContain('/schedule/team-1/game-final');
    });

    it('loads RSVP reminder previews only when a manager opens a specific schedule row action', async () => {
        const managerAuth = {
            ...auth,
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
            roles: ['coach'],
            isParent: false,
            isCoach: true
        };
        const managerModel = model();
        managerModel.canManageTeam = true;
        managerModel.upcomingEvents = [
            managerModel.upcomingEvents[0],
            { id: 'game-2', type: 'game', title: 'at Tigers', date: new Date('2100-06-03T18:00:00Z'), location: 'North Gym', opponent: 'Tigers', status: '', liveStatus: '', visibility: '', isPrivate: false, isPublic: false, shareable: true, publicCalendar: false, homeScore: null, awayScore: null, isCancelled: false }
        ];
        managerModel.nextEvent = managerModel.upcomingEvents[0];
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(managerModel);
        scheduleServiceMocks.loadPreview.mockResolvedValueOnce({
            missingPlayerCount: 3,
            eligibleEmailCount: 4,
            eligibleEmails: ['one@example.test', 'two@example.test', 'three@example.test', 'four@example.test'],
            players: []
        });
        scheduleServiceMocks.sendStaffRsvpReminder.mockResolvedValueOnce({
            missingPlayerCount: 3,
            eligibleEmailCount: 4,
            eligibleEmails: [],
            players: [],
            emailSentCount: 4
        });
        window.confirm = vi.fn(() => true);

        const { container } = await renderTeamDetail(managerAuth);
        await clickButton(container, 'Schedule');
        await flush();

        expect(scheduleServiceMocks.loadPreview).not.toHaveBeenCalled();
        expect(Array.from(container.querySelectorAll('button')).filter((candidate) => candidate.textContent.includes('Review reminder')).length).toBe(2);

        await clickButton(container, 'Review reminder');

        expect(container.textContent).toContain('Staff RSVP reminder');
        expect(container.textContent).toContain('3 no-response players');
        expect(container.textContent).toContain('Send reminder (3)');
        expect(scheduleServiceMocks.loadPreview).toHaveBeenCalledTimes(1);
        expect(scheduleServiceMocks.loadPreview).toHaveBeenCalledWith(expect.objectContaining({
            id: 'game-1',
            teamId: 'team-1',
            type: 'game',
            isDbGame: true,
            isTeamRsvpReminderManager: true
        }), managerAuth.user);

        await clickButton(container, 'Send reminder');

        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('3 no-response players'));
        expect(scheduleServiceMocks.sendStaffRsvpReminder).toHaveBeenCalledTimes(1);
        expect(scheduleServiceMocks.sendStaffRsvpReminder).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1', teamId: 'team-1' }), managerAuth.user, managerAuth.profile);
        expect(container.textContent).toContain('RSVP reminder sent to team chat and 4 parent/guardian emails.');
    });

    it('hides inline RSVP reminders for parents and events with no missing players', async () => {
        const parentModel = model();
        parentModel.canManageTeam = false;
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(parentModel);

        const { container } = await renderTeamDetail();
        await clickButton(container, 'Schedule');
        await flush();

        expect(container.textContent).not.toContain('Staff RSVP reminder');
        expect(scheduleServiceMocks.loadPreview).not.toHaveBeenCalled();
    });

    it('renders empty tab states without trapping users in a spinner', async () => {
        const emptyModel = model();
        emptyModel.team.photoUrl = null;
        emptyModel.team.description = '';
        emptyModel.team.streamUrl = null;
        emptyModel.team.leagueUrl = null;
        emptyModel.team.registrationProvider = [];
        emptyModel.players = [];
        emptyModel.linkedPlayers = [];
        emptyModel.upcomingEvents = [];
        emptyModel.recentResults = [];
        emptyModel.nextEvent = null;
        emptyModel.record = { label: '2100', wins: 0, losses: 0, ties: 0, gamesPlayed: 0, winPercentage: null };
        emptyModel.standings = { enabled: false, label: 'No standings configured', rows: [], currentRow: null };
        emptyModel.leaderboards = [];
        emptyModel.trackingSummaries = [];
        emptyModel.sponsors = [];
        emptyModel.counts = { games: 0, practices: 0, completedGames: 0 };
        teamDetailMocks.loadParentTeamDetail.mockResolvedValueOnce(emptyModel);
        teamDetailMocks.loadTeamDetailInsights.mockResolvedValueOnce({ leaderboards: [], trackingSummaries: [] });
        teamDetailMocks.loadTeamDetailSponsors.mockResolvedValueOnce({ sponsors: [] });

        const { container } = await renderTeamDetail();
        expect(container.textContent).toContain('No completed games yet');
        expect(container.textContent).toContain('Schedule is clear for now');

        await clickButton(container, 'Schedule');
        expect(container.textContent).toContain('No team events found.');
        await clickButton(container, 'Roster');
        expect(container.textContent).toContain('No active players right now.');
        await clickButton(container, 'Insights');
        expect(container.textContent).toContain('No parent-visible tracking items for your players yet.');
        expect(container.textContent).toContain('Leaderboards appear after public stat configs and completed tracked games exist.');
        await clickButton(container, 'More');
        expect(container.textContent).toContain('Team links');
        expect(container.textContent).not.toContain('Registration provider');
        expect(container.textContent).not.toContain('Local attractions and sponsors');
        expect(container.textContent).not.toContain('Loading team');
    });

    it('shows the team unavailable state with a route back to teams', async () => {
        teamDetailMocks.loadParentTeamDetail.mockRejectedValueOnce(new Error('No team access'));
        const { container } = await renderTeamDetail();

        expect(container.textContent).toContain('Team unavailable');
        expect(container.textContent).toContain('No team access');
        expect(hrefs(container)).toContain('/teams');
        expect(container.textContent).not.toContain('Loading team');
    });
});
