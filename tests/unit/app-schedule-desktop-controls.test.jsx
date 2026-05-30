// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const scheduleMocks = vi.hoisted(() => ({
    addTeamCalendarUrl: vi.fn(),
    loadParentSchedule: vi.fn()
}));

vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);
vi.mock('../../apps/app/src/lib/useShellLayout.ts', () => ({
    useShellLayout: () => ({ isDesktopWeb: true, isNative: false, isMobileWeb: false })
}));

import { Schedule } from '../../apps/app/src/pages/Schedule.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent'
    }
};

function event(overrides = {}) {
    return {
        eventKey: overrides.eventKey || 'team-1::game-1::player-1',
        id: overrides.id || 'game-1',
        teamId: overrides.teamId || 'team-1',
        teamName: overrides.teamName || 'Bears',
        type: overrides.type || 'game',
        date: overrides.date || new Date('2099-05-28T18:00:00Z'),
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
    for (let index = 0; index < 25; index += 1) {
        if (container.textContent.includes(text)) return;
        await act(async () => {
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

async function changeSelect(select, value) {
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    scheduleMocks.addTeamCalendarUrl.mockResolvedValue({ added: true, calendarUrls: ['https://example.com/team.ics'] });
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
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledTimes(2);
        await waitForText(container, 'Calendar link saved and schedule refreshed.');
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
        const staff = await renderSchedule();
        await waitForText(staff.container, 'Add external calendar');
        await clickButton(staff.container, 'Save calendar');

        expect(staff.container.textContent).toContain('Enter a calendar .ics URL.');
        expect(scheduleMocks.addTeamCalendarUrl).not.toHaveBeenCalled();
    });

});
