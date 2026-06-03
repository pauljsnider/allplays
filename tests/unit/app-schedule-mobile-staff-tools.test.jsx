// @vitest-environment jsdom
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const scheduleMocks = vi.hoisted(() => ({
    addTeamCalendarUrl: vi.fn(),
    createScheduleImportGame: vi.fn(),
    createScheduleImportPractice: vi.fn(),
    loadParentSchedule: vi.fn(),
    removeTeamCalendarUrl: vi.fn(),
    generateScheduleAiImportRows: vi.fn()
}));

vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);
vi.mock('../../apps/app/src/lib/scheduleAiImport.ts', () => ({
    generateScheduleAiImportRows: scheduleMocks.generateScheduleAiImportRows
}));
vi.mock('../../apps/app/src/lib/useShellLayout.ts', () => ({
    useShellLayout: () => ({ isDesktopWeb: false, isNative: true, isMobileWeb: false })
}));

import { Schedule } from '../../apps/app/src/pages/Schedule.tsx';
import { clearAppDataCache } from '../../apps/app/src/lib/appDataCache.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'coach@example.com',
        displayName: 'Casey Coach'
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
        date: overrides.date || futureDate(24),
        location: overrides.location || 'Main Gym',
        opponent: overrides.opponent || 'Falcons',
        childId: overrides.childId || 'player-1',
        childName: overrides.childName || 'Pat',
        isDbGame: overrides.isDbGame !== false,
        isCancelled: overrides.isCancelled === true,
        myRsvp: overrides.myRsvp || 'not_responded',
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

async function clickButton(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    clearAppDataCache('app-schedule-summary');
    document.body.innerHTML = '';
    scheduleMocks.loadParentSchedule.mockResolvedValue({
        children: [
            { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
        ],
        events: [event({ isTeamStaff: true })]
    });
    scheduleMocks.addTeamCalendarUrl.mockResolvedValue({ added: true, calendarUrls: [] });
    scheduleMocks.createScheduleImportGame.mockResolvedValue('game-new');
    scheduleMocks.createScheduleImportPractice.mockResolvedValue('practice-new');
    scheduleMocks.removeTeamCalendarUrl.mockResolvedValue({ removed: true, calendarUrls: [] });
    scheduleMocks.generateScheduleAiImportRows.mockResolvedValue({ rows: [], errors: [] });
});

describe('React app mobile Schedule staff tools', () => {
    it('keeps staff tools collapsed until opened on mobile layouts', async () => {
        const { container } = await renderSchedule();
        await waitForText(container, 'Main Gym');

        expect(container.textContent).toContain('Staff schedule tools');
        expect(container.textContent).not.toContain('Add external calendar');
        expect(container.textContent).not.toContain('Draft schedule with AI');
        expect(container.textContent).not.toContain('Import schedule CSV');

        await clickButton(container, 'Staff schedule tools');

        await waitForText(container, 'Add external calendar');
        expect(container.textContent).toContain('Draft schedule with AI');
        expect(container.textContent).toContain('Import schedule CSV');
    });

    it('hides the mobile disclosure for parent-only users', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [
                { playerId: 'player-1', playerName: 'Pat', teamId: 'team-1', teamName: 'Bears' }
            ],
            events: [event({ isTeamStaff: false })]
        });

        const { container } = await renderSchedule();
        await waitForText(container, 'Main Gym');

        expect(container.textContent).not.toContain('Staff schedule tools');
        expect(container.textContent).not.toContain('Add external calendar');
    });
});
