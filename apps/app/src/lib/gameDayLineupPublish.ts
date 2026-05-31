function compactString(value: unknown) {
  return String(value || '').trim();
}

function normalizeLineupMap(lineups: unknown): Record<string, string> {
  if (!lineups || typeof lineups !== 'object') return {};
  return Object.entries(lineups as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
    const safeKey = compactString(key);
    const safeValue = compactString(value);
    if (!safeKey || !safeValue) return acc;
    acc[safeKey] = safeValue;
    return acc;
  }, {});
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map(compactString).filter(Boolean)));
}

export type LineupFormationPosition = {
  id: string;
  name: string;
};

export type LineupFormation = {
  id: string;
  name: string;
  numPeriods: number;
  positions: LineupFormationPosition[];
};

export const LINEUP_FORMATIONS: Record<string, LineupFormation> = {
  'soccer-9v9': {
    id: 'soccer-9v9',
    name: 'Soccer 9v9',
    numPeriods: 2,
    positions: [
      { id: 'keeper', name: 'Keeper' },
      { id: 'right-defense', name: 'Right Defense' },
      { id: 'sweeper', name: 'Sweeper' },
      { id: 'left-defense', name: 'Left Defense' },
      { id: 'left-mid', name: 'Left Mid' },
      { id: 'center-mid-1', name: 'Center Mid' },
      { id: 'center-mid-2', name: 'Center Mid' },
      { id: 'right-mid', name: 'Right Mid' },
      { id: 'striker', name: 'Striker' }
    ]
  },
  'basketball-5v5': {
    id: 'basketball-5v5',
    name: 'Basketball 5v5',
    numPeriods: 4,
    positions: [
      { id: 'pg', name: 'Point Guard' },
      { id: 'sg', name: 'Shooting Guard' },
      { id: 'sf', name: 'Small Forward' },
      { id: 'pf', name: 'Power Forward' },
      { id: 'c', name: 'Center' }
    ]
  }
};

export type AutoFilledLineupPlayer = {
  id: string;
  name: string;
  number?: string | null;
};

export type AutoFilledLineupDraftInput = {
  formationId: string;
  goingPlayers: AutoFilledLineupPlayer[];
  previousGamePlan?: Record<string, any> | null;
};

export function getLineupFormation(formationId: string | null | undefined) {
  return LINEUP_FORMATIONS[compactString(formationId)] || null;
}

export function getLineupPeriodsForFormation(formation: LineupFormation) {
  const prefix = formation.numPeriods === 4 ? 'Q' : 'H';
  return Array.from({ length: formation.numPeriods }, (_, index) => `${prefix}${index + 1}`);
}

export function buildAutoFilledLineupDraft({
  formationId,
  goingPlayers,
  previousGamePlan = {}
}: AutoFilledLineupDraftInput) {
  const formation = getLineupFormation(formationId);
  if (!formation) {
    throw new Error('Select a supported formation before saving a lineup draft.');
  }

  const firstPeriod = getLineupPeriodsForFormation(formation)[0];
  const eligiblePlayers = (Array.isArray(goingPlayers) ? goingPlayers : [])
    .map((player) => ({
      ...player,
      id: compactString(player?.id),
      name: compactString(player?.name) || 'Player',
      number: compactString(player?.number) || null
    }))
    .filter((player) => player.id);
  const lineups = formation.positions.reduce<Record<string, string>>((acc, position, index) => {
    const player = eligiblePlayers[index];
    if (player) acc[`${firstPeriod}-${position.id}`] = player.id;
    return acc;
  }, {});

  if (!Object.keys(lineups).length) {
    throw new Error('No Going players are available to auto-fill this lineup.');
  }

  const sourcePlan = previousGamePlan || {};
  return {
    ...sourcePlan,
    formationId: formation.id,
    numPeriods: formation.numPeriods,
    lineups,
    isPublished: false,
    publishedAt: sourcePlan.publishedAt || null,
    publishedBy: sourcePlan.publishedBy || null,
    publishedByName: sourcePlan.publishedByName || null,
    publishedVersion: Number.parseInt(sourcePlan.publishedVersion, 10) || 0,
    publishedFormationId: sourcePlan.publishedFormationId || null,
    publishedNumPeriods: Number.parseInt(sourcePlan.publishedNumPeriods, 10) || null,
    publishedLineups: normalizeLineupMap(sourcePlan.publishedLineups),
    publishedRecipientPlayerIds: uniqueStrings(Array.isArray(sourcePlan.publishedRecipientPlayerIds) ? sourcePlan.publishedRecipientPlayerIds : []),
    publishedRecipientParentIds: uniqueStrings(Array.isArray(sourcePlan.publishedRecipientParentIds) ? sourcePlan.publishedRecipientParentIds : []),
    publishedReadBy: Array.isArray(sourcePlan.publishedReadBy) ? [...sourcePlan.publishedReadBy] : []
  };
}

