// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
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
  loadNotificationPreferences: vi.fn(async (_userId: string, _teamId: string) => ({ liveChat: true, liveScore: false, schedule: true })),
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
  runPushNotificationPrimer: vi.fn(async () => true)
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

function TestRouteControls() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/profile', { replace: true })}>
      Go to plain profile
    </button>
  );
}

function renderProfile(initialEntry = '/profile', includeRouteControls = false) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/profile" element={<><Profile auth={auth} />{includeRouteControls ? <TestRouteControls /> : null}</>} />
      </Routes>
    </MemoryRouter>
  );
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileServiceMocks.loadNotificationPreferences.mockResolvedValue({ liveChat: true, liveScore: false, schedule: true });
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([{ id: 'team-1', name: 'Blue Team' }]);
    profileServiceMocks.loadParentTeams.mockResolvedValue([{ id: 'team-1', name: 'Blue Team' }]);
    profileServiceMocks.requestAccountMerge.mockResolvedValue(undefined);
    pushServiceMocks.getPushNotificationPermissionStatus.mockResolvedValue({
      state: 'prompt',
      isNative: false,
      platform: 'web',
      canPrompt: true,
      canOpenSettings: false
    });
    pushServiceMocks.runPushNotificationPrimer.mockResolvedValue(true);
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

  it('keeps push service value APIs behind the Alerts dynamic import boundary', () => {
    const source = readFileSync('src/pages/Profile.tsx', 'utf8');
    const pushStaticImports = source
      .match(/import[\s\S]*?from ['"][^'"]+['"];?/g)
      ?.filter((statement) => statement.includes("from '../lib/pushService'")) || [];

    expect(source).toContain("import type { PushNotificationPrimerContext, PushNotificationPermissionStatus } from '../lib/pushService';");
    expect(source).toContain("import('../lib/pushService')");
    expect(source).toContain("pushServiceRequest = import('../lib/pushService').catch((error) => {");
    expect(source).toContain('pushServiceRequest = null;');
    expect(pushStaticImports).toEqual([
      "import type { PushNotificationPrimerContext, PushNotificationPermissionStatus } from '../lib/pushService';"
    ]);
  });

  it('does not check push permission status until Alerts is opened', async () => {
    renderProfile();

    expect(await screen.findByRole('heading', { name: 'Your Account' })).toBeTruthy();
    expect(pushServiceMocks.getPushNotificationPermissionStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Alerts$/ }));

    expect(await screen.findByText('Notification preferences')).toBeTruthy();
    await waitFor(() => {
      expect(pushServiceMocks.getPushNotificationPermissionStatus).toHaveBeenCalledTimes(1);
    });
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

  it('shows delivery context and cooldown after resending verification email', async () => {
    authServiceMocks.resendVerificationEmail.mockResolvedValueOnce(undefined);

    renderProfile('/profile?section=security');

    fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }));

    expect(await screen.findByText('Verification email sent to parent@example.com. It can take a couple of minutes; check spam too.')).toBeTruthy();
    const cooldownButton = screen.getByRole('button', { name: 'Resend available soon' });
    expect((cooldownButton as HTMLButtonElement).disabled).toBe(true);
    expect(authServiceMocks.resendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('maps verification resend throttling to a retry-later message and cooldown', async () => {
    authServiceMocks.resendVerificationEmail.mockRejectedValueOnce({ code: 'auth/too-many-requests' });

    renderProfile('/profile?section=security');

    fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }));

    expect(await screen.findByText('Too many attempts. Try again in a few minutes.')).toBeTruthy();
    const cooldownButton = screen.getByRole('button', { name: 'Resend available soon' });
    expect((cooldownButton as HTMLButtonElement).disabled).toBe(true);
    expect(authServiceMocks.describeAuthError).not.toHaveBeenCalled();
  });

  it('disables account merge while parent team eligibility is loading', async () => {
    const parentTeamsRequest = createDeferredPromise<Array<{ id: string; name: string }>>();
    profileServiceMocks.loadParentTeams.mockImplementation(() => parentTeamsRequest.promise);

    renderProfile();

    const loadingButton = await screen.findByRole('button', { name: 'Checking availability' });
    expect((loadingButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Merge another account' })).toBeNull();

    parentTeamsRequest.resolve([{ id: 'team-1', name: 'Blue Team' }]);

    expect(await screen.findByRole('button', { name: 'Merge another account' })).toBeTruthy();
  });

  it('shows an unavailable state instead of an enabled merge CTA when the parent has no teams', async () => {
    profileServiceMocks.loadParentTeams.mockResolvedValue([]);

    renderProfile();

    expect(await screen.findByText('No parent-linked teams are available for account merge.')).toBeTruthy();
    expect(profileServiceMocks.loadParentTeams).toHaveBeenCalledWith('user-1');
    expect(screen.queryByRole('button', { name: 'Merge another account' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeTruthy();
  });

  it('preserves the account merge request flow after parent team eligibility is confirmed', async () => {
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Merge another account' }));
    fireEvent.change(screen.getByLabelText('Secondary account email'), {
      target: { value: 'secondary@example.com' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request merge' }));

    await waitFor(() => {
      expect(profileServiceMocks.requestAccountMerge).toHaveBeenCalledWith(
        'user-1',
        'parent@example.com',
        'secondary@example.com'
      );
    });
    expect(await screen.findByText(/Merge request pending verification/)).toBeTruthy();
  });

  it('loads the Invites section to a normal empty state when invite history is empty', async () => {
    profileServiceMocks.loadProfileAccessCodesPage.mockResolvedValue({ codes: [], nextCursor: null });

    renderProfile('/profile?section=invites');

    expect(await screen.findByText('Invite codes')).toBeTruthy();
    expect(await screen.findByText('No codes generated yet.')).toBeTruthy();
    expect(screen.queryByText('Unable to load invite history.')).toBeNull();
    expect(profileServiceMocks.loadProfileAccessCodesPage).toHaveBeenCalledWith('user-1', { pageSize: 3 });
  });

  it('renders alerts team controls before the first team preferences finish loading', async () => {
    const preferencesRequest = createDeferredPromise<{ liveChat: boolean; liveScore: boolean; schedule: boolean }>();
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([{ id: 'team-1', name: 'Blue Team' }]);
    profileServiceMocks.loadNotificationPreferences.mockImplementation(() => preferencesRequest.promise);

    renderProfile('/profile?section=alerts');

    expect(await screen.findByText('Notification preferences')).toBeTruthy();
    expect(await screen.findByRole('combobox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enable push on this device' })).toBeTruthy();
    expect(screen.getByText('Loading alerts for Blue Team…')).toBeTruthy();
    expect(screen.queryByText('Loading your alert teams…')).toBeNull();

    await waitFor(() => {
      expect(profileServiceMocks.loadNotificationTeams).toHaveBeenCalledTimes(1);
      expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledTimes(1);
      expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledWith('user-1', 'team-1');
    });

    preferencesRequest.resolve({ liveChat: true, liveScore: false, schedule: true });

    await waitFor(() => {
      expect(screen.queryByText('Loading alerts for Blue Team…')).toBeNull();
    });
  });

  it('shows browser-specific recovery when web notifications are blocked', async () => {
    pushServiceMocks.getPushNotificationPermissionStatus.mockResolvedValue({
      state: 'blocked',
      isNative: false,
      platform: 'web',
      canPrompt: false,
      canOpenSettings: false
    });

    renderProfile('/profile?section=alerts');

    expect(await screen.findByText('Notifications are blocked in this browser')).toBeTruthy();
    expect(screen.getByText('Notifications are blocked in this browser. Allow notifications in site settings, then check again.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Check browser settings again' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Open device settings' })).toBeNull();
  });

  it('enables web game-day alerts through push registration and preference save', async () => {
    renderProfile('/profile?section=alerts');

    expect(await screen.findByLabelText('Live Score')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Turn on game-day alerts' }));

    await waitFor(() => {
      expect(pushServiceMocks.runPushNotificationPrimer).toHaveBeenCalledWith('game_day_alerts');
      expect(pushServiceMocks.enablePushNotificationsForUser).toHaveBeenCalledWith('user-1');
      expect(profileServiceMocks.saveNotificationPreferences).toHaveBeenCalledWith('user-1', 'team-1', expect.objectContaining({
        liveScore: true,
        schedule: true
      }));
    });
    expect(await screen.findByText('Game-day alerts are on for this team.')).toBeTruthy();
  });

  it('ignores stale initial alert preferences after switching teams mid-load', async () => {
    const firstTeamPreferences = createDeferredPromise<{ liveChat: boolean; liveScore: boolean; schedule: boolean }>();
    const secondTeamPreferences = createDeferredPromise<{ liveChat: boolean; liveScore: boolean; schedule: boolean }>();
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([
      { id: 'team-1', name: 'Blue Team' },
      { id: 'team-2', name: 'Gold Team' }
    ]);
    profileServiceMocks.loadNotificationPreferences.mockImplementation((_userId: string, teamId: string) => {
      if (teamId === 'team-1') {
        return firstTeamPreferences.promise;
      }
      return secondTeamPreferences.promise;
    });

    renderProfile('/profile?section=alerts');

    const teamSelect = await screen.findByRole('combobox');
    await waitFor(() => {
      expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledWith('user-1', 'team-1');
    });

    fireEvent.change(teamSelect, { target: { value: 'team-2' } });

    await waitFor(() => {
      expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledWith('user-1', 'team-2');
    });

    secondTeamPreferences.resolve({ liveChat: false, liveScore: true, schedule: true });

    await waitFor(() => {
      expect(screen.getByLabelText('Live Chat')).toBeTruthy();
    });
    expect((screen.getByLabelText('Live Chat') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Live Score') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Schedule Changes') as HTMLInputElement).checked).toBe(true);

    firstTeamPreferences.resolve({ liveChat: true, liveScore: false, schedule: false });

    await waitFor(() => {
      expect(screen.queryByText('Loading alerts for Gold Team…')).toBeNull();
    });
    expect((screen.getByLabelText('Live Chat') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Live Score') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Schedule Changes') as HTMLInputElement).checked).toBe(true);
  });

  it('re-syncs the active section and team from the URL after native back collapses profile query state', async () => {
    renderProfile('/profile?section=alerts&teamId=team-1', true);

    expect(await screen.findByText('Notification preferences')).toBeTruthy();
    expect(await screen.findByRole('combobox')).toHaveValue('team-1');

    fireEvent.click(screen.getByRole('button', { name: 'Go to plain profile' }));

    expect(await screen.findByRole('heading', { name: 'Your Account' })).toBeTruthy();
    expect(screen.queryByText('Notification preferences')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
