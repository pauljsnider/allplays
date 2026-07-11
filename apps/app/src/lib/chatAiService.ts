import {
  getAI,
  getApp,
  getGenerativeModel,
  GoogleAIBackend
} from './adapters/legacyChatAi';
import {
  getAggregatedStatsForGames,
  getGameEvents,
  getGames,
  getPlayers,
  postChatMessage
} from './adapters/legacyChatService';
import type { ChatConversation } from './chatService';
import {
  buildChatAudienceMetadata,
  type ChatTargetType
} from './chatLogic';
import type { AuthUser } from './types';

const aiStatsGamesLimit = 10;
const aiGamesContextLimit = 20;
const aiEventsGamesLimit = 3;
const aiEventsPerGameLimit = 25;
const CHAT_AI_RESET_EVENT = 'allplays-chat-ai-reset';

let aiModelCache: any = null;

export function resetChatAiModel() {
  aiModelCache = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener(CHAT_AI_RESET_EVENT, resetChatAiModel);
}

function toDate(value: any) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value?.toDate) return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function truncateText(text: unknown, maxLen: number) {
  const clean = String(text || '').trim();
  if (clean.length <= maxLen) return clean || null;
  return `${clean.slice(0, maxLen).trim()}...`;
}

function isCompletedGame(game: any) {
  const status = String(game?.status || '').toLowerCase();
  if (status === 'final' || status === 'completed') return true;
  const homeScore = Number(game?.homeScore || 0);
  const awayScore = Number(game?.awayScore || 0);
  return homeScore > 0 || awayScore > 0;
}

