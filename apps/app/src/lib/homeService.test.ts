// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAppDataCache } from './appDataCache';

const chatServiceMocks = vi.hoisted(() => ({
    loadChatInbox: vi.fn()
}));

const scheduleServiceMocks = vi.hoisted(() => ({
    hydrateParentScheduleDetails: vi.fn(),
    loadParentSchedule: vi.fn(),
    loadParentScheduleScope: vi.fn()
}));

const feesMocks = vi.hoisted(() => ({
    listParentTeamFeeRecipients: vi.fn(),
    normalizeParentFeeRecord: vi.fn((value) => value)
}));

vi.mock('./chatService', () => chatServiceMocks);
vi.mock('./scheduleService', () => scheduleServiceMocks);
vi.mock('./adapters/legacyHomeFees', () => feesMocks);
vi.mock('./uxTiming', () => ({
    startUxTimer: vi.fn(() => ({ end: vi.fn() }))
}));
vi.mock('./logger', () => ({
    createLogger: vi.fn(() => ({ warn: vi.fn() }))
}));

import { loadParentHomeSummary, loadParentTeamsSummaryBootstrap } from './homeService';

const user = {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent'
} as any;

describe('homeService Teams bootstrap reuse', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAppDataCache();
        window.localStorage.clear();
        chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: [] });
        feesMocks.listParentTeamFeeRecipients.mockResolvedValue([]);
        scheduleServiceMocks.hydrateParentScheduleDetails.mockImplementation(async (schedule) => schedule);
    });

    it('reuses the fast summary schedule scope for teams enrichment without persisting the profile', async () => {
        const scheduleScope = {
            profile: { parentTeamIds: ['team-1'], notifyByEmail: true },
            children: [{
                teamId: 'team-1',
                teamName: 'Fast Falcons',
                playerId: 'player-1',
                playerName: 'Avery Ace'
            }]
        };
        scheduleServiceMocks.loadParentScheduleScope.mockResolvedValue(scheduleScope);
        scheduleServiceMocks.loadParentSchedule.mockImplementation(async (_authUser, options) => ({
            children: options?.parentScope?.children || [],
            events: []
        }));

        const fastSummary = await loadParentTeamsSummaryBootstrap(user, { force: true });
        await loadParentHomeSummary(user, {
            force: true,
            scheduleScope: fastSummary.scheduleScope
        });

        expect(scheduleServiceMocks.loadParentScheduleScope).toHaveBeenCalledTimes(1);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledTimes(1);
        expect(scheduleServiceMocks.loadParentSchedule).toHaveBeenCalledWith(user, expect.objectContaining({
            hydrateDetails: false,
            expandStaffPlayers: false,
            parentScope: scheduleScope
        }));
        expect(window.localStorage.getItem('allplays:appDataCache:teams-summary-bootstrap%3Aparent-1')).toBeNull();
    });
});
