// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    loadStaffRsvpReminderPreview,
    sendStaffRsvpReminder
} from '../../lib/scheduleService';
import { ScheduleEventDetailProvider } from '../../pages/schedule/ScheduleEventDetailContext';
import { StaffRsvpReminderPanel } from './StaffRsvpReminderPanel';
import type { AuthState } from '../../lib/types';

vi.mock('../../lib/scheduleService', () => ({
    loadStaffRsvpReminderPreview: vi.fn(),
    sendStaffRsvpReminder: vi.fn()
}));

const auth: AuthState = {
    user: {
        uid: 'coach-1',
        email: 'coach@example.com',
        displayName: 'Coach One'
    } as any,
    profile: { displayName: 'Coach One' },
    loading: false,
    error: null,
    roles: [],
    isParent: false,
    isCoach: true,
    isAdmin: true,
    isPlatformAdmin: false,
    refresh: vi.fn(),
    signOut: vi.fn()
};

const preview = {
    missingPlayerCount: 2,
    eligibleEmailCount: 3,
    players: [
        { playerId: 'player-1', playerName: 'Avery Smith', parentEmails: ['one@example.com'] },
        { playerId: 'player-2', playerName: 'Blake Jones', parentEmails: ['two@example.com'] }
    ]
} as any;

function buildEvent(overrides: Record<string, unknown> = {}) {
    return {
        eventKey: 'team-1::game-1::player-1',
        id: 'game-1',
        teamId: 'team-1',
        childId: 'player-1',
        childName: 'Avery Smith',
        isDbGame: true,
        isCancelled: false,
        isTeamRsvpReminderManager: true,
        ...overrides
    } as any;
}

function renderPanel(eventOverrides: Record<string, unknown> = {}) {
    return render(
        <ScheduleEventDetailProvider
            value={{
                auth,
                event: buildEvent(eventOverrides),
                childEvents: [buildEvent(eventOverrides)],
                refreshEvent: vi.fn(),
                updateEvents: vi.fn()
            }}
        >
            <StaffRsvpReminderPanel />
        </ScheduleEventDetailProvider>
    );
}

describe('StaffRsvpReminderPanel', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    it('loads reminder preview and sends a confirmed reminder', async () => {
        vi.mocked(loadStaffRsvpReminderPreview).mockResolvedValue(preview);
        vi.mocked(sendStaffRsvpReminder).mockResolvedValue({
            ...preview,
            emailSentCount: 3
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        renderPanel();

        await waitFor(() => {
            expect(screen.getByText('Staff RSVP reminder')).toBeTruthy();
        });
        expect(screen.getByText('2 no-response players · 3 eligible parent/guardian emails.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

        await waitFor(() => {
            expect(sendStaffRsvpReminder).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user, auth.profile);
        });
        expect(screen.getByText('RSVP reminder sent to team chat and 3 parent/guardian emails.')).toBeTruthy();
    });

    it('does not render when there are no missing player RSVPs', async () => {
        vi.mocked(loadStaffRsvpReminderPreview).mockResolvedValue({
            ...preview,
            missingPlayerCount: 0
        });

        renderPanel();

        await waitFor(() => {
            expect(loadStaffRsvpReminderPreview).toHaveBeenCalled();
        });
        expect(screen.queryByText('Staff RSVP reminder')).toBeNull();
    });
});
