// @vitest-environment jsdom
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const scheduleMocks = vi.hoisted(() => ({
    addTeamCalendarUrl: vi.fn(),
    createScheduledGameForApp: vi.fn(),
    createScheduledPracticeForApp: vi.fn(),
    createScheduleImportGame: vi.fn(),
    createScheduleImportPractice: vi.fn(),
    finalizeScheduleImportBatch: vi.fn(),
    loadParentSchedule: vi.fn(),
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

vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);
vi.mock('../../apps/app/src/lib/uxTiming.ts', () => ({
    recordFirstMeaningfulRender: vi.fn(),
    startScreenMountTimer: vi.fn(() => ({ end: vi.fn() }))
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

async function renderSchedule() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            null,
            React.createElement(Schedule, { auth })
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
    scheduleMocks.createScheduleImportGame.mockResolvedValue('game-new');
    scheduleMocks.createScheduleImportPractice.mockResolvedValue('practice-new');
    scheduleMocks.finalizeScheduleImportBatch.mockResolvedValue(undefined);
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
        expect(buttonByText(container, 'Download')).toBeTruthy();
        expect(buttonByText(container, 'Copy')).toBeTruthy();

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

        expect(container.querySelectorAll('.compact-schedule-row')).toHaveLength(20);
        expect(container.textContent).toContain('Showing 20 of 25 events');

        await clickButton(container, 'Show 5 more');
        expect(container.querySelectorAll('.compact-schedule-row')).toHaveLength(25);
        expect(queryButtonByText(container, 'Show 5 more')).toBeNull();

        await clickButton(container, 'List');
        await clickButton(container, 'Compact');
        expect(container.querySelectorAll('.compact-schedule-row')).toHaveLength(20);
        expect(container.textContent).toContain('Showing 20 of 25 events');

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

    it('shows staff-only calendar import and refreshes after save', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });

        const { container } = await renderSchedule();
        await waitForText(container, 'Add external calendar');

        const input = container.querySelector('input[aria-label="External .ics calendar URL"]');
        expect(input).toBeTruthy();

        await changeInput(input, 'https://example.com/team.ics');
        await clickButton(container, 'Save calendar');

        expect(scheduleMocks.addTeamCalendarUrl).toHaveBeenCalledWith('team-1', 'https://example.com/team.ics', auth.user);
        await waitForText(container, 'Calendar link saved and schedule refreshed.');
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(scheduleMocks.loadParentSchedule).toHaveBeenNthCalledWith(1, auth.user, { hydrateDetails: false, expandStaffPlayers: false });
        expect(scheduleMocks.loadParentSchedule).toHaveBeenNthCalledWith(2, auth.user, { hydrateDetails: false, expandStaffPlayers: false });
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

        const { container } = await renderSchedule();
        await waitForText(container, 'Falcons');
        await waitForText(container, 'Manage schedule');

        expect(container.textContent).not.toContain('Add external calendar');
        expect(container.textContent).not.toContain('Draft schedule with AI');
        expect(container.textContent).not.toContain('Import schedule CSV');
        expect(container.querySelector('.schedule-list > a')).toBeTruthy();
        expect(buttonContainingText(container, 'Manage schedule').getAttribute('aria-expanded')).toBe('false');

        await act(async () => {
            buttonContainingText(container, 'Manage schedule').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(buttonContainingText(container, 'Manage schedule').getAttribute('aria-expanded')).toBe('true');
        await waitForText(container, 'Add external calendar');
        expect(container.textContent).toContain('Draft schedule with AI');
        expect(container.textContent).toContain('Import schedule CSV');
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
        await waitForText(container, 'Saved calendar links');
        expect(container.textContent).toContain('https://example.com/stale.ics');

        await clickButton(container, 'Remove');

        expect(window.confirm).toHaveBeenCalledWith('Remove this external calendar link? Imported events from this feed will disappear after the schedule refreshes.');
        expect(scheduleMocks.removeTeamCalendarUrl).toHaveBeenCalledWith('team-1', 'https://example.com/stale.ics', auth.user);
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        expect(scheduleMocks.loadParentSchedule).toHaveBeenNthCalledWith(1, auth.user, { hydrateDetails: false, expandStaffPlayers: false });
        expect(scheduleMocks.loadParentSchedule).toHaveBeenNthCalledWith(2, auth.user, { hydrateDetails: false, expandStaffPlayers: false });
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
        await waitForText(staff.container, 'Add external calendar');
        await clickButton(staff.container, 'Save calendar');

        expect(staff.container.textContent).toContain('Enter a calendar .ics URL.');
        expect(scheduleMocks.addTeamCalendarUrl).not.toHaveBeenCalled();
    });

    it('shows the selected CSV filename immediately and imports staff schedule rows while hiding import from parents', async () => {
        const parentOnly = await renderSchedule();
        await waitForText(parentOnly.container, 'Main Gym');
        expect(parentOnly.container.textContent).not.toContain('Import schedule CSV');

        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });
        clearAppDataCache('app-schedule-summary');

        const { container } = await renderSchedule();
        await waitForText(container, 'Import schedule CSV');
        const csvModuleLoadsBeforeUpload = scheduleMocks.csvModuleLoads;
        const input = container.querySelector('input[aria-label="Schedule CSV file"]');
        const file = new File([
            'Type,Date,Start,End,Opponent,Title,Location\n',
            'Game,4/2/2026,6:30 PM,8:00 PM,Tigers,,Field 1\n',
            'Practice,4/4/2026,7:00 AM,8:30 AM,,Speed Session,Field 2'
        ], 'schedule.csv', { type: 'text/csv' });
        Object.defineProperty(file, 'text', {
            configurable: true,
            value: () => new Promise((resolve) => {
                setTimeout(() => resolve([
                    'Type,Date,Start,End,Opponent,Title,Location\n',
                    'Game,4/2/2026,6:30 PM,8:00 PM,Tigers,,Field 1\n',
                    'Practice,4/4/2026,7:00 AM,8:30 AM,,Speed Session,Field 2'
                ].join('')), 50);
            })
        });

        await act(async () => {
            Object.defineProperty(input, 'files', { value: [file], configurable: true });
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        await waitForText(container, 'Loaded schedule.csv');
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 60));
        });

        await clickButton(container, 'Preview rows');
        await waitForText(container, 'Game vs Tigers');
        expect(scheduleMocks.csvModuleLoads).toBe(csvModuleLoadsBeforeUpload + 1);
        expect(container.textContent).toContain('Speed Session');

        await clickButton(container, 'Import rows');
        expect(scheduleMocks.createScheduleImportGame).toHaveBeenCalledWith('team-1', expect.objectContaining({
            eventType: 'game',
            opponent: 'Tigers',
            importBatch: expect.objectContaining({
                batchId: expect.any(String),
                totalCount: 2,
                rowNumber: expect.any(Number),
                importedBy: auth.user.uid
            })
        }), auth.user);
        expect(scheduleMocks.createScheduleImportPractice).toHaveBeenCalledWith('team-1', expect.objectContaining({
            eventType: 'practice',
            title: 'Speed Session',
            importBatch: expect.objectContaining({
                batchId: expect.any(String),
                totalCount: 2,
                rowNumber: expect.any(Number),
                importedBy: auth.user.uid
            })
        }), auth.user);
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(3);
        expect(scheduleMocks.loadParentSchedule).toHaveBeenLastCalledWith(auth.user, { hydrateDetails: false, expandStaffPlayers: false });
        await waitForText(container, 'Imported 2 schedule row(s) and refreshed the schedule.');
    });

    it('previews and imports staff AI schedule rows without showing the tool to parents', async () => {
        const parentOnly = await renderSchedule();
        await waitForText(parentOnly.container, 'Main Gym');
        expect(parentOnly.container.textContent).not.toContain('Draft schedule with AI');
        await act(async () => {
            parentOnly.root.unmount();
        });
        parentOnly.container.remove();

        const aiRow = {
            rowNumber: 1,
            draft: {},
            normalized: {
                rowNumber: 1,
                eventType: 'game',
                startsAt: '2026-04-02T18:30',
                endsAt: null,
                opponent: 'Tigers',
                title: null,
                location: 'Field 1',
                arrivalTime: null,
                isHome: true,
                notes: 'AI extracted from pasted text'
            },
            errors: []
        };
        scheduleMocks.generateScheduleAiImportRows.mockResolvedValue({ rows: [aiRow], errors: [] });
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });
        clearAppDataCache('app-schedule-summary');

        const { container } = await renderSchedule();
        await waitForText(container, 'Draft schedule with AI');
        const aiModuleLoadsBeforeGenerate = scheduleMocks.aiModuleLoads;
        const textarea = container.querySelector('textarea[aria-label="Schedule text or AI instructions"]');
        expect(textarea).toBeTruthy();

        await changeTextarea(textarea, '4/2 6:30 PM vs Tigers at Field 1');
        await clickButton(container, 'Generate draft rows');
        await waitForText(container, 'AI draft preview 1 row(s)');
        expect(scheduleMocks.aiModuleLoads).toBe(aiModuleLoadsBeforeGenerate + 1);
        expect(scheduleMocks.generateScheduleAiImportRows).toHaveBeenCalledWith(expect.objectContaining({
            teamName: 'Bears',
            text: '4/2 6:30 PM vs Tigers at Field 1',
            imageFile: null,
            currentGames: [expect.objectContaining({ opponent: 'Falcons', location: 'Main Gym' })]
        }));
        expect(container.textContent).toContain('Game vs Tigers');

        await clickButton(container, 'Import reviewed rows');
        expect(scheduleMocks.createScheduleImportGame).toHaveBeenCalledWith('team-1', expect.objectContaining({
            eventType: 'game',
            opponent: 'Tigers'
        }), auth.user);
        await waitForText(container, 'Imported 1 schedule row(s) and refreshed the schedule.');
    });

    it('clears stale AI preview rows when the source text changes', async () => {
        const aiRow = {
            rowNumber: 1,
            draft: {},
            normalized: {
                rowNumber: 1,
                eventType: 'game',
                startsAt: '2026-04-02T18:30',
                endsAt: null,
                opponent: 'Tigers',
                title: null,
                location: 'Field 1',
                arrivalTime: null,
                isHome: true,
                notes: 'AI extracted from pasted text'
            },
            errors: []
        };
        scheduleMocks.generateScheduleAiImportRows.mockResolvedValue({ rows: [aiRow], errors: [] });
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });

        const { container } = await renderSchedule();
        await waitForText(container, 'Draft schedule with AI');
        const textarea = container.querySelector('textarea[aria-label="Schedule text or AI instructions"]');

        await changeTextarea(textarea, '4/2 6:30 PM vs Tigers at Field 1');
        await clickButton(container, 'Generate draft rows');
        await waitForText(container, 'AI draft preview 1 row(s)');
        expect(buttonByText(container, 'Import reviewed rows').disabled).toBe(false);

        await changeTextarea(textarea, '4/3 7:00 PM vs Hawks at Field 2');

        expect(container.textContent).not.toContain('AI draft preview 1 row(s)');
        expect(container.textContent).not.toContain('Game vs Tigers');
        expect(buttonByText(container, 'Import reviewed rows').disabled).toBe(true);
    });

    it('blocks CSV import when preview contains invalid rows', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });

        const { container } = await renderSchedule();
        await waitForText(container, 'Import schedule CSV');
        const input = container.querySelector('input[aria-label="Schedule CSV file"]');
        const file = new File([
            'Type,Date,Start,Opponent\n',
            'Game,4/2/2026,not-a-time,'
        ], 'bad-schedule.csv', { type: 'text/csv' });

        await act(async () => {
            Object.defineProperty(input, 'files', { value: [file], configurable: true });
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        await waitForText(container, 'Loaded bad-schedule.csv');

        await clickButton(container, 'Preview rows');
        await waitForText(container, 'Start time is invalid.');
        expect(buttonByText(container, 'Import rows').disabled).toBe(true);
        expect(scheduleMocks.createScheduleImportGame).not.toHaveBeenCalled();
    });

    it('leaves failed CSV rows available after a partial import failure', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });
        scheduleMocks.createScheduleImportGame.mockRejectedValueOnce(new Error('Firestore write failed'));

        const { container } = await renderSchedule();
        await waitForText(container, 'Import schedule CSV');
        const input = container.querySelector('input[aria-label="Schedule CSV file"]');
        const file = new File([
            'Type,Date,Start,Opponent,Location\n',
            'Game,4/2/2026,6:30 PM,Tigers,Field 1\n',
            'Practice,4/4/2026,7:00 AM,,Field 2'
        ], 'partial-schedule.csv', { type: 'text/csv' });

        await act(async () => {
            Object.defineProperty(input, 'files', { value: [file], configurable: true });
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        await waitForText(container, 'Loaded partial-schedule.csv');

        await clickButton(container, 'Preview rows');
        await waitForText(container, 'Game vs Tigers');
        await clickButton(container, 'Import rows');

        await waitForText(container, 'Imported 1 row(s); 1 row(s) failed and remain below for retry.');
        expect(container.textContent).toContain('Firestore write failed');
        expect(container.textContent).toContain('Game vs Tigers');
        expect(container.textContent).not.toContain('Row 3: Practice');
        expect(scheduleMocks.finalizeScheduleImportBatch).not.toHaveBeenCalled();
    });

    it('finalizes large CSV imports with the successful import count after partial failures', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: true })]
        });
        scheduleMocks.createScheduleImportPractice.mockRejectedValueOnce(new Error('Practice write failed'));
        scheduleMocks.createScheduleImportGame
            .mockResolvedValueOnce('game-1')
            .mockResolvedValueOnce('game-2')
            .mockResolvedValueOnce('game-4');

        const { container } = await renderSchedule();
        await waitForText(container, 'Import schedule CSV');
        const input = container.querySelector('input[aria-label="Schedule CSV file"]');
        const file = new File([
            'Type,Date,Start,Opponent,Location\n',
            'Game,4/2/2026,6:30 PM,Tigers,Field 1\n',
            'Game,4/3/2026,6:30 PM,Hawks,Field 2\n',
            'Practice,4/4/2026,7:00 AM,,Field 3\n',
            'Game,4/5/2026,8:00 AM,Lions,Field 4\n'
        ], 'large-partial-schedule.csv', { type: 'text/csv' });

        await act(async () => {
            Object.defineProperty(input, 'files', { value: [file], configurable: true });
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        await waitForText(container, 'Loaded large-partial-schedule.csv');

        await clickButton(container, 'Preview rows');
        await waitForText(container, 'Game vs Tigers');
        await clickButton(container, 'Import rows');

        await waitForText(container, 'Imported 3 row(s); 1 row(s) failed and remain below for retry.');
        expect(scheduleMocks.finalizeScheduleImportBatch).toHaveBeenCalledWith('team-1', expect.any(String), 3, auth.user);
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
        await waitForText(container, 'Add game for Bears');

        const teamOnePanel = container.querySelector('section[aria-label="Create game"]');
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
