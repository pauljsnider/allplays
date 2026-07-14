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
        { playerId: 'player-1', playerName: 'Avery Smith', parentEmails: ['one@example.com'], hasEligibleParentEmail: true },
        { playerId: 'player-2', playerName: 'Blake Jones', parentEmails: ['two@example.com'], hasEligibleParentEmail: true }
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

function TestPanel({
    eventOverrides = {},
    refreshToken = 0,
    staffRsvpLoader
}: {
    eventOverrides?: Record<string, unknown>;
    refreshToken?: number;
    staffRsvpLoader: ReturnType<typeof createStaffRsvpLoader>;
}) {
    const event = buildEvent(eventOverrides);
    return (
        <ScheduleEventDetailProvider
            value={{
                auth,
                event,
                childEvents: [event],
                refreshEvent: vi.fn(),
                updateEvents: vi.fn()
            }}
        >
            <StaffRsvpReminderPanel refreshToken={refreshToken} staffRsvpLoader={staffRsvpLoader} />
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
        expect(screen.queryByRole('button', { name: 'Review players without email' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

        await waitFor(() => {
            expect(sendStaffRsvpReminder).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user, auth.profile);
        });
        expect(screen.getByText('RSVP reminder sent to team chat and 3 parent/guardian emails.')).toBeTruthy();
        expect(screen.getByText('Sent')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Send reminder' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Send again' })).toBeTruthy();
    });

    it('warns about partial email coverage and reveals uncovered players without blocking send', async () => {
        const partialPreview = {
            ...preview,
            eligibleEmailCount: 1,
            players: [
                { playerId: 'player-1', playerName: 'Avery Smith', parentEmails: ['one@example.com'], hasEligibleParentEmail: true },
                { playerId: 'player-2', playerName: 'Blake Jones', parentEmails: [], hasEligibleParentEmail: false }
            ]
        };
        const staffRsvpLoader = createStaffRsvpLoader();
        staffRsvpLoader.loadReminderPreview.mockResolvedValue(partialPreview);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

        renderPanel({}, staffRsvpLoader);

        expect(await screen.findByText('1 no-response player has no eligible parent/guardian email. Reminder still posts to team chat; emails only reach eligible guardians.')).toBeVisible();
        expect(screen.queryByText('Blake Jones')).toBeNull();
        const disclosure = screen.getByRole('button', { name: 'Review players without email' });
        expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(disclosure);
        expect(screen.getByText('Blake Jones')).toBeVisible();
        expect(screen.queryByText('Avery Smith')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

        expect(confirmSpy).toHaveBeenCalledWith('Send an RSVP reminder to 2 no-response players? 1 eligible parent/guardian email will be targeted. 1 no-response player has no eligible parent/guardian email. The reminder will also post to team chat.');
        expect(sendStaffRsvpReminder).not.toHaveBeenCalled();
    });

    it('uses team-chat-only copy and the existing send path when no email is eligible', async () => {
        const zeroEmailPreview = {
            ...preview,
            eligibleEmailCount: 0,
            players: [
                { playerId: 'player-1', playerName: 'Avery Smith', parentEmails: [], hasEligibleParentEmail: false },
                { playerId: 'player-2', playerName: 'Blake Jones', parentEmails: [], hasEligibleParentEmail: false }
            ]
        };
        const staffRsvpLoader = createStaffRsvpLoader();
        staffRsvpLoader.loadReminderPreview.mockResolvedValue(zeroEmailPreview);
        vi.mocked(sendStaffRsvpReminder).mockResolvedValue({
            ...zeroEmailPreview,
            emailSentCount: 0
        });
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        renderPanel({}, staffRsvpLoader);

        expect(await screen.findByText('No eligible parent/guardian emails for 2 no-response players. Reminder will post to team chat only.')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Send reminder' })).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

        expect(confirmSpy).toHaveBeenCalledWith('Send an RSVP reminder to 2 no-response players? No parent/guardian emails will be sent. The reminder will post to team chat only.');
        await waitFor(() => {
            expect(sendStaffRsvpReminder).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), auth.user, auth.profile);
        });
        expect(screen.getByText('RSVP reminder sent to team chat. No parent/guardian emails were sent.')).toBeVisible();
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

    it('loads the latest event object when the reminder preview refreshes', async () => {
        const staffRsvpLoader = createStaffRsvpLoader();
        staffRsvpLoader.loadReminderPreview.mockResolvedValue(preview);

        const { rerender } = render(
            <TestPanel
                eventOverrides={{ location: 'Field 1' }}
                staffRsvpLoader={staffRsvpLoader}
            />
        );

        await waitFor(() => {
            expect(staffRsvpLoader.loadReminderPreview).toHaveBeenCalledTimes(1);
        });

        rerender(
            <TestPanel
                eventOverrides={{ location: 'Field 2' }}
                refreshToken={1}
                staffRsvpLoader={staffRsvpLoader}
            />
        );

        await waitFor(() => {
            expect(staffRsvpLoader.loadReminderPreview).toHaveBeenCalledTimes(2);
        });
        expect(staffRsvpLoader.loadReminderPreview).toHaveBeenLastCalledWith(
            expect.objectContaining({ location: 'Field 2' }),
            auth.user
        );
    });

    it('shows a recoverable error when preview loading fails', async () => {
        const staffRsvpLoader = createStaffRsvpLoader();
        staffRsvpLoader.loadReminderPreview
            .mockRejectedValueOnce(new Error('Preview service unavailable.'))
            .mockResolvedValueOnce(preview);

        renderPanel({}, staffRsvpLoader);

        expect(await screen.findByText('Preview service unavailable.')).toBeVisible();
        const retryButton = screen.getByRole('button', { name: 'Retry preview' });
        expect(retryButton).toBeVisible();

        fireEvent.click(retryButton);

        expect(await screen.findByRole('button', { name: 'Send reminder' })).toBeVisible();
        expect(staffRsvpLoader.loadReminderPreview).toHaveBeenCalledTimes(2);
        expect(screen.queryByText('Preview service unavailable.')).toBeNull();
    });
});
