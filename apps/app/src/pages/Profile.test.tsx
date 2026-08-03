// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Profile } from './Profile';
import { APP_BACK_DISMISS_EVENT, dispatchNativeBackDismissEvent, getNativeBackTarget } from '../lib/nativeBackButton';
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

const profilePhotoServiceMocks = vi.hoisted(() => ({
  acquireProfilePhoto: vi.fn(),
  deleteProfilePhoto: vi.fn(async () => undefined),
  normalizeProfilePhoto: vi.fn(async (file: File) => file),
  uploadProfilePhoto: vi.fn(async () => ({
    url: 'https://example.test/profile-photo.jpg',
    path: 'profile-photos/users/user-1/new.jpg'
  }))
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

const shellLayoutMocks = vi.hoisted(() => ({
  isNative: false
}));

const initialLoadTelemetryMocks = vi.hoisted(() => ({
  start: vi.fn(),
  end: vi.fn()
}));

vi.mock('../lib/authService', () => authServiceMocks);
vi.mock('../lib/profileService', () => profileServiceMocks);
vi.mock('../lib/profilePhotoService', () => profilePhotoServiceMocks);
vi.mock('../lib/pushService', () => pushServiceMocks);
vi.mock('../lib/inviteUrls', () => ({
  buildAppAcceptInviteUrl: vi.fn((code: string) => `https://example.test/app/#/accept-invite?code=${code}`)
}));
vi.mock('../lib/publicActions', () => ({
  sharePublicUrl: vi.fn(async () => ({ shared: true }))
}));
vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktop: false, isNative: shellLayoutMocks.isNative, isDesktopWeb: false })
}));
vi.mock('../lib/telemetry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/telemetry')>(),
  startAppInitialLoadTimer: initialLoadTelemetryMocks.start.mockImplementation(() => ({
    end: initialLoadTelemetryMocks.end
  }))
}));
vi.mock('lucide-react', () => {
  const Icon = () => null;
  const LoaderIcon = (props: Record<string, unknown>) => <svg data-testid="loading-spinner" {...props} />;
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
    Loader2: LoaderIcon,
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
  refresh: vi.fn(async () => null),
  signOut: vi.fn(async () => undefined)
};

function TestRouteControls() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/profile', { replace: true })}>
      Go to plain profile
    </button>
  );
}

function NativeBackRouteControls() {
  const location = useLocation();
  const navigate = useNavigate();
  const handleNativeBack = () => {
    if (dispatchNativeBackDismissEvent()) return;
    const target = getNativeBackTarget(location.pathname, location.search);
    if (target) navigate(target);
  };
  return (
    <>
      <button type="button" onClick={handleNativeBack}>Simulate native Back</button>
      <output aria-label="Current route">{`${location.pathname}${location.search}`}</output>
    </>
  );
}

function ProfileTestRoute({ profileAuth = auth, includeRouteControls = false, includeNativeBackControls = false }: { profileAuth?: AuthState; includeRouteControls?: boolean; includeNativeBackControls?: boolean }) {
  return (
    <>
      <Profile auth={profileAuth} />
      {includeRouteControls ? <TestRouteControls /> : null}
      {includeNativeBackControls ? <NativeBackRouteControls /> : null}
    </>
  );
}

