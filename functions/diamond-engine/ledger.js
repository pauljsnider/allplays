"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEffectiveDiamondEvents = getEffectiveDiamondEvents;
exports.replayDiamondEvents = replayDiamondEvents;
exports.replayDiamondLedger = replayDiamondLedger;
exports.createDiamondLedger = createDiamondLedger;
exports.createDiamondCheckpoint = createDiamondCheckpoint;
exports.executeDiamondCommandFromCheckpoint = executeDiamondCommandFromCheckpoint;
exports.executeDiamondCommand = executeDiamondCommand;
exports.verifyDiamondLedger = verifyDiamondLedger;
exports.getDiamondCommandHash = getDiamondCommandHash;
const canonical_1 = require("./canonical");
const contracts_1 = require("./contracts");
const reducer_1 = require("./reducer");
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HISTORY_REQUIRED_COMMANDS = new Set([
    'record_fielding',
    'record_scoring_judgment',
    'void_event',
    'supersede_event'
]);
const ATTACHABLE_PLAY_TYPES = new Set(['record_plate_appearance', 'advance_runner']);
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach((child) => deepFreeze(child));
    }
    return value;
}
function requireId(value, label) {
    if (typeof value !== 'string')
        throw new contracts_1.DiamondDomainError('invalid-id', `${label} must be a string.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > 128 || normalized.includes('/')) {
        throw new contracts_1.DiamondDomainError('invalid-id', `${label} must be nonempty, slash-free, and at most 128 characters.`);
    }
    return normalized;
}
function commandHash(command) {
    return (0, canonical_1.hashDiamondValue)(command);
}
function stateForHash(state) {
    return { ...state, checkpointHash: '' };
}
function eventHashMaterial(event) {
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
function hashEvent(event) {
    return (0, canonical_1.hashDiamondValue)(eventHashMaterial(event));
}
function getCorrectionDirectives(events) {
    const eventIds = new Set();
    const directives = new Map();
    events.forEach((event) => {
        if (eventIds.has(event.eventId)) {
            throw new contracts_1.DiamondDomainError('duplicate-event-id', `Duplicate event ID ${event.eventId}.`);
        }
        eventIds.add(event.eventId);
        if (event.type !== 'void_event' && event.type !== 'supersede_event')
            return;
        const targetEventId = event.payload.targetEventId;
        if (!eventIds.has(targetEventId) || targetEventId === event.eventId) {
            throw new contracts_1.DiamondDomainError('invalid-correction-target', 'Corrections must target an earlier canonical event.');
        }
        if (directives.has(targetEventId)) {
            throw new contracts_1.DiamondDomainError('already-corrected', `Event ${targetEventId} already has a correction.`);
        }
        directives.set(targetEventId, event.type === 'void_event'
            ? { kind: 'void', correctionEventId: event.eventId }
            : {
                kind: 'supersede',
                correctionEventId: event.eventId,
                replacement: event.payload.replacement
            });
    });
    return directives;
}
function asReducerAction(type, payload, eventId) {
    return { type, payload, eventId };
}
function attachmentTargetsVoidedPlay(event, voidedEventIds) {
    if (event.type !== 'record_fielding' && event.type !== 'record_scoring_judgment')
        return false;
    const payload = event.payload;
    return voidedEventIds.has(payload.playEventId);
}
function getEffectiveDiamondEvents(events) {
    const directives = getCorrectionDirectives(events);
    const voidedEventIds = new Set([...directives.entries()]
        .filter(([, directive]) => directive.kind === 'void')
        .map(([eventId]) => eventId));
    const effective = [];
    events.forEach((event) => {
        if (event.type === 'void_event' || event.type === 'supersede_event')
            return;
        if (attachmentTargetsVoidedPlay(event, voidedEventIds))
            return;
        const directive = directives.get(event.eventId);
        if (directive?.kind === 'void')
            return;
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
function verifyEventChain(events) {
    let previousHash = '';
    events.forEach((event, index) => {
        const sequence = index + 1;
        if (event.sequence !== sequence || event.revision !== sequence) {
            throw new contracts_1.DiamondDomainError('event-gap', `Expected event sequence ${String(sequence)}.`);
        }
        if (event.previousHash !== previousHash) {
            throw new contracts_1.DiamondDomainError('hash-chain-mismatch', `Event ${event.eventId} has the wrong previous hash.`);
        }
        const expectedHash = hashEvent(event);
        if (event.hash !== expectedHash) {
            throw new contracts_1.DiamondDomainError('event-hash-mismatch', `Event ${event.eventId} failed hash verification.`);
        }
        previousHash = event.hash;
    });
}
function replayDiamondEvents(initialState, events, options = {}) {
    if (options.verifyHashes !== false)
        verifyEventChain(events);
    const directives = getCorrectionDirectives(events);
    const voidedEventIds = new Set([...directives.entries()]
        .filter(([, directive]) => directive.kind === 'void')
        .map(([eventId]) => eventId));
    let state = (0, reducer_1.cloneDiamondState)(initialState);
    const effectiveEvents = [];
    events.forEach((event) => {
        const directive = directives.get(event.eventId);
        if (event.type === 'void_event' || event.type === 'supersede_event') {
            state = (0, reducer_1.reduceDiamondEvent)(state, asReducerAction(event.type, event.payload, event.eventId));
        }
        else if (directive?.kind === 'void' || attachmentTargetsVoidedPlay(event, voidedEventIds)) {
            // Its canonical record remains immutable, but its state effect is removed.
        }
        else if (directive?.kind === 'supersede' && directive.replacement) {
            state = (0, reducer_1.reduceDiamondEvent)(state, asReducerAction(directive.replacement.type, directive.replacement.payload, directive.correctionEventId));
            effectiveEvents.push({
                eventId: directive.correctionEventId,
                sourceEventId: event.eventId,
                revision: event.revision,
                type: directive.replacement.type,
                payload: directive.replacement.payload,
                correctionEventId: directive.correctionEventId
            });
        }
        else {
            state = (0, reducer_1.reduceDiamondEvent)(state, asReducerAction(event.type, event.payload, event.eventId));
            effectiveEvents.push({
                eventId: event.eventId,
                sourceEventId: event.eventId,
                revision: event.revision,
                type: event.type,
                payload: event.payload
            });
        }
        state = (0, reducer_1.setDiamondStateRevision)(state, event.revision, event.hash);
    });
    return deepFreeze({
        state,
        effectiveEvents,
        checkpointHash: events.length ? events[events.length - 1].hash : '',
        complete: true
    });
}
function replayDiamondLedger(ledger, options = {}) {
    const replay = replayDiamondEvents(ledger.initialState, ledger.events, options);
    if (options.verifyHashes !== false && (0, canonical_1.canonicalDiamondJson)(replay.state) !== (0, canonical_1.canonicalDiamondJson)(ledger.state)) {
        throw new contracts_1.DiamondDomainError('checkpoint-state-mismatch', 'Replay state does not match the ledger checkpoint.');
    }
    return replay;
}
function createDiamondLedger(config) {
    const initialState = (0, reducer_1.createInitialDiamondState)(config);
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
function createDiamondCheckpoint(ledger) {
    if (ledger.state.revision !== ledger.events.length) {
        throw new contracts_1.DiamondDomainError('checkpoint-sequence-mismatch', 'Ledger revision and event sequence do not match.');
    }
    const previousHash = ledger.events.length ? ledger.events[ledger.events.length - 1].hash : '';
    if (ledger.state.checkpointHash !== previousHash) {
        throw new contracts_1.DiamondDomainError('checkpoint-hash-mismatch', 'Ledger state and event chain checkpoint hashes do not match.');
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
function validateEnvelope(ledger, command, context) {
    if (command.schemaVersion !== contracts_1.DIAMOND_SCHEMA_VERSION) {
        throw new contracts_1.DiamondDomainError('unsupported-schema', 'Only Diamond command schema version 2 is supported.');
    }
    if (!UUID_V4_PATTERN.test(command.commandId)) {
        throw new contracts_1.DiamondDomainError('invalid-command-id', 'commandId must be a cryptographically random UUID v4.');
    }
    requireId(context.eventId, 'eventId');
    const actorUid = requireId(context.actorUid, 'actorUid');
    if (!Number.isSafeInteger(context.serverTimestampMs) || context.serverTimestampMs < 0) {
        throw new contracts_1.DiamondDomainError('invalid-server-time', 'serverTimestampMs must be a nonnegative safe integer.');
    }
    if (command.teamId !== ledger.teamId || command.gameId !== ledger.gameId) {
        throw new contracts_1.DiamondDomainError('game-mismatch', 'The command does not belong to this team and game.');
    }
    if (command.rulesProfileId !== ledger.rulesProfileId || command.rulesProfileVersion !== ledger.rulesProfileVersion) {
        throw new contracts_1.DiamondDomainError('rules-profile-mismatch', 'The command does not use the game-pinned rules profile.');
    }
    if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
        throw new contracts_1.DiamondDomainError('invalid-revision', 'expectedRevision must be a nonnegative safe integer.');
    }
    if (command.type === 'activate') {
        if (command.payload.initialScorerUid !== actorUid) {
            throw new contracts_1.DiamondDomainError('scorer-mismatch', 'The activating actor must become the initial scorer.');
        }
    }
    else if (ledger.state.currentScorerUid !== actorUid) {
        throw new contracts_1.DiamondDomainError('scorer-lease-lost', 'Only the current scorer may submit this command.', true);
    }
    if (ledger.events.some((event) => event.eventId === context.eventId)) {
        throw new contracts_1.DiamondDomainError('duplicate-event-id', 'eventId already exists in this ledger.');
    }
}
function validateCorrection(ledger, command) {
    if (command.type !== 'void_event' && command.type !== 'supersede_event')
        return;
    const target = ledger.events.find((event) => event.eventId === command.payload.targetEventId);
    if (!target)
        throw new contracts_1.DiamondDomainError('unknown-correction-target', 'The correction target does not exist.');
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
        throw new contracts_1.DiamondDomainError('uncorrectable-event', `A ${target.type} event cannot be voided or superseded.`);
    }
    if (command.type === 'supersede_event' && uncorrectable.has(command.payload.replacement.type)) {
        throw new contracts_1.DiamondDomainError('invalid-replacement', 'A correction replacement must be a correctable scoring command.');
    }
    const directives = getCorrectionDirectives(ledger.events);
    if (directives.has(target.eventId)) {
        throw new contracts_1.DiamondDomainError('already-corrected', 'The target event already has a correction.');
    }
}
function lineupContainsPlayer(state, side, playerId) {
    const lineup = state.lineups[side];
    return lineup.battingOrder.some((slot) => slot.starterPlayerId === playerId ||
        slot.activePlayerId === playerId ||
        slot.substitutions.includes(playerId)) || Object.values(lineup.defense).includes(playerId);
}
function validateAttachment(ledger, command) {
    if (command.type !== 'record_fielding' && command.type !== 'record_scoring_judgment')
        return;
    const payload = command.payload;
    const effectiveEvents = getEffectiveDiamondEvents(ledger.events);
    const target = effectiveEvents.find((event) => event.eventId === payload.playEventId || event.sourceEventId === payload.playEventId);
    if (!target || !ATTACHABLE_PLAY_TYPES.has(target.type)) {
        throw new contracts_1.DiamondDomainError('unknown-play-target', 'Fielding and scoring judgments must cite an effective earlier play.');
    }
    if (command.type !== 'record_scoring_judgment')
        return;
    const scoringPayload = command.payload;
    if (!scoringPayload.pitcherOfRecord)
        return;
    const decision = scoringPayload.pitcherOfRecord;
    if (!lineupContainsPlayer(ledger.state, decision.side, decision.playerId)) {
        throw new contracts_1.DiamondDomainError('pitcher-not-in-lineup', 'A pitcher decision must name a player recorded in that side’s lineup.');
    }
    const duplicateDecision = effectiveEvents.some((event) => {
        if (event.type !== 'record_scoring_judgment')
            return false;
        const judgment = event.payload;
        return judgment.pitcherOfRecord?.decision === decision.decision;
    });
    if (duplicateDecision) {
        throw new contracts_1.DiamondDomainError('duplicate-pitcher-decision', `A ${decision.decision} decision is already recorded. Correct the earlier judgment instead.`);
    }
}
function reject(ledger, error) {
    const domainError = error instanceof contracts_1.DiamondDomainError
        ? error
        : new contracts_1.DiamondDomainError('invalid-command', error instanceof Error ? error.message : 'Invalid Diamond command.');
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
function rejectCheckpoint(checkpoint, error) {
    const domainError = error instanceof contracts_1.DiamondDomainError
        ? error
        : new contracts_1.DiamondDomainError('invalid-command', error instanceof Error ? error.message : 'Invalid Diamond command.');
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
function validateCheckpoint(checkpoint) {
    (0, reducer_1.validateDiamondState)(checkpoint.state);
    requireId(checkpoint.teamId, 'checkpoint.teamId');
    requireId(checkpoint.gameId, 'checkpoint.gameId');
    requireId(checkpoint.rulesProfileId, 'checkpoint.rulesProfileId');
    if (!Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0) {
        throw new contracts_1.DiamondDomainError('invalid-checkpoint-sequence', 'Checkpoint sequence must be a nonnegative safe integer.');
    }
    if (checkpoint.state.revision !== checkpoint.sequence) {
        throw new contracts_1.DiamondDomainError('checkpoint-sequence-mismatch', 'Checkpoint state revision does not match its sequence.');
    }
    if (checkpoint.state.checkpointHash !== checkpoint.previousHash) {
        throw new contracts_1.DiamondDomainError('checkpoint-hash-mismatch', 'Checkpoint state hash does not match previousHash.');
    }
    if (checkpoint.state.teamId !== checkpoint.teamId ||
        checkpoint.state.gameId !== checkpoint.gameId ||
        checkpoint.state.rulesProfileId !== checkpoint.rulesProfileId ||
        checkpoint.state.rulesProfileVersion !== checkpoint.rulesProfileVersion ||
        checkpoint.state.captureMode !== checkpoint.captureMode) {
        throw new contracts_1.DiamondDomainError('checkpoint-metadata-mismatch', 'Checkpoint metadata does not match its state.');
    }
    if (checkpoint.sequence === 0 && checkpoint.previousHash !== '') {
        throw new contracts_1.DiamondDomainError('checkpoint-hash-mismatch', 'An empty checkpoint cannot have a previous hash.');
    }
    if (checkpoint.sequence > 0 && !/^sha256:[0-9a-f]{64}$/.test(checkpoint.previousHash)) {
        throw new contracts_1.DiamondDomainError('checkpoint-hash-mismatch', 'Checkpoint previousHash is malformed.');
    }
}
function validateReceipt(receipt) {
    if (receipt.commandId !== receipt.event.commandId || receipt.commandHash !== receipt.event.commandHash) {
        throw new contracts_1.DiamondDomainError('invalid-command-receipt', 'Command receipt identity does not match its event.');
    }
    if (hashEvent(receipt.event) !== receipt.event.hash) {
        throw new contracts_1.DiamondDomainError('invalid-command-receipt', 'Command receipt event failed hash verification.');
    }
    if (receipt.result.outcome !== 'accepted' ||
        receipt.result.eventId !== receipt.event.eventId ||
        receipt.result.revision !== receipt.event.revision ||
        (0, canonical_1.canonicalDiamondJson)(receipt.result.state) !== (0, canonical_1.canonicalDiamondJson)(receipt.event.after)) {
        throw new contracts_1.DiamondDomainError('invalid-command-receipt', 'Command receipt result does not match its event.');
    }
}
/**
 * Executes the ordinary hot path from one bounded checkpoint plus, when a retry
 * is possible, the one receipt stored at commands/{commandId}. Corrections need
 * full history because their validity depends on all later canonical plays.
 */
function executeDiamondCommandFromCheckpoint(checkpoint, command, context, existingReceipt) {
    try {
        validateCheckpoint(checkpoint);
        const incomingHash = commandHash(command);
        if (existingReceipt) {
            validateReceipt(existingReceipt);
            if (existingReceipt.commandId !== command.commandId) {
                throw new contracts_1.DiamondDomainError('invalid-command-receipt', 'The supplied receipt belongs to another command.');
            }
            if (existingReceipt.commandHash !== incomingHash) {
                throw new contracts_1.DiamondDomainError('idempotency-conflict', 'commandId was already used with a different canonical command.');
            }
            return deepFreeze({
                checkpoint,
                result: {
                    ...existingReceipt.result,
                    outcome: 'duplicate'
                },
                event: existingReceipt.event,
                receipt: existingReceipt
            });
        }
        const syntheticLedger = {
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
            throw new contracts_1.DiamondDomainError('stale-revision', `Expected revision ${String(command.expectedRevision)}, current revision is ${String(checkpoint.sequence)}.`, true);
        }
        if (HISTORY_REQUIRED_COMMANDS.has(command.type)) {
            throw new contracts_1.DiamondDomainError('history-required', 'Corrections and play-linked scoring details require the complete canonical event history.', true);
        }
        const sequence = checkpoint.sequence + 1;
        const before = checkpoint.state;
        let after = (0, reducer_1.reduceDiamondEvent)(before, asReducerAction(command.type, command.payload, context.eventId));
        after = (0, reducer_1.setDiamondStateRevision)(after, sequence, '');
        let event = {
            schemaVersion: contracts_1.DIAMOND_SCHEMA_VERSION,
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
            reducerVersion: contracts_1.DIAMOND_REDUCER_VERSION,
            statCatalogVersion: contracts_1.DIAMOND_STAT_CATALOG_VERSION,
            before,
            after,
            previousHash: checkpoint.previousHash,
            hash: ''
        };
        const hash = hashEvent(event);
        after = (0, reducer_1.setDiamondStateRevision)(after, sequence, hash);
        event = deepFreeze({ ...event, after, hash });
        const result = deepFreeze({
            outcome: 'accepted',
            revision: sequence,
            eventId: event.eventId,
            state: after
        });
        const receipt = deepFreeze({
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
    }
    catch (error) {
        return rejectCheckpoint(checkpoint, error);
    }
}
function executeDiamondCommand(ledger, command, context) {
    try {
        const incomingHash = commandHash(command);
        const existing = ledger.events.find((event) => event.commandId === command.commandId);
        if (existing) {
            if (existing.commandHash !== incomingHash) {
                throw new contracts_1.DiamondDomainError('idempotency-conflict', 'commandId was already used with a different canonical command.');
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
            throw new contracts_1.DiamondDomainError('stale-revision', `Expected revision ${String(command.expectedRevision)}, current revision is ${String(ledger.state.revision)}.`, true);
        }
        validateCorrection(ledger, command);
        validateAttachment(ledger, command);
        const sequence = ledger.events.length + 1;
        const before = ledger.state;
        let after = (0, reducer_1.reduceDiamondEvent)(before, asReducerAction(command.type, command.payload, context.eventId));
        after = (0, reducer_1.setDiamondStateRevision)(after, sequence, '');
        const partialEvent = {
            schemaVersion: contracts_1.DIAMOND_SCHEMA_VERSION,
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
            reducerVersion: contracts_1.DIAMOND_REDUCER_VERSION,
            statCatalogVersion: contracts_1.DIAMOND_STAT_CATALOG_VERSION,
            ...(command.type === 'void_event' ? { voidsEventId: command.payload.targetEventId } : {}),
            ...(command.type === 'supersede_event' ? { supersedesEventId: command.payload.targetEventId } : {}),
            before,
            after,
            previousHash: ledger.events.length ? ledger.events[ledger.events.length - 1].hash : '',
            hash: ''
        };
        if (command.type === 'void_event' || command.type === 'supersede_event') {
            const provisionalEvents = [...ledger.events, partialEvent];
            after = replayDiamondEvents(ledger.initialState, provisionalEvents, { verifyHashes: false }).state;
            after = (0, reducer_1.setDiamondStateRevision)(after, sequence, '');
        }
        let event = { ...partialEvent, after };
        const hash = hashEvent(event);
        after = (0, reducer_1.setDiamondStateRevision)(after, sequence, hash);
        event = deepFreeze({ ...event, after, hash });
        const events = deepFreeze([...ledger.events, event]);
        const nextLedger = deepFreeze({ ...ledger, state: after, events });
        if (command.type === 'void_event' || command.type === 'supersede_event') {
            const replay = replayDiamondEvents(nextLedger.initialState, nextLedger.events);
            if ((0, canonical_1.canonicalDiamondJson)(replay.state) !== (0, canonical_1.canonicalDiamondJson)(nextLedger.state)) {
                throw new contracts_1.DiamondDomainError('checkpoint-state-mismatch', 'The accepted command did not replay to its checkpoint.');
            }
        }
        const result = deepFreeze({
            outcome: 'accepted',
            revision: sequence,
            eventId: event.eventId,
            state: after
        });
        return deepFreeze({ ledger: nextLedger, result, event });
    }
    catch (error) {
        return reject(ledger, error);
    }
}
function verifyDiamondLedger(ledger) {
    replayDiamondLedger(ledger);
    return true;
}
function getDiamondCommandHash(command) {
    return commandHash(command);
}
