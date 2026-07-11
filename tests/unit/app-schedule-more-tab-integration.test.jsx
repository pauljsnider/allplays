// @vitest-environment jsdom
import React, { act } from 'react';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const scheduleMocks = vi.hoisted(() => ({
    cancelParentScheduleRideRequest: vi.fn(),
    claimParentScheduleAssignmentSlot: vi.fn(),
    createParentScheduleRideOffer: vi.fn(),
    loadScheduleStatTrackerConfigsForApp: vi.fn(),
    loadParentPracticePacket: vi.fn(),
    loadStaffPracticePacket: vi.fn(),
    loadParentSchedule: vi.fn(),
    loadParentScheduleEventDetail: vi.fn(),
    resolveCachedParentScheduleEvents: vi.fn(() => []),
    loadParentScheduleAssignments: vi.fn().mockResolvedValue([]),
    loadParentScheduleRideOffers: vi.fn().mockResolvedValue([]),
    loadStaffScheduleRsvpBreakdown: vi.fn(),
    loadStaffRsvpReminderPreview: vi.fn(),
    invalidateStaffRsvpAvailabilityEvent: vi.fn(),
    createStaffRsvpAvailabilityLoader: vi.fn(() => ({
        loadBreakdown: (...args) => scheduleMocks.loadStaffScheduleRsvpBreakdown(...args),
        loadReminderPreview: (...args) => scheduleMocks.loadStaffRsvpReminderPreview(...args),
        invalidateEvent: (...args) => scheduleMocks.invalidateStaffRsvpAvailabilityEvent(...args)
    })),
    loadHomeScoringPlayers: vi.fn().mockResolvedValue([]),
    loadAutoFilledLineupDraftPreviewForApp: vi.fn(),
    loadGameDayLiveEventsForApp: vi.fn().mockResolvedValue([]),
    buildLiveGameClockPeriods: vi.fn((game) => {
        const activePeriod = String(game?.liveClockPeriod || game?.period || '').trim();
        return activePeriod ? [activePeriod] : ['H1', 'H2'];
    }),
    LINEUP_FORMATIONS: {
        'basketball-5v5': {
            id: 'basketball-5v5',
            name: 'Basketball 5v5',
            numPeriods: 4,
            positions: [
                { id: 'pg', name: 'Point Guard' },
                { id: 'sg', name: 'Shooting Guard' }
            ]
        }
    },
    createStaffRsvpAvailabilityLoader: vi.fn(() => ({
        loadBreakdown: vi.fn().mockResolvedValue({
            grouped: {
                going: [],
                maybe: [],
                not_going: [],
                not_responded: []
            },
            counts: {
                going: 0,
                maybe: 0,
                notGoing: 0,
                notResponded: 0,
                total: 0
            }
        }),
        loadReminderPreview: vi.fn().mockResolvedValue({
            totalPlayers: 0,
            respondedCount: 0,
            missingCount: 0,
            missingPlayers: [],
            reminderMessage: '',
            targetLabel: 'staff'
        }),
        invalidateEvent: vi.fn()
    })),
    resolveLiveGameClockSnapshot: vi.fn((game, now = new Date()) => ({
        persistedClockMs: Number(game?.liveClockMs ?? game?.gameClockMs ?? 0) || 0,
        effectiveClockMs: Number(game?.liveClockMs ?? game?.gameClockMs ?? 0) || 0,
        running: game?.liveClockRunning === true,
        period: String(game?.liveClockPeriod || game?.period || 'H1'),
        updatedAt: game?.liveClockUpdatedAt || game?.clockUpdatedAt || now
    })),
    markParentPracticePacketComplete: vi.fn(),
    publishGamePlanForApp: vi.fn(),
    releaseParentScheduleAssignmentClaim: vi.fn(),
    requestParentScheduleRideSpot: vi.fn(),
    setParentScheduleRideOfferStatus: vi.fn(),
    submitParentScheduleRsvp: vi.fn(),
    summarizeParentScheduleRideOffers: vi.fn(() => ({
        offerCount: 0,
        seatsLeft: 0,
        requests: 0,
        pending: 0,
        confirmed: 0,
        isFull: false
    })),
    publishLiveScoreUpdateEvent: vi.fn(),
    recordPlayerGameStat: vi.fn(),
    recordPlayerScoringStat: vi.fn(),
    resolveCachedParentScheduleEvents: vi.fn(() => []),
    saveScheduledGameLineupDraftForApp: vi.fn(),
    saveGameDaySubstitutionForApp: vi.fn(),
    saveStaffPracticePacket: vi.fn(),
    completeGameWrapupForApp: vi.fn(),
    getLineupPublishStatus: vi.fn((gamePlan) => {
        const lineups = gamePlan?.lineups && typeof gamePlan.lineups === 'object' ? gamePlan.lineups : {};
        const publishedLineups = gamePlan?.publishedLineups && typeof gamePlan.publishedLineups === 'object' ? gamePlan.publishedLineups : {};
        const lineupKeys = Object.keys(lineups).filter((key) => String(lineups[key] || '').trim());
        const publishedVersion = Number.parseInt(gamePlan?.publishedVersion, 10) || 0;
        if (!lineupKeys.length) return 'No lineup draft is available yet.';
        if (!publishedVersion) return 'Draft lineup has not been published.';
        const changedAssignments = Array.from(new Set([...lineupKeys, ...Object.keys(publishedLineups)])).filter((key) => (
            String(lineups[key] || '').trim() !== String(publishedLineups[key] || '').trim()
        )).length;
        if (changedAssignments > 0) {
            return `Published v${publishedVersion}. ${changedAssignments} draft assignment${changedAssignments === 1 ? '' : 's'} unpublished.`;
        }
        return `Published v${publishedVersion}. Current draft matches the published lineup.`;
    }),
    hasLineupDraft: vi.fn((gamePlan) => Boolean(gamePlan?.lineups && Object.values(gamePlan.lineups).some((value) => String(value || '').trim()))),
    undoRecordedPlayerGameStat: vi.fn(),
    updateLiveGameClockState: vi.fn(),
    updateGameScore: vi.fn(),
    updateScheduledGameForApp: vi.fn(),
    updateParentScheduleRideRequestStatus: vi.fn()
}));

