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

const gameReportMocks = vi.hoisted(() => ({
  loadGameReportPlays: vi.fn(),
  loadGameReportSections: vi.fn()
}));

vi.mock('./adapters/legacyChatAi', () => ({
  getAI: aiMocks.getAI,
  getApp: aiMocks.getApp,
  getGenerativeModel: aiMocks.getGenerativeModel,
  GoogleAIBackend: class GoogleAIBackend {}
}));

vi.mock('./adapters/legacyChatService', () => chatMocks);
vi.mock('./friendMessageService', () => directMessageMocks);
vi.mock('./gameReportService', () => gameReportMocks);

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
  gameReportMocks.loadGameReportPlays.mockReset();
  gameReportMocks.loadGameReportSections.mockReset();
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

function buildCompletedGame(id: string, trackingEngine?: string) {
  return {
    id,
    date: new Date('2026-01-01T18:00:00.000Z'),
    status: 'completed',
    liveStatus: 'completed',
    opponent: `${id} opponent`,
    ...(trackingEngine ? { trackingEngine } : {})
  };
}

function buildPublicDiamondReport(gameId: string, overrides: Record<string, any> = {}) {
  return {
    game: buildCompletedGame(gameId, 'diamond-v2'),
    visiblePlayerRows: [
      {
        playerId: 'player-7',
        playerName: 'Casey Public',
        number: '7',
        stats: { ab: 2, h: 1, avg: 0.5, secretPitchCall: 99 },
        statPresentation: {
          statCoverage: { ab: 'complete', h: 'complete', avg: 'complete', secretPitchCall: 'partial' }
        }
      }
    ],
    diamond: {
      isDiamond: true,
      status: 'current',
      pending: false,
      requestedStatVisibility: 'public',
      statVisibility: 'public',
      requestedReplayVisibility: 'public',
      replayVisibility: 'public',
      replaySource: 'public-sanitized',
      privateStatsStatus: 'not-requested'
    },
    ...overrides
  } as any;
}

