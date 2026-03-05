import { describe, it, expect } from 'vitest';
import { advanceLiveChatUnreadState } from '../../js/live-tracker-chat-unread.js';

function message(ts, id = `m-${ts}`) {
  return {
    id,
    createdAt: {
      toMillis: () => ts
    }
  };
}

describe('live tracker chat unread state', () => {
  it('increments only by net-new collapsed messages across snapshots', () => {
    let state = {
      chatInitialized: true,
      chatExpanded: false,
      unreadChatCount: 0,
      lastChatSeenAt: 1000,
      lastChatSnapshotAt: 1000
    };

    state = {
      ...state,
      ...advanceLiveChatUnreadState({
        ...state,
        messages: [message(1100)],
        now: 1101
      })
    };
    expect(state.unreadChatCount).toBe(1);

    state = {
      ...state,
      ...advanceLiveChatUnreadState({
        ...state,
        messages: [message(1200), message(1100)],
        now: 1201
      })
    };
    expect(state.unreadChatCount).toBe(2);

    state = {
      ...state,
      ...advanceLiveChatUnreadState({
        ...state,
        messages: [message(1300), message(1200), message(1100)],
        now: 1301
      })
    };
    expect(state.unreadChatCount).toBe(3);
  });

  it('resets unread and baselines when chat is expanded', () => {
    const result = advanceLiveChatUnreadState({
      chatInitialized: true,
      chatExpanded: true,
      unreadChatCount: 5,
      lastChatSeenAt: 1000,
      lastChatSnapshotAt: 1200,
      messages: [message(1300)],
      now: 1301
    });

    expect(result.unreadChatCount).toBe(0);
    expect(result.lastChatSeenAt).toBe(1301);
    expect(result.lastChatSnapshotAt).toBe(1301);
    expect(result.lastChatSnapshotIds).toEqual([]);
  });

  it('counts net-new messages that share the same millisecond timestamp', () => {
    let state = {
      chatInitialized: true,
      chatExpanded: false,
      unreadChatCount: 0,
      lastChatSeenAt: 1000,
      lastChatSnapshotAt: 1000,
      lastChatSnapshotIds: ['existing-1000']
    };

    state = {
      ...state,
      ...advanceLiveChatUnreadState({
        ...state,
        messages: [message(1000, 'existing-1000')],
        now: 1001
      })
    };
    expect(state.unreadChatCount).toBe(0);

    state = {
      ...state,
      ...advanceLiveChatUnreadState({
        ...state,
        messages: [message(1000, 'existing-1000'), message(1000, 'new-1000')],
        now: 1002
      })
    };
    expect(state.unreadChatCount).toBe(1);
    expect(state.lastChatSnapshotAt).toBe(1000);
    expect(state.lastChatSnapshotIds.sort()).toEqual(['existing-1000', 'new-1000']);
  });
});