const reportMocks = vi.hoisted(() => ({
    loadGameReportPlays: vi.fn(),
    loadGameReportSections: vi.fn()
}));

const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn(),
    sharePublicUrl: vi.fn()
}));

vi.mock('@capacitor-firebase/performance', () => ({
    FirebasePerformance: {
        startTrace: vi.fn().mockResolvedValue(undefined),
        stopTrace: vi.fn().mockResolvedValue(undefined),
        putAttribute: vi.fn().mockResolvedValue(undefined),
        putMetric: vi.fn().mockResolvedValue(undefined),
        record: vi.fn().mockResolvedValue(undefined)
    }
}));
vi.mock('../../apps/app/src/lib/performanceInstrumentation.ts', () => ({
    now: vi.fn(() => 0),
    startPerformanceSpan: vi.fn(() => ({ startedAt: 0, end: vi.fn() })),
    recordCompletedPerformanceSpan: vi.fn()
}));
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);
vi.mock('../../apps/app/src/lib/gameReportService.ts', () => reportMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);

import { ScheduleEventDetail, getAvailabilityNoteSaveState, parseEventDetailSection, setScheduleGameDayServiceImporterForTest } from '../../apps/app/src/pages/ScheduleEventDetail.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots = [];

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent'
    }
};

function event(overrides = {}) {
    return {
        eventKey: overrides.eventKey || `${overrides.teamId || 'team-1'}::${overrides.id || 'game-1'}::${overrides.childId || 'player-1'}`,
        id: overrides.id || 'game-1',
        teamId: overrides.teamId || 'team-1',
        teamName: overrides.teamName || 'Bears',
        type: overrides.type || 'game',
        date: overrides.date || new Date('2026-05-21T18:00:00Z'),
        location: overrides.location || 'Main Gym',
        opponent: overrides.opponent || 'Falcons',
        title: overrides.title || null,
        childId: overrides.childId || 'player-1',
        childName: overrides.childName || 'Pat',
        isLinkedParentChild: overrides.isLinkedParentChild !== false,
        isDbGame: overrides.isDbGame !== false,
        isCancelled: overrides.isCancelled === true,
        myRsvp: overrides.myRsvp || 'not_responded',
        rsvpSummary: overrides.rsvpSummary || null,
        rideshareSummary: overrides.rideshareSummary || null,
        assignments: overrides.assignments || [],
        ...overrides
    };
}

function report(overrides = {}) {
    return {
        team: { id: 'team-1', name: 'Bears' },
        game: { id: 'game-1', status: 'completed', liveStatus: 'completed', homeScore: 4, awayScore: 2 },
        summary: 'Bears finished strong.',
        statKeys: [],
        statLabels: {},
        playerRows: [],
        visiblePlayerRows: [],
        deferredPlayerRows: [],
        hasPlayingTime: false,
        plays: [],
        opponentRows: [],
        opponentStatKeys: [],
        opponentStatLabels: {},
        teamStatKeys: [],
        teamStatLabels: {},
        teamStats: {},
        statSheetPhotoUrl: '',
        highlightClips: [],
        teamInsights: [],
        playerInsightRows: [],
        emptyInsightsMessage: 'No insights yet.',
        ...overrides
    };
}

function LocationProbe() {
    const location = useLocation();
    return React.createElement('div', { 'data-testid': 'location' }, `${location.pathname}${location.search}`);
}

async function renderDetail(initialEntry) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: [initialEntry] },
            React.createElement(React.Fragment, null,
                React.createElement(LocationProbe),
                React.createElement(
                    Routes,
                    null,
                    React.createElement(Route, {
                        path: '/schedule/:teamId/:eventId',
                        element: React.createElement(ScheduleEventDetail, { auth })
                    })
                )
            )
        ));
    });

    mountedRoots.push({ container, root });

    return { container, root };
}

