// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Profile } from './Profile';
import type { AuthState } from '../lib/types';

const authServiceMocks = vi.hoisted(() => ({
  describeAuthError: vi.fn((error: unknown) => (error instanceof Error ? error.message : 'Authentication failed.')),
  reloadCurrentUser: vi.fn(async () => undefined),
  resendVerificationEmail: vi.fn(async () => undefined),
  sendResetEmail: vi.fn(async () => undefined),
  setCurrentUserPassword: vi.fn(async () => undefined)
}));

const profileServiceMocks = vi.hoisted(() => ({
  createProfileAccessCode: vi.fn(async () => 'CODE1234'),
  loadNotificationPreferences: vi.fn(async () => ({ liveChat: true, liveScore: false, schedule: true })),
  loadNotificationTeams: vi.fn(async () => ([{ id: 'team-1', name: 'Blue Team' }])),
  loadParentTeams: vi.fn(async () => ([{ id: 'team-1', name: 'Blue Team' }])),
  loadProfileAccessCodes: vi.fn(async () => []),
  loadProfileAccessCodesPage: vi.fn(async () => ({ codes: [], nextCursor: null })),
  loadProfileDocument: vi.fn(async () => ({
    fullName: 'Pat Parent',
    phone: '555-0100',
    photoUrl: '',
    signInMethod: 'emailLink',
    hasPassword: false,
    updatedAt: { seconds: 1717200000 }
  })),
  normalizeNotificationPreferences: vi.fn((preferences: { liveChat?: boolean; liveScore?: boolean; schedule?: boolean } | null) => ({
    liveChat: preferences?.liveChat !== false,
    liveScore: preferences?.liveScore === true,
    schedule: preferences?.schedule !== false
  })),
  requestAccountMerge: vi.fn(async () => undefined),
  saveNotificationPreferences: vi.fn(async (_userId: string, _teamId: string, preferences: unknown) => preferences),
  saveProfileDocument: vi.fn(async () => undefined)
}));

const pushServiceMocks = vi.hoisted(() => ({
  enablePushNotificationsForUser: vi.fn(async () => undefined),
  getPushNotificationPermissionStatus: vi.fn(async () => ({
    state: 'prompt',
    isNative: false,
    platform: 'web',
    canPrompt: true,
    canOpenSettings: false
  })),
  openPushNotificationSettings: vi.fn(async () => undefined),
  runPushNotificationPrimer: vi.fn(async () => ({ completed: false, status: 'skipped' }))
}));

vi.mock('../lib/authService', () => authServiceMocks);
vi.mock('../lib/profileService', () => profileServiceMocks);
vi.mock('../lib/pushService', () => pushServiceMocks);
vi.mock('../lib/inviteUrls', () => ({
  buildAppAcceptInviteUrl: vi.fn((code: string) => `https://example.test/app#/accept-invite?code=${code}`)
}));
vi.mock('../lib/publicActions', () => ({
  sharePublicUrl: vi.fn(async () => ({ shared: true }))
}));
vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktop: false, isNative: false, isDesktopWeb: false })
}));
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    Bell: Icon,
    ChevronDown: Icon,
    ChevronUp: Icon,
    CheckCircle2: Icon,
    Clipboard: Icon,
    Copy: Icon,
    ImagePlus: Icon,
    KeyRound: Icon,
    Link2: Icon,
    Loader2: Icon,
    LogOut: Icon,
    Mail: Icon,
    RefreshCw: Icon,
    Save: Icon,
    Send: Icon,
    Share2: Icon,
    ShieldCheck: Icon,
    Trash2: Icon,
    Upload: Icon,
    UserCircle: Icon,
    XCircle: Icon
  };
});

const auth: AuthState = {
  user: {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    roles: ['parent']
  } as AuthState['user'],
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

function renderProfile(initialEntry = '/profile') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/profile" element={<Profile auth={auth} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
      writable: true
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps mobile profile section buttons in a two-column grid so Alerts stays reachable', async () => {
    renderProfile();

    expect(await screen.findByRole('heading', { name: 'Your Account' })).toBeTruthy();
    const alertsButton = screen.getByRole('button', { name: /^Alerts$/ });
    expect(alertsButton).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Invites$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Security$/ })).toBeTruthy();

    const sectionGrid = alertsButton.parentElement;
    expect(sectionGrid).not.toBeNull();
    expect(sectionGrid?.className).toContain('grid-cols-2');
    expect(sectionGrid?.className).toContain('sm:grid-cols-4');
    expect(sectionGrid?.className).not.toContain('min-w-max');
  });

  it('loads the Invites section to a normal empty state when invite history is empty', async () => {
    profileServiceMocks.loadProfileAccessCodesPage.mockResolvedValue({ codes: [], nextCursor: null });

    renderProfile('/profile?section=invites');

    expect(await screen.findByText('Invite codes')).toBeTruthy();
    expect(await screen.findByText('No codes generated yet.')).toBeTruthy();
    expect(screen.queryByText('Unable to load invite history.')).toBeNull();
    expect(profileServiceMocks.loadProfileAccessCodesPage).toHaveBeenCalledWith('user-1', { pageSize: 3 });
  });
});
