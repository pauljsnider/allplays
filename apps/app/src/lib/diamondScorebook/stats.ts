import {
  type DiamondCommandPayloadMap,
  type DiamondCoverageMap,
  type DiamondFieldingChain,
  type DiamondGameState,
  type DiamondLedger,
  type DiamondSide
} from './contracts';
import { replayEffectiveDiamondEventStates, type DiamondEffectiveEventReplay } from './ledger';
import {
  deriveDiamondCoverageFromEventStates,
  deriveDiamondPutoutCredits,
  getBattingSide,
  getDiamondFinalizationReason,
  isDiamondDeliveredPitch
} from './reducer';
import { requireDiamondRulesProfile } from './rules';

export type DiamondBattingRaw = {
  G: number;
  GS: number;
  PA: number;
  AB: number;
  R: number;
  H: number;
  '1B': number;
  '2B': number;
  '3B': number;
  HR: number;
  TB: number;
  RBI: number;
  BB: number;
  IBB: number;
  HBP: number;
  SO: number;
  SF: number;
  SH: number;
  ROE: number;
  FC: number;
  GIDP: number;
};

export type DiamondBaserunningRaw = {
  SB: number;
  CS: number;
  pickoffs: number;
  advances: number;
  outs: number;
};

export type DiamondPitchingRaw = {
  APP: number;
  GS: number;
  W: number;
  L: number;
  SV: number;
  BF: number;
  outs: number;
  H: number;
  R: number;
  ER: number;
  BB: number;
  IBB: number;
  HBP: number;
  SO: number;
  HR: number;
  WP: number;
  balkIllegalPitch: number;
  inheritedRunners: number;
  inheritedScored: number;
  pitches: number;
  strikes: number;
  firstPitchStrikes: number;
};

export type DiamondFieldingRaw = {
  defensiveOuts: number;
  PO: number;
  A: number;
  E: number;
  DP: number;
  TP: number;
  PB: number;
};

export type DiamondPlayerRawStats = {
  batting: DiamondBattingRaw;
  baserunning: DiamondBaserunningRaw;
  pitching: DiamondPitchingRaw;
  fielding: DiamondFieldingRaw;
};

export type DiamondPlayerDerivedStats = Readonly<{
  AVG: number | null;
  OBP: number | null;
  SLG: number | null;
  OPS: number | null;
  bbRate: number | null;
  strikeoutRate: number | null;
  stolenBaseRate: number | null;
  inningsPitched: string;
  ERA: number | null;
  WHIP: number | null;
  strikeoutWalkRatio: number | null;
  strikeRate: number | null;
  firstPitchStrikeRate: number | null;
  fieldingPercentage: number | null;
  chances: number;
}>;

export type DiamondPlayerStatLine = Readonly<{
  playerId: string;
  side: DiamondSide;
  raw: DiamondPlayerRawStats;
  derived: DiamondPlayerDerivedStats;
  coverage: DiamondCoverageMap;
  sources: Readonly<Record<string, readonly string[]>>;
}>;

export type DiamondTeamRawStats = Readonly<{
  R: number;
  H: number;
  E: number;
  LOB: number;
  rispOpportunities: number;
  rispHits: number;
  twoOutRuns: number;
  twoStrikePlateAppearances: number;
  twoStrikeHits: number;
  firstPitchStrikeOpportunities: number;
  firstPitchStrikes: number;
}>;

type MutableTeamRawStats = {
  -readonly [K in keyof DiamondTeamRawStats]: DiamondTeamRawStats[K];
};

export type DiamondStatProjection = Readonly<{
  schemaVersion: 2;
  catalogVersion: 1;
  sourceRevision: number;
  checkpointHash: string;
  coverage: DiamondCoverageMap;
  players: Readonly<Record<string, DiamondPlayerStatLine>>;
  teams: Readonly<Record<DiamondSide, DiamondTeamRawStats>>;
  inningLines: Readonly<Record<string, number>>;
  complete: true;
}>;

type MutablePlayerLine = {
  playerId: string;
  side: DiamondSide;
  raw: DiamondPlayerRawStats;
  sources: Record<string, Set<string>>;
};

type SimulatedEvent = DiamondEffectiveEventReplay;

function emptyRawStats(): DiamondPlayerRawStats {
  return {
    batting: {
      G: 0,
      GS: 0,
      PA: 0,
      AB: 0,
      R: 0,
      H: 0,
      '1B': 0,
      '2B': 0,
      '3B': 0,
      HR: 0,
      TB: 0,
      RBI: 0,
      BB: 0,
      IBB: 0,
      HBP: 0,
      SO: 0,
      SF: 0,
      SH: 0,
      ROE: 0,
      FC: 0,
      GIDP: 0
    },
    baserunning: { SB: 0, CS: 0, pickoffs: 0, advances: 0, outs: 0 },
    pitching: {
      APP: 0,
      GS: 0,
      W: 0,
      L: 0,
      SV: 0,
      BF: 0,
      outs: 0,
      H: 0,
      R: 0,
      ER: 0,
      BB: 0,
      IBB: 0,
      HBP: 0,
      SO: 0,
      HR: 0,
      WP: 0,
      balkIllegalPitch: 0,
      inheritedRunners: 0,
      inheritedScored: 0,
      pitches: 0,
      strikes: 0,
      firstPitchStrikes: 0
    },
    fielding: { defensiveOuts: 0, PO: 0, A: 0, E: 0, DP: 0, TP: 0, PB: 0 }
  };
}

