import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDirectThreadMountKey, getMessagesInboxLoadRouteKey, isSelectedConversation, mergeInboxTeams, mergeVisibleChatMessages, normalizeConversationId, shouldRecordDirectThreadMount } from './Messages';
import type { ChatInboxPreviewUpdate, ChatTeam } from '../lib/chatService';

function resolveAppSourcePath(relativePath: string) {
  const cwd = process.cwd();
  const appRoot = cwd.endsWith('/apps/app') || cwd.endsWith('\\apps\\app')
    ? cwd
    : resolve(cwd, 'apps/app');
  return resolve(appRoot, relativePath);
}

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
      isMuted: true,
    };

    const merged = mergeInboxTeams([buildTeam()], new Map([[previewUpdate.teamId, previewUpdate]]));

    expect(merged[0].lastMessage?.text).toBe('Practice packet is posted.');
    expect(merged[0].isMuted).toBe(true);
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

describe('conversation id normalization', () => {
  it('falls back to the default team conversation when the route state is blank', () => {
    expect(normalizeConversationId(undefined)).toBe('team');
    expect(normalizeConversationId('')).toBe('team');
    expect(normalizeConversationId(' staff-room ')).toBe('staff-room');
  });

  it('marks only the selected conversation as active', () => {
    expect(isSelectedConversation('team', 'team')).toBe(true);
    expect(isSelectedConversation('team', 'staff-room')).toBe(false);
  });
});

describe('visible chat message merging', () => {
  const buildMessage = (overrides: Record<string, unknown>) => ({
    id: 'message-1',
    text: 'Message',
    senderId: 'user-1',
    senderName: 'Pat Parent',
    senderEmail: 'parent@example.com',
    createdAt: new Date('2026-06-20T12:00:00Z'),
    reactions: {},
    deleted: false,
    ...overrides,
  }) as any;

  it('keeps optimistic messages scoped to the selected conversation', () => {
    const merged = mergeVisibleChatMessages(
      [buildMessage({ id: 'live-staff', text: 'Staff live', conversationId: 'staff-conversation' })],
      [
        buildMessage({ id: 'pending-team', clientMessageId: 'client-team', text: 'Team pending', conversationId: null, sendStatus: 'pending' }),
        buildMessage({ id: 'pending-staff', clientMessageId: 'client-staff', text: 'Staff pending', conversationId: 'staff-conversation', sendStatus: 'pending' }),
      ],
      'staff-conversation'
    );

    expect(merged.map((message) => message.id)).toContain('pending-staff');
    expect(merged.map((message) => message.id)).toContain('live-staff');
    expect(merged.map((message) => message.id)).not.toContain('pending-team');
  });

  it('treats blank optimistic conversation ids as the default team conversation', () => {
    const merged = mergeVisibleChatMessages(
      [],
      [buildMessage({ id: 'pending-team', clientMessageId: 'client-team', conversationId: null, sendStatus: 'pending' })],
      'team'
    );

    expect(merged.map((message) => message.id)).toEqual(['pending-team']);
  });
});

describe('direct thread mount telemetry', () => {
  it('records again when the mobile direct-thread team route changes', () => {
    expect(getDirectThreadMountKey(' team-1 ')).toBe('team-1');
    expect(shouldRecordDirectThreadMount(null, 'team-1')).toBe(true);
    expect(shouldRecordDirectThreadMount('team-1', 'team-1')).toBe(false);
    expect(shouldRecordDirectThreadMount('team-1', 'team-2')).toBe(true);
  });

  it('does not reload desktop inbox data when only the selected team route changes', () => {
    expect(getMessagesInboxLoadRouteKey(true, 'team-1')).toBe('');
    expect(getMessagesInboxLoadRouteKey(true, 'team-2')).toBe('');
    expect(getMessagesInboxLoadRouteKey(false, 'team-1')).toBe('team-1');
    expect(getMessagesInboxLoadRouteKey(false, ' team-2 ')).toBe('team-2');
  });

  it('keeps Messages email composer dispatches on the shared action creators', () => {
    const source = readFileSync(resolveAppSourcePath('src/pages/messages/components/ChatWindow.tsx'), 'utf8');

    expect(source).toContain("import { emailComposerActions, emailReducer, initialEmailComposerState } from '../state/emailReducer';");
    expect(source).toContain("emailDispatch(emailComposerActions.setTemplates(await loadTeamEmailTemplates(teamId)));");
    expect(source).toContain("emailDispatch(emailComposerActions.setDrafts(await loadTeamEmailDrafts(teamId)));");
    expect(source).toContain("emailDispatch(emailComposerActions.clearSelectedDraft());");
    expect(source).toContain("emailDispatch(emailComposerActions.selectDraft(draft.id));");
    expect(source).toContain("emailDispatch(emailComposerActions.applyTemplate(template.id));");
    expect(source).toContain("emailDispatch(emailComposerActions.saveDraft(savedDraft));");
    expect(source).toContain("emailDispatch(emailComposerActions.clearComposer());");
    expect(source).not.toContain("emailDispatch({ type: 'setTemplates'");
    expect(source).not.toContain("emailDispatch({ type: 'setDrafts'");
    expect(source).not.toContain("emailDispatch({ type: 'clearComposer'");
  });
});
