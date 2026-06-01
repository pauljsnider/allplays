import React from 'react';
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Profile } from '../../apps/app/src/pages/Profile';
import type { AuthState } from '../../apps/app/src/lib/types';

const profileServiceMocks = vi.hoisted(() => ({
  createProfileAccessCode: vi.fn(),
  loadParentTeams: vi.fn(),
  loadNotificationPreferences: vi.fn(),
  loadNotificationTeams: vi.fn(),
  loadProfileAccessCodes: vi.fn(),
  loadProfileDocument: vi.fn(),
  normalizeNotificationPreferences: vi.fn(),
  requestAccountMerge: vi.fn(),
  saveNotificationPreferences: vi.fn(),
  saveProfileDocument: vi.fn(),
  uploadProfilePhoto: vi.fn()
}));

const publicActionsMocks = vi.hoisted(() => ({
  sharePublicUrl: vi.fn()
}));

vi.mock('../../apps/app/src/lib/profileService', () => profileServiceMocks);
vi.mock('../../apps/app/src/lib/publicActions', () => publicActionsMocks);
vi.mock('../../apps/app/src/lib/pushService', () => ({
  enablePushNotificationsForUser: vi.fn()
}));
vi.mock('../../apps/app/src/lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktopWeb: false })
}));
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

describe('Profile invites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('scrollTo', vi.fn());
    profileServiceMocks.normalizeNotificationPreferences.mockImplementation((preferences?: any) => ({
      liveChat: preferences?.liveChat !== false,
      liveScore: preferences?.liveScore === true,
      schedule: preferences?.schedule !== false
    }));
    profileServiceMocks.loadProfileDocument.mockResolvedValue({
      fullName: 'Pat Parent',
      phone: '555-0100',
      photoUrl: '',
      signInMethod: 'emailLink',
      hasPassword: false,
      updatedAt: { seconds: 1717200000 }
    });
    profileServiceMocks.loadNotificationTeams.mockResolvedValue([]);
    profileServiceMocks.loadNotificationPreferences.mockResolvedValue({ liveChat: true, liveScore: false, schedule: true });
    profileServiceMocks.loadParentTeams.mockResolvedValue([]);
    profileServiceMocks.requestAccountMerge.mockResolvedValue(undefined);
    profileServiceMocks.saveNotificationPreferences.mockResolvedValue({ liveChat: true, liveScore: false, schedule: true });
    profileServiceMocks.saveProfileDocument.mockResolvedValue(undefined);
    profileServiceMocks.uploadProfilePhoto.mockResolvedValue('https://example.test/avatar.png');
    profileServiceMocks.createProfileAccessCode.mockResolvedValue('NEWMVP42');
    profileServiceMocks.loadProfileAccessCodes.mockResolvedValue([
      { id: 'code-1', code: 'ACTIVE123', email: 'coach@example.com', phone: '', used: false, createdAt: { seconds: 1717200000 } },
      { id: 'code-2', code: 'USED1234', email: 'used@example.com', phone: '', used: true, createdAt: { seconds: 1717113600 }, usedAt: { seconds: 1717200000 } }
    ]);
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
      url: expect.stringContaining('/login.html?code=NEWMVP42'),
      clipboardText: expect.stringContaining('/login.html?code=NEWMVP42')
    })));
    expect(screen.getByText('Share sheet opened.')).toBeTruthy();
  });

  it('shows active invite share actions, hides them for used codes, and surfaces copied and cancelled statuses', async () => {
    publicActionsMocks.sharePublicUrl.mockResolvedValueOnce('copied').mockResolvedValueOnce('cancelled');
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Invites' }));

    const shareButtons = await screen.findAllByRole('button', { name: /Share invite link/ });
    expect(shareButtons).toHaveLength(1);
    const copyLinkButtons = screen.getAllByRole('button', { name: /Copy invite link/ });
    expect(copyLinkButtons).toHaveLength(1);
    const copyCodeButtons = screen.getAllByRole('button', { name: /Copy invite code/ });
    expect(copyCodeButtons).toHaveLength(2);

    const activeCard = shareButtons[0].closest('div.rounded-xl') as HTMLElement | null;
    const usedCard = screen.getByLabelText('Copy invite code USED1234').closest('div.rounded-xl') as HTMLElement | null;
    if (!activeCard || !usedCard) {
      throw new Error('Expected invite cards to render');
    }

    expect(within(activeCard).getByRole('button', { name: /Share invite link/ })).toBeTruthy();
    expect(within(activeCard).getByRole('button', { name: /Copy invite link/ })).toBeTruthy();
    expect(within(usedCard).queryByRole('button', { name: /Share invite link/ })).toBeNull();
    expect(within(usedCard).queryByRole('button', { name: /Copy invite link/ })).toBeNull();

    fireEvent.click(within(activeCard).getByRole('button', { name: /Share invite link/ }));
    expect(await screen.findByText('Link copied.')).toBeTruthy();

    fireEvent.click(within(activeCard).getByRole('button', { name: /Share invite link/ }));
    expect(await screen.findByText('Share cancelled.')).toBeTruthy();
  });
});