function renderProfile(initialEntry = '/profile', includeRouteControls = false, includeNativeBackControls = false, profileAuth: AuthState = auth) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/profile" element={<ProfileTestRoute profileAuth={profileAuth} includeRouteControls={includeRouteControls} includeNativeBackControls={includeNativeBackControls} />} />
        <Route path="/profile/settings" element={<ProfileTestRoute profileAuth={profileAuth} includeRouteControls={includeRouteControls} includeNativeBackControls={includeNativeBackControls} />} />
        <Route path="/home" element={<div>Home route</div>} />
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
    shellLayoutMocks.isNative = false;
    profileServiceMocks.loadProfileDocument.mockResolvedValue({
      fullName: 'Pat Parent',
      phone: '555-0100',
      photoUrl: '',
      signInMethod: 'emailLink',
      hasPassword: false,
      updatedAt: { seconds: 1717200000 }
    });
    profileServiceMocks.saveProfileDocument.mockResolvedValue(undefined);
    profilePhotoServiceMocks.normalizeProfilePhoto.mockImplementation(async (file: File) => file);
    profilePhotoServiceMocks.uploadProfilePhoto.mockResolvedValue({
      url: 'https://example.test/profile-photo.jpg',
      path: 'profile-photos/users/user-1/new.jpg'
    });
    profilePhotoServiceMocks.deleteProfilePhoto.mockResolvedValue(undefined);
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
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:profile-photo-preview'),
      writable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      writable: true
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('uses a successfully hydrated profile without optional phone data', async () => {
    const hydratedAuth: AuthState = {
      ...auth,
      profile: {
        fullName: 'Hydrated Parent',
        photoUrl: 'https://example.test/hydrated-parent.jpg'
      },
      profileHydration: 'success'
    };

    renderProfile('/profile/settings', false, false, hydratedAuth);

    const accountHeader = screen.getByRole('heading', { name: 'Your Account' }).parentElement?.parentElement;
    expect(accountHeader?.querySelector('.animate-spin')).toBeNull();
    expect(await screen.findByDisplayValue('Hydrated Parent')).toBeTruthy();
    expect(document.querySelector('img[src="https://example.test/hydrated-parent.jpg"]')).toBeTruthy();
    expect(profileServiceMocks.loadProfileDocument).not.toHaveBeenCalled();
    expect(initialLoadTelemetryMocks.start).toHaveBeenCalledWith('profile', {
      route: 'profile',
      source: 'auth-profile'
    });
  });

  it('loads the profile document once when authentication used fallback data', async () => {
    const profileRequest = createDeferredPromise<{
      fullName: string;
      phone: string;
      photoUrl: string;
      signInMethod: string;
      hasPassword: boolean;
      updatedAt: { seconds: number };
    }>();
    profileServiceMocks.loadProfileDocument.mockImplementation(() => profileRequest.promise);
    const fallbackAuth: AuthState = {
      ...auth,
      profile: { email: 'parent@example.com' },
      profileHydration: 'fallback'
    };

    renderProfile('/profile/settings', false, false, fallbackAuth);

    const accountHeader = screen.getByRole('heading', { name: 'Your Account' }).parentElement?.parentElement;
    expect(accountHeader?.querySelector('.animate-spin')).toBeTruthy();
    expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      profileRequest.resolve({
        fullName: 'Loaded Parent',
        phone: '',
        photoUrl: '',
        signInMethod: 'emailLink',
        hasPassword: false,
        updatedAt: { seconds: 1717200000 }
      });
    });

    expect(await screen.findByDisplayValue('Loaded Parent')).toBeTruthy();
    await waitFor(() => expect(accountHeader?.querySelector('.animate-spin')).toBeNull());
    expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledTimes(1);
  });

  it('uses the hydrated profile when only the hydration status changes', async () => {
    const profileRequest = createDeferredPromise<never>();
    profileServiceMocks.loadProfileDocument.mockImplementation(() => profileRequest.promise);
    const hydratedProfile = {
      fullName: 'Hydrated After Retry',
      phone: '',
      photoUrl: ''
    };
    const fallbackAuth: AuthState = {
      ...auth,
      profile: hydratedProfile,
      profileHydration: 'fallback'
    };
    const view = renderProfile('/profile/settings', false, false, fallbackAuth);

    expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledTimes(1);

    view.rerender(
      <MemoryRouter initialEntries={['/profile/settings']}>
        <Routes>
          <Route
            path="/profile/settings"
            element={<ProfileTestRoute profileAuth={{ ...fallbackAuth, profileHydration: 'success' }} />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByDisplayValue('Hydrated After Retry')).toBeTruthy();
    expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledTimes(1);
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

    fireEvent.click(screen.getByRole('link', { name: /^Notifications$/ }));

    expect(await screen.findByText('Notification preferences')).toBeTruthy();
    await waitFor(() => {
      expect(pushServiceMocks.getPushNotificationPermissionStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('preserves independent unsaved alert drafts across team switches and failed saves', async () => {
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([
      { id: 'team-1', name: 'Blue Team' },
      { id: 'team-2', name: 'Gold Team' }
    ]);
    profileServiceMocks.loadNotificationPreferences.mockImplementation(async (_userId: string, teamId: string) => (
      teamId === 'team-1'
        ? { liveChat: true, liveScore: false, schedule: true }
        : { liveChat: true, liveScore: false, schedule: false }
    ));
    profileServiceMocks.saveNotificationPreferences
      .mockImplementationOnce(async (_userId: string, _teamId: string, preferences: unknown) => preferences)
      .mockRejectedValueOnce(new Error('save failed'));

    renderProfile();
    fireEvent.click(await screen.findByRole('link', { name: /^Notifications$/ }));

    const teamSelect = await screen.findByLabelText('Team') as HTMLSelectElement;
    await waitFor(() => expect((screen.getByLabelText('Live Chat') as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByLabelText('Live Chat'));
    expect(await screen.findByText('Unsaved changes')).toBeTruthy();

    fireEvent.change(teamSelect, { target: { value: 'team-2' } });
    await waitFor(() => expect((screen.getByLabelText('Live Chat') as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByLabelText('Live Score'));
    expect((screen.getByLabelText('Live Score') as HTMLInputElement).checked).toBe(true);

    fireEvent.change(teamSelect, { target: { value: 'team-1' } });
    await waitFor(() => expect((screen.getByLabelText('Live Chat') as HTMLInputElement).checked).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => expect(profileServiceMocks.saveNotificationPreferences).toHaveBeenCalledWith('user-1', 'team-1', {
      liveChat: false,
      liveScore: false,
      schedule: true
    }));
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());

    fireEvent.change(teamSelect, { target: { value: 'team-2' } });
    await waitFor(() => expect((screen.getByLabelText('Live Score') as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('save failed')).toBeTruthy();
    expect((screen.getByLabelText('Live Score') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save preferences' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps semantic mobile profile navigation in a two-column grid', async () => {
    renderProfile();

    expect(await screen.findByRole('heading', { name: 'Your Account' })).toBeTruthy();
    const notificationsLink = screen.getByRole('link', { name: /^Notifications$/ });
    expect(notificationsLink).toHaveAttribute('href', '/profile/settings?section=alerts');
    expect(screen.getByRole('link', { name: /^Invites$/ })).toHaveAttribute('href', '/profile/settings?section=invites');
    expect(screen.getByRole('link', { name: /^Sign-in & security$/ })).toHaveAttribute('href', '/profile/settings?section=security');
    expect(screen.getByRole('link', { name: /^Profile$/ })).toHaveAttribute('aria-current', 'page');

    const sectionGrid = notificationsLink.parentElement;
    expect(sectionGrid).not.toBeNull();
    expect(sectionGrid?.className).toContain('grid-cols-2');
    expect(sectionGrid?.className).toContain('sm:grid-cols-4');
    expect(sectionGrid?.className).not.toContain('min-w-max');
  });

  it('exposes Family workflows from the mobile profile surface', async () => {
    renderProfile();

    expect(await screen.findByRole('heading', { name: 'Your Account' })).toBeTruthy();
    const familyLink = screen.getByRole('link', { name: 'Open Family workflows' });
    expect(familyLink.getAttribute('href')).toBe('/parent-tools');
    expect(familyLink.textContent).toContain('Player access, household, fees, calendars, sharing, registration, and awards.');
  });

  it('saves profile presentation fields without rewriting the auth-managed email', async () => {
    renderProfile('/profile', false, false, {
      ...auth,
      profile: { fullName: 'Pat Parent', phone: '555-0100', photoUrl: '' },
      profileHydration: 'success'
    });

    const fullNameInput = await screen.findByDisplayValue('Pat Parent');
    fireEvent.change(fullNameInput, { target: { value: 'Pat Parent Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => {
      expect(profileServiceMocks.saveProfileDocument).toHaveBeenCalledWith('user-1', {
        fullName: 'Pat Parent Updated',
        phone: '555-0100',
        photoUrl: null
      });
    });
    expect(await screen.findByText('Profile saved.')).toBeTruthy();
  });

  it('deletes an unreferenced upload before retrying a rejected profile document save', async () => {
    profileServiceMocks.saveProfileDocument
      .mockRejectedValueOnce(new Error('permission-denied'))
      .mockResolvedValueOnce(undefined);
    renderProfile('/profile', false, false, {
      ...auth,
      profile: { fullName: 'Pat Parent', phone: '555-0100', photoUrl: '' },
      profileHydration: 'success'
    });

    await screen.findByDisplayValue('Pat Parent');
    fireEvent.change(screen.getByLabelText('Choose photo'), {
      target: {
        files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })]
      }
    });
    await waitFor(() => {
      expect(profilePhotoServiceMocks.normalizeProfilePhoto).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Upload reached Firebase, but this account does not have permission to save the image.')).toBeTruthy();
    expect(profilePhotoServiceMocks.uploadProfilePhoto).toHaveBeenCalledTimes(1);
    expect(profilePhotoServiceMocks.deleteProfilePhoto).toHaveBeenCalledWith('profile-photos/users/user-1/new.jpg');

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Profile saved.')).toBeTruthy();
    expect(profilePhotoServiceMocks.uploadProfilePhoto).toHaveBeenCalledTimes(2);
    expect(profileServiceMocks.saveProfileDocument).toHaveBeenCalledTimes(2);
  });

  it('persists cleanup paths and removes only the previous committed profile image', async () => {
    renderProfile('/profile', false, false, {
      ...auth,
      profile: {
        fullName: 'Pat Parent',
        phone: '555-0100',
        photoUrl: 'https://example.test/old.jpg',
        photoPath: 'profile-photos/users/user-1/old.jpg'
      },
      profileHydration: 'success'
    });

    await screen.findByDisplayValue('Pat Parent');
    fireEvent.change(screen.getByLabelText('Choose photo'), {
      target: { files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })] }
    });
    await waitFor(() => expect(profilePhotoServiceMocks.normalizeProfilePhoto).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileServiceMocks.saveProfileDocument).toHaveBeenCalledWith('user-1', expect.objectContaining({
      photoUrl: 'https://example.test/profile-photo.jpg',
      photoPath: 'profile-photos/users/user-1/new.jpg'
    })));
    expect(profilePhotoServiceMocks.deleteProfilePhoto).toHaveBeenCalledWith('profile-photos/users/user-1/old.jpg');
    expect(profilePhotoServiceMocks.deleteProfilePhoto).not.toHaveBeenCalledWith('profile-photos/users/user-1/new.jpg');
  });

  it('preserves both profile image objects when the document commit cannot be determined', async () => {
    profileServiceMocks.saveProfileDocument.mockRejectedValueOnce(new Error('deadline-exceeded'));
    profileServiceMocks.loadProfileDocument.mockRejectedValueOnce(new Error('offline'));
    renderProfile('/profile', false, false, {
      ...auth,
      profile: {
        fullName: 'Pat Parent',
        phone: '555-0100',
        photoUrl: 'https://example.test/old.jpg',
        photoPath: 'profile-photos/users/user-1/old.jpg'
      },
      profileHydration: 'success'
    });

    await screen.findByDisplayValue('Pat Parent');
    fireEvent.change(screen.getByLabelText('Choose photo'), {
      target: { files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })] }
    });
    await waitFor(() => expect(profilePhotoServiceMocks.normalizeProfilePhoto).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('The profile save status is unknown. The new photo was preserved; refresh before retrying.')).toBeTruthy();
    expect(profilePhotoServiceMocks.deleteProfilePhoto).not.toHaveBeenCalled();

    const saveButton = screen.getByRole('button', { name: 'Save profile' });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(profileServiceMocks.saveProfileDocument).toHaveBeenCalledTimes(1);
    expect(profilePhotoServiceMocks.uploadProfilePhoto).toHaveBeenCalledTimes(1);
    expect(profilePhotoServiceMocks.deleteProfilePhoto).not.toHaveBeenCalled();
  });

  it('reports an upload permission failure as Storage failure before profile persistence', async () => {
    profilePhotoServiceMocks.uploadProfilePhoto.mockRejectedValueOnce(new Error('storage/unauthorized'));
    renderProfile('/profile', false, false, {
      ...auth,
      profile: { fullName: 'Pat Parent', phone: '555-0100', photoUrl: '' },
      profileHydration: 'success'
    });

    await screen.findByDisplayValue('Pat Parent');
    fireEvent.change(screen.getByLabelText('Choose photo'), {
      target: {
        files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })]
      }
    });
    await waitFor(() => expect(profilePhotoServiceMocks.normalizeProfilePhoto).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Firebase Storage denied this profile photo upload. Refresh your session and try again.')).toBeTruthy();
    expect(profileServiceMocks.saveProfileDocument).not.toHaveBeenCalled();
  });

  it('fails closed for photo changes when the initial ownership read fails', async () => {
    profileServiceMocks.loadProfileDocument.mockRejectedValueOnce(new Error('offline'));
    renderProfile('/profile/settings', false, false, {
      ...auth,
      profile: { email: 'parent@example.com' },
      profileHydration: 'fallback'
    });

    expect(await screen.findByText('Profile details could not be loaded yet.')).toBeTruthy();
    const photoInput = screen.getByLabelText('Choose photo') as HTMLInputElement;
    expect(photoInput.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Pat Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileServiceMocks.saveProfileDocument).toHaveBeenCalledWith('user-1', {
      fullName: 'Pat Updated',
      phone: ''
    }));
    expect(profilePhotoServiceMocks.normalizeProfilePhoto).not.toHaveBeenCalled();
    expect(profilePhotoServiceMocks.uploadProfilePhoto).not.toHaveBeenCalled();
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

    expect((await screen.findAllByText('Create invite')).length).toBeGreaterThan(0);
    expect(await screen.findByText('No invites created yet.')).toBeTruthy();
    expect(screen.queryByText('Unable to load invite history.')).toBeNull();
    expect(profileServiceMocks.loadProfileAccessCodesPage).toHaveBeenCalledWith('user-1', { pageSize: 3 });
  });

  it('blocks phone-only friend invites and guides the user to email', async () => {
    renderProfile('/profile?section=invites');

    const phoneInput = await screen.findByLabelText('Recipient phone');
    expect(screen.getByText("Phone-only invites aren't available. Enter the recipient's email to target the invite.")).toBeTruthy();

    fireEvent.change(phoneInput, { target: { value: '555-0100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    expect(await screen.findByText("Phone-only invites aren't available because sign-in can't verify phone ownership. Enter the recipient's email instead.")).toBeTruthy();
    expect(profileServiceMocks.createProfileAccessCode).not.toHaveBeenCalled();
    expect(screen.queryByText('Invite code')).toBeNull();
  });

  it('continues to create email-targeted friend invites', async () => {
    renderProfile('/profile?section=invites');

    fireEvent.change(await screen.findByLabelText('Recipient email'), { target: { value: ' friend@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    await waitFor(() => {
      expect(profileServiceMocks.createProfileAccessCode).toHaveBeenCalledWith('user-1', 'friend@example.com', '');
    });
    expect(await screen.findByText('Invite code generated.')).toBeTruthy();
    expect(screen.getAllByText('CODE1234')).toHaveLength(2);
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

  it('dismisses the native photo chooser on native Back without clearing unsaved profile fields', async () => {
    shellLayoutMocks.isNative = true;
    renderProfile('/profile/settings');

    const fullNameInput = await screen.findByLabelText('Full name');
    const phoneInput = screen.getByLabelText('Phone');
    fireEvent.change(fullNameInput, { target: { value: 'Unsaved Parent' } });
    fireEvent.change(phoneInput, { target: { value: '555-0199' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose photo' }));
    expect(screen.getByRole('dialog', { name: 'Choose how to update your photo' })).toBeTruthy();

    const event = new Event(APP_BACK_DISMISS_EVENT, { cancelable: true });
    fireEvent(window, event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Choose how to update your photo' })).toBeNull();
    });
    expect(fullNameInput).toHaveValue('Unsaved Parent');
    expect(phoneInput).toHaveValue('555-0199');
  });

  it('keeps Profile mounted when native Back closes the chooser, then follows Profile-to-Home navigation', async () => {
    shellLayoutMocks.isNative = true;
    renderProfile('/profile/settings', false, true);

    expect(await screen.findByRole('heading', { name: 'Your Account' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose photo' }));
    expect(screen.getByRole('dialog', { name: 'Choose how to update your photo' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Simulate native Back' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Choose how to update your photo' })).toBeNull();
    });
    expect(screen.getByRole('heading', { name: 'Your Account' })).toBeTruthy();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/profile/settings');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate native Back' }));

    expect(await screen.findByText('Home route')).toBeTruthy();
  });

  it('continues to dismiss the native photo chooser from Cancel and the backdrop', async () => {
    shellLayoutMocks.isNative = true;
    renderProfile('/profile/settings');

    expect(await screen.findByRole('heading', { name: 'Your Account' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Choose how to update your photo' })).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Choose photo' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose how to update your photo' });
    fireEvent.mouseDown(dialog);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Choose how to update your photo' })).toBeNull();
    });
  });
});
