import {
  buildGamePlanIntervals,
  buildRotationPlanFromGamePlan,
  getAI,
  getApp,
  getGenerativeModel,
  GoogleAIBackend,
  normalizeLineupsForGamePlanPlanner
} from './adapters/legacyGameDayLineup';
import { getLineupFormation, getLineupPeriodsForFormation, type AutoFilledLineupPlayer, type LineupFormationPosition } from './gameDayLineupPublish';

export type LineupEditorPlayer = AutoFilledLineupPlayer & {
  availability: 'going' | 'available';
};

export type ProjectedPlayingTimeSummaryRow = {
  playerId: string;
  playerName: string;
  playerNumber: string | null;
  minutes: number;
  targetMinutes: number;
  percentageOfTarget: number;
  status: 'balanced' | 'under-utilized' | 'over-utilized' | 'good';
};

export function getLineupSlotKey(period: string, positionId: string) {
  return `${compactString(period)}-${compactString(positionId)}`;
}

export function buildLineupEditorPlayers(availablePlayers: AutoFilledLineupPlayer[] = [], goingPlayers: AutoFilledLineupPlayer[] = []): LineupEditorPlayer[] {
  const goingIds = new Set((Array.isArray(goingPlayers) ? goingPlayers : []).map((player) => compactString(player?.id)).filter(Boolean));
  const allPlayers = dedupePlayers([
    ...(Array.isArray(goingPlayers) ? goingPlayers : []),
    ...(Array.isArray(availablePlayers) ? availablePlayers : [])
  ]);
  return allPlayers.map((player) => ({
    ...player,
    availability: goingIds.has(player.id) ? 'going' : 'available'
  }));
}

export function getOrderedLineupPeriods(formationId: string, gamePlan?: Record<string, any> | null) {
  const formation = getLineupFormation(formationId);
  const fallbackPeriods = formation ? getLineupPeriodsForFormation(formation) : [];
  const rotationPlan = buildRotationPlanFromGamePlan(gamePlan || {});
  const planPeriods = Object.keys(rotationPlan);
  if (!planPeriods.length) return fallbackPeriods;
  return [...new Set([...planPeriods, ...fallbackPeriods])].sort(comparePeriods);
}

export function buildLineupEditorAssignments(formationId: string, gamePlan?: Record<string, any> | null) {
  const formation = getLineupFormation(formationId);
  if (!formation) return {} as Record<string, string>;
  const periods = getOrderedLineupPeriods(formationId, gamePlan);
  const rotationPlan = buildRotationPlanFromGamePlan(gamePlan || {});
  const assignments: Record<string, string> = {};

  periods.forEach((period) => {
    formation.positions.forEach((position) => {
      const playerId = compactString(rotationPlan?.[period]?.[position.id]);
      if (playerId) {
        assignments[getLineupSlotKey(period, position.id)] = playerId;
      }
    });
  });

  return assignments;
}

