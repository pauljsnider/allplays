import { getConfigs, getGame, getGameEvents, getTeam } from '../../../../js/db.js';
import { buildGameSummaryPrompt, buildPracticeFeedPrompt, buildFinishGamePayload } from '../../../../js/game-day-wrapup.js';
import { resolveLiveStatConfig } from '../../../../js/live-game-state.js';
import { getApp } from '../../../../js/vendor/firebase-app.js';
import { getAI, getGenerativeModel, GoogleAIBackend } from '../../../../js/vendor/firebase-ai.js';

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

let aiModelCache: any = null;

export function resetGameWrapupAiModelForTests() {
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