async function waitForText(container, text, attempts = 500) {
    for (let index = 0; index < attempts; index += 1) {
        if (container.textContent.includes(text)) return;
        await act(async () => {
            if (vi.isFakeTimers()) {
                await vi.advanceTimersByTimeAsync(1);
                await Promise.resolve();
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
    throw new Error(`Timed out waiting for text: ${text}`);
}

async function waitForMockCall(mock, label) {
    for (let index = 0; index < 100; index += 1) {
        if (mock.mock.calls.length > 0) return;
        await act(async () => {
            if (vi.isFakeTimers()) {
                await vi.advanceTimersByTimeAsync(1);
                await Promise.resolve();
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
    throw new Error(`Timed out waiting for mock call: ${label}`);
}

function buttonByText(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => (
        candidate.textContent.trim() === text || candidate.getAttribute('aria-label') === text
    ));
    if (!button) throw new Error(`Button not found: ${text}`);
    return button;
}

function queryButtonByText(container, text) {
    return Array.from(container.querySelectorAll('button')).find((candidate) => (
        candidate.textContent.trim() === text || candidate.getAttribute('aria-label') === text
    )) || null;
}

async function clickButton(container, text) {
    await act(async () => {
        buttonByText(container, text).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    setScheduleGameDayServiceImporterForTest(() => Promise.resolve(scheduleMocks));
    scheduleMocks.resolveCachedParentScheduleEvents.mockReturnValue([]);
    scheduleMocks.loadParentSchedule.mockResolvedValue({ events: [] });
    scheduleMocks.loadParentScheduleEventDetail.mockImplementation(async () => scheduleMocks.loadParentSchedule());
    scheduleMocks.loadScheduleStatTrackerConfigsForApp.mockResolvedValue([{ id: 'cfg-basketball', name: 'Basketball' }]);
    scheduleMocks.loadParentPracticePacket.mockResolvedValue(null);
    scheduleMocks.loadStaffPracticePacket.mockResolvedValue({
        sessionId: 'session-1',
        teamId: 'team-1',
        eventId: 'practice-1',
        title: 'Practice',
        date: new Date('2026-05-25T08:00:00Z'),
        location: 'Main Gym',
        packetTitle: 'Practice home packet',
        dueDate: null,
        totalMinutes: 0,
        homePacket: { blocks: [], totalMinutes: 0 },
        completions: [],
        children: [{ id: 'player-1', name: 'Pat' }]
    });
    scheduleMocks.publishGamePlanForApp.mockResolvedValue({ gamePlan: {}, notificationError: null });
    scheduleMocks.loadAutoFilledLineupDraftPreviewForApp.mockResolvedValue({
        formationId: 'basketball-5v5',
        formationName: 'Basketball 5v5',
        numPeriods: 4,
        positions: [
            { id: 'pg', name: 'Point Guard', playerId: 'p1', playerName: 'Avery', playerNumber: '1' },
            { id: 'sg', name: 'Shooting Guard', playerId: 'p2', playerName: 'Blake', playerNumber: '2' }
        ],
        goingPlayers: [
            { id: 'p1', name: 'Avery', number: '1' },
            { id: 'p2', name: 'Blake', number: '2' }
        ],
        gamePlan: {
            formationId: 'basketball-5v5',
            numPeriods: 4,
            lineups: { 'Q1-pg': 'p1', 'Q1-sg': 'p2' }
        }
    });
    scheduleMocks.saveScheduledGameLineupDraftForApp.mockResolvedValue({
        formationId: 'basketball-5v5',
        formationName: 'Basketball 5v5',
        numPeriods: 4,
        positions: [
            { id: 'pg', name: 'Point Guard', playerId: 'p1', playerName: 'Avery', playerNumber: '1' },
            { id: 'sg', name: 'Shooting Guard', playerId: 'p2', playerName: 'Blake', playerNumber: '2' }
        ],
        goingPlayers: [
            { id: 'p1', name: 'Avery', number: '1' },
            { id: 'p2', name: 'Blake', number: '2' }
        ],
        gamePlan: {
            formationId: 'basketball-5v5',
            numPeriods: 4,
            lineups: { 'Q1-pg': 'p1', 'Q1-sg': 'p2' }
        }
    });
    scheduleMocks.saveStaffPracticePacket.mockResolvedValue({
        sessionId: 'session-1',
        teamId: 'team-1',
        eventId: 'practice-1',
        title: 'Practice',
        date: new Date('2026-05-25T08:00:00Z'),
        location: 'Main Gym',
        packetTitle: 'Practice home packet',
        dueDate: null,
        totalMinutes: 10,
        homePacket: { blocks: [{ drillTitle: 'Home Drill 1', duration: 10 }], totalMinutes: 10 },
        completions: [],
        children: [{ id: 'player-1', name: 'Pat' }]
    });
    scheduleMocks.updateGameScore.mockResolvedValue({ homeScore: 5, awayScore: 2, scoreUpdatedAt: new Date('2026-05-25T08:00:00Z'), scoreUpdatedBy: 'user-1' });
    scheduleMocks.updateScheduledGameForApp.mockResolvedValue({ updated: true, eventId: 'game-1' });
    scheduleMocks.publishLiveScoreUpdateEvent.mockResolvedValue({ type: 'score_update', homeScore: 5, awayScore: 2 });
    scheduleMocks.markParentPracticePacketComplete.mockResolvedValue({
        id: 'user-1__player-1',
        parentUserId: 'user-1',
        parentName: 'Pat Parent',
        childId: 'player-1',
        childName: 'Pat',
        status: 'completed'
    });
    reportMocks.loadGameReportSections.mockResolvedValue(report());
    publicActionMocks.sharePublicUrl.mockResolvedValue('shared');
    publicActionMocks.openPublicUrl.mockResolvedValue(undefined);
    window.requestAnimationFrame = (callback) => {
        callback(0);
        return 0;
    };
    window.scrollTo = vi.fn();
});

afterEach(async () => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        await act(async () => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
    setScheduleGameDayServiceImporterForTest();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('React app ScheduleEventDetail More tab integration', () => {
    it('parses only supported event detail sections and falls back to availability', () => {
        expect(parseEventDetailSection('game')).toBe('game');
        expect(parseEventDetailSection('rideshare')).toBe('rideshare');
        expect(parseEventDetailSection('assignments')).toBe('assignments');
        expect(parseEventDetailSection('invalid')).toBe('availability');
        expect(parseEventDetailSection(null)).toBe('availability');
    });

    it('enables Save note only for dirty notes on existing RSVPs', () => {
        expect(getAvailabilityNoteSaveState('going', 'Running late', 'Original note')).toMatchObject({
            isDirty: true,
            canSaveNote: true
        });
        expect(getAvailabilityNoteSaveState('going', 'Original note', 'Original note')).toMatchObject({
            isDirty: false,
            canSaveNote: false
        });
        expect(getAvailabilityNoteSaveState('not_responded', 'Need a ride', '')).toMatchObject({
            isDirty: true,
            canSaveNote: false
        });
    });

    it('saves an edited RSVP note without reselecting the current response', async () => {
        scheduleMocks.loadParentScheduleEventDetail.mockResolvedValue({
            events: [event({ myRsvp: 'going', myRsvpNote: 'Original note' })]
        });
        scheduleMocks.submitParentScheduleRsvp.mockResolvedValue({ going: 1, maybe: 0, notGoing: 0, notResponded: 0 });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'Is Pat going?');

        const noteInput = container.querySelector('textarea[aria-label="Availability note"]');
        await act(async () => {
            const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setValue.call(noteInput, 'Running late from pickup');
            noteInput.dispatchEvent(new Event('input', { bubbles: true }));
        });

        await waitForText(container, 'Unsaved note changes');
        expect(buttonByText(container, 'Save note')).not.toBeNull();

        await clickButton(container, 'Save note');

        expect(scheduleMocks.submitParentScheduleRsvp).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'game-1', childId: 'player-1' }),
            auth.user,
            'going',
            'Running late from pickup'
        );
        await waitForText(container, 'Pat availability note saved.');
        await waitForText(container, 'Availability saved');
        expect(container.querySelector('textarea[aria-label="Availability note"]')?.value).toBe('Running late from pickup');
    });

    it('renders the practice More tab with text-only sharing wired to the primary top card', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [
                event({
                    id: 'practice-1',
                    type: 'practice',
                    title: 'Practice',
                    location: 'North Field',
                    practiceSessionId: 'session-1',
                    practiceHomePacket: {
                        totalMinutes: 20,
                        blocks: [
                            { type: 'Drill', duration: 10, drillTitle: 'Ball Mastery', description: 'Touches at home.' },
                            { type: 'Drill', duration: 10, drillTitle: 'Passing Wall', description: 'Two-touch passing.' }
                        ]
                    },
                    practiceHomePacketSummary: '2 drills · 20 min',
                    notes: 'Bring water'
                })
            ]
        });
        scheduleMocks.loadParentScheduleEventDetail.mockResolvedValue({
            events: [
                event({
                    id: 'practice-1',
                    type: 'practice',
                    title: 'Practice',
                    location: 'North Field',
                    practiceSessionId: 'session-1',
                    practiceHomePacket: {
                        totalMinutes: 20,
                        blocks: [
                            { type: 'Drill', duration: 10, drillTitle: 'Ball Mastery', description: 'Touches at home.' },
                            { type: 'Drill', duration: 10, drillTitle: 'Passing Wall', description: 'Two-touch passing.' }
                        ]
                    },
                    practiceHomePacketSummary: '2 drills · 20 min',
                    notes: 'Bring water'
                })
            ]
        });
        scheduleMocks.loadParentPracticePacket.mockResolvedValue({
            sessionId: 'session-1',
            teamId: 'team-1',
            eventId: 'practice-1',
            title: 'Practice',
            date: new Date('2026-05-21T18:00:00Z'),
            location: 'North Field',
            homePacket: {
                totalMinutes: 20,
                blocks: [
                    { type: 'Drill', duration: 10, drillTitle: 'Ball Mastery', description: 'Touches at home.' },
                    { type: 'Drill', duration: 10, drillTitle: 'Passing Wall', description: 'Two-touch passing.' }
                ]
            },
            completions: [],
            children: [{ id: 'player-1', name: 'Pat' }]
        });

        const { container } = await renderDetail('/schedule/team-1/practice-1?childId=player-1');
        await waitForText(container, 'Practice');
        expect(container.textContent).toContain('Practice packet ready');
        await clickButton(container, 'Practice packet ready, review packet');
        await waitForText(container, 'Practice hub');

        const firstHubCardTitle = container.querySelector('.app-card article h3')?.textContent;
        const practiceHub = Array.from(container.querySelectorAll('.app-card')).find((card) => card.textContent.includes('Practice hub'));
        expect(practiceHub.querySelector('article h3')?.textContent).toBe('Share practice');
        expect(container.textContent).not.toContain('Open packet');
        expect(container.textContent).toContain('Open team');
        expect(container.textContent).toContain('Packet ready');
        expect(container.textContent).toContain('Ball Mastery');
        expect(container.textContent).toContain('Mark complete: Pat');

        await clickButton(container, 'Share practice');

        const shareCall = publicActionMocks.sharePublicUrl.mock.calls[0]?.[0];
        expect(shareCall.title).toBe('Bears Practice');
        expect(shareCall.url).toBeUndefined();
        expect(shareCall.text).toContain('Bears Practice');
        expect(shareCall.text).toContain('North Field');
        expect(shareCall.text).toContain('Packet: 2 drills · 20 min');
        expect(shareCall.text).not.toContain('allplays.ai');
        await waitForText(container, 'Practice share sheet opened.');

        await clickButton(container, 'Mark complete: Pat');
        expect(scheduleMocks.markParentPracticePacketComplete).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 'session-1' }),
            auth.user,
            { id: 'player-1', name: 'Pat' }
        );
        await waitForText(container, 'Pat marked complete.');
    });

    it('opens the game hub immediately when the route requests section=game', async () => {
        scheduleMocks.loadParentScheduleEventDetail.mockResolvedValue({
            events: [
                event({
                    liveStatus: 'completed',
                    homeScore: 4,
                    awayScore: 2
                })
            ]
        });
        reportMocks.loadGameReportSections.mockResolvedValue(report());

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1&section=game');
        await waitForText(container, 'Game hub');

        expect(scheduleMocks.loadGameDayLiveEventsForApp).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Watch replay');
        expect(container.textContent).toContain('Match report');
        expect(container.textContent).not.toContain('Is Pat going?');
    });

    it('falls back to Availability when the route section is invalid', async () => {
        scheduleMocks.loadParentScheduleEventDetail.mockResolvedValue({
            events: [event()]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1&section=not-real');
        await waitForText(container, 'Is Pat going?');

        expect(container.textContent).not.toContain('Game hub');
    });

    it('keeps the requested section while falling back to the first event when the route childId is unknown', async () => {
        scheduleMocks.loadParentScheduleEventDetail.mockResolvedValue({
            events: [
                event({ childId: 'player-1', childName: 'Pat' }),
                event({ eventKey: 'team-1::game-1::player-2', childId: 'player-2', childName: 'Sam', myRsvp: 'maybe' })
            ]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=missing-player&section=availability');
        await waitForText(container, 'Are Pat and Sam going?');
        expect(container.textContent).toContain('One choice updates Pat and Sam.');

        await clickButton(container, 'Set individually');
        await waitForText(container, 'Is Pat going?');

        const switcher = container.querySelector('[data-testid="event-player-switcher"]');
        expect(switcher).not.toBeNull();
        expect(buttonByText(switcher, 'Pat').getAttribute('aria-pressed')).toBe('true');
        expect(buttonByText(switcher, 'Sam').getAttribute('aria-pressed')).toBe('false');
        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/schedule/team-1/game-1?childId=missing-player&section=availability');
    });

    it('renders the completed game More tab with replay and report actions wired to public URLs', async () => {
        scheduleMocks.loadParentScheduleEventDetail.mockResolvedValue({
            events: [
                event({
                    liveStatus: 'completed',
                    homeScore: 4,
                    awayScore: 2
                })
            ]
        });
        reportMocks.loadGameReportSections.mockResolvedValue(report());

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        expect(scheduleMocks.loadParentScheduleEventDetail).toHaveBeenCalledWith(auth.user, { teamId: 'team-1', eventId: 'game-1' });
        expect(scheduleMocks.loadParentSchedule).not.toHaveBeenCalled();
        await clickButton(container, 'Game');
        await waitForText(container, 'Game hub');

        expect(container.textContent).toContain('Watch replay');
        expect(container.textContent).toContain('Match report');

        await clickButton(container, 'Watch replay');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true');

        await clickButton(container, 'Share match report');
        const shareCall = publicActionMocks.sharePublicUrl.mock.calls[0]?.[0];
        expect(shareCall.title).toBe('Bears vs. Falcons match report');
        expect(shareCall.url).toBe('https://allplays.ai/game.html#teamId=team-1&gameId=game-1');
        expect(shareCall.clipboardText).toContain('https://allplays.ai/game.html#teamId=team-1&gameId=game-1');
    });

    it('keeps the multi-child summary switcher inline with the event metadata row', async () => {
        scheduleMocks.loadParentScheduleEventDetail.mockResolvedValue({
            events: [
                event({ childId: 'player-1', childName: 'Pat', liveStatus: 'completed', homeScore: 4, awayScore: 2 }),
                event({ eventKey: 'team-1::game-1::player-2', childId: 'player-2', childName: 'Sam', myRsvp: 'maybe', liveStatus: 'completed', homeScore: 4, awayScore: 2 })
            ]
        });
        reportMocks.loadGameReportSections.mockResolvedValue(report());

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');

        const switchers = container.querySelectorAll('[data-testid="event-player-switcher"]');
        expect(switchers).toHaveLength(1);
        expect(buttonByText(container, 'Pat')).not.toBeNull();
        expect(buttonByText(container, 'Sam')).not.toBeNull();
        expect(container.textContent).toContain('Pat · Bears');
        expect(container.textContent).toContain('Add to Calendar');
    });

    it('hides empty optional postgame report tabs for completed games', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ liveStatus: 'completed', homeScore: 4, awayScore: 2 })]
        });
        reportMocks.loadGameReportSections.mockResolvedValue(report({
            plays: [],
            teamStatKeys: ['shots'],
            teamStatLabels: { shots: 'Shots' },
            teamStats: {}
        }));

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Report sections');
        await clickButton(container, 'Report sections');
        await waitForText(container, 'Match Summary');

        expect(queryButtonByText(container, 'Summary')).not.toBeNull();
        expect(queryButtonByText(container, 'Players')).not.toBeNull();
        expect(queryButtonByText(container, 'Plays')).toBeNull();
        expect(queryButtonByText(container, 'Opponent')).toBeNull();
        expect(queryButtonByText(container, 'Insights')).toBeNull();
        expect(queryButtonByText(container, 'Media')).toBeNull();
    });

    it('shows optional postgame report tabs only when their data exists', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ liveStatus: 'completed', homeScore: 4, awayScore: 2 })]
        });
        reportMocks.loadGameReportSections.mockResolvedValue(report({
            opponentRows: [{ id: 'opp-1', name: 'Jordan', number: '12', stats: { pts: 9 } }],
            opponentStatKeys: ['pts'],
            opponentStatLabels: { pts: 'PTS' },
            highlightClips: [{
                title: 'Late goal',
                description: 'Late goal',
                period: 'Q4',
                gameTime: '01:20',
                startMs: 1000,
                endMs: 3000,
                url: 'https://example.com/highlight'
            }]
        }));

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Report sections');
        await clickButton(container, 'Report sections');
        await waitForText(container, 'Match Summary');

        expect(queryButtonByText(container, 'Opponent')).not.toBeNull();
        expect(queryButtonByText(container, 'Media')).not.toBeNull();
        expect(queryButtonByText(container, 'Insights')).toBeNull();
    });

    it('defaults Player Performance to participants and reveals the full roster on demand', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ liveStatus: 'completed', homeScore: 4, awayScore: 2 })]
        });
        reportMocks.loadGameReportSections.mockResolvedValue(report({
            statKeys: ['pts'],
            statLabels: { pts: 'PTS' },
            playerRows: [
                { playerId: 'player-1', playerName: 'Pat', number: '7', stats: { pts: 8 }, timeMs: 1200000, didNotPlay: false, participated: true, participationStatus: 'appeared', participationSource: 'app-stat-tracker' },
                { playerId: 'player-2', playerName: 'Sam', number: '9', stats: {}, timeMs: 0, didNotPlay: false, participated: true, participationStatus: 'appeared', participationSource: 'app-stat-tracker' },
                { playerId: 'player-3', playerName: 'Drew', number: '11', stats: {}, timeMs: 0, didNotPlay: true, participated: false, participationStatus: 'did-not-appear', participationSource: '' },
                { playerId: 'player-4', playerName: 'Casey', number: '15', stats: {}, timeMs: 0, didNotPlay: false, participated: false, participationStatus: '', participationSource: '' }
            ],
            visiblePlayerRows: [
                { playerId: 'player-1', playerName: 'Pat', number: '7', stats: { pts: 8 }, timeMs: 1200000, didNotPlay: false, participated: true, participationStatus: 'appeared', participationSource: 'app-stat-tracker' },
                { playerId: 'player-2', playerName: 'Sam', number: '9', stats: {}, timeMs: 0, didNotPlay: false, participated: true, participationStatus: 'appeared', participationSource: 'app-stat-tracker' },
                { playerId: 'player-3', playerName: 'Drew', number: '11', stats: {}, timeMs: 0, didNotPlay: true, participated: false, participationStatus: 'did-not-appear', participationSource: '' }
            ],
            deferredPlayerRows: [
                { playerId: 'player-4', playerName: 'Casey', number: '15', stats: {}, timeMs: 0, didNotPlay: false, participated: false, participationStatus: '', participationSource: '' }
            ],
            hasPlayingTime: true
        }));

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Report sections');
        await clickButton(container, 'Report sections');
        await waitForText(container, 'Match Summary');
        await clickButton(container, 'Players');

        expect(container.textContent).toContain('#7 Pat');
        expect(container.textContent).toContain('#9 Sam');
        expect(container.textContent).toContain('#11 Drew');
        expect(container.textContent).toContain('DNP');
        expect(container.textContent).not.toContain('#15 Casey');
        expect(container.textContent).toContain('Show full roster (1)');

        await clickButton(container, 'Show full roster (1)');

        expect(container.textContent).toContain('#15 Casey');
        expect(container.textContent).toContain('Hide full roster');
    });

    it('does not refresh completed game reports on focus or while Plays stays open', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ liveStatus: 'completed', homeScore: 4, awayScore: 2 })]
        });
        reportMocks.loadGameReportSections.mockResolvedValue(report({
            plays: [{ id: 'play-1', period: 'Q4', clock: '00:30', text: 'Final whistle' }]
        }));

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Report sections');
        await clickButton(container, 'Report sections');
        await waitForText(container, 'Match Summary');

        expect(reportMocks.loadGameReportSections).toHaveBeenCalledTimes(1);

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            await Promise.resolve();
        });
        expect(reportMocks.loadGameReportSections).toHaveBeenCalledTimes(1);

        vi.useFakeTimers();
        await clickButton(container, 'Plays');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(16000);
        });
        expect(reportMocks.loadGameReportSections).toHaveBeenCalledTimes(1);
    });

    it('refreshes live game report plays on Plays focus and interval only', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ liveStatus: 'live', homeScore: 4, awayScore: 2 })]
        });
        reportMocks.loadGameReportSections.mockResolvedValue(report({
            game: { id: 'game-1', status: 'live', liveStatus: 'live', homeScore: 4, awayScore: 2 },
            plays: [{ id: 'play-1', period: 'Q1', clock: '05:12', text: 'Opening bucket' }]
        }));
        reportMocks.loadGameReportPlays.mockResolvedValue({
            game: { id: 'game-1', status: 'live', liveStatus: 'live', homeScore: 4, awayScore: 2 },
            plays: [
                { id: 'play-1', period: 'Q1', clock: '05:12', text: 'Opening bucket' },
                { id: 'play-2', period: 'Q1', clock: '04:58', text: 'Second bucket' }
            ]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Report sections');
        await clickButton(container, 'Report sections');
        await waitForText(container, 'Match Summary');

        expect(reportMocks.loadGameReportSections).toHaveBeenCalledTimes(1);

        vi.useFakeTimers();
        await clickButton(container, 'Plays');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(15000);
        });
        expect(reportMocks.loadGameReportSections).toHaveBeenCalledTimes(1);
        expect(reportMocks.loadGameReportPlays).toHaveBeenCalledTimes(1);
        expect(reportMocks.loadGameReportPlays).toHaveBeenCalledWith('team-1', 'game-1');
        await waitForText(container, 'Second bucket');

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            await Promise.resolve();
        });
        expect(reportMocks.loadGameReportSections).toHaveBeenCalledTimes(1);
        expect(reportMocks.loadGameReportPlays).toHaveBeenCalledTimes(2);

        await clickButton(container, 'Summary');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(15000);
            window.dispatchEvent(new Event('focus'));
            await Promise.resolve();
        });
        expect(reportMocks.loadGameReportSections).toHaveBeenCalledTimes(1);
        expect(reportMocks.loadGameReportPlays).toHaveBeenCalledTimes(2);
    });

    it('renders the live period and clock chip beside the score for live games', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [
                event({
                    liveStatus: 'live',
                    homeScore: 4,
                    awayScore: 2,
                    liveClockMs: 494000,
                    liveClockRunning: false,
                    liveClockPeriod: 'Q2',
                    liveClockUpdatedAt: new Date('2026-05-28T07:10:00Z')
                })
            ]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Game hub');

        expect(container.textContent).toContain('4-2');
        expect(container.textContent).toContain('LIVE · Q2 · 08:14');
        expect(container.querySelector('[aria-label="Live game clock"]')?.textContent).toBe('LIVE · Q2 · 08:14');
    });

    it('does not render a misleading clock chip for games without live clock data', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ liveStatus: 'scheduled', homeScore: 0, awayScore: 0 })]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Game hub');

        expect(container.textContent).toContain('0-0');
        expect(container.querySelector('[aria-label="Live game clock"]')).toBeNull();
        expect(container.textContent).not.toContain('00:00');
    });

    it('lets authorized staff adjust and save the live score from the game hub', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [
                event({
                    homeScore: 4,
                    awayScore: 2,
                    canUpdateScore: true
                })
            ]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Live score');

        await waitForMockCall(scheduleMocks.buildLiveGameClockPeriods, 'buildLiveGameClockPeriods');
        await waitForMockCall(scheduleMocks.resolveLiveGameClockSnapshot, 'resolveLiveGameClockSnapshot');
        expect(scheduleMocks.buildLiveGameClockPeriods).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }));
        expect(scheduleMocks.resolveLiveGameClockSnapshot).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), expect.any(Date));

        await clickButton(container, 'Home score up');
        expect(container.textContent).toContain('Unsaved score changes');
        await clickButton(container, 'Save score');

        expect(scheduleMocks.updateGameScore).toHaveBeenCalledWith(
            'team-1',
            'game-1',
            { homeScore: 5, awayScore: 2 },
            auth.user
        );
        expect(scheduleMocks.publishLiveScoreUpdateEvent).toHaveBeenCalledWith(
            'team-1',
            'game-1',
            { homeScore: 5, awayScore: 2 },
            auth.user,
            { homeScore: 4, awayScore: 2 }
        );
        await waitForText(container, 'Score saved and posted to live play-by-play.');
        expect(container.textContent).toContain('5-2');
    });

    it('does not publish a live event when the saved score is unchanged', async () => {
        scheduleMocks.updateGameScore.mockResolvedValue({
            homeScore: 4,
            awayScore: 2,
            scoreUpdatedAt: new Date('2026-05-25T08:00:00Z'),
            scoreUpdatedBy: 'user-1'
        });
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ homeScore: 4, awayScore: 2, canUpdateScore: true })]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Live score');

        expect(buttonByText(container, 'Save score').disabled).toBe(true);
        await clickButton(container, 'Home score up');
        await clickButton(container, 'Save score');

        await waitForText(container, 'Score saved.');
        expect(scheduleMocks.publishLiveScoreUpdateEvent).not.toHaveBeenCalled();
    });

    it('lets staff undo the latest score change and save the restored score', async () => {
        scheduleMocks.updateGameScore.mockImplementation(async (_teamId, _gameId, score) => ({
            ...score,
            scoreUpdatedAt: new Date('2026-05-25T08:00:00Z'),
            scoreUpdatedBy: 'user-1'
        }));
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [
                event({
                    homeScore: 4,
                    awayScore: 2,
                    canUpdateScore: true
                })
            ]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Live score');
        expect(container.textContent).not.toContain('Undo last score change');

        await clickButton(container, 'Home score up');
        expect(container.textContent).toContain('5-2');
        expect(container.textContent).toContain('Undo last score change');
        await clickButton(container, 'Save score');
        await waitForText(container, 'Score saved and posted to live play-by-play.');

        await clickButton(container, 'Undo last score change');
        expect(container.textContent).toContain('4-2');
        expect(container.textContent).toContain('Unsaved score changes');
        expect(container.textContent).not.toContain('Score saved.');
        await clickButton(container, 'Save score');

        expect(scheduleMocks.updateGameScore).toHaveBeenLastCalledWith(
            'team-1',
            'game-1',
            { homeScore: 4, awayScore: 2 },
            auth.user
        );
        await waitForText(container, 'Score saved and posted to live play-by-play.');
    });

    it('keeps a saved score when live play-by-play posting fails', async () => {
        scheduleMocks.updateGameScore.mockImplementation(async (_teamId, _gameId, score) => ({
            ...score,
            scoreUpdatedAt: new Date('2026-05-25T08:00:00Z'),
            scoreUpdatedBy: 'user-1'
        }));
        scheduleMocks.publishLiveScoreUpdateEvent.mockRejectedValue(new Error('live event failed'));
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ homeScore: 4, awayScore: 2, canUpdateScore: true })]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Live score');

        await clickButton(container, 'Away score up');
        await clickButton(container, 'Save score');

        await waitForText(container, 'Score saved. Live play-by-play post failed.');
        expect(container.textContent).toContain('4-3');
        expect(container.textContent).toContain('Saved score controls');
    });

    it('disables undo while a live score save is in flight', async () => {
        let resolveSave;
        const savePromise = new Promise((resolve) => {
            resolveSave = resolve;
        });
        scheduleMocks.updateGameScore.mockReturnValue(savePromise);
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ homeScore: 4, awayScore: 2, canUpdateScore: true })]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Live score');

        await clickButton(container, 'Away score up');
        await clickButton(container, 'Save score');
        expect(buttonByText(container, 'Undo last score change').disabled).toBe(true);

        await act(async () => {
            resolveSave({ homeScore: 4, awayScore: 3, scoreUpdatedAt: new Date('2026-05-25T08:00:00Z'), scoreUpdatedBy: 'user-1' });
            await savePromise;
        });

        expect(buttonByText(container, 'Undo last score change').disabled).toBe(false);
    });

    it('keeps score controls hidden for read-only schedule viewers', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ homeScore: 4, awayScore: 2, canUpdateScore: false })]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Game hub');

        expect(container.textContent).toContain('4-2');
        expect(container.textContent).not.toContain('Live score');
        expect(container.textContent).not.toContain('Save score');
        expect(container.textContent).not.toContain('Lineup publish');
    });

    it('keeps lineup publish controls hidden for non-staff scorekeepers', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({
                canUpdateScore: true,
                isTeamStaff: false,
                gamePlan: { lineups: { 'H1-keeper': 'p1' } }
            })]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Live score');

        expect(container.textContent).toContain('Live score');
        expect(container.textContent).not.toContain('Lineup publish');
        expect(container.textContent).not.toContain('Publish lineup');
    });

    it('shows lineup publish status and disables publish when staff has no draft', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ canUpdateScore: true, isTeamStaff: true, gamePlan: { lineups: {} } })]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Lineup builder');
        await clickButton(container, 'Lineup builder');
        await waitForText(container, 'No lineup draft is available yet.', 500);

        expect(container.querySelector('#game-hub-lineup-formation')).not.toBeNull();
        expect(buttonByText(container, 'Publish lineup').disabled).toBe(true);
    });

    it('creates a lineup draft from Going players and enables publish without reloading', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ canUpdateScore: true, isTeamStaff: true, gamePlan: { lineups: {} } })]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Lineup builder');
        await clickButton(container, 'Lineup builder');
        await waitForText(container, 'Basketball 5v5', 2000);

        const select = container.querySelector('#game-hub-lineup-formation');
        await act(async () => {
            fireEvent.change(select, { target: { value: 'basketball-5v5' } });
        });
        await waitForText(container, '#1 Avery', 2000);
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 900));
        });

        expect(scheduleMocks.saveScheduledGameLineupDraftForApp).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user, 'basketball-5v5', expect.objectContaining({
            lineups: expect.objectContaining({ 'Q1-pg': 'p1', 'Q1-sg': 'p2' })
        }));
        await waitForText(container, 'Lineup draft autosaved.');
        expect(buttonByText(container, 'Publish lineup').disabled).toBe(false);
    });

    it('publishes a lineup draft once and updates the visible status without reloading', async () => {
        const draftGamePlan = {
            lineups: { 'H1-keeper': 'p1' },
            publishedVersion: 1,
            publishedLineups: { 'H1-keeper': 'p9' }
        };
        const publishedGamePlan = {
            ...draftGamePlan,
            isPublished: true,
            publishedVersion: 2,
            publishedLineups: { 'H1-keeper': 'p1' },
            publishedReadBy: []
        };
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ canUpdateScore: true, isTeamStaff: true, gamePlan: draftGamePlan })]
        });
        scheduleMocks.publishGamePlanForApp.mockResolvedValue({
            gamePlan: publishedGamePlan,
            notificationError: 'Chat offline'
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Lineup builder');
        await clickButton(container, 'Lineup builder');
        await waitForText(container, 'Published v1. 1 draft assignment unpublished.');

        await clickButton(container, 'Publish lineup');

        expect(scheduleMocks.publishGamePlanForApp).toHaveBeenCalledTimes(1);
        expect(scheduleMocks.publishGamePlanForApp).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user);
        await waitForText(container, 'Published v2. Current draft matches the published lineup.');
        expect(container.textContent).toContain('Lineup saved as v2, but team chat notification failed: Chat offline');
    });

    it('leaves edited scores visible when saving the live score fails', async () => {
        scheduleMocks.updateGameScore.mockRejectedValue(new Error('Permission denied'));
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            events: [event({ homeScore: 4, awayScore: 2, canUpdateScore: true })]
        });

        const { container } = await renderDetail('/schedule/team-1/game-1?childId=player-1');
        await waitForText(container, 'vs. Falcons');
        await clickButton(container, 'Game');
        await waitForText(container, 'Live score');

        await clickButton(container, 'Away score up');
        await clickButton(container, 'Save score');

        await waitForText(container, 'Permission denied');
        expect(container.textContent).toContain('4-3');
        expect(container.textContent).toContain('Unsaved score changes');
    });
});
