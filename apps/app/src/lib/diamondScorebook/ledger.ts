import { canonicalDiamondJson, hashDiamondValue } from './canonical';
import {
  DIAMOND_REDUCER_VERSION,
  DIAMOND_SCHEMA_VERSION,
  DIAMOND_STAT_CATALOG_VERSION,
  DiamondDomainError,
  type DiamondCommand,
  type DiamondCheckpoint,
  type DiamondCheckpointExecution,
  type DiamondCommandContext,
  type DiamondCommandPayloadMap,
  type DiamondCommandResult,
  type DiamondCommandReceipt,
  type DiamondCommandType,
  type DiamondEffectiveEvent,
  type DiamondEvent,
  type DiamondExecution,
  type DiamondFieldingChain,
  type DiamondGameState,
  type DiamondLedger,
  type DiamondLedgerConfig,
  type DiamondReplacement,
  type DiamondSide
} from './contracts';
import {
  cloneDiamondState,
  createInitialDiamondState,
  deriveDiamondCoverageFromEventStates,
  getBattingSide,
  getDiamondFinalizationReason,
  reduceDiamondEvent,
  setDiamondStateRevision,
  validateDiamondFieldingOutCredit,
  validateDiamondMergedFieldingOutCredit,
  validateDiamondState,
  type DiamondReducerAction
} from './reducer';

type CorrectionDirective = Readonly<{
  kind: 'void' | 'supersede';
  correctionEventId: string;
  replacement?: DiamondReplacement;
}>;

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HISTORY_REQUIRED_COMMANDS = new Set<DiamondCommandType>([
  'record_fielding',
  'record_scoring_judgment',
  'void_event',
  'supersede_event',
  'finalize'
]);
const ATTACHABLE_PLAY_TYPES = new Set<DiamondCommandType>(['record_plate_appearance', 'advance_runner']);
const PITCHER_APPEARANCE_TYPES = new Set<DiamondCommandType>(['record_pitch', 'record_plate_appearance', 'advance_runner']);
const FINAL_REOPEN_INTERVENING_TYPES = new Set<DiamondCommandType>(['private_note', 'scorer_handoff']);

// Private-note plaintext and author identity live only in the server-private,
// deletion-indexed note record. The canonical ledger keeps a replay-valid
// redacted nulls so its hash chain contains neither the note nor a note-author
// identifier and cannot collide with any valid scorer UID.
export const DIAMOND_PRIVATE_NOTE_TOMBSTONE = '[private note stored separately]' as const;
export const DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION = null;
export const DIAMOND_PRIVATE_NOTE_REASON_TOMBSTONE = 'Private note correction stored separately.' as const;

function privateNoteStateForStorage(state: DiamondGameState): DiamondGameState {
  // Canonical private-material before/after snapshots deliberately redact the
  // scorer as null. They are hash-chain evidence, not standalone reducer input;
  // replay always advances from the authoritative running/checkpoint state.
  return state.currentScorerUid === null
    ? state
    : { ...state, currentScorerUid: DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION };
}

function resultForPrivateNoteStorage(result: DiamondCommandResult, event: DiamondEvent): DiamondCommandResult {
  return event.actorUid !== DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION
    ? result
    : { ...result, state: event.after };
}

function resultForPrivateNoteResponse(
  result: DiamondCommandResult,
  event: DiamondEvent,
  currentScorerUid: string | null
): DiamondCommandResult {
  return event.actorUid !== DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION
    ? result
    : { ...result, state: { ...result.state, currentScorerUid } };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child));
  }
  return value;
}

