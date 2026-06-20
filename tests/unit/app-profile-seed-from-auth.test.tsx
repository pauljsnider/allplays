// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Profile } from '../../apps/app/src/pages/Profile';
import type { AuthState } from '../../apps/app/src/lib/types';

const profileServiceMocks = vi.hoisted(() => ({
    acquireProfilePhoto: vi.fn(),
    createProfileAccessCode: vi.fn(),
    loadParentTeams: vi.fn(),
    loadNotificationPreferences: vi.fn(),
    loadNotificationTeams: vi.fn(),
    loadProfileAccessCodes: vi.fn(),
    loadProfileDocument: vi.fn(),
    normalizeNotificationPreferences: vi.fn((preferences?: any) => ({
        liveChat: preferences?.liveChat !== false,
        liveScore: preferences?.liveScore === true,
        schedule: preferences?.schedule !== false
    })),
    normalizeProfilePhoto: vi.fn(),
    requestAccountMerge: vi.fn(),
    saveNotificationPreferences: vi.fn(),
    saveProfileDocument: vi.fn(),
    uploadProfilePhoto: vi.fn()
}));

const publicActionsMocks = vi.hoisted(() => ({
    sharePublicUrl: vi.fn()
}));

const pushServiceMocks = vi.hoisted(() => ({
    enablePushNotificationsForUser: vi.fn(),
    getPushNotificationPermissionStatus: vi.fn(),
    openPushNotificationSettings: vi.fn(),
    runPushNotificationPrimer: vi.fn()
}));

const shellLayoutState = vi.hoisted(() => ({
    isDesktopWeb: false,
    isNative: false
}));

vi.mock('../../apps/app/src/lib/profileService', () => profileServiceMocks);
vi.mock('../../apps/app/src/lib/publicActions', () => publicActionsMocks);
vi.mock('../../apps/app/src/lib/pushService', () => pushServiceMocks);
vi.mock('../../apps/app/src/lib/useShellLayout', () => ({
    useShellLayout: () => shellLayoutState
}));
vi.mock('lucide-react', () => {
    const createIcon = (name: string) => (props: Record<string, unknown>) => React.createElement('svg', { ...props, 'data-icon': name });
    return {
        Bell: createIcon('Bell'),
        ChevronDown: createIcon('ChevronDown'),
        ChevronUp: createIcon('ChevronUp'),
        CheckCircle2: createIcon('CheckCircle2'),
        Clipboard: createIcon('Clipboard'),
        Copy: createIcon('Copy'),
        ImagePlus: createIcon('ImagePlus'),
        KeyRound: createIcon('KeyRound'),
        Link2: createIcon('Link2'),
        Loader2: createIcon('Loader2'),
        LogOut: createIcon('LogOut'),
        Mail: createIcon('Mail'),
        RefreshCw: createIcon('RefreshCw'),
        Save: createIcon('Save'),
        Send: createIcon('Send'),
        Share2: createIcon('Share2'),
        ShieldCheck: createIcon('ShieldCheck'),
        Trash2: createIcon('Trash2'),
        Upload: createIcon('Upload'),
        UserCircle: createIcon('UserCircle'),
        XCircle: createIcon('XCircle')
    };
});

vi.mock('../../apps/app/src/lib/authService', () => ({
    describeAuthError: (error: any) => error?.message || 'Authentication failed.',
    reloadCurrentUser: vi.fn(),
    resendVerificationEmail: vi.fn(),
    sendResetEmail: vi.fn(),
    setCurrentUserPassword: vi.fn()
}));