function simulate(ledger: DiamondLedger): readonly SimulatedEvent[] {
  return replayEffectiveDiamondEventStates(ledger.initialState, ledger.events);
}

function safeRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function formatInningsPitched(outs: number): string {
  if (!Number.isInteger(outs) || outs < 0) return '0.0';
  return `${String(Math.floor(outs / 3))}.${String(outs % 3)}`;
}

export function formatDiamondRate(value: number | null, digits = 3): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace(/^0(?=\.)/, '');
}

export function deriveDiamondPlayerStats(
  raw: DiamondPlayerRawStats,
  coverage: DiamondCoverageMap,
  eraInningsBasis: number
): DiamondPlayerDerivedStats {
  const battingDenominator = raw.batting.AB + raw.batting.BB + raw.batting.IBB + raw.batting.HBP + raw.batting.SF;
  const battingComplete = coverage.batting === 'complete';
  const baserunningComplete = coverage.baserunning === 'complete';
  const pitchingComplete = coverage.pitching === 'complete';
  const pitchComplete = coverage.pitches === 'complete';
  const fieldingComplete = coverage.fielding === 'complete';
  const average = battingComplete ? safeRatio(raw.batting.H, raw.batting.AB) : null;
  const obp = battingComplete ? safeRatio(raw.batting.H + raw.batting.BB + raw.batting.IBB + raw.batting.HBP, battingDenominator) : null;
  const slugging = battingComplete ? safeRatio(raw.batting.TB, raw.batting.AB) : null;
  const chances = raw.fielding.PO + raw.fielding.A + raw.fielding.E;
  return {
    AVG: average,
    OBP: obp,
    SLG: slugging,
    OPS: obp === null || slugging === null ? null : obp + slugging,
    bbRate: battingComplete ? safeRatio(raw.batting.BB + raw.batting.IBB, raw.batting.PA) : null,
    strikeoutRate: battingComplete ? safeRatio(raw.batting.SO, raw.batting.PA) : null,
    stolenBaseRate: baserunningComplete ? safeRatio(raw.baserunning.SB, raw.baserunning.SB + raw.baserunning.CS) : null,
    inningsPitched: formatInningsPitched(raw.pitching.outs),
    ERA: pitchingComplete && raw.pitching.outs > 0 ? (raw.pitching.ER * eraInningsBasis * 3) / raw.pitching.outs : null,
    WHIP:
      pitchingComplete && raw.pitching.outs > 0 ? ((raw.pitching.BB + raw.pitching.IBB + raw.pitching.H) * 3) / raw.pitching.outs : null,
    strikeoutWalkRatio: pitchingComplete ? safeRatio(raw.pitching.SO, raw.pitching.BB + raw.pitching.IBB) : null,
    strikeRate: pitchComplete ? safeRatio(raw.pitching.strikes, raw.pitching.pitches) : null,
    firstPitchStrikeRate: pitchComplete ? safeRatio(raw.pitching.firstPitchStrikes, raw.pitching.BF) : null,
    fieldingPercentage: fieldingComplete ? safeRatio(raw.fielding.PO + raw.fielding.A, chances) : null,
    chances
  };
}

function isStrikePitch(result: DiamondCommandPayloadMap['record_pitch']['result']): boolean {
  return ['called_strike', 'swinging_strike', 'foul', 'foul_bunt', 'in_play'].includes(result);
}

function battingSideFor(state: DiamondGameState) {
  return getBattingSide(state);
}

function isOpenDefensiveEntry(state: DiamondGameState, side: DiamondSide) {
  const defensiveSide = battingSideFor(state) === 'home' ? 'away' : 'home';
  const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
  const inningKey = `${state.inning.half === 'top' ? 'T' : 'B'}${String(state.inning.number)}`;
  const runLimitReached = profile.inningRunLimit !== null && (state.inningRuns[inningKey] ?? 0) >= profile.inningRunLimit;
  return (
    state.lifecycle === 'active' &&
    side === defensiveSide &&
    state.inning.outs < 3 &&
    state.halfInningEnd === null &&
    !runLimitReached &&
    getDiamondFinalizationReason(state) === null
  );
}