function shouldFetchStats(question: string) {
  return /(stats|scorer|score|points|rebounds|assists|goals|saves|leader|leading|top|better|improv|improve|development|progress|player\s*#?\s*\d+)/i.test(question);
}

function shouldFetchEvents(question: string) {
  return /(play\s*by\s*play|play-by-play|timeline|game\s*log|event\s*log|events|possessions|highlights|what happened|sequence)/i.test(question);
}

function serializeGame(game: any) {
  const date = toDate(game?.date);
  return {
    id: game?.id || null,
    date: date ? date.toISOString() : null,
    opponent: game?.opponent || null,
    location: game?.location || null,
    status: game?.status || null,
    homeScore: game?.homeScore ?? null,
    awayScore: game?.awayScore ?? null,
    summary: truncateText(game?.summary, 700)
  };
}

function findMatchedPlayer(question: string, players: any[]) {
  const match = question.match(/player\s*#?\s*(\d{1,3})/i);
  if (!match) return null;
  const target = String(Number(match[1]));
  return players.find((player) => String(player.number ?? '') === target) || null;
}

async function buildAiContext(teamId: string, team: Record<string, any>, question: string, { fetchStats, fetchEvents }: { fetchStats: boolean; fetchEvents: boolean }) {
  const [players, games] = await Promise.all([
    getPlayers(teamId, { includeInactive: true }),
    getGames(teamId)
  ]);
  const playersById = new Map((players || []).map((player: any) => [player.id, player]));
  const now = new Date();
  const cutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const gamesWithDates = (games || [])
    .map((game: any) => ({ ...game, _date: toDate(game.date) }))
    .filter((game: any) => game._date);

  const upcomingGames = gamesWithDates
    .filter((game: any) => game._date >= cutoff)
    .sort((a: any, b: any) => a._date.getTime() - b._date.getTime())
    .slice(0, 10)
    .map(serializeGame);

  const recentGames = gamesWithDates
    .filter((game: any) => game._date < cutoff)
    .sort((a: any, b: any) => b._date.getTime() - a._date.getTime())
    .slice(0, aiGamesContextLimit)
    .map(serializeGame);

  let statsSummary = null;
  if (fetchStats) {
    const completedGames = gamesWithDates
      .filter(isCompletedGame)
      .sort((a: any, b: any) => b._date.getTime() - a._date.getTime())
      .slice(0, aiStatsGamesLimit);
    const totals = await getAggregatedStatsForGames(teamId, completedGames.map((game: any) => game.id));
    statsSummary = {
      gamesUsed: completedGames.map(serializeGame),
      totalsByPlayer: Object.entries(totals || {}).map(([playerId, stats]) => ({
        id: playerId,
        name: (playersById.get(playerId) as any)?.name || 'Unknown',
        number: (playersById.get(playerId) as any)?.number || null,
        stats
      }))
    };
  }

  let eventsSummary = null;
  if (fetchEvents) {
    const recentCompleted = gamesWithDates
      .filter(isCompletedGame)
      .sort((a: any, b: any) => b._date.getTime() - a._date.getTime())
      .slice(0, aiEventsGamesLimit);
    const eventsByGame = await Promise.all(recentCompleted.map(async (game: any) => {
      const events = await getGameEvents(teamId, game.id, { limit: aiEventsPerGameLimit });
      return {
        game: serializeGame(game),
        events: (events || []).slice().reverse().map((event: any) => {
          const player = event.playerId ? playersById.get(event.playerId) as any : null;
          return {
            id: event.id,
            timestamp: event.timestamp ?? null,
            period: event.period ?? null,
            gameTime: event.gameTime ?? null,
            text: event.text || null,
            type: event.type || null,
            playerId: event.playerId || null,
            playerName: player?.name || null,
            playerNumber: player?.number ?? null,
            statKey: event.statKey || null,
            value: event.value ?? null,
            isOpponent: event.isOpponent === true
          };
        })
      };
    }));
    eventsSummary = {
      gamesUsed: recentCompleted.map(serializeGame),
      eventsByGame
    };
  }

  const matchedPlayer = findMatchedPlayer(question, players || []);
  return {
    team: {
      id: teamId,
      name: team?.name || null,
      sport: team?.sport || null
    },
    players: (players || []).map((player: any) => ({
      id: player.id,
      name: player.name || null,
      number: player.number || null
    })),
    matchedPlayer: matchedPlayer ? {
      id: matchedPlayer.id,
      name: matchedPlayer.name || null,
      number: matchedPlayer.number ?? null
    } : null,
    gamesUpcoming: upcomingGames,
    gamesRecent: recentGames,
    stats: statsSummary,
    playByPlay: eventsSummary
  };
}

async function getAiModel() {
  if (aiModelCache) return aiModelCache;
  const firebaseApp = getApp();
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  aiModelCache = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
  return aiModelCache;
}

export async function sendAllPlaysChatAnswer({
  teamId,
  team,
  user,
  question,
  selectedConversation,
  selectedConversationId,
  selectedRecipientTarget,
  selectedRecipientIds
}: {
  teamId: string;
  team: Record<string, any>;
  user: AuthUser;
  question: string;
  selectedConversation?: ChatConversation | null;
  selectedConversationId: string;
  selectedRecipientTarget: ChatTargetType;
  selectedRecipientIds: string[];
}) {
  const fetchStats = shouldFetchStats(question);
  const fetchEvents = shouldFetchEvents(question);
  const context = await buildAiContext(teamId, team, question, { fetchStats, fetchEvents });
  const prompt = `You are ALL PLAYS, a sports management expert for youth teams.\n` +
    `You are speaking to coaches, admins, and parents.\n` +
    `Use ONLY the provided DATA to answer. If the data is insufficient, say so.\n` +
    `Respond in a clear, readable format with short paragraphs or bullet points.\n` +
    `Limit to at most 6 bullets total. Use *bold* only for short labels.\n\n` +
    `QUESTION:\n${question}\n\nDATA (JSON):\n${JSON.stringify(context)}\n`;
  const model = await getAiModel();
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  const targetMetadata = buildChatAudienceMetadata({
    selectedConversation,
    selectedConversationId,
    selectedRecipientTarget,
    selectedRecipientIds
  });
  await postChatMessage(teamId, {
    text: `ALL PLAYS\n\n${responseText}`,
    senderId: user.uid,
    senderName: user.displayName || user.email || null,
    senderEmail: user.email || null,
    senderPhotoUrl: user.photoUrl || null,
    ai: false,
    aiName: null,
    aiQuestion: null,
    conversationId: selectedConversationId,
    ...targetMetadata,
    aiMeta: null
  });
}
