import { DiamondDomainError, type DiamondCommandType } from './contracts';

type Shape = true | 'replacement' | readonly [Shape] | { readonly [key: string]: Shape };
const scalarKeys = (...keys: string[]): Record<string, Shape> => Object.fromEntries(keys.map((key) => [key, true]));
const owns = (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key);
const credit = scalarKeys('countsRun', 'earned', 'rbi', 'responsiblePitcherId');
const advance = { ...credit, ...scalarKeys('to', 'cause', 'outKind') };
const fielding: Shape = {
  ...scalarKeys('putoutBy', 'passedBallBy', 'doublePlay', 'triplePlay', 'battedBall', 'location'),
  putouts: [scalarKeys('runnerId', 'putoutBy')],
  assists: [true],
  errors: [scalarKeys('playerId', 'kind')]
};
const shapes: Record<DiamondCommandType, Shape> = {
  activate: scalarKeys('initialScorerUid', 'captureMode'),
  set_lineup: { side: true, entries: [scalarKeys('slot', 'playerId', 'displayName', 'jerseyNumber', 'starter', 'battingRole')] },
  set_defensive_alignment: { side: true, assignments: [scalarKeys('playerId', 'position')] },
  set_dp_flex: scalarKeys('side', 'dpPlayerId', 'flexPlayerId', 'dpBattingSlot', 'flexDefensivePosition'),
  start: {},
  record_pitch: scalarKeys('pitcherId', 'batterId', 'result'),
  record_plate_appearance: {
    ...scalarKeys('batterId', 'pitcherId', 'result', 'outsOnPlay', 'runsBattedIn'),
    batterAdvance: advance,
    runnerAdvances: [{ ...advance, ...scalarKeys('runnerId', 'from') }],
    fielding,
    omissions: [true]
  },
  advance_runner: { ...advance, ...scalarKeys('runnerId', 'from'), fielding, omissions: [true] },
  record_fielding: { playEventId: true, fielding },
  record_scoring_judgment: {
    ...scalarKeys('playEventId', 'runnerId', 'earned', 'rbi', 'responsiblePitcherId'),
    pitcherOfRecord: scalarKeys('side', 'playerId', 'decision')
  },
  advance_half_inning: {},
  place_tiebreaker_runner: scalarKeys('side', 'runnerId', 'base', 'chargedToPitcherId'),
  substitute: scalarKeys('side', 'battingSlot', 'outgoingPlayerId', 'incomingPlayerId', 'defensivePosition'),
  re_enter: scalarKeys('side', 'battingSlot', 'starterPlayerId', 'replacedPlayerId', 'defensivePosition'),
  add_courtesy_runner: scalarKeys('side', 'forPlayerId', 'runnerId', 'base', 'forRole'),
  scorer_handoff: scalarKeys('toUid'),
  suspend: scalarKeys('reason'),
  resume: {},
  cancel: scalarKeys('confirmed', 'reason'),
  finalize: scalarKeys('confirmed'),
  reopen_for_correction: scalarKeys('reason'),
  private_note: scalarKeys('text', 'attachedEventId', 'visibility'),
  rules_decision: { ...scalarKeys('code', 'description'), affectedFamilies: [true] },
  void_event: scalarKeys('targetEventId', 'reason'),
  supersede_event: { ...scalarKeys('targetEventId', 'reason'), replacement: 'replacement' }
};

/** Runtime shape validation precedes hashing and persistence, including nested corrections. */
export function validateDiamondCommandPayload(type: DiamondCommandType, payload: unknown): void {
  let budget = 65536;
  const invalid = (): never => {
    throw new DiamondDomainError('invalid-command-payload', 'Command payload exceeds its bounded contract.');
  };
  const visit = (value: unknown, shape: Shape, depth: number): void => {
    budget -= 8;
    if (budget < 0 || depth > 12) invalid();
    if (value === undefined) {
      if (depth === 0) invalid();
      return;
    }
    if (shape === true) {
      if (typeof value === 'string') budget -= value.length * 3;
      else if (value !== null && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) invalid();
      if (budget < 0) invalid();
      return;
    }
    if (!value || typeof value !== 'object') invalid();
    if (Array.isArray(shape)) {
      if (!Array.isArray(value) || value.length > 1000) invalid();
      const items = value as unknown[];
      if (Reflect.ownKeys(items).length !== items.length + 1) invalid();
      for (let index = 0; index < items.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(items, String(index));
        if (!descriptor || !owns(descriptor, 'value') || descriptor.value === undefined) invalid();
        visit(descriptor!.value, shape[0], depth + 1);
      }
      return;
    }
    if (Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const object = value as Record<string, unknown>;
    const fields = shape === 'replacement' ? { type: true, payload: true } : shape;
    for (const ownKey of Reflect.ownKeys(object)) {
      if (typeof ownKey !== 'string') invalid();
      const key = ownKey as string;
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor?.enumerable || !owns(descriptor, 'value')) invalid();
      if (!owns(fields, key)) throw new DiamondDomainError('invalid-object', 'Command payload contains unsupported fields.');
      budget -= key.length * 3;
      if (shape === 'replacement' && key === 'payload') {
        const replacementType = object.type;
        if (
          typeof replacementType !== 'string' ||
          !owns(shapes, replacementType) ||
          replacementType === 'supersede_event' ||
          replacementType === 'void_event'
        )
          invalid();
        visit(object.payload, shapes[replacementType as DiamondCommandType], depth + 1);
      } else visit(object[key], (fields as Record<string, Shape>)[key], depth + 1);
    }
  };
  if (!owns(shapes, type)) invalid();
  visit(payload, shapes[type], 0);
}
