// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Profile } from './Profile';
import type { AuthState } from '../lib/types';

const profileServiceMocks = vi.hoisted(() => ({
    createProfileAccessCode: vi.fn(),
    loadNotificationPreferences: vi.fn(),
    loadNotificationTeams: vi.fn(),
    loadParentTeams: vi.fn(),
    loadProfileAccessCodes: vi.fn(),
    loadProfileDocument: vi.fn(),
    normalizeNotificationPreferences: vi.fn(() => ({ liveChat: false, liveScore: false, schedule: false })),
    requestAccountMerge: vi.fn(),
    saveNotificationPreferences: vi.fn(),
    saveProfileDocument: vi.fn(),
    uploadProfilePhoto: vi.fn()
}));

vi.mock('../lib/profileService', () => profileServiceMocks);
vi.mock('../lib/authService', () => ({
    describeAuthError: vi.fn(() => 'auth error'),
    reloadCurrentUser: vi.fn(),
    resendVerificationEmail: vi.fn(),
    sendResetEmail: vi.fn(),
    setCurrentUserPassword: vi.fn()
}));
vi.mock('../lib/pushService', () => ({
    enablePushNotificationsForUser: vi.fn()
}));
vi.mock('../lib/useShellLayout', () => ({
    useShellLayout: vi.fn(() => ({ isDesktopWeb: false }))
}));

const auth: AuthState = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Parent User',
        emailVerified: true
    } as any,
    profile: null,
    loading: false,
    error: null,
    roles: ['parent'],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn(),
    signOut: vi.fn()
};

function renderProfile() {
    return render(
        <MemoryRouter>
            <Profile auth={auth} />
        </MemoryRouter>
    );
}

describe('Profile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('scrollTo', vi.fn());
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 0;
        });
        profileServiceMocks.loadProfileDocument.mockResolvedValue({ fullName: 'Parent User', signInMethod: 'password', hasPassword: true });
        profileServiceMocks.loadNotificationTeams.mockResolvedValue([{ id: 'team-1', name: 'Bears' }]);
        profileServiceMocks.loadNotificationPreferences.mockResolvedValue({ liveChat: false, liveScore: false, schedule: false });
        profileServiceMocks.loadProfileAccessCodes.mockResolvedValue([{ id: 'code-1', code: 'ABCD1234', used: false }]);
        profileServiceMocks.loadParentTeams.mockResolvedValue([{ id: 'team-1', name: 'Bears' }]);
        profileServiceMocks.requestAccountMerge.mockResolvedValue('merge-1');
    });

    it('loads only account data on initial render', async () => {
        renderProfile();

        expect(await screen.findByRole('heading', { name: 'Your Account' })).toBeInTheDocument();
        await waitFor(() => {
            expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledWith('user-1');
        });
        expect(profileServiceMocks.loadNotificationTeams).not.toHaveBeenCalled();
        expect(profileServiceMocks.loadNotificationPreferences).not.toHaveBeenCalled();
        expect(profileServiceMocks.loadProfileAccessCodes).not.toHaveBeenCalled();
        expect(profileServiceMocks.loadParentTeams).not.toHaveBeenCalled();
    });

    it('loads alerts data once when Alerts opens and reuses it on return', async () => {
        renderProfile();

        fireEvent.click(await screen.findByRole('button', { name: 'Alerts' }));

        await waitFor(() => {
            expect(profileServiceMocks.loadNotificationTeams).toHaveBeenCalledTimes(1);
            expect(profileServiceMocks.loadNotificationTeams).toHaveBeenCalledWith('user-1', 'parent@example.com');
        });
        await waitFor(() => {
            expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledTimes(1);
            expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledWith('user-1', 'team-1');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        fireEvent.click(screen.getByRole('button', { name: 'Alerts' }));

        await waitFor(() => {
            expect(profileServiceMocks.loadNotificationTeams).toHaveBeenCalledTimes(1);
            expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledTimes(1);
        });
        expect(profileServiceMocks.loadParentTeams).not.toHaveBeenCalled();
    });

    it('loads invite history only when Invites opens and reuses it on return', async () => {
        renderProfile();

        fireEvent.click(await screen.findByRole('button', { name: 'Invites' }));

        await waitFor(() => {
            expect(profileServiceMocks.loadProfileAccessCodes).toHaveBeenCalledTimes(1);
            expect(profileServiceMocks.loadProfileAccessCodes).toHaveBeenCalledWith('user-1');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        fireEvent.click(screen.getByRole('button', { name: 'Invites' }));

        await waitFor(() => {
            expect(profileServiceMocks.loadProfileAccessCodes).toHaveBeenCalledTimes(1);
        });
    });

    it('loads parent-linked teams only when merge options expand and does not refetch', async () => {
        renderProfile();

        fireEvent.click(await screen.findByRole('button', { name: 'Merge another account' }));

        await waitFor(() => {
            expect(profileServiceMocks.loadParentTeams).toHaveBeenCalledTimes(1);
            expect(profileServiceMocks.loadParentTeams).toHaveBeenCalledWith('user-1');
        });
        expect(profileServiceMocks.loadNotificationTeams).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Security' }));
        fireEvent.click(screen.getByRole('button', { name: 'Account' }));

        await waitFor(() => {
            expect(profileServiceMocks.loadParentTeams).toHaveBeenCalledTimes(1);
        });
    });

    it('shows a neutral message when no parent-linked teams are available', async () => {
        profileServiceMocks.loadParentTeams.mockResolvedValue([]);

        renderProfile();

        fireEvent.click(await screen.findByRole('button', { name: 'Merge another account' }));

        expect(await screen.findByText('No parent-linked teams are available for account merge.')).toBeInTheDocument();
    });

    it('rejects invalid and same-account emails without calling the merge service', async () => {
        renderProfile();

        fireEvent.click(await screen.findByRole('button', { name: 'Merge another account' }));
        await waitFor(() => {
            expect(profileServiceMocks.loadParentTeams).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Request merge' }));
        expect(await screen.findByText('Enter the email address for the other account.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Secondary account email'), { target: { value: 'not-an-email' } });
        fireEvent.click(screen.getByRole('button', { name: 'Request merge' }));
        expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Secondary account email'), { target: { value: 'parent@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Request merge' }));
        expect(await screen.findByText('Enter a different email than the account you are signed in with.')).toBeInTheDocument();
        expect(profileServiceMocks.requestAccountMerge).not.toHaveBeenCalled();
    });

    it('submits a valid merge request, clears the field, and shows pending verification', async () => {
        renderProfile();

        fireEvent.click(await screen.findByRole('button', { name: 'Merge another account' }));
        await waitFor(() => {
            expect(profileServiceMocks.loadParentTeams).toHaveBeenCalledTimes(1);
        });

        const input = screen.getByLabelText('Secondary account email') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'child@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Request merge' }));

        await waitFor(() => {
            expect(profileServiceMocks.requestAccountMerge).toHaveBeenCalledWith('user-1', 'parent@example.com', 'child@example.com');
        });
        expect(await screen.findByText('Merge request pending verification. We will verify the other email before moving any account data.')).toBeInTheDocument();
        expect(input.value).toBe('');
    });
});
