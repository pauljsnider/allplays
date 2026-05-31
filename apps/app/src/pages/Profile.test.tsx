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

describe('Profile account merge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('scrollTo', vi.fn());
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 0;
        });
        profileServiceMocks.loadProfileDocument.mockResolvedValue({ fullName: 'Parent User', signInMethod: 'password', hasPassword: true });
        profileServiceMocks.loadNotificationTeams.mockResolvedValue([]);
        profileServiceMocks.loadNotificationPreferences.mockResolvedValue({ liveChat: false, liveScore: false, schedule: false });
        profileServiceMocks.loadProfileAccessCodes.mockResolvedValue([]);
        profileServiceMocks.requestAccountMerge.mockResolvedValue('merge-1');
    });

    it('shows the merge entry point for parent-linked users', async () => {
        profileServiceMocks.loadParentTeams.mockResolvedValue([{ id: 'team-1', name: 'Bears' }]);

        renderProfile();

        expect(await screen.findByRole('button', { name: 'Merge another account' })).toBeInTheDocument();
    });

    it('hides the merge entry point for users without parent-linked teams', async () => {
        profileServiceMocks.loadParentTeams.mockResolvedValue([]);

        renderProfile();

        await waitFor(() => {
            expect(profileServiceMocks.loadParentTeams).toHaveBeenCalledWith('user-1');
        });
        expect(screen.queryByRole('button', { name: 'Merge another account' })).not.toBeInTheDocument();
    });

    it('rejects invalid and same-account emails without calling the merge service', async () => {
        profileServiceMocks.loadParentTeams.mockResolvedValue([{ id: 'team-1', name: 'Bears' }]);

        renderProfile();

        fireEvent.click(await screen.findByRole('button', { name: 'Merge another account' }));

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
        profileServiceMocks.loadParentTeams.mockResolvedValue([{ id: 'team-1', name: 'Bears' }]);

        renderProfile();

        fireEvent.click(await screen.findByRole('button', { name: 'Merge another account' }));

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
