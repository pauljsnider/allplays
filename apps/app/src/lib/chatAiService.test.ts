import { beforeEach, describe, expect, it, vi } from 'vitest';

const aiMocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getAI: vi.fn(() => ({})),
  getApp: vi.fn(() => ({})),
  getGenerativeModel: vi.fn()
}));

const chatMocks = vi.hoisted(() => ({
  getAggregatedStatsForGames: vi.fn(),
  getGameEvents: vi.fn(),
  getGames: vi.fn(),
  getPlayers: vi.fn(),
  postChatMessage: vi.fn()
}));

const directMessageMocks = vi.hoisted(() => ({
  sendAuthorizedDirectMessage: vi.fn()
}));

vi.mock('./adapters/legacyChatAi', () => ({
  getAI: aiMocks.getAI,
  getApp: aiMocks.getApp,
  getGenerativeModel: aiMocks.getGenerativeModel,
  GoogleAIBackend: class GoogleAIBackend {}
}));

vi.mock('./adapters/legacyChatService', () => chatMocks);
vi.mock('./friendMessageService', () => directMessageMocks);

beforeEach(async () => {
  vi.clearAllMocks();
  aiMocks.getGenerativeModel.mockReturnValue({ generateContent: aiMocks.generateContent });
  aiMocks.generateContent.mockResolvedValue({
    response: { text: () => 'Bring both uniforms.' }
  });
  chatMocks.getPlayers.mockResolvedValue([]);
  chatMocks.getGames.mockResolvedValue([]);
  chatMocks.getAggregatedStatsForGames.mockResolvedValue({});
  chatMocks.getGameEvents.mockResolvedValue([]);
  chatMocks.postChatMessage.mockResolvedValue({ id: 'ai-answer-1' });
  directMessageMocks.sendAuthorizedDirectMessage.mockResolvedValue({ id: 'direct-ai-answer-1' });
  const { resetChatAiModel } = await import('./chatAiService');
  resetChatAiModel();
});

const user = {
  uid: 'coach-1',
  email: 'coach@example.test',
  displayName: 'Coach Taylor',
  roles: ['coach' as const]
};

describe('sendAllPlaysChatAnswer', () => {
  it('routes a direct-conversation answer through the authorized server write path', async () => {
    const { sendAllPlaysChatAnswer } = await import('./chatAiService');

    await sendAllPlaysChatAnswer({
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Bears' },
      user,
      question: 'What should we bring?',
      selectedConversation: {
        id: 'direct_coach-1__user%3Aparent-1',
        type: 'direct',
        participantIds: ['coach-1', 'user:parent-1']
      } as any,
      selectedConversationId: 'direct_coach-1__user%3Aparent-1',
      selectedRecipientTarget: 'individuals',
      selectedRecipientIds: ['user:parent-1']
    });

    expect(directMessageMocks.sendAuthorizedDirectMessage).toHaveBeenCalledWith({
      teamId: 'team-1',
      conversationId: 'direct_coach-1__user%3Aparent-1',
      clientMessageId: null,
      text: 'ALL PLAYS\n\nBring both uniforms.',
      attachments: []
    });
    expect(chatMocks.postChatMessage).not.toHaveBeenCalled();
  });

  it('keeps group-conversation answers on the standard group write path', async () => {
    const { sendAllPlaysChatAnswer } = await import('./chatAiService');

    await sendAllPlaysChatAnswer({
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Bears' },
      user,
      question: 'What should we bring?',
      selectedConversation: {
        id: 'group_guardians',
        type: 'group',
        participantIds: ['coach-1', 'email:guardian@example.test']
      } as any,
      selectedConversationId: 'group_guardians',
      selectedRecipientTarget: 'individuals',
      selectedRecipientIds: ['email:guardian@example.test']
    });

    expect(chatMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
      text: 'ALL PLAYS\n\nBring both uniforms.',
      conversationId: 'group_guardians',
      targetType: 'individuals'
    }));
    expect(directMessageMocks.sendAuthorizedDirectMessage).not.toHaveBeenCalled();
  });
});
