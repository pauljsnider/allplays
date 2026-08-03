// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FriendProfile } from './FriendProfile';
import type { AuthState } from '../lib/types';

const socialMocks = vi.hoisted(() => ({
  loadFriendProfile: vi.fn(),
  reactToSocialPost: vi.fn()
}));
const publicActionMocks = vi.hoisted(() => ({ copyPublicText: vi.fn() }));

vi.mock('../lib/socialService', () => socialMocks);
vi.mock('../lib/publicActions', () => publicActionMocks);

const auth: AuthState = {
  user: { uid: 'user-1', email: 'pat@example.com', displayName: 'Pat Parent' } as AuthState['user'],
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

const profile = {
  userId: 'user-1',
  name: 'Pat Parent',
  photoUrl: null,
  sharedTeamNames: [],
  publicTeams: [{ id: 'team-1', name: 'Bears', sport: 'Basketball', photoUrl: null }],
  publicChildren: [{ id: 'athlete-1', name: 'Pat Star', headline: 'Point guard', photoUrl: null, shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=athlete-1' }],
  messageRoute: null,
  isSelf: true,
  posts: []
};

describe('FriendProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socialMocks.loadFriendProfile.mockResolvedValue(profile);
    publicActionMocks.copyPublicText.mockResolvedValue('copied');
  });

  afterEach(cleanup);

  it('uses the friend profile as the signed-in profile home and exposes public teams and players', async () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<FriendProfile auth={auth} profileUserId="user-1" />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Pat Parent' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Bears/ })).toHaveAttribute('href', '/teams/team-1/public');
    expect(screen.getByRole('link', { name: /Pat Star/ })).toHaveAttribute('href', profile.publicChildren[0].shareUrl);
    expect(screen.getAllByRole('link', { name: 'Edit profile' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Profile sections' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Posts' })).toHaveAttribute('href', '/profile?section=posts');
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute('href', '/profile?section=teams');
    expect(screen.getByRole('link', { name: 'Players' })).toHaveAttribute('href', '/profile?section=players');
    expect(document.querySelector('main')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Copy profile link' }));
    await waitFor(() => expect(publicActionMocks.copyPublicText).toHaveBeenCalledWith(`${window.location.origin}/app/#/people/user-1`));
  });

  it('supports route-addressable profile sections without rendering unrelated collections', async () => {
    render(
      <MemoryRouter initialEntries={['/profile?section=teams']}>
        <Routes>
          <Route path="/profile" element={<FriendProfile auth={auth} profileUserId="user-1" />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Public teams' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('heading', { name: 'Public players' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Recent posts' })).toBeNull();
  });

  it('shows a direct message action for an accepted friend profile', async () => {
    socialMocks.loadFriendProfile.mockResolvedValue({
      ...profile,
      userId: 'friend-2',
      name: 'Jamie Friend',
      isSelf: false,
      messageRoute: '/messages/team-1?compose=user%3Afriend-2&recipientName=Jamie+Friend'
    });

    render(
      <MemoryRouter initialEntries={['/people/friend-2']}>
        <Routes>
          <Route path="/people/:userId" element={<FriendProfile auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('link', { name: 'Message' })).toHaveAttribute('href', '/messages/team-1?compose=user%3Afriend-2&recipientName=Jamie+Friend');
  });
});