function addMergedFielding(
  fieldings: readonly DiamondFieldingChain[],
  actualOutCount: number,
  side: DiamondSide,
  eventId: string,
  ensure: (playerId: string, side: DiamondSide) => MutablePlayerLine,
  credit: (line: MutablePlayerLine, family: keyof DiamondPlayerRawStats, stat: string, value: number, eventId: string) => void,
  options: Readonly<{ creditPassedBall?: boolean }> = {}
) {
  const putouts = deriveDiamondPutoutCredits(fieldings, actualOutCount);
  const assists = new Set<string>();
  const passedBalls = new Set<string>();
  const errorMultiplicity = new Map<string, { maxChainTotal: number; maxFielding: number; maxThrowing: number }>();
  let doublePlay = false;
  let triplePlay = false;

  fieldings.forEach((fielding) => {
    (fielding.assists ?? []).forEach((playerId) => assists.add(playerId));
    const chainErrors = new Map<string, { total: number; fielding: number; throwing: number }>();
    (fielding.errors ?? []).forEach(({ playerId, kind }) => {
      const counts = chainErrors.get(playerId) ?? { total: 0, fielding: 0, throwing: 0 };
      counts.total += 1;
      if (kind) counts[kind] += 1;
      chainErrors.set(playerId, counts);
    });
    chainErrors.forEach((counts, playerId) => {
      const merged = errorMultiplicity.get(playerId) ?? { maxChainTotal: 0, maxFielding: 0, maxThrowing: 0 };
      merged.maxChainTotal = Math.max(merged.maxChainTotal, counts.total);
      merged.maxFielding = Math.max(merged.maxFielding, counts.fielding);
      merged.maxThrowing = Math.max(merged.maxThrowing, counts.throwing);
      errorMultiplicity.set(playerId, merged);
    });
    if (fielding.passedBallBy) passedBalls.add(fielding.passedBallBy);
    doublePlay ||= fielding.doublePlay === true;
    triplePlay ||= fielding.triplePlay === true;
  });

  putouts.forEach((count, playerId) => credit(ensure(playerId, side), 'fielding', 'PO', count, eventId));
  assists.forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'A', 1, eventId));
  let errorCredits = 0;
  errorMultiplicity.forEach(({ maxChainTotal, maxFielding, maxThrowing }, playerId) => {
    const playerErrorCredits = Math.max(maxChainTotal, maxFielding + maxThrowing);
    for (let count = 0; count < playerErrorCredits; count += 1) {
      credit(ensure(playerId, side), 'fielding', 'E', 1, eventId);
      errorCredits += 1;
    }
  });
  if (options.creditPassedBall !== false) {
    passedBalls.forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'PB', 1, eventId));
  }
  const participants = new Set<string>([...putouts.keys(), ...assists]);
  if (doublePlay) participants.forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'DP', 1, eventId));
  if (triplePlay) participants.forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'TP', 1, eventId));
  return { errorCredits, passedBallObserved: passedBalls.size > 0 };
}

function atBatForResult(result: DiamondCommandPayloadMap['record_plate_appearance']['result']): boolean {
  return !['walk', 'intentional_walk', 'hit_by_pitch', 'sacrifice_bunt', 'sacrifice_fly', 'interference'].includes(result);
}

type OrderedAttachment<T> = Readonly<{ order: number; value: T }>;

function collectAttachmentMaps(events: readonly SimulatedEvent[]) {
  const fielding = new Map<string, OrderedAttachment<DiamondFieldingChain>[]>();
  const judgments = new Map<string, OrderedAttachment<DiamondCommandPayloadMap['record_scoring_judgment']>[]>();
  events.forEach(({ event }, order) => {
    if (event.type === 'record_fielding') {
      const payload = event.payload as DiamondCommandPayloadMap['record_fielding'];
      fielding.set(payload.playEventId, [...(fielding.get(payload.playEventId) ?? []), { order, value: payload.fielding }]);
    }
    if (event.type === 'record_scoring_judgment') {
      const payload = event.payload as DiamondCommandPayloadMap['record_scoring_judgment'];
      judgments.set(payload.playEventId, [...(judgments.get(payload.playEventId) ?? []), { order, value: payload }]);
    }
  });
  return { fielding, judgments };
}

function attachmentsForPlay<T>(attachments: ReadonlyMap<string, readonly OrderedAttachment<T>[]>, event: SimulatedEvent['event']) {
  return [...new Set([event.sourceEventId, event.eventId])]
    .flatMap((eventId) => attachments.get(eventId) ?? [])
    .sort((left, right) => left.order - right.order)
    .map(({ value }) => value);
}

function latestJudgmentValue<K extends 'earned' | 'rbi' | 'responsiblePitcherId'>(
  judgments: readonly DiamondCommandPayloadMap['record_scoring_judgment'][],
  runnerId: string,
  field: K
): DiamondCommandPayloadMap['record_scoring_judgment'][K] | undefined {
  for (let index = judgments.length - 1; index >= 0; index -= 1) {
    const judgment = judgments[index];
    if ((!judgment.runnerId || judgment.runnerId === runnerId) && judgment[field] !== undefined) {
      return judgment[field];
    }
  }
  return undefined;
}

