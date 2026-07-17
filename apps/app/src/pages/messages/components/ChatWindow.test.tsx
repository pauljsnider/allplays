// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_BACK_DISMISS_EVENT } from '../../../lib/nativeBackButton';
import { findExistingDirectConversationId, Sheet, sendLazyAllPlaysChatAnswer } from './ChatWindow';

const chatAiServiceMocks = vi.hoisted(() => ({
  sendAllPlaysChatAnswer: vi.fn()
}));

vi.mock('../../../lib/chatAiService', () => chatAiServiceMocks);

function resolveAppSourcePath(relativePath: string) {
  const cwd = process.cwd();
  const appRoot = cwd.endsWith('/apps/app') || cwd.endsWith('\\apps\\app')
    ? cwd
    : resolve(cwd, 'apps/app');
  return resolve(appRoot, relativePath);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Messages Sheet native back behavior', () => {
  it('consumes native back dismiss events and closes the sheet', () => {
    const onClose = vi.fn();

    render(
      <Sheet title="Message audience" onClose={onClose}>
        <button type="button">Selected members</button>
      </Sheet>
    );

    expect(screen.getByRole('dialog', { name: 'Message audience' })).toBeVisible();

    const event = new Event(APP_BACK_DISMISS_EVENT, { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores native back dismiss events already consumed by a higher overlay', () => {
    const onClose = vi.fn();

    render(
      <Sheet title="Message audience" onClose={onClose}>
        <button type="button">Selected members</button>
      </Sheet>
    );

    const event = new Event(APP_BACK_DISMISS_EVENT, { cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Messages ALL PLAYS lazy loading', () => {
  it('reserves enough mobile chat topbar space for both shell overlay buttons', () => {
    const sourcePath = resolveAppSourcePath('src/pages/messages/components/ChatWindow.tsx');
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toContain("${!embedded && !isDesktopWeb ? 'pr-28' : ''}");
    expect(source).not.toContain("${!embedded && !isDesktopWeb ? 'pr-16' : ''}");
  });

  it('keeps the AI answer module behind the wantsAi send branch', () => {
    const sourcePath = resolveAppSourcePath('src/pages/messages/components/ChatWindow.tsx');
    const source = readFileSync(sourcePath, 'utf8');
    const chatServiceImport = source.match(/import \{[\s\S]*?\} from '..\/..\/..\/lib\/chatService';/)?.[0] || '';
    const chatServiceSource = readFileSync(resolveAppSourcePath('src/lib/chatService.ts'), 'utf8');
    const legacyChatServiceSource = readFileSync(resolveAppSourcePath('src/lib/adapters/legacyChatService.ts'), 'utf8');

    expect(chatServiceImport).not.toContain('sendAllPlaysChatAnswer');
    expect(source).toContain("await import('../../../lib/chatAiService')");
    expect(source.indexOf('if (result.wantsAi)')).toBeLessThan(source.indexOf('await sendLazyAllPlaysChatAnswer({'));
    expect(chatServiceSource).not.toContain('getAI');
    expect(chatServiceSource).not.toContain('getGenerativeModel');
    expect(chatServiceSource).not.toContain('GoogleAIBackend');
    expect(legacyChatServiceSource).not.toContain('firebase-ai');
  });

  it('keeps Team Email reducer and service calls out of the eager ChatWindow imports', () => {
    const sourcePath = resolveAppSourcePath('src/pages/messages/components/ChatWindow.tsx');
    const source = readFileSync(sourcePath, 'utf8');
    const chatServiceImport = source.match(/import \{[\s\S]*?\} from '..\/..\/..\/lib\/chatService';/)?.[0] || '';

    expect(source).toContain("lazy(() => import('./TeamEmailSheet'))");
    expect(source).not.toContain("from '../state/emailReducer'");
    expect(chatServiceImport).not.toContain('loadTeamEmailDrafts');
    expect(chatServiceImport).not.toContain('loadTeamEmailTemplates');
    expect(chatServiceImport).not.toContain('loadSentTeamEmails');
    expect(chatServiceImport).not.toContain('saveTeamEmailDraft');
    expect(chatServiceImport).not.toContain('saveTeamEmailTemplate');
    expect(chatServiceImport).not.toContain('sendTeamEmailMessage');
  });

  it('loads and calls the AI module only through the lazy answer helper', async () => {
    const input = {
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Bears' },
      user: { uid: 'user-1', email: 'coach@example.test', displayName: 'Coach Taylor', roles: ['coach'] as const },
      question: 'who needs RSVP help?',
      selectedConversation: { id: 'staff-conversation', participantRoles: ['staff'] },
      selectedConversationId: 'staff-conversation',
      selectedRecipientTarget: 'staff' as const,
      selectedRecipientIds: ['user:coach-1']
    };

    await sendLazyAllPlaysChatAnswer(input as any);

    expect(chatAiServiceMocks.sendAllPlaysChatAnswer).toHaveBeenCalledTimes(1);
    expect(chatAiServiceMocks.sendAllPlaysChatAnswer).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      question: 'who needs RSVP help?',
      selectedConversationId: 'staff-conversation',
      selectedRecipientTarget: 'staff',
      selectedRecipientIds: ['user:coach-1']
    }));
  });
});

describe('Chat composer audience lifecycle', () => {
  it('reuses a direct conversation that the friend originally started', () => {
    const conversations = [{
      id: 'direct_friend-2__user%3Acurrent-1',
      type: 'direct' as const,
      participantIds: ['friend-2', 'user:current-1']
    }, {
      id: 'direct_current-1__user%3Aother-3',
      type: 'direct' as const,
      participantIds: ['current-1', 'user:other-3']
    }, {
      id: 'group_current-1__friend-2',
      type: 'group' as const,
      participantIds: ['current-1', 'friend-2']
    }];

    expect(findExistingDirectConversationId(conversations, 'current-1', 'user:friend-2'))
      .toBe('direct_friend-2__user%3Acurrent-1');
    expect(findExistingDirectConversationId(conversations, 'current-1', 'user:missing-4')).toBe('');
  });

  it('keeps full team as the default and resets the audience before enqueueing each send', () => {
    const sourcePath = resolveAppSourcePath('src/pages/messages/components/ChatWindow.tsx');
    const source = readFileSync(sourcePath, 'utf8');
    const handleSendStart = source.indexOf('const handleSend = async');
    const handleSendEnd = source.indexOf('const openEmailSheet =', handleSendStart);
    const handleSendSource = source.slice(handleSendStart, handleSendEnd);

    expect(source).toContain("useState<ChatTargetType>('full_team')");
    expect(handleSendSource).toContain("setSelectedRecipientTarget('full_team');");
    expect(handleSendSource.indexOf("setSelectedRecipientTarget('full_team');"))
      .toBeLessThan(handleSendSource.indexOf('enqueueChatSend(request);'));
  });
});
