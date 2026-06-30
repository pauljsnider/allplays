// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendStaffRsvpReminder } from '../../lib/scheduleService';
import { ScheduleEventDetailProvider } from '../../pages/schedule/ScheduleEventDetailContext';
import { StaffRsvpReminderPanel } from './StaffRsvpReminderPanel';
import type { AuthState } from '../../lib/types';

vi.mock('../../lib/scheduleService', () => ({
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

function createStaffRsvpLoader() {
    return {
        loadBreakdown: vi.fn(),
        loadReminderPreview: vi.fn(),
        invalidateEvent: vi.fn()
    };
}

function renderPanel(eventOverrides: Record<string, unknown> = {}, staffRsvpLoader = createStaffRsvpLoader()) {
    return {
        ...render(
            <ScheduleEventDetailProvider
                value={{
                    auth,
                    event: buildEvent(eventOverrides),
                    childEvents: [buildEvent(eventOverrides)],
                    refreshEvent: vi.fn(),
                    updateEvents: vi.fn()
                }}
            >
                <StaffRsvpReminderPanel staffRsvpLoader={staffRsvpLoader} />
            </ScheduleEventDetailProvider>
        ),
        staffRsvpLoader
    };
}

describe('StaffRsvpReminderPanel', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    it('loads reminder preview and sends a confirmed reminder', async () => {
        const staffRsvpLoader = createStaffRsvpLoader();
        staffRsvpLoader.loadReminderPreview.mockResolvedValue(preview);
        vi.mocked(sendStaffRsvpReminder).mockResolvedValue({
            ...preview,
            emailSentCount: 3
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        renderPanel({}, staffRsvpLoader);

        await waitFor(() => {
            expect(screen.getByText('Staff RSVP reminder')).toBeTruthy();
        });
        expect(staffRsvpLoader.loadReminderPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user);
        expect(screen.getByText('2 no-response players · 3 eligible parent/guardian emails.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

        await waitFor(() => {
            expect(sendStaffRsvpReminder).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user, auth.profile);
        });
        expect(screen.getByText('RSVP reminder sent to team chat and 3 parent/guardian emails.')).toBeTruthy();
        expect(screen.getByText('Sent')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Send reminder' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Send again' })).toBeTruthy();
    });

    it('keeps repeat reminders secondary and confirmed after a successful send', async () => {
        const staffRsvpLoader = createStaffRsvpLoader();
        staffRsvpLoader.loadReminderPreview.mockResolvedValue(preview);
        vi.mocked(sendStaffRsvpReminder).mockResolvedValue({
            ...preview,
            emailSentCount: 3
        });
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValueOnce(true);

        renderPanel({}, staffRsvpLoader);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Send reminder' })).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Send again' })).toBeTruthy();
        });
        expect(sendStaffRsvpReminder).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
        expect(confirmSpy).toHaveBeenCalledTimes(2);
        expect(sendStaffRsvpReminder).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Send again' }));

        await waitFor(() => {
            expect(sendStaffRsvpReminder).toHaveBeenCalledTimes(2);
        });
        expect(confirmSpy).toHaveBeenCalledTimes(3);
    });

    it('does not render when there are no missing player RSVPs', async () => {
        const staffRsvpLoader = createStaffRsvpLoader();
        staffRsvpLoader.loadReminderPreview.mockResolvedValue({
            ...preview,
            missingPlayerCount: 0
        });

        renderPanel({}, staffRsvpLoader);

        await waitFor(() => {
            expect(staffRsvpLoader.loadReminderPreview).toHaveBeenCalled();
        });
        expect(screen.queryByText('Staff RSVP reminder')).toBeNull();
    });
});