function buildPublicDiamondReplay(gameId: string, text = 'Casey Public doubled') {
  return {
    game: buildCompletedGame(gameId, 'diamond-v2'),
    playsFresh: true,
    plays: [{ id: 'play-public-1', text, period: 'Top 1', clock: '', timestamp: new Date('2026-01-01T18:10:00.000Z') }],
    replay: {
      requestedVisibility: 'public',
      visibility: 'public',
      source: 'public-sanitized'
    }
  } as any;
}

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

    expect(chatMocks.postChatMessage).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({
        text: 'ALL PLAYS\n\nBring both uniforms.',
        conversationId: 'group_guardians',
        targetType: 'individuals'
      })
    );
    expect(directMessageMocks.sendAuthorizedDirectMessage).not.toHaveBeenCalled();
    expect(String(aiMocks.generateContent.mock.calls[0]?.[0] || '')).not.toContain('Diamond evidence is public-only');
  });

  it('uses only complete public Diamond stats and replay evidence for a group answer', async () => {
    const diamondGame = buildCompletedGame('diamond-1', 'diamond-v2');
    chatMocks.getPlayers.mockResolvedValue([{ id: 'player-7', name: 'Casey Public', number: '7' }]);
    chatMocks.getGames.mockResolvedValue([diamondGame]);
    gameReportMocks.loadGameReportSections.mockResolvedValue(buildPublicDiamondReport('diamond-1'));
    gameReportMocks.loadGameReportPlays.mockResolvedValue(buildPublicDiamondReplay('diamond-1'));
    const { sendAllPlaysChatAnswer } = await import('./chatAiService');

    await sendAllPlaysChatAnswer({
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Bears' },
      user,
      question: 'Who is the stats leader and what happened?',
      selectedConversation: { id: 'group_guardians', type: 'group', participantIds: ['coach-1'] } as any,
      selectedConversationId: 'group_guardians',
      selectedRecipientTarget: 'full_team',
      selectedRecipientIds: []
    });

    expect(chatMocks.getAggregatedStatsForGames).not.toHaveBeenCalled();
    expect(chatMocks.getGameEvents).not.toHaveBeenCalled();
    expect(gameReportMocks.loadGameReportSections).toHaveBeenCalledWith('team-1', 'diamond-1', { statVisibility: 'public' });
    expect(gameReportMocks.loadGameReportPlays).toHaveBeenCalledWith('team-1', 'diamond-1', { statVisibility: 'public' });
    const prompt = String(aiMocks.generateContent.mock.calls[0]?.[0] || '');
    expect(prompt).toContain('Casey Public doubled');
    expect(prompt).toContain('"visibility":"public"');
    expect(prompt).toContain('"ab":2');
    expect(prompt).not.toContain('"secretPitchCall":99');
    expect(prompt).toContain('never infer manager-private details');
  });

  it('keeps mixed-team legacy reads on legacy IDs and routes Diamond evidence through public reports', async () => {
    const legacyGame = buildCompletedGame('legacy-1');
    const diamondGame = buildCompletedGame('diamond-1', 'diamond-v2');
    chatMocks.getPlayers.mockResolvedValue([
      { id: 'legacy-player', name: 'Legacy Player', number: '4' },
      { id: 'player-7', name: 'Casey Public', number: '7' }
    ]);
    chatMocks.getGames.mockResolvedValue([legacyGame, diamondGame]);
    chatMocks.getAggregatedStatsForGames.mockResolvedValue({ 'legacy-player': { pts: 9 } });
    chatMocks.getGameEvents.mockResolvedValue([{ id: 'legacy-play', text: 'Legacy basket', playerId: 'legacy-player' }]);
    gameReportMocks.loadGameReportSections.mockResolvedValue(buildPublicDiamondReport('diamond-1'));
    gameReportMocks.loadGameReportPlays.mockResolvedValue(buildPublicDiamondReplay('diamond-1'));
    const { sendAllPlaysChatAnswer } = await import('./chatAiService');

    await sendAllPlaysChatAnswer({
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Mixed Bears' },
      user,
      question: 'Show the stats and play-by-play highlights',
      selectedConversation: null,
      selectedConversationId: 'team',
      selectedRecipientTarget: 'full_team',
      selectedRecipientIds: []
    });

    expect(chatMocks.getAggregatedStatsForGames).toHaveBeenCalledTimes(1);
    expect(chatMocks.getAggregatedStatsForGames).toHaveBeenCalledWith('team-1', ['legacy-1']);
    expect(chatMocks.getGameEvents).toHaveBeenCalledTimes(1);
    expect(chatMocks.getGameEvents).toHaveBeenCalledWith('team-1', 'legacy-1', { limit: 25 });
    const prompt = String(aiMocks.generateContent.mock.calls[0]?.[0] || '');
    expect(prompt).toContain('Legacy basket');
    expect(prompt).toContain('Casey Public doubled');
    expect(prompt).toContain('"legacyGameCount":1');
    expect(prompt).toContain('"diamondGameCount":1');
    expect(chatMocks.getGames).toHaveBeenCalledWith('team-1', { requireCompleteSharedGames: true });
  });

  it('fails closed before AI or legacy stats when the complete shared-game inventory is unavailable', async () => {
    chatMocks.getGames.mockRejectedValue(Object.assign(
      new Error('Unable to load a complete shared-game inventory.'),
      { code: 'game-inventory-cache-only', complete: false, absenceConfirmed: false }
    ));
    const { sendAllPlaysChatAnswer } = await import('./chatAiService');

    await expect(sendAllPlaysChatAnswer({
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Mixed Bears' },
      user,
      question: 'Who is the stats leader?',
      selectedConversation: null,
      selectedConversationId: 'team',
      selectedRecipientTarget: 'full_team',
      selectedRecipientIds: []
    })).rejects.toMatchObject({
      code: 'game-inventory-cache-only',
      complete: false,
      absenceConfirmed: false
    });

    expect(chatMocks.getGames).toHaveBeenCalledWith('team-1', { requireCompleteSharedGames: true });
    expect(chatMocks.getAggregatedStatsForGames).not.toHaveBeenCalled();
    expect(gameReportMocks.loadGameReportSections).not.toHaveBeenCalled();
    expect(aiMocks.generateContent).not.toHaveBeenCalled();
    expect(chatMocks.postChatMessage).not.toHaveBeenCalled();
  });

  it('retries an incomplete Diamond replay once before answering', async () => {
    chatMocks.getGames.mockResolvedValue([buildCompletedGame('diamond-1', 'diamond-v2')]);
    gameReportMocks.loadGameReportPlays
      .mockResolvedValueOnce({ ...buildPublicDiamondReplay('diamond-1'), playsFresh: false, replay: undefined })
      .mockResolvedValueOnce(buildPublicDiamondReplay('diamond-1'));
    const { sendAllPlaysChatAnswer } = await import('./chatAiService');

    await sendAllPlaysChatAnswer({
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Bears' },
      user,
      question: 'What happened in the game log?',
      selectedConversation: null,
      selectedConversationId: 'team',
      selectedRecipientTarget: 'full_team',
      selectedRecipientIds: []
    });

    expect(gameReportMocks.loadGameReportPlays).toHaveBeenCalledTimes(2);
    expect(aiMocks.generateContent).toHaveBeenCalledTimes(1);
    expect(chatMocks.postChatMessage).toHaveBeenCalledTimes(1);
  });

  it('does not send pending correction events to the model when a Diamond replay stays non-fresh', async () => {
    chatMocks.getGames.mockResolvedValue([buildCompletedGame('diamond-1', 'diamond-v2')]);
    gameReportMocks.loadGameReportPlays.mockResolvedValue({
      ...buildPublicDiamondReplay('diamond-1'),
      playsFresh: false,
      plays: [
        { id: 'event-original', text: 'Original single', period: 'Top 1', clock: '', timestamp: new Date() },
        { id: 'event-void', text: 'Scoring correction recorded', period: 'Top 1', clock: '', timestamp: new Date() },
        { id: 'event-supersede', text: 'Scoring correction replaced a prior play', period: 'Top 1', clock: '', timestamp: new Date() }
      ],
      replayError: 'Diamond play-by-play could not be refreshed completely. Retry the report.'
    });
    const { sendAllPlaysChatAnswer } = await import('./chatAiService');

    await expect(
      sendAllPlaysChatAnswer({
        teamId: 'team-1',
        team: { id: 'team-1', name: 'Bears' },
        user,
        question: 'What happened in the game log?',
        selectedConversation: null,
        selectedConversationId: 'team',
        selectedRecipientTarget: 'full_team',
        selectedRecipientIds: []
      })
    ).rejects.toThrow('temporarily unavailable');

    expect(gameReportMocks.loadGameReportPlays).toHaveBeenCalledTimes(2);
    expect(aiMocks.generateContent).not.toHaveBeenCalled();
    expect(chatMocks.postChatMessage).not.toHaveBeenCalled();
  });

  it('does not call the model or post when Diamond evidence stays incomplete', async () => {
    chatMocks.getGames.mockResolvedValue([buildCompletedGame('diamond-1', 'diamond-v2')]);
    gameReportMocks.loadGameReportSections.mockResolvedValue(
      buildPublicDiamondReport('diamond-1', {
        diamond: { ...buildPublicDiamondReport('diamond-1').diamond, pending: true, status: 'pending' }
      })
    );
    const { sendAllPlaysChatAnswer } = await import('./chatAiService');

    await expect(
      sendAllPlaysChatAnswer({
        teamId: 'team-1',
        team: { id: 'team-1', name: 'Bears' },
        user,
        question: 'Who is the stats leader?',
        selectedConversation: null,
        selectedConversationId: 'team',
        selectedRecipientTarget: 'full_team',
        selectedRecipientIds: []
      })
    ).rejects.toThrow('temporarily unavailable');

    expect(gameReportMocks.loadGameReportSections).toHaveBeenCalledTimes(2);
    expect(aiMocks.generateContent).not.toHaveBeenCalled();
    expect(chatMocks.postChatMessage).not.toHaveBeenCalled();
  });
});
