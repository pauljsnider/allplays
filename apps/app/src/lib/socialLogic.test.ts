import { describe, expect, it } from 'vitest';
import {
  buildSocialHomeModel,
  categorizeFriends,
  emptySocialHome,
  type SocialFriend
} from './socialLogic';

function friend(overrides: Partial<SocialFriend> = {}): SocialFriend {
  return {
    id: 'me__them',
    userId: 'them',
    name: 'Coach Dad',
    email: 'dad@allplays.ai',
    photoUrl: null,
    sharedTeamIds: [],
    sharedTeamNames: [],
    status: 'pending',
    requesterId: 'them',
    recipientId: 'me',
    ...overrides
  };
}

describe('categorizeFriends', () => {
  it('classifies a pending request addressed to the current user as incoming', () => {
    const { incomingRequests, outgoingRequests, active } = categorizeFriends([friend()], 'me');
    expect(incomingRequests.map((f) => f.userId)).toEqual(['them']);
    expect(outgoingRequests).toEqual([]);
    expect(active).toEqual([]);
  });

  it('classifies a pending request the current user sent as outgoing', () => {
    const { incomingRequests, outgoingRequests } = categorizeFriends(
      [friend({ requesterId: 'me', recipientId: 'them' })],
      'me'
    );
    expect(incomingRequests).toEqual([]);
    expect(outgoingRequests.map((f) => f.userId)).toEqual(['them']);
  });
});

describe('buildSocialHomeModel', () => {
  it('exposes incoming requests and defaults friendshipsError to null', () => {
    const model = buildSocialHomeModel({
      feedItems: [],
      friendshipFriends: [friend()],
      suggestions: [],
      currentUserId: 'me'
    });
    expect(model.incomingRequests.map((f) => f.userId)).toEqual(['them']);
    expect(model.metrics.incomingRequests).toBe(1);
    expect(model.friendshipsError).toBeNull();
  });

  it('carries a friendships load error so the UI can surface it', () => {
    const model = buildSocialHomeModel({
      feedItems: [],
      friendshipFriends: [],
      suggestions: [],
      currentUserId: 'me',
      friendshipsError: 'Missing or insufficient permissions.'
    });
    expect(model.friendshipsError).toBe('Missing or insufficient permissions.');
    expect(model.incomingRequests).toEqual([]);
  });
});

describe('emptySocialHome', () => {
  it('has a null friendshipsError', () => {
    expect(emptySocialHome().friendshipsError).toBeNull();
  });
});
