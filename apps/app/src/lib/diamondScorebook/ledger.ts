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
  type DiamondEffectiveEvent,
  type DiamondEvent,
  type DiamondExecution,
  type DiamondGameState,
  type DiamondLedger,
  type DiamondLedgerConfig,
  type DiamondReplacement
} from './contracts';
import {
  cloneDiamondState,
  createInitialDiamondState,
  reduceDiamondEvent,
  setDiamondStateRevision,
  validateDiamondState,
  type DiamondReducerAction
} from './reducer';

type CorrectionDirective = Readonly<{
  kind: 'void' | 'supersede';
  correctionEventId: string;
  replacement?: DiamondReplacement;
}>;

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function commandHash(command: DiamondCommand): string {
  return hashDiamondValue(command);
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

export function getEffectiveDiamondEvents(events: readonly DiamondEvent[]): readonly DiamondEffectiveEvent[] {
  const directives = getCorrectionDirectives(events);
  const effective: DiamondEffectiveEvent[] = [];
  events.forEach((event) => {
    if (event.type === 'void_event' || event.type === 'supersede_event') return;
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
  const directives = getCorrectionDirectives(events);
  let state = cloneDiamondState(initialState);
  const effectiveEvents: DiamondEffectiveEvent[] = [];

  events.forEach((event) => {
    const directive = directives.get(event.eventId);
    if (event.type === 'void_event' || event.type === 'supersede_event') {
      state = reduceDiamondEvent(state, asReducerAction(event.type, event.payload, event.eventId));
    } else if (directive?.kind === 'void') {
      // Its canonical record remains immutable, but its state effect is removed.
    } else if (directive?.kind === 'supersede' && directive.replacement) {
      state = reduceDiamondEvent(
        state,
        asReducerAction(directive.replacement.type, directive.replacement.payload, directive.correctionEventId)
      );
      effectiveEvents.push({
        eventId: directive.correctionEventId,
        sourceEventId: event.eventId,
        revision: event.revision,
        type: directive.replacement.type,
        payload: directive.replacement.payload,
        correctionEventId: directive.correctionEventId
      });
    } else {
      state = reduceDiamondEvent(state, asReducerAction(event.type, event.payload, event.eventId));
      effectiveEvents.push({
        eventId: event.eventId,
        sourceEventId: event.eventId,
        revision: event.revision,
        type: event.type,
        payload: event.payload
      });
    }
    state = setDiamondStateRevision(state, event.revision, event.hash);
  });

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

function validateEnvelope(ledger: DiamondLedger, command: DiamondCommand, context: DiamondCommandContext) {
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
  } else if (ledger.state.currentScorerUid !== actorUid) {
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

/**
 * Executes the ordinary hot path from one bounded checkpoint plus, when a retry
 * is possible, the one receipt stored at commands/{commandId}. Corrections need
 * full history because their validity depends on all later canonical plays.
 */
export function executeDiamondCommandFromCheckpoint(
  checkpoint: DiamondCheckpoint,
  command: DiamondCommand,
  context: DiamondCommandContext,
  existingReceipt?: DiamondCommandReceipt | null
): DiamondCheckpointExecution {
  try {
    validateCheckpoint(checkpoint);
    const incomingHash = commandHash(command);
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
          ...existingReceipt.result,
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
    validateEnvelope(syntheticLedger, command, context);
    if (command.expectedRevision !== checkpoint.sequence) {
      throw new DiamondDomainError(
        'stale-revision',
        `Expected revision ${String(command.expectedRevision)}, current revision is ${String(checkpoint.sequence)}.`,
        true
      );
    }
    if (command.type === 'void_event' || command.type === 'supersede_event') {
      throw new DiamondDomainError('history-required', 'Void and supersede commands require the complete canonical event history.', true);
    }

    const sequence = checkpoint.sequence + 1;
    const before = checkpoint.state;
    let after = reduceDiamondEvent(before, asReducerAction(command.type, command.payload, context.eventId));
    after = setDiamondStateRevision(after, sequence, '');
    let event = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      eventId: context.eventId,
      sequence,
      revision: sequence,
      commandId: command.commandId,
      commandHash: incomingHash,
      type: command.type,
      payload: command.payload,
      actorUid: context.actorUid,
      serverTimestampMs: context.serverTimestampMs,
      rulesProfileId: command.rulesProfileId,
      rulesProfileVersion: command.rulesProfileVersion,
      reducerVersion: DIAMOND_REDUCER_VERSION,
      statCatalogVersion: DIAMOND_STAT_CATALOG_VERSION,
      before,
      after,
      previousHash: checkpoint.previousHash,
      hash: ''
    } as DiamondEvent;
    const hash = hashEvent(event);
    after = setDiamondStateRevision(after, sequence, hash);
    event = deepFreeze({ ...event, after, hash } as DiamondEvent);
    const result: DiamondCommandResult = deepFreeze({
      outcome: 'accepted',
      revision: sequence,
      eventId: event.eventId,
      state: after
    });
    const receipt: DiamondCommandReceipt = deepFreeze({
      commandId: command.commandId,
      commandHash: incomingHash,
      event,
      result
    });
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
    const incomingHash = commandHash(command);
    const existing = ledger.events.find((event) => event.commandId === command.commandId);
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
          state: existing.after
        },
        event: existing
      };
    }

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
    after = setDiamondStateRevision(after, sequence, '');

    const partialEvent = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      eventId: context.eventId,
      sequence,
      revision: sequence,
      commandId: command.commandId,
      commandHash: incomingHash,
      type: command.type,
      payload: command.payload,
      actorUid: context.actorUid,
      serverTimestampMs: context.serverTimestampMs,
      rulesProfileId: command.rulesProfileId,
      rulesProfileVersion: command.rulesProfileVersion,
      reducerVersion: DIAMOND_REDUCER_VERSION,
      statCatalogVersion: DIAMOND_STAT_CATALOG_VERSION,
      ...(command.type === 'void_event' ? { voidsEventId: command.payload.targetEventId } : {}),
      ...(command.type === 'supersede_event' ? { supersedesEventId: command.payload.targetEventId } : {}),
      before,
      after,
      previousHash: ledger.events.length ? ledger.events[ledger.events.length - 1].hash : '',
      hash: ''
    } as DiamondEvent;

    if (command.type === 'void_event' || command.type === 'supersede_event') {
      const provisionalEvents = [...ledger.events, partialEvent];
      after = replayDiamondEvents(ledger.initialState, provisionalEvents, { verifyHashes: false }).state;
      after = setDiamondStateRevision(after, sequence, '');
    }

    let event = { ...partialEvent, after } as DiamondEvent;
    const hash = hashEvent(event);
    after = setDiamondStateRevision(after, sequence, hash);
    event = deepFreeze({ ...event, after, hash } as DiamondEvent);
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
