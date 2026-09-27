import type { DiamondDefensivePosition } from './diamondScorebook';
import type { DiamondLineupEntry, DiamondScorebookSnapshot, DiamondSide } from './diamondScorebookService';

export type DiamondSubstitutionTarget = {
  key: string;
  role: 'batting' | 'dh' | 'flex';
  entry: DiamondLineupEntry;
  defensivePosition?: DiamondDefensivePosition;
};

export function getDiamondSubstitutionTargets(snapshot: DiamondScorebookSnapshot, side: DiamondSide): DiamondSubstitutionTarget[] {
  const lineup = snapshot.lineups[side];
  const personnel = snapshot.lineupPersonnel?.[side];
  const targets: DiamondSubstitutionTarget[] = lineup.map((entry) => ({ key: String(entry.slot), role: 'batting', entry }));
  const battingIds = new Set(lineup.map((entry) => entry.playerId));
  const designatedHitters = lineup.filter((entry) => entry.battingRole === 'dh');
  const outsideDefenders = Object.entries(snapshot.defense[side]).filter(([, player]) => player && !battingIds.has(player.playerId));
  const dh =
    personnel?.dhDefense ||
    (designatedHitters.length === 1 && outsideDefenders.length === 1 && !personnel?.dpFlex
      ? {
          ...outsideDefenders[0]![1]!,
          slot: designatedHitters[0]!.slot,
          starterPlayerId: outsideDefenders[0]![1]!.playerId,
          starterReentriesUsed: 0
        }
      : null);
  if (dh && designatedHitters.length === 1 && !personnel?.dhTerminated) {
    const position = Object.entries(snapshot.defense[side]).find(([, player]) => player?.playerId === dh.playerId)?.[0] as
      DiamondDefensivePosition | undefined;
    if (position) targets.push({ key: `dh:${dh.slot}`, role: 'dh', entry: dh, defensivePosition: position });
  }
  if (dh && personnel?.dhTerminated) {
    const activeBatter = lineup.find((entry) => entry.slot === dh.slot);
    if (activeBatter) {
      const position = Object.entries(snapshot.defense[side]).find(([, player]) => player?.playerId === activeBatter.playerId)?.[0] as
        DiamondDefensivePosition | undefined;
      targets.push({
        key: `dh-retired:${dh.slot}`,
        role: 'dh',
        entry: { ...dh, ...activeBatter, starterPlayerId: dh.starterPlayerId, starterReentriesUsed: dh.starterReentriesUsed },
        defensivePosition: position
      });
    }
  }
  const pair = personnel?.dpFlex;
  if (pair) {
    const defender = snapshot.defense[side][pair.flexDefensivePosition];
    const history = personnel.flexDefense;
    if (defender && (defender.playerId === pair.flexPlayerId || defender.playerId === pair.dpPlayerId)) {
      targets.push({
        key: `flex:${pair.dpBattingSlot}`,
        role: 'flex',
        defensivePosition: pair.flexDefensivePosition,
        entry: {
          ...(history || { ...defender, slot: pair.dpBattingSlot, starterPlayerId: pair.flexPlayerId, starterReentriesUsed: 0 }),
          ...defender,
          playerId: defender.playerId
        }
      });
    }
  }
  return targets;
}

export function resolveDiamondSubstitutionTarget(
  snapshot: DiamondScorebookSnapshot,
  side: DiamondSide,
  slot: number,
  outgoingPlayerId: string,
  incomingPlayerId: string,
  defensivePosition?: unknown
): DiamondSubstitutionTarget | null {
  const targets = getDiamondSubstitutionTargets(snapshot, side).filter(
    (target) =>
      target.entry.slot === slot &&
      target.entry.playerId === outgoingPlayerId &&
      (!target.key.startsWith('dh-retired:') || target.entry.starterPlayerId === incomingPlayerId)
  );
  const pair = snapshot.lineupPersonnel?.[side].dpFlex;
  if (pair && outgoingPlayerId === pair.flexPlayerId && incomingPlayerId === pair.dpPlayerId) {
    return (
      targets.find((target) => target.role === 'batting') ||
      targets.find((target) => target.role === 'flex' && defensivePosition === target.defensivePosition) ||
      null
    );
  }
  if (pair && outgoingPlayerId === pair.dpPlayerId && incomingPlayerId === pair.flexPlayerId) {
    return targets.find((target) => target.role === 'flex') || targets.find((target) => target.role === 'batting') || null;
  }
  return (
    targets.find(
      (target) => target.role !== 'batting' && (defensivePosition === undefined || defensivePosition === target.defensivePosition)
    ) ||
    targets.find((target) => target.role === 'batting') ||
    null
  );
}
