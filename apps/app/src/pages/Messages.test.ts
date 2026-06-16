import { describe, expect, it } from 'vitest';
import { mergeInboxTeams } from './Messages';
import type { ChatInboxPreviewUpdate, ChatTeam } from '../lib/chatService';

function buildTeam(overrides: Partial<ChatTeam> = {}): ChatTeam {
  return {
    id: overrides.id || 'team-1',
    name: overrides.name || 'Bears',
    sport: overrides.sport || 'Basketball',
    photoUrl: overrides.photoUrl || null,
    active: overrides.active ?? true,
    role: overrides.role || 'Admin',
    canModerate: overrides.canModerate ?? true,
    unreadCount: overrides.unreadCount ?? 0,
    lastMessage: overrides.lastMessage ?? null,
    preferredConversationId: overrides.preferredConversationId ?? null,
    isMuted: overrides.isMuted ?? false,
  };
}

describe('mergeInboxTeams', () => {
  it('applies deferred previews collected during the active inbox load', () => {
    const previewUpdate: ChatInboxPreviewUpdate = {
      teamId: 'team-1',
      lastMessage: {
        id: 'msg-1',
        text: 'Practice packet is posted.',
        senderId: 'coach-1',
        senderName: 'Coach Jamie',
        senderEmail: 'coach@example.com',
        createdAt: new Date('2026-06-15T02:00:00Z'),
        reactions: {},
        deleted: false,
      },
      preferredConversationId: null,
    };

    const merged = mergeInboxTeams([buildTeam()], new Map([[previewUpdate.teamId, previewUpdate]]));

    expect(merged[0].lastMessage?.text).toBe('Practice packet is posted.');
  });

  it('resets teams back to placeholder previews when a new inbox load has no deferred preview yet', () => {
    const merged = mergeInboxTeams([
      buildTeam({
        id: 'team-1',
        lastMessage: null,
      }),
    ], new Map());

    expect(merged[0].lastMessage).toBeNull();
    expect(merged[0].preferredConversationId).toBeNull();
  });
});
