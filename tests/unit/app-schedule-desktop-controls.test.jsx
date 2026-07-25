// @vitest-environment jsdom
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { getScheduleMapHref } from '../../apps/app/src/lib/scheduleLogic.ts';

const scheduleMocks = vi.hoisted(() => ({
    addTeamCalendarUrl: vi.fn(),
    createScheduledGameForApp: vi.fn(),
    createScheduledPracticeForApp: vi.fn(),
    createScheduledTournamentBlockForApp: vi.fn(),
    createScheduleImportGame: vi.fn(),
    createScheduleImportPractice: vi.fn(),
    finalizeScheduleImportBatch: vi.fn(),
    loadParentSchedule: vi.fn(),
    loadParentScheduleScope: vi.fn(),
    loadScheduleStatTrackerConfigsForApp: vi.fn(),
    removeTeamCalendarUrl: vi.fn(),
    generateScheduleAiImportRows: vi.fn(),
    aiModuleLoads: 0,
    csvModuleLoads: 0
}));
const layoutState = vi.hoisted(() => ({
    isDesktopWeb: true,
    isNative: false,
    isMobileWeb: false
}));
const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn()
}));

vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../apps/app/src/lib/performanceInstrumentation.ts', () => ({
    now: vi.fn(() => 0),
    startPerformanceSpan: vi.fn(() => ({ startedAt: 0, end: vi.fn() })),
    recordCompletedPerformanceSpan: vi.fn()
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
vi.mock('../../apps/app/src/lib/uxTiming.ts', () => ({
    recordFirstMeaningfulRender: vi.fn(),
    startScreenMountTimer: vi.fn(() => ({ end: vi.fn() })),
    startUxTimer: vi.fn(() => ({ end: vi.fn() }))
}));
vi.mock('../../apps/app/src/lib/scheduleAiImport.ts', async () => {
    scheduleMocks.aiModuleLoads += 1;
    return {
        generateScheduleAiImportRows: scheduleMocks.generateScheduleAiImportRows
    };
});

vi.mock('../../apps/app/src/lib/scheduleCsvImport.ts', async (importOriginal) => {
    scheduleMocks.csvModuleLoads += 1;
    return await importOriginal();
});
vi.mock('../../apps/app/src/lib/useShellLayout.ts', () => ({
    useShellLayout: () => layoutState
}));

import { Schedule } from '../../apps/app/src/pages/Schedule.tsx';
import { clearAppDataCache } from '../../apps/app/src/lib/appDataCache.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent'
    }
};

function futureDate(offsetHours = 24) {
    return new Date(Date.now() + offsetHours * 60 * 60 * 1000);
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function event(overrides = {}) {
    return {
        eventKey: overrides.eventKey || 'team-1::game-1::player-1',
        id: overrides.id || 'game-1',
        teamId: overrides.teamId || 'team-1',
        teamName: overrides.teamName || 'Bears',
        type: overrides.type || 'game',
        date: overrides.date || futureDate(7 * 24),
        location: overrides.location || 'Main Gym',
        opponent: overrides.opponent || 'Falcons',
        title: overrides.title || null,
        childId: overrides.childId || 'player-1',
        childName: overrides.childName || 'Pat',
        isDbGame: overrides.isDbGame !== false,
        isCancelled: overrides.isCancelled === true,
        myRsvp: overrides.myRsvp || 'not_responded',
        rsvpSummary: overrides.rsvpSummary || null,
        rideshareSummary: overrides.rideshareSummary || null,
        assignments: overrides.assignments || [],
        ...overrides
    };
}

function RouteProbe() {
    const location = useLocation();
    return React.createElement('div', { 'data-testid': 'route-probe' }, `${location.pathname}${location.search}`);
}

async function renderSchedule(initialEntries) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            initialEntries ? { initialEntries } : null,
            React.createElement(
                React.Fragment,
                null,
                initialEntries ? React.createElement(RouteProbe) : null,
                React.createElement(Schedule, { auth })
            )
        ));
    });

    return { container, root };
}

