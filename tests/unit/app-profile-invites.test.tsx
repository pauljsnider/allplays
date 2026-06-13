// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  openPushNotificationSettings: vi.fn()
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

function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile auth={auth} />
    </MemoryRouter>
  );
}

function getPhotoInput(container: HTMLElement) {
  const input = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement | null;
  if (!input) {
    throw new Error('Profile photo input not found');
  }
  return input;
}

async function selectPhoto(container: HTMLElement, fileName: string) {
  const input = getPhotoInput(container);
  const file = new File(['image-bytes'], fileName, { type: 'image/png' });
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file]
  });
  fireEvent.change(input);
  await waitFor(() => expect(profileServiceMocks.normalizeProfilePhoto).toHaveBeenCalledWith(file));
  return file;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Profile invites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.refresh = vi.fn().mockResolvedValue(undefined);
    auth.signOut = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('scrollTo', vi.fn());
    window.URL.createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
    window.URL.revokeObjectURL = vi.fn();
    profileServiceMocks.normalizeNotificationPreferences.mockClear();
    profileServiceMocks.loadProfileDocument.mockResolvedValue({
      fullName: 'Pat Parent',
      phone: '555-0100',
      photoUrl: '',
      signInMethod: 'emailLink',
      hasPassword: false,
      updatedAt: { seconds: 1717200000 }
    });
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([]);
    profileServiceMocks.acquireProfilePhoto.mockResolvedValue(new File(['native-photo'], 'native-camera.jpg', { type: 'image/jpeg' }));
    pushServiceMocks.enablePushNotificationsForUser.mockResolvedValue(undefined);
    pushServiceMocks.getPushNotificationPermissionStatus.mockResolvedValue({
      state: 'prompt',
      isNative: false,
      platform: 'web',
      canPrompt: true,
      canOpenSettings: false
    });
    pushServiceMocks.openPushNotificationSettings.mockResolvedValue(undefined);
    profileServiceMocks.loadNotificationPreferences.mockResolvedValue({ liveChat: true, liveScore: false, schedule: true });
    profileServiceMocks.loadParentTeams.mockResolvedValue([]);
    profileServiceMocks.requestAccountMerge.mockResolvedValue(undefined);
    profileServiceMocks.saveNotificationPreferences.mockResolvedValue({ liveChat: true, liveScore: false, schedule: true });
    profileServiceMocks.saveProfileDocument.mockResolvedValue(undefined);
    profileServiceMocks.uploadProfilePhoto.mockResolvedValue('https://example.test/avatar.png');
    profileServiceMocks.normalizeProfilePhoto.mockImplementation(async (file: File) => file);
    profileServiceMocks.createProfileAccessCode.mockResolvedValue('NEWMVP42');
    profileServiceMocks.loadProfileAccessCodes.mockResolvedValue([
      { id: 'code-1', code: 'ACTIVE123', email: 'coach@example.com', phone: '', used: false, createdAt: { seconds: 1717200000 } },
      { id: 'code-2', code: 'USED1234', email: 'used@example.com', phone: '', used: true, createdAt: { seconds: 1717113600 }, usedAt: { seconds: 1717200000 } }
    ]);
    shellLayoutState.isDesktopWeb = false;
    shellLayoutState.isNative = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('shares a generated invite link with invite metadata before any copy fallback', async () => {
    publicActionsMocks.sharePublicUrl.mockResolvedValue('shared');
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Invites' }));
    fireEvent.change(screen.getByLabelText('Invite email label'), { target: { value: 'coach@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate invite link' }));

    await screen.findByText('Generated invite link');
    fireEvent.click(screen.getByRole('button', { name: 'Share invite link' }));

    await waitFor(() => expect(publicActionsMocks.sharePublicUrl).toHaveBeenCalledWith(expect.objectContaining({
      title: 'ALL PLAYS invite for coach@example.com',
      text: 'Use this ALL PLAYS invite link for coach@example.com.',
      url: expect.stringContaining('/app#/accept-invite?code=NEWMVP42'),
      clipboardText: expect.stringContaining('/app#/accept-invite?code=NEWMVP42')
    })));
    expect(screen.getByText(/\/app#\/accept-invite\?code=NEWMVP42/)).toBeTruthy();
    expect(screen.getByText('Share sheet opened.')).toBeTruthy();
  });

  it('shows active invite share actions, hides them for used codes, and surfaces copied and cancelled statuses', async () => {
    publicActionsMocks.sharePublicUrl.mockResolvedValueOnce('copied').mockResolvedValueOnce('cancelled');
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Invites' }));

    const shareButtons = await screen.findAllByRole('button', { name: /Share saved invite link/ });
    expect(shareButtons).toHaveLength(1);
    const copyLinkButtons = screen.getAllByRole('button', { name: /Copy saved invite link/ });
    expect(copyLinkButtons).toHaveLength(1);
    const copyCodeButtons = screen.getAllByRole('button', { name: /Copy saved invite code/ });
    expect(copyCodeButtons).toHaveLength(2);

    const activeCard = shareButtons[0].closest('div.rounded-xl') as HTMLElement | null;
    const usedCard = screen.getByLabelText('Copy saved invite code USED1234').closest('div.rounded-xl') as HTMLElement | null;
    if (!activeCard || !usedCard) {
      throw new Error('Expected invite cards to render');
    }

    expect(within(activeCard).getByRole('button', { name: /Share saved invite link/ })).toBeTruthy();
    expect(within(activeCard).getByRole('button', { name: /Copy saved invite link/ })).toBeTruthy();
    expect(within(usedCard).queryByRole('button', { name: /Share saved invite link/ })).toBeNull();
    expect(within(usedCard).queryByRole('button', { name: /Copy saved invite link/ })).toBeNull();

    fireEvent.click(within(activeCard).getByRole('button', { name: /Share saved invite link/ }));
    await waitFor(() => expect(publicActionsMocks.sharePublicUrl).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: expect.stringContaining('/app#/accept-invite?code=ACTIVE123'),
      clipboardText: expect.stringContaining('/app#/accept-invite?code=ACTIVE123')
    })));
    expect(await screen.findByText('Link copied.')).toBeTruthy();

    fireEvent.click(within(activeCard).getByRole('button', { name: /Share saved invite link/ }));
    await waitFor(() => expect(publicActionsMocks.sharePublicUrl).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: expect.stringContaining('/app#/accept-invite?code=ACTIVE123'),
      clipboardText: expect.stringContaining('/app#/accept-invite?code=ACTIVE123')
    })));
    expect(await screen.findByText('Share cancelled.')).toBeTruthy();
  });

  it('routes typed profile invite links through the app accept flow', async () => {
    publicActionsMocks.sharePublicUrl.mockResolvedValue('shared');
    profileServiceMocks.loadProfileAccessCodes.mockResolvedValue([
      { id: 'code-1', code: 'ACTIVE123', email: 'coach@example.com', phone: '', used: false, type: 'parent_invite', createdAt: { seconds: 1717200000 } }
    ]);

    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Invites' }));
    fireEvent.click(await screen.findByRole('button', { name: /Share saved invite link for ACTIVE123/ }));

    await waitFor(() => expect(publicActionsMocks.sharePublicUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/app#/accept-invite?code=ACTIVE123&type=parent_invite'),
      clipboardText: expect.stringContaining('/app#/accept-invite?code=ACTIVE123&type=parent_invite')
    })));
  });

  it('revokes replaced and removed profile photo blob previews', async () => {
    const { container } = renderProfile();

    await screen.findByText('Choose photo');
    await selectPhoto(container, 'first.png');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await selectPhoto(container, 'second.png');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first.png');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second.png');
  });

  it('revokes temporary blob previews after save and on unmount without touching remote urls', async () => {
    profileServiceMocks.loadProfileDocument
      .mockResolvedValueOnce({
        fullName: 'Pat Parent',
        phone: '555-0100',
        photoUrl: 'https://example.test/original.png',
        signInMethod: 'emailLink',
        hasPassword: false,
        updatedAt: { seconds: 1717200000 }
      });

    const { container, unmount } = renderProfile();

    await screen.findByText('Choose photo');
    await selectPhoto(container, 'saved.png');
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileServiceMocks.uploadProfilePhoto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(profileServiceMocks.saveProfileDocument).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:saved.png');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('https://example.test/original.png');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('https://example.test/avatar.png');
    expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('https://example.test/avatar.png');

    unmount();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('https://example.test/avatar.png');
  });

  it('does not reload the profile document after a successful text-only save', async () => {
    renderProfile();

    await screen.findByText('Choose photo');
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Pat Parent Updated' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '555-0111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileServiceMocks.saveProfileDocument).toHaveBeenCalledWith('user-1', {
      fullName: 'Pat Parent Updated',
      phone: '555-0111',
      email: 'parent@example.com',
      photoUrl: null
    }));
    await screen.findByText('Profile saved.');

    expect(profileServiceMocks.uploadProfilePhoto).not.toHaveBeenCalled();
    expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Pat Parent Updated' })).toBeTruthy();
  });

  it('shows saved profile UI immediately from local state without waiting for auth refresh', async () => {
    const refreshDeferred = createDeferred<void>();
    auth.refresh = vi.fn().mockReturnValue(refreshDeferred.promise);

    const { container } = renderProfile();

    await screen.findByText('Choose photo');
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Pat Parent Updated' } });
    await selectPhoto(container, 'saved.png');
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileServiceMocks.uploadProfilePhoto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(profileServiceMocks.saveProfileDocument).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));

    expect(await screen.findByText('Profile saved.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Pat Parent Updated' })).toBeTruthy();
    expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('https://example.test/avatar.png');
    expect((screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement).disabled).toBe(false);
    expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledTimes(1);

    refreshDeferred.resolve();
  });

  it('shows a loading state until alert teams resolve and only then renders team controls', async () => {
    const deferredTeams = createDeferred<Array<{ id: string; name: string }>>();
    profileServiceMocks.loadNotificationTeams.mockReturnValue(deferredTeams.promise);
    profileServiceMocks.loadNotificationPreferences.mockResolvedValue({ liveChat: true, liveScore: false, schedule: true });

    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Alerts' }));

    await waitFor(() => expect(profileServiceMocks.loadNotificationTeams).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Loading your alert teams…')).toBeTruthy();
    expect(screen.queryByLabelText('Team')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn on game-day alerts' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save preferences' })).toBeNull();

    deferredTeams.resolve([{ id: 'team-1', name: 'Blue Team' }]);

    await waitFor(() => expect((screen.getByLabelText('Team') as HTMLSelectElement).value).toBe('team-1'));
    expect(await screen.findByRole('button', { name: 'Turn on game-day alerts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeTruthy();
  });

  it('shows an empty state when no alert teams are available', async () => {
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([]);

    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Alerts' }));

    expect(await screen.findByText('No team alerts available yet')).toBeTruthy();
    expect(screen.getByText('Join or create a team first, then come back here to turn on game-day and team update alerts.')).toBeTruthy();
    expect(screen.queryByLabelText('Team')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn on game-day alerts' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save preferences' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to My Teams' }).getAttribute('href')).toBe('/teams');
  });

  it('uses hydrated alert preferences before saving game-day alerts', async () => {
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([{ id: 'team-1', name: 'Blue Team' }]);
    profileServiceMocks.loadNotificationPreferences.mockResolvedValueOnce({ liveChat: true, liveScore: false, schedule: false });
    profileServiceMocks.saveNotificationPreferences.mockImplementation(async (_userId, _teamId, preferences) => preferences);

    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Alerts' }));

    await waitFor(() => expect((screen.getByLabelText('Team') as HTMLSelectElement).value).toBe('team-1'));
    await waitFor(() => expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledTimes(1));

    const gameDayButton = await screen.findByRole('button', { name: 'Turn on game-day alerts' });
    expect((gameDayButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(gameDayButton);

    await waitFor(() => expect(pushServiceMocks.enablePushNotificationsForUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(profileServiceMocks.saveNotificationPreferences).toHaveBeenCalledTimes(1));
    expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledTimes(1);
    expect(profileServiceMocks.saveNotificationPreferences).toHaveBeenCalledWith('user-1', 'team-1', {
      liveChat: true,
      liveScore: true,
      schedule: true
    });
    expect(await screen.findByText('Game-day alerts are on for this team.')).toBeTruthy();
  });

  it('hides stale team toggles and disables team actions until the new team preferences finish hydrating', async () => {
    const secondTeamPreferences = createDeferred<{ liveChat: boolean; liveScore: boolean; schedule: boolean }>();
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([
      { id: 'team-1', name: 'Blue Team' },
      { id: 'team-2', name: 'Gold Team' }
    ]);
    profileServiceMocks.loadNotificationPreferences
      .mockResolvedValueOnce({ liveChat: true, liveScore: false, schedule: false })
      .mockReturnValueOnce(secondTeamPreferences.promise);
    profileServiceMocks.saveNotificationPreferences.mockImplementation(async (_userId, _teamId, preferences) => preferences);

    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Alerts' }));

    await waitFor(() => expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledTimes(1));
    const teamSelect = await screen.findByLabelText('Team');
    const gameDayButton = await screen.findByRole('button', { name: 'Turn on game-day alerts' });
    const saveButton = screen.getByRole('button', { name: 'Save preferences' });
    expect(screen.getByLabelText('Live Chat')).toBeTruthy();
    expect((gameDayButton as HTMLButtonElement).disabled).toBe(false);
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(teamSelect, { target: { value: 'team-2' } });

    await waitFor(() => expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Loading alerts for Gold Team…')).toBeTruthy();
    expect(screen.queryByLabelText('Live Chat')).toBeNull();
    expect((gameDayButton as HTMLButtonElement).disabled).toBe(true);
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(gameDayButton);
    fireEvent.click(saveButton);
    expect(pushServiceMocks.enablePushNotificationsForUser).not.toHaveBeenCalled();
    expect(profileServiceMocks.saveNotificationPreferences).not.toHaveBeenCalled();

    secondTeamPreferences.resolve({ liveChat: false, liveScore: false, schedule: false });

    await waitFor(() => expect(screen.getByLabelText('Live Chat')).toBeTruthy());
    expect((gameDayButton as HTMLButtonElement).disabled).toBe(false);
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders fallback toggles and re-enables team actions when preference loading fails', async () => {
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([
      { id: 'team-1', name: 'Blue Team' },
      { id: 'team-2', name: 'Gold Team' }
    ]);
    profileServiceMocks.loadNotificationPreferences
      .mockResolvedValueOnce({ liveChat: true, liveScore: false, schedule: false })
      .mockRejectedValueOnce(new Error('temporary outage'));
    profileServiceMocks.saveNotificationPreferences.mockImplementation(async (_userId, _teamId, preferences) => preferences);

    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Alerts' }));

    await waitFor(() => expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledTimes(1));
    const teamSelect = await screen.findByLabelText('Team');
    const gameDayButton = await screen.findByRole('button', { name: 'Turn on game-day alerts' });
    const saveButton = screen.getByRole('button', { name: 'Save preferences' });

    fireEvent.change(teamSelect, { target: { value: 'team-2' } });

    await waitFor(() => expect(profileServiceMocks.loadNotificationPreferences).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Unable to load notification preferences.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Loading alerts for Gold Team…')).toBeNull());
    expect(screen.getByLabelText('Live Chat')).toBeTruthy();
    expect((screen.getByLabelText('Live Chat') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Live Score') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Schedule Changes') as HTMLInputElement).checked).toBe(true);
    expect((gameDayButton as HTMLButtonElement).disabled).toBe(false);
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => expect(profileServiceMocks.saveNotificationPreferences).toHaveBeenCalledWith('user-1', 'team-2', {
      liveChat: true,
      liveScore: false,
      schedule: true
    }));
  });

  it('shows blocked native push recovery and refreshes after returning from settings', async () => {
    shellLayoutState.isNative = true;
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([{ id: 'team-1', name: 'Blue Team' }]);
    pushServiceMocks.getPushNotificationPermissionStatus
      .mockResolvedValueOnce({
        state: 'blocked',
        isNative: true,
        platform: 'ios',
        canPrompt: false,
        canOpenSettings: true
      })
      .mockResolvedValueOnce({
        state: 'enabled',
        isNative: true,
        platform: 'ios',
        canPrompt: false,
        canOpenSettings: false
      });

    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Alerts' }));

    expect(await screen.findByText('Notifications are off in device settings')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Open device settings' })[0]);

    await waitFor(() => expect(pushServiceMocks.openPushNotificationSettings).toHaveBeenCalledTimes(1));
    fireEvent(window, new Event('focus'));

    expect(await screen.findByText('Push is allowed on this device')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh push registration' })).toBeTruthy();
  });

  it('routes blocked native game-day alerts through device settings instead of saving', async () => {
    shellLayoutState.isNative = true;
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([{ id: 'team-1', name: 'Blue Team' }]);
    pushServiceMocks.getPushNotificationPermissionStatus.mockResolvedValue({
      state: 'blocked',
      isNative: true,
      platform: 'android',
      canPrompt: false,
      canOpenSettings: true
    });

    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Alerts' }));
    await screen.findByText('Notifications are off in device settings');

    const openSettingsButton = await screen.findByRole('button', { name: 'Open device settings to finish alerts' });
    expect(openSettingsButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(openSettingsButton);

    await waitFor(() => expect(pushServiceMocks.openPushNotificationSettings).toHaveBeenCalledTimes(1));
    expect(pushServiceMocks.enablePushNotificationsForUser).not.toHaveBeenCalled();
    expect(profileServiceMocks.saveNotificationPreferences).not.toHaveBeenCalled();
  });

  it('uploads the normalized profile photo instead of the original selection', async () => {
    const normalizedFile = new File(['normalized-image'], 'normalized.jpg', { type: 'image/jpeg' });
    profileServiceMocks.normalizeProfilePhoto.mockResolvedValue(normalizedFile);
    const { container } = renderProfile();

    await screen.findByText('Choose photo');
    await selectPhoto(container, 'original.png');

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(normalizedFile));

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileServiceMocks.uploadProfilePhoto).toHaveBeenCalledWith(normalizedFile));
  });

  it('keeps the most recent profile photo selection when normalization finishes out of order', async () => {
    const firstNormalizedFile = new File(['first-normalized'], 'first-normalized.jpg', { type: 'image/jpeg' });
    const secondNormalizedFile = new File(['second-normalized'], 'second-normalized.jpg', { type: 'image/jpeg' });
    const firstNormalization = createDeferred<File>();
    const secondNormalization = createDeferred<File>();
    profileServiceMocks.normalizeProfilePhoto
      .mockReturnValueOnce(firstNormalization.promise)
      .mockReturnValueOnce(secondNormalization.promise);

    const { container } = renderProfile();

    await screen.findByText('Choose photo');
    await selectPhoto(container, 'first.png');
    await selectPhoto(container, 'second.png');

    secondNormalization.resolve(secondNormalizedFile);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(secondNormalizedFile));
    expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('blob:second-normalized.jpg');

    firstNormalization.resolve(firstNormalizedFile);
    await waitFor(() => expect(profileServiceMocks.normalizeProfilePhoto).toHaveBeenCalledTimes(2));
    expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('blob:second-normalized.jpg');

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileServiceMocks.uploadProfilePhoto).toHaveBeenCalledWith(secondNormalizedFile));
    expect(profileServiceMocks.uploadProfilePhoto).toHaveBeenCalledTimes(1);
    expect(profileServiceMocks.uploadProfilePhoto.mock.calls[0]?.[0]).toBe(secondNormalizedFile);
    expect(profileServiceMocks.uploadProfilePhoto.mock.calls[0]?.[0]).not.toBe(firstNormalizedFile);
  });

  it('uses the native chooser to capture a profile photo before saving', async () => {
    shellLayoutState.isNative = true;
    const { container } = renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Choose photo' }));
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose existing photo' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));

    await waitFor(() => expect(profileServiceMocks.acquireProfilePhoto).toHaveBeenCalledWith('camera'));
    expect(profileServiceMocks.normalizeProfilePhoto).not.toHaveBeenCalled();
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('blob:native-camera.jpg');

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(profileServiceMocks.uploadProfilePhoto).toHaveBeenCalledTimes(1));
    expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('https://example.test/avatar.png');
  });

  it('shows an inline error and preserves the current photo when native camera permission is denied', async () => {
    shellLayoutState.isNative = true;
    profileServiceMocks.loadProfileDocument.mockResolvedValue({
      fullName: 'Pat Parent',
      phone: '555-0100',
      photoUrl: 'https://example.test/original.png',
      signInMethod: 'emailLink',
      hasPassword: false,
      updatedAt: { seconds: 1717200000 }
    });
    profileServiceMocks.acquireProfilePhoto.mockRejectedValue({ code: 'permission-denied', message: 'Denied' });

    const { container } = renderProfile();

    await screen.findByRole('button', { name: 'Choose photo' });
    expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('https://example.test/original.png');

    fireEvent.click(screen.getByRole('button', { name: 'Choose photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));

    expect(await screen.findByText('Camera permission was denied. Allow camera access to take a new profile photo.')).toBeTruthy();
    expect((container.querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('https://example.test/original.png');
    expect(profileServiceMocks.uploadProfilePhoto).not.toHaveBeenCalled();
  });
});