export function buildProjectedPlayingTimeSummary(formationId: string, gamePlan: Record<string, any> | null | undefined, players: AutoFilledLineupPlayer[] = []) {
  const formation = getLineupFormation(formationId);
  const cleanPlayers = dedupePlayers(players);
  if (!formation || !cleanPlayers.length || !gamePlan?.lineups || typeof gamePlan.lineups !== 'object') {
    return [] as ProjectedPlayingTimeSummaryRow[];
  }

  const normalizedLineups = normalizeLineupsForGamePlanPlanner(gamePlan || {});
  const intervals = buildGamePlanIntervals(gamePlan || {});
  const playingTime: Record<string, number> = {};
  cleanPlayers.forEach((player) => {
    playingTime[player.id] = 0;
  });

  intervals.forEach((interval: any) => {
    formation.positions.forEach((position) => {
      const playerId = compactString(normalizedLineups?.[`${interval.key}-${position.id}`]);
      if (playerId && Object.prototype.hasOwnProperty.call(playingTime, playerId)) {
        playingTime[playerId] += Number(interval.duration) || 0;
      }
    });
  });

  const totalPlayerMinutes = (Number(gamePlan?.numPeriods) || 0) * (Number(gamePlan?.periodDuration) || 0) * formation.positions.length;
  const targetMinutes = cleanPlayers.length ? totalPlayerMinutes / cleanPlayers.length : 0;

  return cleanPlayers
    .map((player) => {
      const minutes = Number(playingTime[player.id] || 0);
      let status: ProjectedPlayingTimeSummaryRow['status'] = 'good';
      if (targetMinutes > 0) {
        if (minutes < targetMinutes * 0.7) {
          status = 'under-utilized';
        } else if (minutes > targetMinutes * 1.3) {
          status = 'over-utilized';
        } else if (minutes >= targetMinutes * 0.85 && minutes <= targetMinutes * 1.15) {
          status = 'balanced';
        }
      }
      return {
        playerId: player.id,
        playerName: player.name,
        playerNumber: player.number || null,
        minutes,
        targetMinutes,
        percentageOfTarget: targetMinutes > 0 ? (minutes / targetMinutes) * 100 : 0,
        status
      };
    })
    .sort((left, right) => right.minutes - left.minutes || left.playerName.localeCompare(right.playerName));
}

export function assignLineupPlayer(lineups: Record<string, string>, targetKey: string, playerId: string) {
  const safeTargetKey = compactString(targetKey);
  const safePlayerId = compactString(playerId);
  if (!safeTargetKey || !safePlayerId) return { ...(lineups || {}) };
  const next = { ...(lineups || {}) };
  const periodKey = getPeriodKeyFromSlot(safeTargetKey);
  if (periodKey) {
    Object.entries(next).forEach(([key, value]) => {
      if (getPeriodKeyFromSlot(key) === periodKey && value === safePlayerId && key !== safeTargetKey) {
        delete next[key];
      }
    });
  }
  next[safeTargetKey] = safePlayerId;
  return next;
}

export function clearLineupPlayer(lineups: Record<string, string>, targetKey: string) {
  const safeTargetKey = compactString(targetKey);
  const next = { ...(lineups || {}) };
  delete next[safeTargetKey];
  return next;
}

export function moveLineupPlayer(lineups: Record<string, string>, sourceKey: string, targetKey: string) {
  const safeSourceKey = compactString(sourceKey);
  const safeTargetKey = compactString(targetKey);
  if (!safeSourceKey || !safeTargetKey || safeSourceKey === safeTargetKey) {
    return { ...(lineups || {}) };
  }
  const next = { ...(lineups || {}) };
  const sourcePlayerId = compactString(next[safeSourceKey]);
  const targetPlayerId = compactString(next[safeTargetKey]);
  if (!sourcePlayerId) return next;
  next[safeTargetKey] = sourcePlayerId;
  if (targetPlayerId) {
    next[safeSourceKey] = targetPlayerId;
  } else {
    delete next[safeSourceKey];
  }
  return next;
}

export function buildRoundRobinLineup(lineupPeriods: string[], positions: LineupFormationPosition[], players: AutoFilledLineupPlayer[]) {
  const cleanPlayers = dedupePlayers(players);
  if (!lineupPeriods.length || !positions.length || !cleanPlayers.length) return {} as Record<string, string>;
  const next: Record<string, string> = {};
  let playerIndex = 0;
  lineupPeriods.forEach((period) => {
    positions.forEach((position) => {
      const player = cleanPlayers[playerIndex % cleanPlayers.length];
      next[getLineupSlotKey(period, position.id)] = player.id;
      playerIndex += 1;
    });
  });
  return next;
}