async function waitForText(container, text) {
    for (let index = 0; index < 200; index += 1) {
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

function buttonByText(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.trim() === text);
    if (!button) throw new Error(`Button not found: ${text}`);
    return button;
}

function queryButtonByText(container, text) {
    return Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.trim() === text) || null;
}

function buttonContainingText(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    return button;
}

function selectByLabel(container, label) {
    const select = Array.from(container.querySelectorAll('select')).find((candidate) => candidate.getAttribute('aria-label') === label);
    if (!select) throw new Error(`Select not found: ${label}`);
    return select;
}

async function clickButton(container, text) {
    await act(async () => {
        buttonByText(container, text).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

async function waitForButtonEnabled(container, text) {
    const timeoutMs = 3000;
    const startTime = Date.now();
    while ((Date.now() - startTime) < timeoutMs) {
        const button = queryButtonByText(container, text);
        if (button && !button.disabled) return button;
        await act(async () => {
            if (vi.isFakeTimers()) {
                await vi.advanceTimersByTimeAsync(10);
                await Promise.resolve();
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
    }
    throw new Error(`Timed out waiting for enabled button: ${text}`);
}

async function openManageSchedule(container) {
    await waitForText(container, 'Manage schedule');
    if (buttonContainingText(container, 'Manage schedule').getAttribute('aria-expanded') !== 'true') {
        await act(async () => {
            buttonContainingText(container, 'Manage schedule').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
    }
}

async function changeInput(input, value) {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function changeTextarea(textarea, value) {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(textarea, value);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function changeSelect(select, value) {
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    clearAppDataCache('app-schedule-summary');
    document.body.innerHTML = '';
    layoutState.isDesktopWeb = true;
    layoutState.isNative = false;
    layoutState.isMobileWeb = false;
    scheduleMocks.addTeamCalendarUrl.mockResolvedValue({ added: true, calendarUrls: ['https://example.com/team.ics'] });
    scheduleMocks.createScheduledGameForApp.mockResolvedValue('game-new');
    scheduleMocks.createScheduledPracticeForApp.mockResolvedValue('practice-new');
    scheduleMocks.createScheduledTournamentBlockForApp.mockResolvedValue('tournament-new');
    scheduleMocks.createScheduleImportGame.mockResolvedValue('game-new');
    scheduleMocks.createScheduleImportPractice.mockResolvedValue('practice-new');
    scheduleMocks.finalizeScheduleImportBatch.mockResolvedValue(undefined);
    scheduleMocks.loadParentScheduleScope.mockResolvedValue({
        profile: {},
        children: [],
        staffTeams: [],
        isPartial: true
    });
    scheduleMocks.loadScheduleStatTrackerConfigsForApp.mockResolvedValue([{ id: 'cfg-basketball', name: 'Basketball' }]);
    scheduleMocks.removeTeamCalendarUrl.mockResolvedValue({ removed: true, calendarUrls: [] });
    scheduleMocks.generateScheduleAiImportRows.mockResolvedValue({ rows: [], errors: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    scheduleMocks.loadParentSchedule.mockResolvedValue({
        children: [
            { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
            { playerId: 'player-2', playerName: 'Sam', teamId: 'team-1', teamName: 'Bears' }
        ],
        events: [event()]
    });
});

describe('React app desktop Schedule controls', () => {
    it('collapses advanced filters by default and preserves selections across toggles', async () => {
        const { container } = await renderSchedule();
        await waitForText(container, 'Main Gym');

        expect(container.textContent).toContain('Active filters');
        expect(container.textContent).toContain('All Upcoming · All · All teams · All players');
        expect(container.textContent).toContain('Needs attention');
        expect(() => buttonByText(container, 'Compact')).toThrow();
        expect(() => buttonByText(container, 'Download')).toThrow();
        expect(() => selectByLabel(container, 'Time range')).toThrow();

        await clickButton(container, 'Filters and views');

        expect(buttonByText(container, 'List')).toBeTruthy();
        expect(buttonByText(container, 'Compact')).toBeTruthy();
        expect(buttonByText(container, 'Calendar')).toBeTruthy();
        expect(buttonByText(container, 'Packets')).toBeTruthy();
        expect(selectByLabel(container, 'Time range')).toBeTruthy();

        await clickButton(container, 'Compact');
        await changeSelect(selectByLabel(container, 'Time range'), 'month');
        await changeSelect(selectByLabel(container, 'Team'), 'team-1');
        await changeSelect(selectByLabel(container, 'Player'), 'player-2');
        await clickButton(container, 'Upcoming Games');

        await clickButton(container, 'Filters and views');
        expect(container.textContent).toContain('Upcoming Games · Month · Bears · Sam');
        expect(() => buttonByText(container, 'Compact')).toThrow();

        await clickButton(container, 'Filters and views');
        expect(buttonByText(container, 'Compact').getAttribute('aria-pressed')).toBe('true');
        expect(selectByLabel(container, 'Time range').value).toBe('month');
        expect(selectByLabel(container, 'Team').value).toBe('team-1');
        expect(selectByLabel(container, 'Player').value).toBe('player-2');
    });

    it('paginates compact view rows and resets expanded state on view and filter changes', async () => {
        const upcomingEvents = Array.from({ length: 25 }, (_, index) => event({
            eventKey: `team-1::upcoming-${index}::player-1`,
            id: `upcoming-${index}`,
            childId: 'player-1',
            childName: 'Pat',
            opponent: `Upcoming ${index + 1}`,
            location: `Field ${index + 1}`,
            date: futureDate((index + 1) * 24)
        }));
        const pastEvents = Array.from({ length: 12 }, (_, index) => event({
            eventKey: `team-1::past-${index}::player-1`,
            id: `past-${index}`,
            childId: 'player-1',
            childName: 'Pat',
            opponent: `Past ${index + 1}`,
            location: `Old Field ${index + 1}`,
            date: futureDate(-((index + 1) * 24))
        }));
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
                { playerId: 'player-2', playerName: 'Sam', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [...upcomingEvents, ...pastEvents]
        });

        const { container } = await renderSchedule();
        await waitForText(container, 'Upcoming 1');
        await clickButton(container, 'Filters and views');
        await clickButton(container, 'Compact');
        await waitForText(container, 'Compact schedule');

        expect(container.querySelectorAll('.compact-schedule-row')).toHaveLength(10);
        expect(container.textContent).toContain('Showing 10 of 25 events');

        await clickButton(container, 'Show 10 more');
        expect(container.querySelectorAll('.compact-schedule-row')).toHaveLength(20);
        expect(container.textContent).toContain('Showing 20 of 25 events');

        await clickButton(container, 'Show 5 more');
        expect(container.querySelectorAll('.compact-schedule-row')).toHaveLength(25);
        expect(queryButtonByText(container, 'Show 5 more')).toBeNull();

        await clickButton(container, 'List');
        await clickButton(container, 'Compact');
        expect(container.querySelectorAll('.compact-schedule-row')).toHaveLength(10);
        expect(container.textContent).toContain('Showing 10 of 25 events');

        await clickButton(container, 'Past Events');
        expect(container.querySelectorAll('.compact-schedule-row')).toHaveLength(10);
        expect(container.textContent).toContain('Showing 10 of 12 events');
        expect(buttonByText(container, 'Show 2 more')).toBeTruthy();
    });

    it('does not load AI or CSV helpers for parent-only initial render', async () => {
        const { container } = await renderSchedule();
        await waitForText(container, 'Main Gym');

        expect(scheduleMocks.aiModuleLoads).toBe(0);
        expect(scheduleMocks.csvModuleLoads).toBe(0);
        expect(container.textContent).not.toContain('Add external calendar');
        expect(container.textContent).not.toContain('Draft schedule with AI');
        expect(container.textContent).not.toContain('Import schedule CSV');
    });

    it('opens the tournament shell from staff tools and cancels without creating data', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });

        const { container } = await renderSchedule();
        await openManageSchedule(container);
        await waitForText(container, 'Start a new tournament block');

        await clickButton(container, 'New tournament block');
        await waitForText(container, 'Create tournament block');
        expect(container.querySelector('[role="dialog"]')).toBeTruthy();

        const divisionInput = container.querySelector('input[aria-label="Tournament division"]');
        expect(divisionInput).toBeTruthy();
        await changeInput(divisionInput, 'Gold');
        expect(divisionInput.value).toBe('Gold');

        await clickButton(container, 'Cancel');
        await waitForText(container, 'Start a new tournament block');
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(scheduleMocks.createScheduledTournamentBlockForApp).not.toHaveBeenCalled();

        await clickButton(container, 'New tournament block');
        await waitForText(container, 'Create tournament block');
        expect(container.querySelector('input[aria-label="Tournament division"]').value).toBe('');
    });

    it('dismisses the tournament shell close control without persisting tournament data', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });

        const { container } = await renderSchedule();
        await openManageSchedule(container);
        await clickButton(container, 'New tournament block');
        await waitForText(container, 'Create tournament block');

        await act(async () => {
            const closeButton = container.querySelector('button[aria-label="Close tournament shell"]');
            closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        await waitForText(container, 'Start a new tournament block');
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(scheduleMocks.createScheduledTournamentBlockForApp).not.toHaveBeenCalled();
    });

    it('keeps the tournament shell open while saving even when dismissal shortcuts fire', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });
        const deferred = createDeferred();
        scheduleMocks.createScheduledTournamentBlockForApp.mockReturnValue(deferred.promise);

        const { container } = await renderSchedule();
        await openManageSchedule(container);
        await clickButton(container, 'New tournament block');
        await waitForText(container, 'Create tournament block');

        const divisionInput = container.querySelector('input[aria-label="Tournament division"]');
        const bracketInput = container.querySelector('input[aria-label="Tournament bracket"]');
        const roundInput = container.querySelector('input[aria-label="Tournament round"]');
        const opponentInput = container.querySelector('input[aria-label="Game 1 opponent"]');
        await changeInput(divisionInput, 'Gold');
        await changeInput(bracketInput, 'Gold Bracket');
        await changeInput(roundInput, 'Semifinal');
        await changeInput(opponentInput, 'Tigers');
        await clickButton(container, 'Create tournament');
        await waitForText(container, 'Creating tournament');

        const dialog = container.querySelector('[role="dialog"]');
        const closeButton = container.querySelector('button[aria-label="Close tournament shell"]');
        expect(closeButton.disabled).toBe(true);
        expect(buttonByText(container, 'Cancel').disabled).toBe(true);

        await act(async () => {
            dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });

        expect(container.querySelector('[role="dialog"]')).toBeTruthy();
        expect(container.querySelector('input[aria-label="Tournament division"]').value).toBe('Gold');

        await act(async () => {
            deferred.resolve('tournament-new');
            await deferred.promise;
        });

        await waitForText(container, 'Tournament created and schedule refreshed.');
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(scheduleMocks.createScheduledTournamentBlockForApp).toHaveBeenCalledTimes(1);
    });

    it('shows staff-only calendar import and refreshes after save', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });

        const { container } = await renderSchedule();
        await openManageSchedule(container);
        await waitForText(container, 'Add external calendar');

        const input = container.querySelector('input[aria-label="External .ics calendar URL"]');
        expect(input).toBeTruthy();

        await changeInput(input, 'https://example.com/team.ics');
        await clickButton(container, 'Save calendar');

        expect(scheduleMocks.addTeamCalendarUrl).toHaveBeenCalledWith('team-1', 'https://example.com/team.ics', auth.user);
        await waitForText(container, 'Calendar link saved and schedule refreshed.');
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(scheduleMocks.loadParentSchedule).toHaveBeenNthCalledWith(1, auth.user, {
            hydrateDetails: false,
            expandStaffPlayers: false,
            onPartial: expect.any(Function)
        });
        expect(scheduleMocks.loadParentSchedule).toHaveBeenNthCalledWith(2, auth.user, {
            hydrateDetails: false,
            expandStaffPlayers: false,
            onPartial: expect.any(Function)
        });
    });

    it('keeps mobile staff schedule tools collapsed until explicitly opened', async () => {
        layoutState.isDesktopWeb = false;
        layoutState.isMobileWeb = true;
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });

        const { container } = await renderSchedule(['/schedule?scope=staff']);
        await waitForText(container, 'Falcons');
        await waitForText(container, 'Manage schedule');

        expect(container.textContent).not.toContain('Add external calendar');
        expect(container.textContent).not.toContain('Draft schedule with AI');
        expect(container.textContent).not.toContain('Import schedule CSV');
        expect(container.querySelector('.schedule-list > .schedule-event-row-mobile .schedule-event-row-detail')).toBeTruthy();
        expect(buttonContainingText(container, 'Manage schedule').getAttribute('aria-expanded')).toBe('false');

        await act(async () => {
            buttonContainingText(container, 'Manage schedule').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(buttonContainingText(container, 'Manage schedule').getAttribute('aria-expanded')).toBe('true');
        await waitForText(container, 'Add external calendar');
        expect(container.textContent).toContain('Manage the whole schedule in chat');
        expect(container.textContent).toContain('Manage with AI');
        expect(container.textContent).not.toContain('Draft schedule with AI');
        expect(container.textContent).not.toContain('Import schedule CSV');
    });

    it('opens event-specific mobile directions externally without changing the schedule route', async () => {
        layoutState.isDesktopWeb = false;
        layoutState.isMobileWeb = true;
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [
                event(),
                event({
                    eventKey: 'team-1::game-2::player-1',
                    id: 'game-2',
                    opponent: 'Hawks',
                    location: 'River Field'
                }),
                event({
                    eventKey: 'team-1::game-3::player-1',
                    id: 'game-3',
                    opponent: 'Owls',
                    location: 'TBD'
                })
            ]
        });

        const { container } = await renderSchedule(['/schedule?filter=upcoming-games']);
        await waitForText(container, 'River Field');

        const falconsDirections = container.querySelector('button[aria-label="Directions to vs. Falcons at Main Gym"]');
        const hawksDirections = container.querySelector('button[aria-label="Directions to vs. Hawks at River Field"]');
        const tbdRow = Array.from(container.querySelectorAll('.schedule-event-row-mobile'))
            .find((row) => row.textContent.includes('Owls'));
        expect(falconsDirections).toBeTruthy();
        expect(hawksDirections).toBeTruthy();
        expect(tbdRow).toBeTruthy();
        expect(tbdRow.querySelector('.schedule-event-directions')).toBeNull();
        expect(falconsDirections.textContent.trim()).toBe('Directions');
        expect(hawksDirections.textContent.trim()).toBe('Directions');
        expect(falconsDirections.className).toContain('min-h-11');

        await act(async () => {
            falconsDirections.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith(getScheduleMapHref('Main Gym'));
        expect(container.querySelector('[data-testid="route-probe"]').textContent)
            .toBe('/schedule?filter=upcoming-games');

        const falconsDetail = falconsDirections.closest('.schedule-event-row-mobile')
            .querySelector('.schedule-event-row-detail');
        expect(falconsDetail.getAttribute('href'))
            .toBe('/schedule/team-1/game-1?childId=player-1&section=availability');

        await act(async () => {
            falconsDetail.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.querySelector('[data-testid="route-probe"]').textContent)
            .toBe('/schedule/team-1/game-1?childId=player-1&section=availability');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledTimes(1);
    });

    it('reuses the cached schedule when the route remounts', async () => {
        const first = await renderSchedule();
        await waitForText(first.container, 'Main Gym');

        await act(async () => {
            first.root.unmount();
        });
        first.container.remove();
        scheduleMocks.loadParentSchedule.mockRejectedValue(new Error('network should not be needed'));

        const second = await renderSchedule();
        await waitForText(second.container, 'Main Gym');

        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(1);
        expect(second.container.textContent).not.toContain('Loading schedule');
    });

    it('forces a fresh schedule reload when the user taps Refresh', async () => {
        scheduleMocks.loadParentSchedule
            .mockResolvedValueOnce({
                children: [
                    { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
                ],
                events: [event({ location: 'Main Gym' })]
            })
            .mockResolvedValueOnce({
                children: [
                    { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
                ],
                events: [event({ location: 'Fresh Field', opponent: 'Hawks' })]
            });

        const { container } = await renderSchedule();
        await waitForText(container, 'Main Gym');

        await clickButton(container, 'Refresh');
        await waitForText(container, 'Fresh Field');

        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Hawks');
    });

    it('keeps the last loaded schedule visible when refresh fails', async () => {
        const { container } = await renderSchedule();
        await waitForText(container, 'Main Gym');

        scheduleMocks.loadParentSchedule.mockRejectedValueOnce(new Error('network down'));

        await clickButton(container, 'Refresh');
        await waitForText(container, 'Unable to refresh schedule while offline. Showing the last loaded schedule.');

        expect(container.textContent).not.toContain('network down');
        expect(container.textContent).toContain('Main Gym');
        expect(container.textContent).toContain('Falcons');
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
    });

    it('shows saved staff calendar links and removes one after confirmation', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true, calendarUrls: ['https://example.com/stale.ics'] })]
        });

        const { container } = await renderSchedule();
        await openManageSchedule(container);
        await waitForText(container, 'Saved calendar links');
        expect(container.textContent).toContain('https://example.com/stale.ics');

        const savedCalendarUrl = Array.from(container.querySelectorAll('div')).find((candidate) => candidate.textContent.trim() === 'https://example.com/stale.ics');
        const savedCalendarRow = savedCalendarUrl?.parentElement;
        const removeButton = savedCalendarRow?.querySelector('button');
        if (!savedCalendarRow || !removeButton) throw new Error('Saved calendar row not found');

        await act(async () => {
            removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(window.confirm).toHaveBeenCalledWith('Remove this external calendar link? Imported events from this feed will disappear after the schedule refreshes.');
        expect(scheduleMocks.removeTeamCalendarUrl).toHaveBeenCalledWith('team-1', 'https://example.com/stale.ics', auth.user);
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(scheduleMocks.loadParentSchedule).toHaveBeenNthCalledWith(1, auth.user, {
            hydrateDetails: false,
            expandStaffPlayers: false,
            onPartial: expect.any(Function)
        });
        expect(scheduleMocks.loadParentSchedule).toHaveBeenNthCalledWith(2, auth.user, {
            hydrateDetails: false,
            expandStaffPlayers: false,
            onPartial: expect.any(Function)
        });
        await waitForText(container, 'Calendar link removed and schedule refreshed.');
    });

    it('groups duplicate family event rows into one visible schedule card', async () => {
        const gameDate = futureDate(7 * 24);

        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
                { playerId: 'player-2', playerName: 'Sam', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [
                event({ childId: 'player-1', childName: 'Pat', eventKey: 'team-1::game-1::player-1', date: gameDate }),
                event({ childId: 'player-2', childName: 'Sam', eventKey: 'team-1::game-1::player-2', date: gameDate })
            ]
        });

        const { container } = await renderSchedule();
        await waitForText(container, 'Pat, Sam · Bears');

        expect(container.querySelectorAll('.schedule-event-card')).toHaveLength(1);
    });

    it('hides calendar import from parent-only teams and validates .ics input inline', async () => {
        const { container } = await renderSchedule();
        await waitForText(container, 'Main Gym');
        expect(container.textContent).not.toContain('Add external calendar');

        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });
        clearAppDataCache('app-schedule-summary');
        const staff = await renderSchedule();
        await openManageSchedule(staff.container);
        await waitForText(staff.container, 'Add external calendar');
        await clickButton(staff.container, 'Save calendar');

        expect(staff.container.textContent).toContain('Enter a calendar .ics URL.');
        expect(scheduleMocks.addTeamCalendarUrl).not.toHaveBeenCalled();
    });

    it('shows one top-level AI schedule manager that opens a new team-scoped draft', async () => {
        const parentOnly = await renderSchedule();
        await waitForText(parentOnly.container, 'Main Gym');
        expect(parentOnly.container.textContent).not.toContain('Start schedule import');

        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });
        clearAppDataCache('app-schedule-summary');

        const { container } = await renderSchedule(['/schedule?scope=staff']);
        await waitForText(container, 'Manage the whole schedule in chat');
        const aiManager = container.querySelector('#schedule-staff-ai');
        const eventList = container.querySelector('.schedule-list');
        expect(aiManager).toBeTruthy();
        expect(eventList).toBeTruthy();
        expect(aiManager.compareDocumentPosition(eventList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(container.textContent).not.toContain('Draft schedule with AI');
        expect(container.textContent).not.toContain('Import schedule CSV');
        expect(container.querySelector('input[aria-label="Schedule CSV file"]')).toBeNull();
        expect(container.querySelector('textarea[aria-label="Schedule text or AI instructions"]')).toBeNull();
        expect(scheduleMocks.aiModuleLoads).toBe(0);
        expect(scheduleMocks.csvModuleLoads).toBe(0);

        const link = Array.from(container.querySelectorAll('a')).find((candidate) => candidate.textContent?.includes('Manage with AI'));
        expect(link).toBeTruthy();
        const href = link.getAttribute('href');
        expect(href).toContain('/ai?');
        expect(href).toContain('newChat=1');
        expect(href).toContain('intent=schedule-import');
        expect(href).toContain('teamId=team-1');
        expect(decodeURIComponent(href)).toContain('teamName=Bears');
    });

    it('clears stale tracker config selections when staff switch teams before creating a game', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' },
                { playerId: 'player-2', playerName: 'Sam', teamId: 'team-2', teamName: 'Wolves' }
            ],
            events: [
                event({ teamId: 'team-1', teamName: 'Bears', isTeamStaff: true }),
                event({ eventKey: 'team-2::game-2::player-2', id: 'game-2', teamId: 'team-2', teamName: 'Wolves', childId: 'player-2', childName: 'Sam', isTeamStaff: true })
            ]
        });
        scheduleMocks.loadScheduleStatTrackerConfigsForApp.mockImplementation(async (teamId) => {
            if (teamId === 'team-1') {
                return [{ id: 'cfg-team-1', name: 'Bears Tracker' }];
            }
            if (teamId === 'team-2') {
                return [{ id: 'cfg-team-2', name: 'Wolves Tracker' }];
            }
            return [];
        });

        const { container } = await renderSchedule();
        await waitForText(container, 'Main Gym');
        await clickButton(container, 'Filters and views');
        await changeSelect(selectByLabel(container, 'Team'), 'team-1');
        await openManageSchedule(container);
        await waitForText(container, 'Add game for Bears');

        const teamOnePanel = container.querySelector('section[aria-label="Create game"]');
        await act(async () => {
            teamOnePanel.querySelector('input').focus();
            await Promise.resolve();
        });
        await waitForText(container, 'Bears Tracker');
        const teamOneSelects = teamOnePanel.querySelectorAll('select');
        await changeSelect(teamOneSelects[1], 'cfg-team-1');
        expect(teamOneSelects[1].value).toBe('cfg-team-1');

        await changeSelect(selectByLabel(container, 'Team'), 'team-2');
        await waitForText(container, 'Add game for Wolves');

        const teamTwoPanel = container.querySelector('section[aria-label="Create game"]');
        const teamTwoSelects = teamTwoPanel.querySelectorAll('select');
        expect(teamTwoSelects[1].value).toBe('');

        await clickButton(container, 'Create game');

        expect(scheduleMocks.createScheduledGameForApp).toHaveBeenCalledWith('team-2', expect.objectContaining({
            statTrackerConfigId: ''
        }), auth.user);
    });

});
