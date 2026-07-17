import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getComposeRecipientFromSearch, getDirectThreadMountKey, getInboxRowWindow, getMessagesInboxLoadRouteKey, getOpportunityInquiryIdFromSearch, isSelectedConversation, mergeInboxTeams, mergeVisibleChatMessages, normalizeConversationId, shouldRecordDirectThreadMount } from './Messages';
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
  function previewUpdate(overrides: Partial<ChatInboxPreviewUpdate> = {}): ChatInboxPreviewUpdate {
    return {
      teamId: overrides.teamId || 'team-1',
      lastMessage: overrides.lastMessage ?? {
        id: 'msg-1',
        text: 'Practice packet is posted.',
        senderId: 'coach-1',
        senderName: 'Coach Jamie',
        senderEmail: 'coach@example.com',
        createdAt: new Date('2026-06-15T02:00:00Z'),
        reactions: {},
        deleted: false,
      },
      preferredConversationId: overrides.preferredConversationId ?? null,
      isMuted: overrides.isMuted ?? false,
    };
  }

  it('applies deferred previews collected during the active inbox load', () => {
    const update = previewUpdate({ isMuted: true });

    const merged = mergeInboxTeams([buildTeam()], new Map([[update.teamId, update]]));

    expect(merged[0].lastMessage?.text).toBe('Practice packet is posted.');
    expect(merged[0].isMuted).toBe(true);
  });

  it('coalesces batched deferred previews, keeps the latest update per team, and sorts once by preview recency', () => {
    const olderUpdate = previewUpdate({
      teamId: 'team-1',
      lastMessage: {
        id: 'older',
        text: 'Older Bears update.',
        senderId: 'coach-1',
        senderName: 'Coach Jamie',
        senderEmail: 'coach@example.com',
        createdAt: new Date('2026-06-15T01:00:00Z'),
        reactions: {},
        deleted: false,
      },
      preferredConversationId: 'staff-room',
      isMuted: true,
    });
    const latestUpdate = previewUpdate({
      teamId: 'team-1',
      lastMessage: {
        id: 'latest',
        text: 'Latest Bears update wins.',
        senderId: 'coach-1',
        senderName: 'Coach Jamie',
        senderEmail: 'coach@example.com',
        createdAt: new Date('2026-06-15T04:00:00Z'),
        reactions: {},
        deleted: false,
      },
      preferredConversationId: null,
      isMuted: false,
    });
    const thunderUpdate = previewUpdate({
      teamId: 'team-2',
      lastMessage: {
        id: 'thunder',
        text: 'Thunder checks in.',
        senderId: 'coach-2',
        senderName: 'Coach Morgan',
        senderEmail: 'morgan@example.com',
        createdAt: new Date('2026-06-15T03:00:00Z'),
        reactions: {},
        deleted: false,
      },
    });
    const batchedUpdates = new Map<string, ChatInboxPreviewUpdate>();
    batchedUpdates.set(olderUpdate.teamId, olderUpdate);
    batchedUpdates.set(thunderUpdate.teamId, thunderUpdate);
    batchedUpdates.set(latestUpdate.teamId, latestUpdate);

    const merged = mergeInboxTeams([
      buildTeam({ id: 'team-2', name: 'Thunder' }),
      buildTeam({ id: 'team-1', name: 'Bears' }),
    ], batchedUpdates);

    expect(merged.map((team) => team.id)).toEqual(['team-1', 'team-2']);
    expect(merged[0].lastMessage?.text).toBe('Latest Bears update wins.');
    expect(merged[0].preferredConversationId).toBeNull();
    expect(merged[0].isMuted).toBe(false);
    expect(merged[1].lastMessage?.text).toBe('Thunder checks in.');
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

describe('message entry routes', () => {
  it('selects an opportunity conversation from the Messages query', () => {
    expect(getOpportunityInquiryIdFromSearch('?inquiry=inquiry-1')).toBe('inquiry-1');
    expect(getOpportunityInquiryIdFromSearch('?conversation=team')).toBe('');
  });

  it('accepts only safe user recipient tokens for pre-addressed direct messages', () => {
    expect(getComposeRecipientFromSearch('?compose=user%3Afriend-1&recipientName=Pat+Parent')).toEqual({
      id: 'user:friend-1',
      name: 'Pat Parent'
    });
    expect(getComposeRecipientFromSearch('?compose=email%3Aprivate%40example.com')).toBeNull();
    expect(getComposeRecipientFromSearch('?compose=user%3Afriend%2Fmessages')).toBeNull();
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

  it('loads the inbox in bounded unread mode while deferred previews hydrate later', () => {
    const source = readFileSync(resolveAppSourcePath('src/pages/Messages.tsx'), 'utf8');

    expect(source).toContain('const [result, inquiryPage] = await Promise.all([');
    expect(source).toContain('loadChatInbox(auth.user, {');
    expect(source).toContain('includeLastMessages: false,');
    expect(source).toContain('onPreview: (previewUpdate) => {');
    expect(source).toContain('pendingPreviewUpdates.set(previewUpdate.teamId, previewUpdate);');
    expect(source).toContain('schedulePreviewFlush();');
    expect(source).toContain('setTeams((current) => mergeInboxTeams(current, updates));');
    expect(source).not.toContain('mergeInboxPreview');
  });

  it('keeps Team Email composer dispatches on the shared action creators', () => {
    const source = readFileSync(resolveAppSourcePath('src/pages/messages/components/TeamEmailSheet.tsx'), 'utf8');

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

describe('Messages inbox row windowing', () => {
  it('calculates top, middle, and bottom windows with bounded overscan', () => {
    expect(getInboxRowWindow({ itemCount: 250, scrollOffset: 0, viewportSize: 640 })).toEqual({
      startIndex: 0,
      endIndex: 12,
    });
    expect(getInboxRowWindow({ itemCount: 250, scrollOffset: 8000, viewportSize: 640 })).toEqual({
      startIndex: 96,
      endIndex: 112,
    });
    expect(getInboxRowWindow({ itemCount: 250, scrollOffset: 20000, viewportSize: 640 })).toEqual({
      startIndex: 238,
      endIndex: 250,
    });
  });

  it('accounts for document list offsets and renders every filtered result below the threshold', () => {
    expect(getInboxRowWindow({
      itemCount: 250,
      scrollOffset: 1800,
      viewportSize: 400,
      listOffset: 1000,
      rowHeight: 80,
      overscan: 2,
    })).toEqual({ startIndex: 8, endIndex: 17 });
    expect(getInboxRowWindow({ itemCount: 3, scrollOffset: 5000, viewportSize: 640 })).toEqual({
      startIndex: 0,
      endIndex: 3,
    });
  });
});
