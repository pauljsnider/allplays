import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createParentDashboardRsvpController } from '../../js/parent-dashboard-rsvp-controls.js';
import { resolveRsvpPlayerIdsForSubmission } from '../../js/parent-dashboard-rsvp.js';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('parent dashboard RSVP controller', () => {
    it('submits grouped row RSVP only for that row child ids and updates matching local state', async () => {
        const allScheduleEvents = [
            { teamId: 'team-1', id: 'game-1', childId: 'child-a', myRsvp: null, rsvpSummary: null },
            { teamId: 'team-1', id: 'game-1', childId: 'child-b', myRsvp: null, rsvpSummary: null },
            { teamId: 'team-1', id: 'game-2', childId: 'child-c', myRsvp: null, rsvpSummary: null }
        ];
        const submitRsvp = vi.fn().mockResolvedValue({ going: 2, maybe: 0, notGoing: 0, notResponded: 0, total: 2 });
        const submitRsvpForPlayer = vi.fn();
        const renderScheduleFromControls = vi.fn();
        const controller = createParentDashboardRsvpController({
            getAllScheduleEvents: () => allScheduleEvents,
            getCurrentUserId: () => 'parent-1',
            getCurrentUser: () => ({ displayName: 'Parent One', email: 'parent@example.com' }),
            documentRef: {
                getElementById(id) {
                    if (id === 'player-filter') return { value: '' };
                    return null;
                }
            },
            resolveRsvpPlayerIdsForSubmission,
            submitRsvp,
            submitRsvpForPlayer,
            renderScheduleFromControls,
            alertFn: vi.fn(),
            consoleRef: { error: vi.fn() }
        });

        await controller.submitGameRsvpFromButton({
            dataset: {
                teamId: 'team-1',
                gameId: 'game-1',
                childIds: 'child-a,child-b'
            }
        }, 'going');

        expect(submitRsvp).toHaveBeenCalledWith('team-1', 'game-1', 'parent-1', {
            displayName: 'Parent One',
            playerIds: ['child-a', 'child-b'],
            response: 'going'
        });
        expect(submitRsvpForPlayer).not.toHaveBeenCalled();
        expect(allScheduleEvents[0].myRsvp).toBe('going');
        expect(allScheduleEvents[1].myRsvp).toBe('going');
        expect(allScheduleEvents[0].rsvpSummary).toEqual({ going: 2, maybe: 0, notGoing: 0, notResponded: 0, total: 2 });
        expect(allScheduleEvents[1].rsvpSummary).toEqual({ going: 2, maybe: 0, notGoing: 0, notResponded: 0, total: 2 });
        expect(allScheduleEvents[2].myRsvp).toBeNull();
        expect(renderScheduleFromControls).toHaveBeenCalledTimes(1);
    });

    it('submits a per-child card RSVP only for the clicked child and leaves siblings unchanged', async () => {
        const allScheduleEvents = [
            { teamId: 'team-1', id: 'game-1', childId: 'child-a', myRsvp: null, rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 2, total: 2 } },
            { teamId: 'team-1', id: 'game-1', childId: 'child-b', myRsvp: 'going', rsvpSummary: { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 } },
            { teamId: 'team-1', id: 'game-2', childId: 'child-c', myRsvp: null, rsvpSummary: null }
        ];
        const submitRsvp = vi.fn();
        const submitRsvpForPlayer = vi.fn().mockResolvedValue({ going: 1, maybe: 0, notGoing: 1, notResponded: 0, total: 2 });
        const renderScheduleFromControls = vi.fn();
        const controller = createParentDashboardRsvpController({
            getAllScheduleEvents: () => allScheduleEvents,
            getCurrentUserId: () => 'parent-1',
            getCurrentUser: () => ({ email: 'parent@example.com' }),
            documentRef: {
                getElementById(id) {
                    if (id === 'player-filter') return { value: '' };
                    return null;
                }
            },
            resolveRsvpPlayerIdsForSubmission,
            submitRsvp,
            submitRsvpForPlayer,
            renderScheduleFromControls,
            alertFn: vi.fn(),
            consoleRef: { error: vi.fn() }
        });

        await controller.submitGameRsvpFromButton({
            dataset: {
                teamId: 'team-1',
                gameId: 'game-1',
                childId: 'child-a'
            }
        }, 'not_going');

        expect(submitRsvpForPlayer).toHaveBeenCalledWith('team-1', 'game-1', 'parent-1', {
            displayName: 'parent@example.com',
            playerId: 'child-a',
            response: 'not_going'
        });
        expect(submitRsvp).not.toHaveBeenCalled();
        expect(allScheduleEvents[0].myRsvp).toBe('not_going');
        expect(allScheduleEvents[0].rsvpSummary).toEqual({ going: 1, maybe: 0, notGoing: 1, notResponded: 0, total: 2 });
        expect(allScheduleEvents[1].myRsvp).toBe('going');
        expect(allScheduleEvents[1].rsvpSummary).toEqual({ going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 });
        expect(allScheduleEvents[2].myRsvp).toBeNull();
        expect(renderScheduleFromControls).toHaveBeenCalledTimes(1);
    });

    it('reads the current schedule array from the accessor after init-time reassignment', async () => {
        let allScheduleEvents = [];
        const submitRsvp = vi.fn().mockResolvedValue({ going: 1, maybe: 0, notGoing: 0, notResponded: 0, total: 1 });
        const submitRsvpForPlayer = vi.fn();
        const renderScheduleFromControls = vi.fn();
        const controller = createParentDashboardRsvpController({
            getAllScheduleEvents: () => allScheduleEvents,
            getCurrentUserId: () => 'parent-1',
            getCurrentUser: () => ({ displayName: 'Parent One', email: 'parent@example.com' }),
            documentRef: {
                getElementById(id) {
                    if (id === 'player-filter') return { value: '' };
                    return null;
                }
            },
            resolveRsvpPlayerIdsForSubmission,
            submitRsvp,
            submitRsvpForPlayer,
            renderScheduleFromControls,
            alertFn: vi.fn(),
            consoleRef: { error: vi.fn() }
        });

        allScheduleEvents = [
            { teamId: 'team-1', id: 'game-1', childId: 'child-a', myRsvp: null, rsvpSummary: null }
        ];

        await controller.submitGameRsvpFromButton({
            dataset: {
                teamId: 'team-1',
                gameId: 'game-1',
                childId: 'child-a'
            }
        }, 'going');

        expect(submitRsvpForPlayer).toHaveBeenCalledWith('team-1', 'game-1', 'parent-1', {
            displayName: 'Parent One',
            playerId: 'child-a',
            response: 'going'
        });
        expect(allScheduleEvents[0].myRsvp).toBe('going');
    });
});

describe('parent dashboard RSVP wiring', () => {
    const html = readRepoFile('parent-dashboard.html');

    it('imports the RSVP controller helper and preserves grouped plus per-child button datasets', () => {
        expect(html).toContain("import { createParentDashboardRsvpController } from './js/parent-dashboard-rsvp-controls.js?v=1';");
        expect(html).toContain('const { submitGameRsvp, submitGameRsvpFromButton } = createParentDashboardRsvpController({');
        expect(html).toContain('data-child-ids="${escapeAttr((ev.childIds || []).join(\',\'))}"');
        expect(html).toContain('data-child-id="${escapeAttr(game.childId || game.playerId || \'\')}"');
    });

    it('exports the RSVP button handler only after the controller destructuring runs', () => {
        const controllerInitIndex = html.indexOf('const { submitGameRsvp, submitGameRsvpFromButton } = createParentDashboardRsvpController({');
        const windowExportIndex = html.indexOf('window.submitGameRsvpFromButton = submitGameRsvpFromButton;');

        expect(controllerInitIndex).toBeGreaterThan(-1);
        expect(windowExportIndex).toBeGreaterThan(controllerInitIndex);
    });
});