type PitcherDecision = NonNullable<DiamondCommandPayloadMap['record_scoring_judgment']['pitcherOfRecord']>;

function officialWinningSide(state: DiamondGameState): DiamondSide | null {
  if (state.lifecycle !== 'final') return null;
  if (state.finalizationReason?.kind === 'forfeit') {
    return state.gameEndDecision?.reason === 'forfeit' ? state.gameEndDecision.awardedSide : null;
  }
  if (state.score.home === state.score.away) return null;
  return state.score.home > state.score.away ? 'home' : 'away';
}

function exposedPitcherDecisionEventIds(events: readonly SimulatedEvent[], finalState: DiamondGameState) {
  const winningSide = officialWinningSide(finalState);
  if (!winningSide) return new Set<string>();
  const losingSide = winningSide === 'home' ? 'away' : 'home';
  const decisions = events.flatMap(({ event }) => {
    if (event.type !== 'record_scoring_judgment') return [];
    const pitcherOfRecord = (event.payload as DiamondCommandPayloadMap['record_scoring_judgment']).pitcherOfRecord;
    return pitcherOfRecord ? [{ eventId: event.eventId, value: pitcherOfRecord }] : [];
  });
  const byType = new Map<PitcherDecision['decision'], PitcherDecision>();
  for (const { value } of decisions) {
    if (byType.has(value.decision)) return new Set<string>();
    byType.set(value.decision, value);
    const expectedSide = value.decision === 'loss' ? losingSide : winningSide;
    if (value.side !== expectedSide) return new Set<string>();
  }
  const win = byType.get('win');
  const save = byType.get('save');
  if (win && save && win.playerId === save.playerId) return new Set<string>();
  return new Set(decisions.map(({ eventId }) => eventId));
}

