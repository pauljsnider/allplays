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
  loadProfileAccessCodesPage: vi.fn(),
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

const auth: AuthState = {
  user: {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    emailVerified: false,
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
  signOut: vi.fn().mockResolvedValue(undefined)
};

function renderProfileAt(search = '') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/profile', search }]}>
      <Profile auth={auth} />
    </MemoryRouter>
  );
}

describe('Profile section restore from URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.refresh = vi.fn().mockResolvedValue(undefined);
    auth.signOut = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('scrollTo', vi.fn());
    window.URL.createObjectURL = vi.fn((file: File) => `blob:${(file as any).name}`);
    window.URL.revokeObjectURL = vi.fn();

    profileServiceMocks.loadProfileDocument.mockResolvedValue({
      fullName: 'Pat Parent',
      phone: '555-0100',
      photoUrl: '',
      signInMethod: 'emailLink',
      hasPassword: false,
      updatedAt: { seconds: 1717200000 }
    });
    profileServiceMocks.loadProfileAccessCodes.mockResolvedValue([]);
    profileServiceMocks.loadProfileAccessCodesPage.mockResolvedValue({ codes: [], nextCursor: null });
    profileServiceMocks.loadParentTeams.mockResolvedValue([]);
    profileServiceMocks.normalizeProfilePhoto.mockImplementation(async (file: File) => file);
    profileServiceMocks.saveProfileDocument.mockResolvedValue(undefined);
    profileServiceMocks.uploadProfilePhoto.mockResolvedValue('https://example.test/avatar.png');
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([
      { id: 'team-1', name: 'Blue Team' },
      { id: 'team-2', name: 'Gold Team' }
    ]);
    profileServiceMocks.loadNotificationPreferences.mockResolvedValue({
      liveChat: true,
      liveScore: false,
      schedule: true
    });
    profileServiceMocks.saveNotificationPreferences.mockResolvedValue({
      liveChat: true,
      liveScore: false,
      schedule: true
    });
    pushServiceMocks.getPushNotificationPermissionStatus.mockResolvedValue({
      state: 'prompt',
      isNative: false,
      platform: 'web',
      canPrompt: true,
      canOpenSettings: false
    });
    pushServiceMocks.openPushNotificationSettings.mockResolvedValue(undefined);
    pushServiceMocks.enablePushNotificationsForUser.mockResolvedValue(undefined);
    pushServiceMocks.runPushNotificationPrimer.mockResolvedValue(true);
    publicActionsMocks.sharePublicUrl.mockResolvedValue('shared');
    shellLayoutState.isDesktopWeb = false;
    shellLayoutState.isNative = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('restores alerts section and selects the correct team when mounted with ?section=alerts&teamId=team-2', async () => {
    renderProfileAt('?section=alerts&teamId=team-2');

    // The Alerts section nav button should be visually active (aria-pressed)
    const alertsButton = await screen.findByRole('button', { name: 'Alerts' });
    expect(alertsButton.getAttribute('aria-pressed')).toBe('true');

    // Account button should not be active
    const accountButton = screen.getByRole('button', { name: 'Account' });
    expect(accountButton.getAttribute('aria-pressed')).toBe('false');

    // Wait for teams to load and team-2 to be selected
    await waitFor(() => {
      const teamSelect = screen.queryByLabelText('Team') as HTMLSelectElement | null;
      return teamSelect !== null && teamSelect.value === 'team-2';
    });

    const teamSelect = screen.getByLabelText('Team') as HTMLSelectElement;
    expect(teamSelect.value).toBe('team-2');

    // Alert preferences should have loaded for team-2
    await waitFor(() => expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledWith('user-1', 'team-2'));
  });

  it('falls back to the first team when the URL teamId does not match any loaded team', async () => {
    renderProfileAt('?section=alerts&teamId=nonexistent-team');

    // Should still show the Alerts section
    const alertsButton = await screen.findByRole('button', { name: 'Alerts' });
    expect(alertsButton.getAttribute('aria-pressed')).toBe('true');

    // Should fall back to the first team (team-1)
    await waitFor(() => {
      const teamSelect = screen.queryByLabelText('Team') as HTMLSelectElement | null;
      return teamSelect !== null && teamSelect.value !== '';
    });

    const teamSelect = screen.getByLabelText('Team') as HTMLSelectElement;
    expect(teamSelect.value).toBe('team-1');

    // Alert preferences should have loaded for team-1 (the fallback)
    await waitFor(() => expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledWith('user-1', 'team-1'));
  });

  it('defaults to the account section when no section param is in the URL', async () => {
    renderProfileAt('');

    const accountButton = await screen.findByRole('button', { name: 'Account' });
    expect(accountButton.getAttribute('aria-pressed')).toBe('true');

    const alertsButton = screen.getByRole('button', { name: 'Alerts' });
    expect(alertsButton.getAttribute('aria-pressed')).toBe('false');

    // Account form should be visible
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeTruthy();
    // Team alerts data should not be loaded yet
    expect(profileServiceMocks.loadNotificationTeams).not.toHaveBeenCalled();
  });

  it('defaults to the account section when an invalid section param is given', async () => {
    renderProfileAt('?section=badvalue');

    const accountButton = await screen.findByRole('button', { name: 'Account' });
    expect(accountButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeTruthy();
  });
});
