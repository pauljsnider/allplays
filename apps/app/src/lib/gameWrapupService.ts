import {
  buildFinishGamePayload,
  buildGameSummaryPrompt,
  buildPracticeFeedPrompt,
  getAI,
  getApp,
  getConfigs,
  getGame,
  getGameEvents,
  getGenerativeModel,
  getTeam,
  GoogleAIBackend,
  resolveLiveStatConfig,
  resolveSummaryRecipient
} from './adapters/legacyGameWrapup';

export type GameWrapupScore = {
  home: number;
  away: number;
};

export type PracticeFeedItem = {
  weakness: string;
  evidence: string;
  drillCategory: string;
  urgency: 'high' | 'medium' | 'low' | string;
  addedAt: string;
};

export type GameWrapupArtifacts = {
  summary: string;
  practiceFeedItems: PracticeFeedItem[];
};

export type GameWrapupEmailDraft = {
  recipientEmail: string;
  subject: string;
  body: string;
  mailto: string;
};

let aiModelCache: any = null;

export function resetGameWrapupAiModel() {
  aiModelCache = null;
}

export function buildAppWrapupCompletionPayload({ homeScore, awayScore, postGameNotes }: {
  homeScore: number;
  awayScore: number;
  postGameNotes: string;
}) {
  return buildFinishGamePayload({
    homeScoreValue: String(homeScore),
    awayScoreValue: String(awayScore),
    postGameNotesValue: postGameNotes
  });
}

export function buildGameWrapupEmailDraft({
  teamName,
  opponentName,
  gameDate,
  score,
  summary,
  postGameNotes,
  teamNotificationEmail,
  userEmail
}: {
  teamName: string;
  opponentName: string;
  gameDate?: Date | null;
  score: GameWrapupScore;
  summary?: string;
  postGameNotes?: string;
  teamNotificationEmail?: string | null;
  userEmail?: string | null;
}): GameWrapupEmailDraft | null {
  const recipientEmail = resolveSummaryRecipient({ teamNotificationEmail, userEmail });
  if (!recipientEmail) {
    return null;
  }

  const resolvedTeamName = String(teamName || 'Team').trim() || 'Team';
  const resolvedOpponentName = String(opponentName || 'Opponent').trim() || 'Opponent';
  const dateLabel = gameDate instanceof Date && !Number.isNaN(gameDate.getTime())
    ? gameDate.toLocaleDateString()
    : new Date().toLocaleDateString();
  const trimmedSummary = String(summary || '').trim();
  const trimmedNotes = String(postGameNotes || '').trim();
  const subject = `${resolvedTeamName} vs ${resolvedOpponentName} - Game Summary`;

  let body = `${resolvedTeamName} Game Summary\n`;
  body += `Date: ${dateLabel}\n`;
  body += `Opponent: ${resolvedOpponentName}\n`;
  body += `Final Score: ${Number(score?.home || 0)} - ${Number(score?.away || 0)}\n`;

  if (trimmedSummary) {
    body += `\nSUMMARY:\n`;
    body += `${'='.repeat(40)}\n`;
    body += `${trimmedSummary}\n`;
  }

  if (trimmedNotes) {
    body += `\nPOST-GAME NOTES:\n`;
    body += `${'='.repeat(40)}\n`;
    body += `${trimmedNotes}\n`;
  }

  return {
    recipientEmail,
    subject,
    body,
    mailto: `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  };
}

async function getGameWrapupAiModel() {
  if (aiModelCache) return aiModelCache;
  const app = getApp();
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  aiModelCache = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
  return aiModelCache;
}

function normalizeDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.seconds === 'number') {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseJsonObject(text: string) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function normalizePracticeFeedItems(value: unknown) {
  const parsed = parseJsonObject(String(value || ''));
  const items = Array.isArray(parsed?.practiceFeedItems) ? parsed.practiceFeedItems : [];
  return items.map((item: any) => ({
    weakness: String(item?.weakness || '').trim(),
    evidence: String(item?.evidence || '').trim(),
    drillCategory: String(item?.drillCategory || '').trim(),
    urgency: String(item?.urgency || 'medium').trim() || 'medium',
    addedAt: new Date().toISOString()
  })).filter((item: PracticeFeedItem) => item.weakness || item.evidence || item.drillCategory);
}

export async function generateGameWrapupArtifactsForApp({
  teamId,
  gameId,
  score,
  notes
}: {
  teamId: string;
  gameId: string;
  score: GameWrapupScore;
  notes: string;
}): Promise<GameWrapupArtifacts> {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before running wrap-up AI.');
  }

  const [team, game, configs, rawEvents] = await Promise.all([
    getTeam(teamId, { includeInactive: true }).catch(() => null),
    getGame(teamId, gameId),
    getConfigs(teamId).catch(() => []),
    getGameEvents(teamId, gameId, { limit: 100 }).catch(() => [])
  ]);

  if (!game) {
    throw new Error('Game not found.');
  }

  const resolvedConfig = resolveLiveStatConfig({
    configs,
    game,
    team
  });
  const events = (Array.isArray(rawEvents) ? rawEvents : [])
    .map((entry: any) => ({
      ...entry,
      clock: entry?.clock || entry?.gameTime || ''
    }))
    .sort((a: any, b: any) => (normalizeDate(a?.timestamp)?.getTime() || 0) - (normalizeDate(b?.timestamp)?.getTime() || 0))
    .slice(-30);

  const practiceFeedPrompt = buildPracticeFeedPrompt({
    game,
    team,
    config: resolvedConfig,
    score,
    coachingNotes: Array.isArray(game.coachingNotes) ? game.coachingNotes : [],
    notes,
    events
  });
  const summaryPrompt = buildGameSummaryPrompt({
    game,
    team,
    config: resolvedConfig,
    score,
    coachingNotes: Array.isArray(game.coachingNotes) ? game.coachingNotes : [],
    notes
  });

  const model = await getGameWrapupAiModel();
  const [practiceFeedResult, summaryResult] = await Promise.all([
    model.generateContent(practiceFeedPrompt),
    model.generateContent(summaryPrompt)
  ]);

  return {
    practiceFeedItems: normalizePracticeFeedItems(practiceFeedResult?.response?.text?.() || ''),
    summary: String(summaryResult?.response?.text?.() || '').trim()
  };
}