export type GamePlanPublishPayloadInput = {
  previousGamePlan?: Record<string, any> | null;
  publishedBy?: string | null;
  publishedByName?: string | null;
  publishedAt?: Date;
  recipientPlayerIds?: string[];
  recipientParentIds?: string[];
};

export function countLineupChanges(previousLineups: unknown, nextLineups: unknown) {
  const before = normalizeLineupMap(previousLineups);
  const after = normalizeLineupMap(nextLineups);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let changedAssignments = 0;
  keys.forEach((key) => {
    if ((before[key] || null) !== (after[key] || null)) {
      changedAssignments += 1;
    }
  });
  return changedAssignments;
}

export function buildLineupPublishPayload({
  previousGamePlan = {},
  publishedBy = null,
  publishedByName = null,
  publishedAt = new Date(),
  recipientPlayerIds = [],
  recipientParentIds = []
}: GamePlanPublishPayloadInput) {
  const sourcePlan = previousGamePlan || {};
  const lineups = normalizeLineupMap(sourcePlan.lineups);
  const formationId = compactString(sourcePlan.formationId) || null;
  const parsedNumPeriods = Number.parseInt(sourcePlan.numPeriods, 10);
  const numPeriods = Number.isFinite(parsedNumPeriods) ? parsedNumPeriods : null;

  return {
    ...sourcePlan,
    lineups,
    isPublished: true,
    publishedAt,
    publishedBy,
    publishedByName,
    publishedVersion: (Number.parseInt(sourcePlan.publishedVersion, 10) || 0) + 1,
    publishedFormationId: formationId,
    publishedNumPeriods: numPeriods,
    publishedLineups: { ...lineups },
    publishedRecipientPlayerIds: uniqueStrings(recipientPlayerIds),
    publishedRecipientParentIds: uniqueStrings(recipientParentIds),
    publishedReadBy: []
  };
}

export function buildLineupPublishMessage({
  opponentName,
  publishedVersion,
  changedAssignments = 0
}: {
  opponentName?: string | null;
  publishedVersion?: number | string | null;
  changedAssignments?: number;
}) {
  const safeOpponent = compactString(opponentName) || 'your opponent';
  if ((Number.parseInt(String(publishedVersion || ''), 10) || 0) <= 1) {
    return `Lineup published for ${safeOpponent}. Open Game Day to review the final assignments.`;
  }
  const changeText = changedAssignments > 0
    ? ` ${changedAssignments} assignment${changedAssignments === 1 ? '' : 's'} changed.`
    : '';
  return `Lineup updated for ${safeOpponent}.${changeText} Open Game Day to review the latest assignments.`;
}

export function getLineupPublishStatus(gamePlan: Record<string, any> | null | undefined) {
  const plan = gamePlan || {};
  const lineups = normalizeLineupMap(plan.lineups);
  const publishedLineups = normalizeLineupMap(plan.publishedLineups);
  const publishedVersion = Number.parseInt(plan.publishedVersion, 10) || 0;
  if (!Object.keys(lineups).length) return 'No lineup draft is available yet.';
  if (!publishedVersion) return 'Draft lineup has not been published.';
  const changedAssignments = countLineupChanges(publishedLineups, lineups);
  if (changedAssignments > 0) {
    return `Published v${publishedVersion}. ${changedAssignments} draft assignment${changedAssignments === 1 ? '' : 's'} unpublished.`;
  }
  return `Published v${publishedVersion}. Current draft matches the published lineup.`;
}

export function hasLineupDraft(gamePlan: Record<string, any> | null | undefined) {
  return Object.keys(normalizeLineupMap(gamePlan?.lineups)).length > 0;
}