function requireId(value: unknown, label: string) {
  if (typeof value !== 'string') throw new DiamondDomainError('invalid-id', `${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || normalized.includes('/')) {
    throw new DiamondDomainError('invalid-id', `${label} must be nonempty, slash-free, and at most 128 characters.`);
  }
  return normalized;
}

export function getDiamondPrivateNoteText(command: DiamondCommand): string | null {
  if (command.type === 'private_note') return command.payload.text;
  if (command.type === 'supersede_event' && command.payload.replacement.type === 'private_note') {
    return command.payload.replacement.payload.text;
  }
  return null;
}

function isCorrectionCommand(command: DiamondCommand) {
  return command.type === 'void_event' || command.type === 'supersede_event';
}

function isCanonicalPrivateNoteMaterialEvent(event: DiamondEvent | undefined) {
  if (!event || event.actorUid !== DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION) return false;
  if (
    event.before.currentScorerUid !== DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION ||
    event.after.currentScorerUid !== DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION
  ) {
    return false;
  }
  if (event.type === 'private_note') {
    return event.payload.text === DIAMOND_PRIVATE_NOTE_TOMBSTONE;
  }
  if (event.type === 'supersede_event' && event.payload.replacement.type === 'private_note') {
    return (
      event.payload.reason === DIAMOND_PRIVATE_NOTE_REASON_TOMBSTONE &&
      event.payload.replacement.payload.text === DIAMOND_PRIVATE_NOTE_TOMBSTONE
    );
  }
  return (
    (event.type === 'void_event' || event.type === 'supersede_event') &&
    event.payload.reason === DIAMOND_PRIVATE_NOTE_REASON_TOMBSTONE
  );
}

function targetsPrivateNote(ledger: DiamondLedger, command: DiamondCommand) {
  if (!isCorrectionCommand(command)) return false;
  const target = ledger.events.find((event) => event.eventId === command.payload.targetEventId);
  return isCanonicalPrivateNoteMaterialEvent(target);
}

function isPrivateMaterialCommand(ledger: DiamondLedger, command: DiamondCommand) {
  return getDiamondPrivateNoteText(command) !== null || targetsPrivateNote(ledger, command);
}

export function canonicalizeDiamondPrivateNoteCommand(
  command: DiamondCommand,
  privateMaterial = getDiamondPrivateNoteText(command) !== null
): DiamondCommand {
  const canonicalCommand = privateMaterial
    ? ({ ...command, leaseId: null } as unknown as DiamondCommand)
    : command;
  if (canonicalCommand.type === 'private_note') {
    return {
      ...canonicalCommand,
      payload: { ...canonicalCommand.payload, text: DIAMOND_PRIVATE_NOTE_TOMBSTONE }
    } as DiamondCommand;
  }
  if (
    canonicalCommand.type === 'supersede_event' &&
    canonicalCommand.payload.replacement.type === 'private_note'
  ) {
    return {
      ...canonicalCommand,
      payload: {
        ...canonicalCommand.payload,
        reason: DIAMOND_PRIVATE_NOTE_REASON_TOMBSTONE,
        replacement: {
          ...canonicalCommand.payload.replacement,
          payload: {
            ...canonicalCommand.payload.replacement.payload,
            text: DIAMOND_PRIVATE_NOTE_TOMBSTONE
          }
        }
      }
    } as DiamondCommand;
  }
  if (privateMaterial && isCorrectionCommand(canonicalCommand)) {
    return {
      ...canonicalCommand,
      payload: {
        ...canonicalCommand.payload,
        reason: DIAMOND_PRIVATE_NOTE_REASON_TOMBSTONE
      }
    } as DiamondCommand;
  }
  return canonicalCommand;
}

export function getDiamondPrivateNoteRequestHash(command: DiamondCommand): string | null {
  return getDiamondPrivateNoteText(command) === null && !isCorrectionCommand(command)
    ? null
    : hashDiamondValue({
        schemaVersion: 1,
        kind: 'diamond-private-note-request',
        command:
          isCorrectionCommand(command)
            ? {
                ...command,
                payload: {
                  ...command.payload,
                  reason: DIAMOND_PRIVATE_NOTE_REASON_TOMBSTONE
                }
              }
            : command
      });
}

function commandHash(command: DiamondCommand, privateMaterial = getDiamondPrivateNoteText(command) !== null): string {
  return hashDiamondValue(canonicalizeDiamondPrivateNoteCommand(command, privateMaterial));
}

function validateTrustedCommandAuthorization(command: DiamondCommand, context: DiamondCommandContext) {
  if (command.type === 'cancel' && context.managerAuthorized !== true) {
    throw new DiamondDomainError(
      'manager-authorization-required',
      'Only a server-verified current team manager may cancel a Diamond game.'
    );
  }
}

function stateForHash(state: DiamondGameState): DiamondGameState {
  return { ...state, checkpointHash: '' };
}

function eventHashMaterial(event: DiamondEvent) {
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    sequence: event.sequence,
    revision: event.revision,
    commandId: event.commandId,
    commandHash: event.commandHash,
    type: event.type,
    payload: event.payload,
    actorUid: event.actorUid,
    serverTimestampMs: event.serverTimestampMs,
    rulesProfileId: event.rulesProfileId,
    rulesProfileVersion: event.rulesProfileVersion,
    reducerVersion: event.reducerVersion,
    statCatalogVersion: event.statCatalogVersion,
    supersedesEventId: event.supersedesEventId,
    voidsEventId: event.voidsEventId,
    before: stateForHash(event.before),
    after: stateForHash(event.after),
    previousHash: event.previousHash
  };
}

function hashEvent(event: DiamondEvent): string {
  return hashDiamondValue(eventHashMaterial(event));
}

function getCorrectionDirectives(events: readonly DiamondEvent[]): Map<string, CorrectionDirective> {
  const eventIds = new Set<string>();
  const directives = new Map<string, CorrectionDirective>();
  events.forEach((event) => {
    if (eventIds.has(event.eventId)) {
      throw new DiamondDomainError('duplicate-event-id', `Duplicate event ID ${event.eventId}.`);
    }
    eventIds.add(event.eventId);
    if (event.type !== 'void_event' && event.type !== 'supersede_event') return;
    const targetEventId = event.payload.targetEventId;
    if (!eventIds.has(targetEventId) || targetEventId === event.eventId) {
      throw new DiamondDomainError('invalid-correction-target', 'Corrections must target an earlier canonical event.');
    }
    if (directives.has(targetEventId)) {
      throw new DiamondDomainError('already-corrected', `Event ${targetEventId} already has a correction.`);
    }
    directives.set(
      targetEventId,
      event.type === 'void_event'
        ? { kind: 'void', correctionEventId: event.eventId }
        : {
            kind: 'supersede',
            correctionEventId: event.eventId,
            replacement: event.payload.replacement
          }
    );
  });
  return directives;
}

function asReducerAction(
  type: DiamondReducerAction['type'],
  payload: DiamondCommandPayloadMap[keyof DiamondCommandPayloadMap],
  eventId: string
): DiamondReducerAction {
  return { type, payload, eventId } as DiamondReducerAction;
}

function attachmentTargetsVoidedPlay(event: Pick<DiamondEffectiveEvent, 'type' | 'payload'>, voidedEventIds: ReadonlySet<string>) {
  if (event.type !== 'record_fielding' && event.type !== 'record_scoring_judgment') return false;
  const payload = event.payload as DiamondCommandPayloadMap['record_fielding'] | DiamondCommandPayloadMap['record_scoring_judgment'];
  return voidedEventIds.has(payload.playEventId);
}

type ObsoleteFinalizationPairs = Readonly<{
  finalizeEventIds: ReadonlySet<string>;
  reopenEventIds: ReadonlySet<string>;
}>;

function getObsoleteFinalizationPairs(events: readonly DiamondEvent[]): ObsoleteFinalizationPairs {
  const finalizeEventIds = new Set<string>();
  const reopenEventIds = new Set<string>();
  let candidateFinalizeEventId: string | null = null;
  let invalidPair = false;

  events.forEach((event) => {
    if (event.type === 'finalize') {
      if (candidateFinalizeEventId || invalidPair) {
        candidateFinalizeEventId = null;
        invalidPair = true;
      } else {
        candidateFinalizeEventId = event.eventId;
      }
      return;
    }
    if (event.type === 'reopen_for_correction') {
      if (candidateFinalizeEventId && !invalidPair) {
        finalizeEventIds.add(candidateFinalizeEventId);
        reopenEventIds.add(event.eventId);
      }
      candidateFinalizeEventId = null;
      invalidPair = false;
      return;
    }
    if (candidateFinalizeEventId && !FINAL_REOPEN_INTERVENING_TYPES.has(event.type)) {
      candidateFinalizeEventId = null;
      invalidPair = true;
    }
  });

  return { finalizeEventIds, reopenEventIds };
}

export function getEffectiveDiamondEvents(events: readonly DiamondEvent[]): readonly DiamondEffectiveEvent[] {
  const directives = getCorrectionDirectives(events);
  const obsoleteFinalizations = getObsoleteFinalizationPairs(events);
  const voidedEventIds = new Set(
    [...directives.entries()].filter(([, directive]) => directive.kind === 'void').map(([eventId]) => eventId)
  );
  const effective: DiamondEffectiveEvent[] = [];
  events.forEach((event) => {
    if (event.type === 'void_event' || event.type === 'supersede_event') return;
    if (obsoleteFinalizations.finalizeEventIds.has(event.eventId) || obsoleteFinalizations.reopenEventIds.has(event.eventId)) return;
    if (attachmentTargetsVoidedPlay(event, voidedEventIds)) return;
    const directive = directives.get(event.eventId);
    if (directive?.kind === 'void') return;
    if (directive?.kind === 'supersede' && directive.replacement) {
      effective.push({
        eventId: directive.correctionEventId,
        sourceEventId: event.eventId,
        revision: event.revision,
        type: directive.replacement.type,
        payload: directive.replacement.payload,
        correctionEventId: directive.correctionEventId
      });
      return;
    }
    effective.push({
      eventId: event.eventId,
      sourceEventId: event.eventId,
      revision: event.revision,
      type: event.type,
      payload: event.payload
    });
  });
  return deepFreeze(effective);
}

type HistoricalPlayContext = Readonly<{
  battingSide: DiamondSide;
  defensiveSide: DiamondSide;
  activeDefenders: ReadonlySet<string>;
  catcherId: string | null;
  participants: ReadonlySet<string>;
  scoringRunners: ReadonlySet<string>;
  requiresHomeRunRbi: boolean;
  actualOutCount: number;
  actualOutRunnerIds: readonly string[];
  knownPlayers: Readonly<Record<DiamondSide, ReadonlySet<string>>>;
  pitcherAppearances: Readonly<Record<DiamondSide, ReadonlySet<string>>>;
}>;

type ParticipantReplayTracker = {
  plays: Map<string, HistoricalPlayContext>;
  pitcherAppearances: Record<DiamondSide, Set<string>>;
  pitcherDecisions: Partial<Record<PitcherDecision['decision'], PitcherDecision>>;
};

type PitcherDecision = NonNullable<DiamondCommandPayloadMap['record_scoring_judgment']['pitcherOfRecord']>;

function createParticipantReplayTracker(): ParticipantReplayTracker {
  return {
    plays: new Map<string, HistoricalPlayContext>(),
    pitcherAppearances: { home: new Set<string>(), away: new Set<string>() },
    pitcherDecisions: {}
  };
}

function otherSide(side: DiamondSide): DiamondSide {
  return side === 'home' ? 'away' : 'home';
}

function scoringParticipants(event: DiamondEffectiveEvent) {
  const participants = new Set<string>();
  const scoringRunners = new Set<string>();
  let requiresHomeRunRbi = false;
  if (event.type === 'record_plate_appearance') {
    const payload = event.payload as DiamondCommandPayloadMap['record_plate_appearance'];
    requiresHomeRunRbi = payload.result === 'home_run';
    participants.add(payload.batterId);
    if (payload.batterAdvance.to === 'home' && payload.batterAdvance.countsRun !== false) scoringRunners.add(payload.batterId);
    payload.runnerAdvances.forEach((advance) => {
      participants.add(advance.runnerId);
      if (advance.to === 'home' && advance.countsRun !== false) scoringRunners.add(advance.runnerId);
    });
  } else if (event.type === 'advance_runner') {
    const payload = event.payload as DiamondCommandPayloadMap['advance_runner'];
    participants.add(payload.runnerId);
    if (payload.to === 'home' && payload.countsRun !== false) scoringRunners.add(payload.runnerId);
  }
  return { participants, scoringRunners, requiresHomeRunRbi };
}

function actualOutRunnerIds(event: DiamondEffectiveEvent) {
  if (event.type === 'record_plate_appearance') {
    const payload = event.payload as DiamondCommandPayloadMap['record_plate_appearance'];
    return [
      { runnerId: payload.batterId, to: payload.batterAdvance.to },
      ...payload.runnerAdvances.map((advance) => ({ runnerId: advance.runnerId, to: advance.to }))
    ]
      .filter((move) => move.to === 'out')
      .map((move) => move.runnerId);
  }
  if (event.type === 'advance_runner') {
    const payload = event.payload as DiamondCommandPayloadMap['advance_runner'];
    return payload.to === 'out' ? [payload.runnerId] : [];
  }
  return [];
}

function fieldingParticipantIds(fielding: DiamondFieldingChain) {
  return [
    ...(fielding.putoutBy ? [fielding.putoutBy] : []),
    ...(fielding.putouts ?? []).map((putout) => putout.putoutBy),
    ...(fielding.assists ?? []),
    ...(fielding.errors ?? []).map((error) => error.playerId),
    ...(fielding.passedBallBy ? [fielding.passedBallBy] : [])
  ];
}

function knownPlayerIds(state: DiamondGameState, side: DiamondSide) {
  const lineup = state.lineups[side];
  return new Set([
    ...lineup.battingOrder.flatMap((slot) => [slot.starterPlayerId, slot.activePlayerId, ...slot.substitutions]),
    ...Object.values(lineup.defense).filter((playerId): playerId is string => Boolean(playerId)),
    ...lineup.courtesyRunnerIds,
    ...(lineup.dpFlex ? [lineup.dpFlex.dpPlayerId, lineup.dpFlex.flexPlayerId] : [])
  ]);
}

function playerRoleIsUnambiguous(context: HistoricalPlayContext, side: DiamondSide, playerId: string) {
  return context.knownPlayers[side].has(playerId) && !context.knownPlayers[otherSide(side)].has(playerId);
}

function pitcherRoleIsUnambiguous(context: HistoricalPlayContext, side: DiamondSide, playerId: string) {
  return context.pitcherAppearances[side].has(playerId) && playerRoleIsUnambiguous(context, side, playerId);
}

function recordPitcherDecision(tracker: ParticipantReplayTracker, decision: PitcherDecision) {
  if (tracker.pitcherDecisions[decision.decision]) {
    throw new DiamondDomainError(
      'duplicate-pitcher-decision',
      `A ${decision.decision} decision is already recorded. Correct the earlier judgment instead.`
    );
  }

  const decisions = { ...tracker.pitcherDecisions, [decision.decision]: decision };
  const win = decisions.win;
  const loss = decisions.loss;
  const save = decisions.save;
  const contradictory =
    (win && loss && win.side === loss.side) ||
    (win && save && win.side !== save.side) ||
    (loss && save && loss.side === save.side) ||
    (win && save && win.playerId === save.playerId);
  if (contradictory) {
    throw new DiamondDomainError(
      'contradictory-pitcher-decision',
      'Winning, losing, and saving pitcher decisions must use coherent sides and distinct winning and saving pitchers.'
    );
  }

  tracker.pitcherDecisions[decision.decision] = decision;
}

function validatePitcherDecisionsForFinalization(state: DiamondGameState, tracker: ParticipantReplayTracker) {
  const decisions = Object.values(tracker.pitcherDecisions);
  if (!decisions.length) return;

  const reason = getDiamondFinalizationReason(state);
  if (!reason) return;

  let winningSide: DiamondSide | null;
  if (reason.kind === 'forfeit') {
    winningSide = state.gameEndDecision?.reason === 'forfeit' ? state.gameEndDecision.awardedSide : null;
  } else if (state.score.home === state.score.away) {
    winningSide = null;
  } else {
    winningSide = state.score.home > state.score.away ? 'home' : 'away';
  }

  if (!winningSide) {
    throw new DiamondDomainError(
      'pitcher-decision-not-allowed-for-tie',
      'A tied official result cannot award a winning, losing, or saving pitcher decision.'
    );
  }

  const losingSide = otherSide(winningSide);
  const win = tracker.pitcherDecisions.win;
  const loss = tracker.pitcherDecisions.loss;
  const save = tracker.pitcherDecisions.save;
  if ((win && win.side !== winningSide) || (loss && loss.side !== losingSide) || (save && save.side !== winningSide)) {
    throw new DiamondDomainError(
      'pitcher-decision-official-result-mismatch',
      'Winning and saving pitcher decisions must use the official winning side, and a losing decision must use the official losing side.'
    );
  }
}

function validateAttachmentAgainstHistoricalPlay(event: Pick<DiamondEffectiveEvent, 'type' | 'payload'>, context: HistoricalPlayContext) {
  if (event.type === 'record_fielding') {
    const fielding = (event.payload as DiamondCommandPayloadMap['record_fielding']).fielding;
    validateDiamondFieldingOutCredit(fielding, context.actualOutCount);
    validateDiamondMergedFieldingOutCredit([fielding], context.actualOutRunnerIds);
    const invalidFielder = fieldingParticipantIds(fielding).find(
      (playerId) => !context.activeDefenders.has(playerId) || !playerRoleIsUnambiguous(context, context.defensiveSide, playerId)
    );
    if (invalidFielder) {
      throw new DiamondDomainError(
        'invalid-fielding-participant',
        `${invalidFielder} was not an active ${context.defensiveSide} defender when the cited play occurred.`
      );
    }
    if (fielding.passedBallBy && fielding.passedBallBy !== context.catcherId) {
      throw new DiamondDomainError(
        'invalid-fielding-participant',
        'A passed-ball attachment must name the catcher recorded when the cited play occurred.'
      );
    }
    return;
  }
  if (event.type !== 'record_scoring_judgment') return;
  const payload = event.payload as DiamondCommandPayloadMap['record_scoring_judgment'];
  const hasRunnerJudgment = payload.earned !== undefined || payload.rbi !== undefined || payload.responsiblePitcherId !== undefined;
  if (
    payload.runnerId &&
    (!context.participants.has(payload.runnerId) || !playerRoleIsUnambiguous(context, context.battingSide, payload.runnerId))
  ) {
    throw new DiamondDomainError(
      'invalid-scoring-participant',
      `${payload.runnerId} was not an unambiguous ${context.battingSide} participant in the cited play.`
    );
  }
  if (hasRunnerJudgment) {
    if (context.scoringRunners.size === 0) {
      throw new DiamondDomainError('invalid-scoring-participant', 'The cited play has no counted run to receive this scoring judgment.');
    }
    if (payload.runnerId) {
      if (!context.scoringRunners.has(payload.runnerId)) {
        throw new DiamondDomainError(
          'invalid-scoring-participant',
          'Runner-level scoring credit must name a counted run on the cited play.'
        );
      }
    } else if (context.scoringRunners.size !== 1) {
      throw new DiamondDomainError(
        'ambiguous-scoring-participant',
        'A multi-run play requires the exact scoring runner for earned-run, RBI, or pitcher-responsibility judgment.'
      );
    }
  }
  if (payload.rbi === false && context.requiresHomeRunRbi) {
    throw new DiamondDomainError('invalid-rbi', 'A counted run on a home run cannot have its batter RBI revoked.');
  }
  if (payload.responsiblePitcherId && !pitcherRoleIsUnambiguous(context, context.defensiveSide, payload.responsiblePitcherId)) {
    throw new DiamondDomainError(
      'responsible-pitcher-role-mismatch',
      `${payload.responsiblePitcherId} was not unambiguously recorded as a ${context.defensiveSide} pitcher by the cited play.`
    );
  }
  if (payload.pitcherOfRecord) {
    const decision = payload.pitcherOfRecord;
    if (!pitcherRoleIsUnambiguous(context, decision.side, decision.playerId)) {
      throw new DiamondDomainError(
        'pitcher-not-in-lineup',
        'A pitcher decision must name a player unambiguously recorded as a pitcher for that side by the cited play.'
      );
    }
  }
}

function observeEffectiveEventParticipants(state: DiamondGameState, event: DiamondEffectiveEvent, tracker: ParticipantReplayTracker) {
  if (PITCHER_APPEARANCE_TYPES.has(event.type)) {
    const battingSide = getBattingSide(state);
    const defensiveSide = otherSide(battingSide);
    const pitcherId = state.lineups[defensiveSide].defense.P;
    if (!pitcherId) {
      throw new DiamondDomainError('missing-defensive-pitcher', 'The cited play has no authoritative defensive pitcher.');
    }
    tracker.pitcherAppearances[defensiveSide].add(pitcherId);
  }
  if (ATTACHABLE_PLAY_TYPES.has(event.type)) {
    const battingSide = getBattingSide(state);
    const defensiveSide = otherSide(battingSide);
    const { participants, scoringRunners, requiresHomeRunRbi } = scoringParticipants(event);
    const knownPlayers = {
      home: knownPlayerIds(state, 'home'),
      away: knownPlayerIds(state, 'away')
    };
    participants.forEach((playerId) => knownPlayers[battingSide].add(playerId));
    const outRunnerIds = actualOutRunnerIds(event);
    const context: HistoricalPlayContext = {
      battingSide,
      defensiveSide,
      activeDefenders: new Set(
        Object.values(state.lineups[defensiveSide].defense).filter((playerId): playerId is string => Boolean(playerId))
      ),
      catcherId: state.lineups[defensiveSide].defense.C ?? null,
      participants,
      scoringRunners,
      requiresHomeRunRbi,
      actualOutCount: outRunnerIds.length,
      actualOutRunnerIds: outRunnerIds,
      knownPlayers,
      pitcherAppearances: {
        home: new Set(tracker.pitcherAppearances.home),
        away: new Set(tracker.pitcherAppearances.away)
      }
    };
    tracker.plays.set(event.eventId, context);
    tracker.plays.set(event.sourceEventId, context);
    return;
  }
  if (event.type === 'record_fielding' || event.type === 'record_scoring_judgment') {
    const payload = event.payload as DiamondCommandPayloadMap['record_fielding'] | DiamondCommandPayloadMap['record_scoring_judgment'];
    const context = tracker.plays.get(payload.playEventId);
    if (!context) {
      throw new DiamondDomainError(
        'unknown-play-target',
        'Fielding and scoring judgments must cite an effective earlier play with complete replay context.'
      );
    }
    validateAttachmentAgainstHistoricalPlay(event, context);
    if (event.type === 'record_scoring_judgment') {
      const decision = (event.payload as DiamondCommandPayloadMap['record_scoring_judgment']).pitcherOfRecord;
      if (decision) recordPitcherDecision(tracker, decision);
    }
  }
}

export type DiamondEffectiveEventReplay = Readonly<{
  event: DiamondEffectiveEvent;
  before: DiamondGameState;
  after: DiamondGameState;
}>;

type InternalDiamondReplay = Readonly<{
  state: DiamondGameState;
  effectiveEvents: readonly DiamondEffectiveEvent[];
  effectiveEventStates: readonly DiamondEffectiveEventReplay[];
  participantTracker: ParticipantReplayTracker;
}>;

function validateObsoleteFinalizationEvent(event: DiamondEvent) {
  reduceDiamondEvent(event.before, asReducerAction(event.type, event.payload, event.eventId));
}

function transitionToCorrectionState(state: DiamondGameState): DiamondGameState {
  return validateDiamondState({
    ...state,
    lifecycle: 'correction',
    suspendedReason: null,
    finalizationReason: null,
    finalConfirmedAtRevision: null
  });
}

function replayCanonicalDiamondEvents(initialState: DiamondGameState, events: readonly DiamondEvent[]): InternalDiamondReplay {
  validateDiamondState(initialState);
  const directives = getCorrectionDirectives(events);
  const obsoleteFinalizations = getObsoleteFinalizationPairs(events);
  const voidedEventIds = new Set(
    [...directives.entries()].filter(([, directive]) => directive.kind === 'void').map(([eventId]) => eventId)
  );
  let state = cloneDiamondState(initialState);
  const effectiveEvents: DiamondEffectiveEvent[] = [];
  const effectiveEventStates: DiamondEffectiveEventReplay[] = [];
  const participantTracker = createParticipantReplayTracker();

  events.forEach((event) => {
    let replayedEvent: Omit<DiamondEffectiveEventReplay, 'after'> | null = null;
    const directive = directives.get(event.eventId);
    if (event.type === 'void_event' || event.type === 'supersede_event') {
      state = reduceDiamondEvent(state, asReducerAction(event.type, event.payload, event.eventId));
    } else if (directive?.kind === 'void' || attachmentTargetsVoidedPlay(event, voidedEventIds)) {
      // Its canonical record remains immutable, but its state effect is removed.
    } else if (obsoleteFinalizations.finalizeEventIds.has(event.eventId)) {
      validateObsoleteFinalizationEvent(event);
    } else if (obsoleteFinalizations.reopenEventIds.has(event.eventId)) {
      validateObsoleteFinalizationEvent(event);
      state = transitionToCorrectionState(state);
    } else {
      const effectiveEvent: DiamondEffectiveEvent =
        directive?.kind === 'supersede' && directive.replacement
          ? {
              eventId: directive.correctionEventId,
              sourceEventId: event.eventId,
              revision: event.revision,
              type: directive.replacement.type,
              payload: directive.replacement.payload,
              correctionEventId: directive.correctionEventId
            }
          : {
              eventId: event.eventId,
              sourceEventId: event.eventId,
              revision: event.revision,
              type: event.type,
              payload: event.payload
            };
      const before = state;
      observeEffectiveEventParticipants(state, effectiveEvent, participantTracker);
      const reduced = reduceDiamondEvent(state, asReducerAction(effectiveEvent.type, effectiveEvent.payload, effectiveEvent.eventId));
      if (effectiveEvent.type === 'finalize') validatePitcherDecisionsForFinalization(state, participantTracker);
      state = reduced;
      effectiveEvents.push(effectiveEvent);
      replayedEvent = { event: effectiveEvent, before };
    }
    state = setDiamondStateRevision(state, event.revision, event.hash);
    if (replayedEvent) effectiveEventStates.push({ ...replayedEvent, after: state });
  });

  return { state, effectiveEvents, effectiveEventStates, participantTracker };
}

export function replayEffectiveDiamondEventStates(
  initialState: DiamondGameState,
  events: readonly DiamondEvent[]
): readonly DiamondEffectiveEventReplay[] {
  return deepFreeze([...replayCanonicalDiamondEvents(initialState, events).effectiveEventStates]);
}

function verifyEventChain(events: readonly DiamondEvent[]) {
  let previousHash = '';
  events.forEach((event, index) => {
    const sequence = index + 1;
    if (event.sequence !== sequence || event.revision !== sequence) {
      throw new DiamondDomainError('event-gap', `Expected event sequence ${String(sequence)}.`);
    }
    if (event.previousHash !== previousHash) {
      throw new DiamondDomainError('hash-chain-mismatch', `Event ${event.eventId} has the wrong previous hash.`);
    }
    const expectedHash = hashEvent(event);
    if (event.hash !== expectedHash) {
      throw new DiamondDomainError('event-hash-mismatch', `Event ${event.eventId} failed hash verification.`);
    }
    previousHash = event.hash;
  });
}

export type DiamondReplayResult = Readonly<{
  state: DiamondGameState;
  effectiveEvents: readonly DiamondEffectiveEvent[];
  checkpointHash: string;
  complete: true;
}>;

export function replayDiamondEvents(
  initialState: DiamondGameState,
  events: readonly DiamondEvent[],
  options: Readonly<{ verifyHashes?: boolean }> = {}
): DiamondReplayResult {
  if (options.verifyHashes !== false) verifyEventChain(events);
  const replay = replayCanonicalDiamondEvents(initialState, events);
  let { state } = replay;
  const { effectiveEvents, effectiveEventStates } = replay;
  state = {
    ...state,
    coverage: deriveDiamondCoverageFromEventStates(initialState, effectiveEventStates)
  };

  return deepFreeze({
    state,
    effectiveEvents,
    checkpointHash: events.length ? events[events.length - 1].hash : '',
    complete: true as const
  });
}

export function replayDiamondLedger(ledger: DiamondLedger, options: Readonly<{ verifyHashes?: boolean }> = {}): DiamondReplayResult {
  const replay = replayDiamondEvents(ledger.initialState, ledger.events, options);
  if (options.verifyHashes !== false && canonicalDiamondJson(replay.state) !== canonicalDiamondJson(ledger.state)) {
    throw new DiamondDomainError('checkpoint-state-mismatch', 'Replay state does not match the ledger checkpoint.');
  }
  return replay;
}

export function createDiamondLedger(config: DiamondLedgerConfig): DiamondLedger {
  const initialState = createInitialDiamondState(config);
  return deepFreeze({
    teamId: config.teamId,
    gameId: config.gameId,
    rulesProfileId: config.rulesProfileId,
    rulesProfileVersion: config.rulesProfileVersion,
    captureMode: config.captureMode,
    initialState,
    state: initialState,
    events: []
  });
}

export function createDiamondCheckpoint(ledger: DiamondLedger): DiamondCheckpoint {
  if (ledger.state.revision !== ledger.events.length) {
    throw new DiamondDomainError('checkpoint-sequence-mismatch', 'Ledger revision and event sequence do not match.');
  }
  const previousHash = ledger.events.length ? ledger.events[ledger.events.length - 1].hash : '';
  if (ledger.state.checkpointHash !== previousHash) {
    throw new DiamondDomainError('checkpoint-hash-mismatch', 'Ledger state and event chain checkpoint hashes do not match.');
  }
  return deepFreeze({
    teamId: ledger.teamId,
    gameId: ledger.gameId,
    rulesProfileId: ledger.rulesProfileId,
    rulesProfileVersion: ledger.rulesProfileVersion,
    captureMode: ledger.captureMode,
    sequence: ledger.state.revision,
    previousHash,
    state: ledger.state
  });
}

/** Returns side ownership from validated marked initial and effective states. */
export function validateDiamondPlayerIdentityOwnership(ledger: DiamondLedger): true {
  getDiamondPlayerIdentityIdsBySide(ledger);
  return true;
}

export function getDiamondPlayerIdentityIdsBySide(ledger: DiamondLedger): Readonly<Record<DiamondSide, readonly string[]>> {
  validateDiamondState(ledger.initialState);
  const ownershipState = validateDiamondState(ledger.state);
  return deepFreeze({
    home: [...knownPlayerIds(ownershipState, 'home')].sort(),
    away: [...knownPlayerIds(ownershipState, 'away')].sort()
  });
}

function validateEnvelope(
  ledger: DiamondLedger,
  command: DiamondCommand,
  context: DiamondCommandContext,
  privateMaterialTargetVerified = false
) {
  validateTrustedCommandAuthorization(command, context);
  if (command.schemaVersion !== DIAMOND_SCHEMA_VERSION) {
    throw new DiamondDomainError('unsupported-schema', 'Only Diamond command schema version 2 is supported.');
  }
  if (!UUID_V4_PATTERN.test(command.commandId)) {
    throw new DiamondDomainError('invalid-command-id', 'commandId must be a cryptographically random UUID v4.');
  }
  requireId(context.eventId, 'eventId');
  const actorUid = requireId(context.actorUid, 'actorUid');
  if (!Number.isSafeInteger(context.serverTimestampMs) || context.serverTimestampMs < 0) {
    throw new DiamondDomainError('invalid-server-time', 'serverTimestampMs must be a nonnegative safe integer.');
  }
  if (command.teamId !== ledger.teamId || command.gameId !== ledger.gameId) {
    throw new DiamondDomainError('game-mismatch', 'The command does not belong to this team and game.');
  }
  if (command.rulesProfileId !== ledger.rulesProfileId || command.rulesProfileVersion !== ledger.rulesProfileVersion) {
    throw new DiamondDomainError('rules-profile-mismatch', 'The command does not use the game-pinned rules profile.');
  }
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
    throw new DiamondDomainError('invalid-revision', 'expectedRevision must be a nonnegative safe integer.');
  }
  if (command.type === 'activate') {
    if (command.payload.initialScorerUid !== actorUid) {
      throw new DiamondDomainError('scorer-mismatch', 'The activating actor must become the initial scorer.');
    }
  } else if (
    command.type !== 'cancel' &&
    !(command.type === 'scorer_handoff' && context.scorerLeaseRecoveryAuthorized === true) &&
    !privateMaterialTargetVerified &&
    !isPrivateMaterialCommand(ledger, command) &&
    ledger.state.currentScorerUid !== actorUid
  ) {
    throw new DiamondDomainError('scorer-lease-lost', 'Only the current scorer may submit this command.', true);
  }
  if (ledger.events.some((event) => event.eventId === context.eventId)) {
    throw new DiamondDomainError('duplicate-event-id', 'eventId already exists in this ledger.');
  }
}

function validateCorrection(ledger: DiamondLedger, command: DiamondCommand) {
  if (command.type !== 'void_event' && command.type !== 'supersede_event') return;
  const target = ledger.events.find((event) => event.eventId === command.payload.targetEventId);
  if (!target) throw new DiamondDomainError('unknown-correction-target', 'The correction target does not exist.');
  const uncorrectable = new Set([
    'activate',
    'start',
    'scorer_handoff',
    'suspend',
    'resume',
    'cancel',
    'finalize',
    'reopen_for_correction',
    'void_event',
    'supersede_event'
  ]);
  if (uncorrectable.has(target.type)) {
    throw new DiamondDomainError('uncorrectable-event', `A ${target.type} event cannot be voided or superseded.`);
  }
  if (command.type === 'supersede_event' && uncorrectable.has(command.payload.replacement.type)) {
    throw new DiamondDomainError('invalid-replacement', 'A correction replacement must be a correctable scoring command.');
  }
  const directives = getCorrectionDirectives(ledger.events);
  if (directives.has(target.eventId)) {
    throw new DiamondDomainError('already-corrected', 'The target event already has a correction.');
  }
}

function validateHistoryAwareCommand(ledger: DiamondLedger, command: DiamondCommand) {
  if (command.type !== 'record_fielding' && command.type !== 'record_scoring_judgment' && command.type !== 'finalize') return;
  const replay = replayCanonicalDiamondEvents(ledger.initialState, ledger.events);
  if (command.type === 'finalize') {
    validatePitcherDecisionsForFinalization(replay.state, replay.participantTracker);
    return;
  }
  const syntheticEvent: DiamondEffectiveEvent = {
    eventId: 'pending-attachment',
    sourceEventId: 'pending-attachment',
    revision: ledger.state.revision + 1,
    type: command.type,
    payload: command.payload
  };
  observeEffectiveEventParticipants(replay.state, syntheticEvent, replay.participantTracker);
}

function reject(ledger: DiamondLedger, error: unknown): DiamondExecution {
  const domainError =
    error instanceof DiamondDomainError
      ? error
      : new DiamondDomainError('invalid-command', error instanceof Error ? error.message : 'Invalid Diamond command.');
  return {
    ledger,
    result: {
      outcome: 'rejected',
      revision: ledger.state.revision,
      state: ledger.state,
      rejection: { code: domainError.code, message: domainError.message, retryable: domainError.retryable }
    }
  };
}

function rejectCheckpoint(checkpoint: DiamondCheckpoint, error: unknown): DiamondCheckpointExecution {
  const domainError =
    error instanceof DiamondDomainError
      ? error
      : new DiamondDomainError('invalid-command', error instanceof Error ? error.message : 'Invalid Diamond command.');
  return {
    checkpoint,
    result: {
      outcome: 'rejected',
      revision: checkpoint.state.revision,
      state: checkpoint.state,
      rejection: { code: domainError.code, message: domainError.message, retryable: domainError.retryable }
    }
  };
}

function validateCheckpoint(checkpoint: DiamondCheckpoint) {
  validateDiamondState(checkpoint.state);
  requireId(checkpoint.teamId, 'checkpoint.teamId');
  requireId(checkpoint.gameId, 'checkpoint.gameId');
  requireId(checkpoint.rulesProfileId, 'checkpoint.rulesProfileId');
  if (!Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0) {
    throw new DiamondDomainError('invalid-checkpoint-sequence', 'Checkpoint sequence must be a nonnegative safe integer.');
  }
  if (checkpoint.state.revision !== checkpoint.sequence) {
    throw new DiamondDomainError('checkpoint-sequence-mismatch', 'Checkpoint state revision does not match its sequence.');
  }
  if (checkpoint.state.checkpointHash !== checkpoint.previousHash) {
    throw new DiamondDomainError('checkpoint-hash-mismatch', 'Checkpoint state hash does not match previousHash.');
  }
  if (
    checkpoint.state.teamId !== checkpoint.teamId ||
    checkpoint.state.gameId !== checkpoint.gameId ||
    checkpoint.state.rulesProfileId !== checkpoint.rulesProfileId ||
    checkpoint.state.rulesProfileVersion !== checkpoint.rulesProfileVersion ||
    checkpoint.state.captureMode !== checkpoint.captureMode
  ) {
    throw new DiamondDomainError('checkpoint-metadata-mismatch', 'Checkpoint metadata does not match its state.');
  }
  if (checkpoint.sequence === 0 && checkpoint.previousHash !== '') {
    throw new DiamondDomainError('checkpoint-hash-mismatch', 'An empty checkpoint cannot have a previous hash.');
  }
  if (checkpoint.sequence > 0 && !/^sha256:[0-9a-f]{64}$/.test(checkpoint.previousHash)) {
    throw new DiamondDomainError('checkpoint-hash-mismatch', 'Checkpoint previousHash is malformed.');
  }
}

function validateReceipt(receipt: DiamondCommandReceipt) {
  if (receipt.commandId !== receipt.event.commandId || receipt.commandHash !== receipt.event.commandHash) {
    throw new DiamondDomainError('invalid-command-receipt', 'Command receipt identity does not match its event.');
  }
  if (hashEvent(receipt.event) !== receipt.event.hash) {
    throw new DiamondDomainError('invalid-command-receipt', 'Command receipt event failed hash verification.');
  }
  if (
    receipt.result.outcome !== 'accepted' ||
    receipt.result.eventId !== receipt.event.eventId ||
    receipt.result.revision !== receipt.event.revision ||
    canonicalDiamondJson(receipt.result.state) !== canonicalDiamondJson(receipt.event.after)
  ) {
    throw new DiamondDomainError('invalid-command-receipt', 'Command receipt result does not match its event.');
  }
}

export function verifyDiamondCommandReceipt(receipt: DiamondCommandReceipt): true {
  validateReceipt(receipt);
  return true;
}

export function createDiamondCommandReceipt(
  command: DiamondCommand,
  event: DiamondEvent,
  result: DiamondCommandResult
): DiamondCommandReceipt {
  const expectedCommandHash = commandHash(
    command,
    event.actorUid === DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION
  );
  if (event.commandHash !== expectedCommandHash) {
    throw new DiamondDomainError('invalid-command-receipt', 'Command receipt command does not match its event.');
  }
  const receipt = deepFreeze({
    commandId: command.commandId,
    commandHash: expectedCommandHash,
    event,
    result: resultForPrivateNoteStorage(result, event)
  });
  validateReceipt(receipt);
  return receipt;
}

/**
 * Executes the ordinary hot path from one bounded checkpoint plus, when a retry
 * is possible, the one receipt stored at commands/{commandId}. Corrections need
 * full history because their validity depends on all later canonical plays.
 */
export function executeDiamondCommandFromCheckpoint(
  checkpoint: DiamondCheckpoint,
  command: DiamondCommand,
  context: DiamondCommandContext,
  existingReceipt?: DiamondCommandReceipt | null,
  privateMaterialTargetVerified = false
): DiamondCheckpointExecution {
  try {
    validateCheckpoint(checkpoint);
    validateTrustedCommandAuthorization(command, context);
    const privateMaterial =
      getDiamondPrivateNoteText(command) !== null ||
      privateMaterialTargetVerified ||
      existingReceipt?.event.actorUid === DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION;
    const incomingHash = commandHash(command, privateMaterial);
    if (existingReceipt) {
      validateReceipt(existingReceipt);
      if (existingReceipt.commandId !== command.commandId) {
        throw new DiamondDomainError('invalid-command-receipt', 'The supplied receipt belongs to another command.');
      }
      if (existingReceipt.commandHash !== incomingHash) {
        throw new DiamondDomainError('idempotency-conflict', 'commandId was already used with a different canonical command.');
      }
      return deepFreeze({
        checkpoint,
        result: {
          ...resultForPrivateNoteResponse(
            existingReceipt.result,
            existingReceipt.event,
            checkpoint.state.currentScorerUid
          ),
          outcome: 'duplicate' as const
        },
        event: existingReceipt.event,
        receipt: existingReceipt
      });
    }

    const syntheticLedger: DiamondLedger = {
      teamId: checkpoint.teamId,
      gameId: checkpoint.gameId,
      rulesProfileId: checkpoint.rulesProfileId,
      rulesProfileVersion: checkpoint.rulesProfileVersion,
      captureMode: checkpoint.captureMode,
      initialState: checkpoint.state,
      state: checkpoint.state,
      events: []
    };
    validateEnvelope(
      syntheticLedger,
      command,
      context,
      privateMaterialTargetVerified
    );
    if (command.expectedRevision !== checkpoint.sequence) {
      throw new DiamondDomainError(
        'stale-revision',
        `Expected revision ${String(command.expectedRevision)}, current revision is ${String(checkpoint.sequence)}.`,
        true
      );
    }
    if (HISTORY_REQUIRED_COMMANDS.has(command.type)) {
      throw new DiamondDomainError(
        'history-required',
        'Corrections, finalization, and play-linked scoring details require the complete canonical event history.',
        true
      );
    }

    const sequence = checkpoint.sequence + 1;
    const before = checkpoint.state;
    let after = reduceDiamondEvent(before, asReducerAction(command.type, command.payload, context.eventId));
    after = setDiamondStateRevision(after, sequence, '');
    const canonicalCommand = canonicalizeDiamondPrivateNoteCommand(command);
    const privateNote = getDiamondPrivateNoteText(command) !== null;
    let event = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      eventId: context.eventId,
      sequence,
      revision: sequence,
      commandId: command.commandId,
      commandHash: incomingHash,
      type: command.type,
      payload: canonicalCommand.payload,
      actorUid: privateNote ? DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION : context.actorUid,
      serverTimestampMs: context.serverTimestampMs,
      rulesProfileId: command.rulesProfileId,
      rulesProfileVersion: command.rulesProfileVersion,
      reducerVersion: DIAMOND_REDUCER_VERSION,
      statCatalogVersion: DIAMOND_STAT_CATALOG_VERSION,
      before: privateNote ? privateNoteStateForStorage(before) : before,
      after: privateNote ? privateNoteStateForStorage(after) : after,
      previousHash: checkpoint.previousHash,
      hash: ''
    } as DiamondEvent;
    const hash = hashEvent(event);
    after = setDiamondStateRevision(after, sequence, hash);
    event = deepFreeze({
      ...event,
      after: privateNote ? privateNoteStateForStorage(after) : after,
      hash
    } as DiamondEvent);
    const result: DiamondCommandResult = deepFreeze({
      outcome: 'accepted',
      revision: sequence,
      eventId: event.eventId,
      state: after
    });
    const receipt = createDiamondCommandReceipt(command, event, result);
    return deepFreeze({
      checkpoint: {
        ...checkpoint,
        sequence,
        previousHash: hash,
        state: after
      },
      result,
      event,
      receipt
    });
  } catch (error) {
    return rejectCheckpoint(checkpoint, error);
  }
}

export function executeDiamondCommand(ledger: DiamondLedger, command: DiamondCommand, context: DiamondCommandContext): DiamondExecution {
  try {
    validateTrustedCommandAuthorization(command, context);
    const existing = ledger.events.find((event) => event.commandId === command.commandId);
    const privateMaterial =
      getDiamondPrivateNoteText(command) !== null ||
      targetsPrivateNote(ledger, command) ||
      existing?.actorUid === DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION;
    const incomingHash = commandHash(command, privateMaterial);
    if (existing) {
      if (existing.commandHash !== incomingHash) {
        throw new DiamondDomainError('idempotency-conflict', 'commandId was already used with a different canonical command.');
      }
      return {
        ledger,
        result: {
          outcome: 'duplicate',
          revision: existing.revision,
          eventId: existing.eventId,
          state: resultForPrivateNoteResponse(
            { outcome: 'accepted', revision: existing.revision, eventId: existing.eventId, state: existing.after },
            existing,
            ledger.state.currentScorerUid
          ).state
        },
        event: existing
      };
    }

    validateDiamondState(ledger.initialState);
    validateDiamondState(ledger.state);
    validateEnvelope(ledger, command, context);
    if (command.expectedRevision !== ledger.state.revision) {
      throw new DiamondDomainError(
        'stale-revision',
        `Expected revision ${String(command.expectedRevision)}, current revision is ${String(ledger.state.revision)}.`,
        true
      );
    }
    validateCorrection(ledger, command);

    const sequence = ledger.events.length + 1;
    const before = ledger.state;
    let after = reduceDiamondEvent(before, asReducerAction(command.type, command.payload, context.eventId));
    // The reducer performs strict runtime shape validation first, so malformed
    // nested attachment payloads cannot reach history-aware membership checks.
    validateHistoryAwareCommand(ledger, command);
    after = setDiamondStateRevision(after, sequence, '');
    const canonicalCommand = canonicalizeDiamondPrivateNoteCommand(command, privateMaterial);
    const privateNote = privateMaterial;

    const partialEvent = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      eventId: context.eventId,
      sequence,
      revision: sequence,
      commandId: command.commandId,
      commandHash: incomingHash,
      type: command.type,
      payload: canonicalCommand.payload,
      actorUid: privateNote ? DIAMOND_PRIVATE_NOTE_ACTOR_REDACTION : context.actorUid,
      serverTimestampMs: context.serverTimestampMs,
      rulesProfileId: command.rulesProfileId,
      rulesProfileVersion: command.rulesProfileVersion,
      reducerVersion: DIAMOND_REDUCER_VERSION,
      statCatalogVersion: DIAMOND_STAT_CATALOG_VERSION,
      ...(command.type === 'void_event' ? { voidsEventId: command.payload.targetEventId } : {}),
      ...(command.type === 'supersede_event' ? { supersedesEventId: command.payload.targetEventId } : {}),
      before: privateNote ? privateNoteStateForStorage(before) : before,
      after: privateNote ? privateNoteStateForStorage(after) : after,
      previousHash: ledger.events.length ? ledger.events[ledger.events.length - 1].hash : '',
      hash: ''
    } as DiamondEvent;

    const provisionalEvents = [...ledger.events, partialEvent];
    if (command.type === 'void_event' || command.type === 'supersede_event') {
      after = replayDiamondEvents(ledger.initialState, provisionalEvents, { verifyHashes: false }).state;
      after = setDiamondStateRevision(after, sequence, '');
    } else {
      const coverageReplay = replayCanonicalDiamondEvents(ledger.initialState, provisionalEvents);
      after = {
        ...after,
        coverage: deriveDiamondCoverageFromEventStates(ledger.initialState, coverageReplay.effectiveEventStates)
      };
    }

    let event = {
      ...partialEvent,
      after: privateNote ? privateNoteStateForStorage(after) : after
    } as DiamondEvent;
    const hash = hashEvent(event);
    after = setDiamondStateRevision(after, sequence, hash);
    event = deepFreeze({
      ...event,
      after: privateNote ? privateNoteStateForStorage(after) : after,
      hash
    } as DiamondEvent);
    const events = deepFreeze([...ledger.events, event]);
    const nextLedger: DiamondLedger = deepFreeze({ ...ledger, state: after, events });

    if (command.type === 'void_event' || command.type === 'supersede_event') {
      const replay = replayDiamondEvents(nextLedger.initialState, nextLedger.events);
      if (canonicalDiamondJson(replay.state) !== canonicalDiamondJson(nextLedger.state)) {
        throw new DiamondDomainError('checkpoint-state-mismatch', 'The accepted command did not replay to its checkpoint.');
      }
    }

    const result: DiamondCommandResult = deepFreeze({
      outcome: 'accepted',
      revision: sequence,
      eventId: event.eventId,
      state: after
    });
    return deepFreeze({ ledger: nextLedger, result, event });
  } catch (error) {
    return reject(ledger, error);
  }
}

export function verifyDiamondLedger(ledger: DiamondLedger): true {
  replayDiamondLedger(ledger);
  return true;
}

export function getDiamondCommandHash(command: DiamondCommand): string {
  return commandHash(command);
}