export function buildLineupAiPrompt({
  periods,
  positions,
  goingPlayers,
  formationId
}: {
  periods: string[];
  positions: LineupFormationPosition[];
  goingPlayers: AutoFilledLineupPlayer[];
  formationId: string;
}) {
  return `Return a JSON rotation plan using this exact shape: {"Q1":{"pg":"Player Name"}}.\n` +
    `Use these exact period keys: ${periods.join(', ')}.\n` +
    `Going players: ${goingPlayers.map((player) => player.name).join(', ') || 'Unknown'}.\n` +
    `Formation: ${formationId}. Positions (use these exact IDs as keys): ${positions.map((position) => `${position.id}:${position.name}`).join(', ')}.\n` +
    `Goal: balance playing time as evenly as possible while filling each position in every period.\n` +
    `Respond ONLY with valid JSON.`;
}

export function parseAiLineupPlan(
  text: string,
  periods: string[],
  positions: LineupFormationPosition[],
  players: AutoFilledLineupPlayer[]
) {
  const parsed = parseJsonObject(text);
  if (!parsed) return null;
  const playerMap = new Map<string, AutoFilledLineupPlayer>();
  dedupePlayers(players).forEach((player) => {
    playerMap.set(player.name.toLowerCase(), player);
    playerMap.set(`${compactString(player.number)} ${player.name}`.trim().toLowerCase(), player);
    playerMap.set(compactString(player.id).toLowerCase(), player);
  });

  const next: Record<string, string> = {};
  periods.forEach((period) => {
    const periodPlan = parsed?.[period];
    if (!periodPlan || typeof periodPlan !== 'object') return;
    positions.forEach((position) => {
      const rawValue = compactString((periodPlan as Record<string, unknown>)[position.id]);
      if (!rawValue) return;
      const matchedPlayer = playerMap.get(rawValue.toLowerCase());
      if (matchedPlayer?.id) {
        next[getLineupSlotKey(period, position.id)] = matchedPlayer.id;
      }
    });
  });

  return Object.keys(next).length ? next : null;
}

let lineupAiModelCache: any = null;

export async function getLineupAiModel() {
  if (lineupAiModelCache) return lineupAiModelCache;
  const firebaseApp = getApp();
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  lineupAiModelCache = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
  return lineupAiModelCache;
}

function dedupePlayers(players: AutoFilledLineupPlayer[] = []) {
  const seen = new Set<string>();
  return (Array.isArray(players) ? players : []).reduce<AutoFilledLineupPlayer[]>((acc, player) => {
    const id = compactString(player?.id);
    if (!id || seen.has(id)) return acc;
    seen.add(id);
    acc.push({
      id,
      name: compactString(player?.name) || 'Player',
      number: compactString(player?.number) || null
    });
    return acc;
  }, []);
}

function compactString(value: unknown) {
  return String(value || '').trim();
}

function parseJsonObject(text: string): Record<string, any> | null {
  const cleaned = compactString(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function comparePeriods(left: string, right: string) {
  const parsedLeft = parsePeriod(left);
  const parsedRight = parsePeriod(right);
  if (!parsedLeft || !parsedRight) return left.localeCompare(right);
  if (parsedLeft.prefix !== parsedRight.prefix) return parsedLeft.prefix.localeCompare(parsedRight.prefix);
  if (parsedLeft.period !== parsedRight.period) return parsedLeft.period - parsedRight.period;
  return parsedLeft.time - parsedRight.time;
}

function parsePeriod(value: string) {
  const match = /^([A-Z])(\d+)(?: (\d+)')?$/.exec(compactString(value));
  if (!match) return null;
  return {
    prefix: match[1],
    period: Number.parseInt(match[2], 10) || 0,
    time: Number.parseInt(match[3] || '0', 10) || 0
  };
}

function getPeriodKeyFromSlot(slotKey: string) {
  const safeSlotKey = compactString(slotKey);
  const separatorIndex = safeSlotKey.indexOf('-');
  if (separatorIndex <= 0) return '';
  return safeSlotKey.slice(0, separatorIndex);
}
