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