export function projectDiamondStats(ledger: DiamondLedger): DiamondStatProjection {
  const simulated = simulate(ledger);
  const coverage = deriveDiamondCoverageFromEventStates(ledger.initialState, simulated);
  const profile = requireDiamondRulesProfile(ledger.rulesProfileId, ledger.rulesProfileVersion);
  const lines = new Map<string, MutablePlayerLine>();
  const gameSeen = new Set<string>();
  const starterSeen = new Set<string>();
  const pitchingAppearanceSeen = new Set<string>();
  const pitchingStartSeen = new Set<string>();
  const teams: Record<DiamondSide, MutableTeamRawStats> = {
    home: {
      R: 0,
      H: 0,
      E: 0,
      LOB: 0,
      rispOpportunities: 0,
      rispHits: 0,
      twoOutRuns: 0,
      twoStrikePlateAppearances: 0,
      twoStrikeHits: 0,
      firstPitchStrikeOpportunities: 0,
      firstPitchStrikes: 0
    },
    away: {
      R: 0,
      H: 0,
      E: 0,
      LOB: 0,
      rispOpportunities: 0,
      rispHits: 0,
      twoOutRuns: 0,
      twoStrikePlateAppearances: 0,
      twoStrikeHits: 0,
      firstPitchStrikeOpportunities: 0,
      firstPitchStrikes: 0
    }
  };
  const attachments = collectAttachmentMaps(simulated);
  const exposedDecisionEventIds = exposedPitcherDecisionEventIds(simulated, ledger.state);
  let physicalCauseCluster: {
    cause: 'wild_pitch' | 'passed_ball' | 'balk' | 'illegal_pitch' | null;
    pitcherId: string | null;
    anchoredByPitch: boolean;
    pitchingCreditRecorded: boolean;
    passedBallCreditRecorded: boolean;
  } | null = null;

  const ensure = (playerId: string, side: DiamondSide) => {
    const existing = lines.get(playerId);
    if (existing) return existing;
    const created: MutablePlayerLine = { playerId, side, raw: emptyRawStats(), sources: {} };
    lines.set(playerId, created);
    return created;
  };
  const credit = (line: MutablePlayerLine, family: keyof DiamondPlayerRawStats, stat: string, value: number, eventId: string) => {
    const familyRecord = line.raw[family] as unknown as Record<string, number>;
    familyRecord[stat] = (familyRecord[stat] ?? 0) + value;
    const key = `${family}.${stat}`;
    if (!line.sources[key]) line.sources[key] = new Set();
    line.sources[key].add(eventId);
  };
  const creditGame = (playerId: string, side: DiamondSide, eventId: string, starter: boolean) => {
    const line = ensure(playerId, side);
    if (!gameSeen.has(playerId)) {
      credit(line, 'batting', 'G', 1, eventId);
      gameSeen.add(playerId);
    }
    if (starter && !starterSeen.has(playerId)) {
      credit(line, 'batting', 'GS', 1, eventId);
      starterSeen.add(playerId);
    }
  };
  const creditPitchingAppearance = (playerId: string, side: DiamondSide, eventId: string, starter: boolean) => {
    const line = ensure(playerId, side);
    if (!pitchingAppearanceSeen.has(playerId)) {
      credit(line, 'pitching', 'APP', 1, eventId);
      pitchingAppearanceSeen.add(playerId);
    }
    if (starter && !pitchingStartSeen.has(playerId)) {
      credit(line, 'pitching', 'GS', 1, eventId);
      pitchingStartSeen.add(playerId);
    }
  };

  simulated.forEach(({ event, before }) => {
    const eventId = event.eventId;
    if (event.type !== 'advance_runner' && event.type !== 'record_plate_appearance') physicalCauseCluster = null;
    switch (event.type) {
      case 'start': {
        (['home', 'away'] as const).forEach((side) => {
          before.lineups[side].battingOrder.forEach((slot) => creditGame(slot.activePlayerId, side, eventId, true));
          Object.values(before.lineups[side].defense).forEach((playerId) => {
            if (playerId) creditGame(playerId, side, eventId, true);
          });
          const pitcherId = before.lineups[side].defense.P;
          if (pitcherId) creditPitchingAppearance(pitcherId, side, eventId, true);
        });
        break;
      }
      case 'substitute': {
        const payload = event.payload as DiamondCommandPayloadMap['substitute'];
        creditGame(payload.incomingPlayerId, payload.side, eventId, false);
        const entersAsPitcher = payload.defensivePosition === 'P' || before.lineups[payload.side].defense.P === payload.outgoingPlayerId;
        if (entersAsPitcher && isOpenDefensiveEntry(before, payload.side)) {
          creditPitchingAppearance(payload.incomingPlayerId, payload.side, eventId, false);
          const inherited = [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length;
          if (inherited > 0) {
            credit(ensure(payload.incomingPlayerId, payload.side), 'pitching', 'inheritedRunners', inherited, eventId);
          }
        }
        break;
      }
      case 're_enter': {
        const payload = event.payload as DiamondCommandPayloadMap['re_enter'];
        creditGame(payload.starterPlayerId, payload.side, eventId, false);
        const entersAsPitcher = payload.defensivePosition === 'P' || before.lineups[payload.side].defense.P === payload.replacedPlayerId;
        if (entersAsPitcher && isOpenDefensiveEntry(before, payload.side)) {
          creditPitchingAppearance(payload.starterPlayerId, payload.side, eventId, false);
          const inherited = [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length;
          if (inherited > 0) {
            credit(ensure(payload.starterPlayerId, payload.side), 'pitching', 'inheritedRunners', inherited, eventId);
          }
        }
        break;
      }
      case 'set_defensive_alignment': {
        const payload = event.payload as DiamondCommandPayloadMap['set_defensive_alignment'];
        const priorPitcherId = before.lineups[payload.side].defense.P;
        const incomingPitcherId = payload.assignments.find((assignment) => assignment.position === 'P')?.playerId;
        if (incomingPitcherId && incomingPitcherId !== priorPitcherId && isOpenDefensiveEntry(before, payload.side)) {
          creditPitchingAppearance(incomingPitcherId, payload.side, eventId, false);
          const inherited = [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length;
          if (inherited > 0) {
            credit(ensure(incomingPitcherId, payload.side), 'pitching', 'inheritedRunners', inherited, eventId);
          }
        }
        break;
      }
      case 'record_pitch': {
        const payload = event.payload as DiamondCommandPayloadMap['record_pitch'];
        const pitchingSide = before.inning.half === 'top' ? 'home' : 'away';
        const pitcher = ensure(payload.pitcherId, pitchingSide);
        creditPitchingAppearance(payload.pitcherId, pitchingSide, eventId, false);
        if (isDiamondDeliveredPitch(payload.result)) {
          credit(pitcher, 'pitching', 'pitches', 1, eventId);
          if (isStrikePitch(payload.result)) credit(pitcher, 'pitching', 'strikes', 1, eventId);
          if (before.inning.pitchesInPlateAppearance === 0) {
            teams[pitchingSide].firstPitchStrikeOpportunities += 1;
            if (isStrikePitch(payload.result)) {
              credit(pitcher, 'pitching', 'firstPitchStrikes', 1, eventId);
              teams[pitchingSide].firstPitchStrikes += 1;
            }
          }
        }
        const alreadyCreditedPitchingInfraction = payload.result === 'balk' || payload.result === 'illegal_pitch';
        if (alreadyCreditedPitchingInfraction) {
          credit(pitcher, 'pitching', 'balkIllegalPitch', 1, eventId);
        }
        // A following set of independent runner moves can cite the same physical
        // pitch. Without this pitch anchor, consecutive advance commands remain
        // separate plays because the schema contains no trustworthy group ID.
        physicalCauseCluster = {
          cause: alreadyCreditedPitchingInfraction ? payload.result : null,
          pitcherId: payload.pitcherId,
          anchoredByPitch: true,
          pitchingCreditRecorded: alreadyCreditedPitchingInfraction,
          passedBallCreditRecorded: false
        };
        break;
      }
      case 'record_plate_appearance': {
        const payload = event.payload as DiamondCommandPayloadMap['record_plate_appearance'];
        const battingSide = battingSideFor(before);
        const pitchingSide = battingSide === 'home' ? 'away' : 'home';
        const batter = ensure(payload.batterId, battingSide);
        const pitcher = ensure(payload.pitcherId, pitchingSide);
        const currentPitcherId = before.lineups[pitchingSide].defense.P ?? payload.pitcherId;
        creditGame(payload.batterId, battingSide, eventId, false);
        creditPitchingAppearance(payload.pitcherId, pitchingSide, eventId, false);
        credit(batter, 'batting', 'PA', 1, eventId);
        credit(pitcher, 'pitching', 'BF', 1, eventId);
        if (atBatForResult(payload.result)) credit(batter, 'batting', 'AB', 1, eventId);

        const hitBases: Partial<Record<typeof payload.result, number>> = {
          single: 1,
          double: 2,
          triple: 3,
          home_run: 4
        };
        const bases = hitBases[payload.result];
        if (bases) {
          credit(batter, 'batting', 'H', 1, eventId);
          credit(batter, 'batting', bases === 4 ? 'HR' : `${String(bases)}B`, 1, eventId);
          credit(batter, 'batting', 'TB', bases, eventId);
          credit(pitcher, 'pitching', 'H', 1, eventId);
          teams[battingSide].H += 1;
          if (payload.result === 'home_run') credit(pitcher, 'pitching', 'HR', 1, eventId);
        }
        if (payload.result === 'walk' || payload.result === 'intentional_walk') {
          credit(batter, 'batting', payload.result === 'walk' ? 'BB' : 'IBB', 1, eventId);
          credit(pitcher, 'pitching', payload.result === 'walk' ? 'BB' : 'IBB', 1, eventId);
        }
        if (payload.result === 'hit_by_pitch') {
          credit(batter, 'batting', 'HBP', 1, eventId);
          credit(pitcher, 'pitching', 'HBP', 1, eventId);
        }
        if (payload.result === 'strikeout' || payload.result === 'dropped_third_strike') {
          credit(batter, 'batting', 'SO', 1, eventId);
          credit(pitcher, 'pitching', 'SO', 1, eventId);
        }
        if (payload.result === 'sacrifice_fly') credit(batter, 'batting', 'SF', 1, eventId);
        if (payload.result === 'sacrifice_bunt') credit(batter, 'batting', 'SH', 1, eventId);
        if (payload.result === 'reached_on_error') credit(batter, 'batting', 'ROE', 1, eventId);
        if (payload.result === 'fielders_choice') credit(batter, 'batting', 'FC', 1, eventId);
        if (payload.result === 'double_play') credit(batter, 'batting', 'GIDP', 1, eventId);

        const hasRisp = Boolean(before.bases.second || before.bases.third);
        if (hasRisp) teams[battingSide].rispOpportunities += 1;
        if (hasRisp && bases) teams[battingSide].rispHits += 1;
        if (before.inning.strikes >= 2) {
          teams[battingSide].twoStrikePlateAppearances += 1;
          if (bases) teams[battingSide].twoStrikeHits += 1;
        }

        const allAdvances = [{ runnerId: payload.batterId, from: 'batter' as const, ...payload.batterAdvance }, ...payload.runnerAdvances];
        let runsOnPlay = 0;
        allAdvances.forEach((advance) => {
          if (advance.from !== 'batter') {
            const runner = ensure(advance.runnerId, battingSide);
            if (advance.to === 'out') credit(runner, 'baserunning', 'outs', 1, eventId);
            else if (advance.to !== 'stay') credit(runner, 'baserunning', 'advances', 1, eventId);
            if (advance.cause === 'stolen_base') credit(runner, 'baserunning', 'SB', 1, eventId);
            if (advance.cause === 'caught_stealing') credit(runner, 'baserunning', 'CS', 1, eventId);
            if (advance.cause === 'pickoff') credit(runner, 'baserunning', 'pickoffs', 1, eventId);
          }
          if (advance.to !== 'home' || advance.countsRun === false) return;
          runsOnPlay += 1;
          const runner = ensure(advance.runnerId, battingSide);
          creditGame(advance.runnerId, battingSide, eventId, false);
          credit(runner, 'batting', 'R', 1, eventId);
          const placement = advance.from === 'batter' ? null : before.bases[advance.from];
          const matchingJudgments = attachmentsForPlay(attachments.judgments, event).filter(
            (candidate) => !candidate.runnerId || candidate.runnerId === advance.runnerId
          );
          const responsiblePitcherId =
            latestJudgmentValue(matchingJudgments, advance.runnerId, 'responsiblePitcherId') ??
            advance.responsiblePitcherId ??
            (advance.from === 'batter' ? payload.pitcherId : placement?.chargedToPitcherId);
          const earned = latestJudgmentValue(matchingJudgments, advance.runnerId, 'earned') ?? advance.earned;
          if (responsiblePitcherId) {
            const responsiblePitcher = ensure(responsiblePitcherId, pitchingSide);
            creditPitchingAppearance(responsiblePitcherId, pitchingSide, eventId, false);
            credit(responsiblePitcher, 'pitching', 'R', 1, eventId);
            if (currentPitcherId !== responsiblePitcherId) {
              credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'inheritedScored', 1, eventId);
            }
            if (earned === true) credit(responsiblePitcher, 'pitching', 'ER', 1, eventId);
          }
          const rbi = latestJudgmentValue(matchingJudgments, advance.runnerId, 'rbi') ?? advance.rbi;
          if (payload.runsBattedIn === undefined && rbi === true) credit(batter, 'batting', 'RBI', 1, eventId);
        });
        if (payload.runsBattedIn !== undefined) {
          credit(batter, 'batting', 'RBI', payload.runsBattedIn, eventId);
        }
        const physicalCauses = new Set(allAdvances.map((advance) => advance.cause));
        if (physicalCauses.has('wild_pitch')) credit(pitcher, 'pitching', 'WP', 1, eventId);
        if (physicalCauses.has('balk') || physicalCauses.has('illegal_pitch')) {
          const matchingPriorCredit =
            physicalCauseCluster?.pitcherId === payload.pitcherId &&
            (physicalCauseCluster.cause === 'balk' || physicalCauseCluster.cause === 'illegal_pitch') &&
            physicalCauseCluster.pitchingCreditRecorded;
          if (!matchingPriorCredit) credit(pitcher, 'pitching', 'balkIllegalPitch', 1, eventId);
        }
        credit(pitcher, 'pitching', 'outs', payload.outsOnPlay, eventId);
        teams[battingSide].R += runsOnPlay;
        if (before.inning.outs === 2) teams[battingSide].twoOutRuns += runsOnPlay;

        const defenders = new Set(Object.values(before.lineups[pitchingSide].defense).filter(Boolean));
        defenders.forEach((playerId) => credit(ensure(playerId, pitchingSide), 'fielding', 'defensiveOuts', payload.outsOnPlay, eventId));
        const fieldingResult = addMergedFielding(
          [...(payload.fielding ? [payload.fielding] : []), ...attachmentsForPlay(attachments.fielding, event)],
          payload.outsOnPlay,
          pitchingSide,
          eventId,
          ensure,
          credit
        );
        teams[pitchingSide].E += fieldingResult.errorCredits;
        physicalCauseCluster = null;
        break;
      }
      case 'advance_runner': {
        const payload = event.payload as DiamondCommandPayloadMap['advance_runner'];
        const battingSide = battingSideFor(before);
        const pitchingSide = battingSide === 'home' ? 'away' : 'home';
        const runner = ensure(payload.runnerId, battingSide);
        creditGame(payload.runnerId, battingSide, eventId, false);
        if (payload.to === 'out') credit(runner, 'baserunning', 'outs', 1, eventId);
        else if (payload.to !== 'stay') credit(runner, 'baserunning', 'advances', 1, eventId);
        if (payload.cause === 'stolen_base') credit(runner, 'baserunning', 'SB', 1, eventId);
        if (payload.cause === 'caught_stealing') credit(runner, 'baserunning', 'CS', 1, eventId);
        if (payload.cause === 'pickoff') credit(runner, 'baserunning', 'pickoffs', 1, eventId);
        const placement = before.bases[payload.from];
        const matchingJudgments = attachmentsForPlay(attachments.judgments, event).filter(
          (candidate) => !candidate.runnerId || candidate.runnerId === payload.runnerId
        );
        const responsiblePitcherId =
          latestJudgmentValue(matchingJudgments, payload.runnerId, 'responsiblePitcherId') ??
          payload.responsiblePitcherId ??
          placement?.chargedToPitcherId;
        const currentPitcherId = before.lineups[pitchingSide].defense.P;
        const physicalCause = ['wild_pitch', 'passed_ball', 'balk', 'illegal_pitch'].includes(payload.cause)
          ? (payload.cause as 'wild_pitch' | 'passed_ball' | 'balk' | 'illegal_pitch')
          : null;
        const sharesAnchoredPitch = Boolean(
          physicalCause &&
          physicalCauseCluster?.anchoredByPitch &&
          physicalCauseCluster.pitcherId === (currentPitcherId ?? null) &&
          (physicalCauseCluster.cause === null || physicalCauseCluster.cause === physicalCause)
        );
        if (!physicalCause) {
          physicalCauseCluster = null;
        } else if (!sharesAnchoredPitch) {
          physicalCauseCluster = {
            cause: physicalCause,
            pitcherId: currentPitcherId ?? null,
            anchoredByPitch: false,
            pitchingCreditRecorded: false,
            passedBallCreditRecorded: false
          };
        } else if (physicalCauseCluster?.cause === null) {
          physicalCauseCluster.cause = physicalCause;
        }
        if (payload.to === 'out' && currentPitcherId) {
          credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'outs', 1, eventId);
          const defenders = new Set(Object.values(before.lineups[pitchingSide].defense).filter(Boolean));
          defenders.forEach((playerId) => credit(ensure(playerId, pitchingSide), 'fielding', 'defensiveOuts', 1, eventId));
        }
        if (payload.to === 'home' && payload.countsRun !== false) {
          credit(runner, 'batting', 'R', 1, eventId);
          teams[battingSide].R += 1;
          if (before.inning.outs === 2) teams[battingSide].twoOutRuns += 1;
          if (responsiblePitcherId) {
            const responsiblePitcher = ensure(responsiblePitcherId, pitchingSide);
            credit(responsiblePitcher, 'pitching', 'R', 1, eventId);
            const earned = latestJudgmentValue(matchingJudgments, payload.runnerId, 'earned') ?? payload.earned;
            if (earned === true) credit(responsiblePitcher, 'pitching', 'ER', 1, eventId);
            if (currentPitcherId && currentPitcherId !== responsiblePitcherId) {
              credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'inheritedScored', 1, eventId);
            }
          }
        }
        if (currentPitcherId && payload.cause === 'wild_pitch' && !physicalCauseCluster?.pitchingCreditRecorded) {
          credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'WP', 1, eventId);
          if (physicalCauseCluster) physicalCauseCluster.pitchingCreditRecorded = true;
        }
        if (
          currentPitcherId &&
          (payload.cause === 'balk' || payload.cause === 'illegal_pitch') &&
          !physicalCauseCluster?.pitchingCreditRecorded
        ) {
          credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'balkIllegalPitch', 1, eventId);
          if (physicalCauseCluster) physicalCauseCluster.pitchingCreditRecorded = true;
        }
        const fieldingResult = addMergedFielding(
          [...(payload.fielding ? [payload.fielding] : []), ...attachmentsForPlay(attachments.fielding, event)],
          payload.to === 'out' ? 1 : 0,
          pitchingSide,
          eventId,
          ensure,
          credit,
          { creditPassedBall: !physicalCauseCluster?.passedBallCreditRecorded }
        );
        if (fieldingResult.passedBallObserved && physicalCauseCluster) physicalCauseCluster.passedBallCreditRecorded = true;
        teams[pitchingSide].E += fieldingResult.errorCredits;
        break;
      }
      case 'add_courtesy_runner': {
        const payload = event.payload as DiamondCommandPayloadMap['add_courtesy_runner'];
        creditGame(payload.runnerId, payload.side, eventId, false);
        break;
      }
      case 'record_fielding': {
        // Attached to and credited with its original play above.
        break;
      }
      case 'record_scoring_judgment': {
        const payload = event.payload as DiamondCommandPayloadMap['record_scoring_judgment'];
        if (payload.pitcherOfRecord && exposedDecisionEventIds.has(eventId)) {
          const decision = payload.pitcherOfRecord.decision === 'win' ? 'W' : payload.pitcherOfRecord.decision === 'loss' ? 'L' : 'SV';
          credit(ensure(payload.pitcherOfRecord.playerId, payload.pitcherOfRecord.side), 'pitching', decision, 1, eventId);
        }
        break;
      }
      case 'advance_half_inning': {
        const side = battingSideFor(before);
        teams[side].LOB += [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length;
        break;
      }
      case 'finalize': {
        if (ledger.state.lifecycle === 'final' && event.revision === ledger.state.finalConfirmedAtRevision) {
          const side = battingSideFor(before);
          teams[side].LOB += [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length;
        }
        break;
      }
      default:
        break;
    }
  });

  const players = Object.fromEntries(
    Array.from(lines.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([playerId, line]) => [
        playerId,
        {
          playerId,
          side: line.side,
          raw: line.raw,
          derived: deriveDiamondPlayerStats(line.raw, coverage, profile.eraInningsBasis),
          coverage,
          sources: Object.fromEntries(Object.entries(line.sources).map(([stat, sourceIds]) => [stat, Array.from(sourceIds).sort()]))
        } satisfies DiamondPlayerStatLine
      ])
  );

  return {
    schemaVersion: 2,
    catalogVersion: 1,
    sourceRevision: ledger.state.revision,
    checkpointHash: ledger.state.checkpointHash,
    coverage,
    players,
    teams,
    inningLines: ledger.state.inningRuns,
    complete: true
  };
}

export function isBattingQualified(line: DiamondPlayerStatLine, teamGames: number, plateAppearancesPerGame = 2.1): boolean {
  return (
    line.coverage.batting === 'complete' &&
    Number.isFinite(teamGames) &&
    teamGames > 0 &&
    line.raw.batting.PA >= teamGames * plateAppearancesPerGame
  );
}