function buildAuth(overrides: Partial<AuthState> = {}): AuthState {
    return {
        user: {
            uid: 'user-1',
            email: 'test@example.com',
            displayName: 'Test User',
            emailVerified: true,
            roles: ['parent'],
            parentOf: []
        },
        profile: null,
        loading: false,
        error: null,
        roles: ['parent'],
        isParent: true,
        isCoach: false,
        isAdmin: false,
        isPlatformAdmin: false,
        refresh: vi.fn().mockResolvedValue(undefined),
        signOut: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

describe('Profile seed from auth.profile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('scrollTo', vi.fn());
        window.URL.createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
        window.URL.revokeObjectURL = vi.fn();
        profileServiceMocks.normalizeNotificationPreferences.mockClear();
        profileServiceMocks.loadNotificationTeams.mockResolvedValue([]);
        profileServiceMocks.loadProfileAccessCodes.mockResolvedValue([]);
        profileServiceMocks.loadParentTeams.mockResolvedValue([]);
        profileServiceMocks.loadNotificationPreferences.mockResolvedValue({ liveChat: true, liveScore: false, schedule: true });
        profileServiceMocks.saveNotificationPreferences.mockResolvedValue({ liveChat: true, liveScore: false, schedule: true });
        profileServiceMocks.saveProfileDocument.mockResolvedValue(undefined);
        profileServiceMocks.uploadProfilePhoto.mockResolvedValue('https://example.test/avatar.png');
        profileServiceMocks.normalizeProfilePhoto.mockImplementation(async (file: File) => file);
        pushServiceMocks.getPushNotificationPermissionStatus.mockResolvedValue({
            state: 'prompt',
            isNative: false,
            platform: 'web',
            canPrompt: true,
            canOpenSettings: false
        });
        pushServiceMocks.openPushNotificationSettings.mockResolvedValue(undefined);
        pushServiceMocks.runPushNotificationPrimer.mockResolvedValue(true);
        shellLayoutState.isDesktopWeb = false;
        shellLayoutState.isNative = false;
    });

    afterEach(() => {
        cleanup();
    });

    it('seeds fullName from auth.profile without calling loadProfileDocument', async () => {
        const auth = buildAuth({
            profile: {
                fullName: 'Test User',
                phone: '555-0199',
                photoUrl: '',
                email: 'test@example.com'
            }
        });

        render(
            <MemoryRouter>
                <Profile auth={auth} />
            </MemoryRouter>
        );

        // The full name field should be populated immediately from auth.profile
        const fullNameInput = await screen.findByPlaceholderText('Your name') as HTMLInputElement;
        await waitFor(() => expect(fullNameInput.value).toBe('Test User'));

        // loadProfileDocument must NOT have been called since auth.profile was present
        expect(profileServiceMocks.loadProfileDocument).not.toHaveBeenCalled();
    });

    it('seeds phone from auth.profile without a network round-trip', async () => {
        const auth = buildAuth({
            profile: {
                fullName: 'Test User',
                phone: '555-0199',
                photoUrl: '',
                email: 'test@example.com'
            }
        });

        render(
            <MemoryRouter>
                <Profile auth={auth} />
            </MemoryRouter>
        );

        const phoneInput = await screen.findByPlaceholderText('123-456-7890') as HTMLInputElement;
        await waitFor(() => expect(phoneInput.value).toBe('555-0199'));

        expect(profileServiceMocks.loadProfileDocument).not.toHaveBeenCalled();
    });

    it('seeds photoPreview from auth.profile without calling loadProfileDocument', async () => {
        const auth = buildAuth({
            profile: {
                fullName: 'Test User',
                phone: '',
                photoUrl: 'https://example.test/profile.png',
                email: 'test@example.com'
            }
        });

        const { container } = render(
            <MemoryRouter>
                <Profile auth={auth} />
            </MemoryRouter>
        );

        // Wait for the loading spinner to disappear and photo to appear
        await waitFor(() => {
            const img = container.querySelector('img') as HTMLImageElement | null;
            expect(img?.getAttribute('src')).toBe('https://example.test/profile.png');
        });

        expect(profileServiceMocks.loadProfileDocument).not.toHaveBeenCalled();
    });

    it('falls back to loadProfileDocument when auth.profile is null', async () => {
        profileServiceMocks.loadProfileDocument.mockResolvedValue({
            fullName: 'Loaded User',
            phone: '555-0200',
            photoUrl: '',
            email: 'test@example.com'
        });

        const auth = buildAuth({ profile: null });

        render(
            <MemoryRouter>
                <Profile auth={auth} />
            </MemoryRouter>
        );

        const fullNameInput = await screen.findByPlaceholderText('Your name') as HTMLInputElement;
        await waitFor(() => expect(fullNameInput.value).toBe('Loaded User'));

        expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledTimes(1);
        expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledWith('user-1');
    });
});
