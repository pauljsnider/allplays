import {
  functions,
  httpsCallable,
  subscribeDiamondLiveChat as subscribeDiamondLiveChatAdapter,
  subscribeDiamondLiveReactions as subscribeDiamondLiveReactionsAdapter,
} from './adapters/legacyDiamondLiveEngagement';
import { callNativeFirebaseFunction } from './nativeCallable';
import { isNativeRuntime } from './nativeRuntime';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIAMOND_INTERACTION_LIFECYCLES = new Set([
  'configured',
  'ready',
  'scheduled',
  'active',
  'suspended',
  'live',
  'in_progress',
  'in-progress',
  'final',
  'correction',
  'completed',
  'cancelled',
  'canceled',
  'deleted',
]);
const DIAMOND_TERMINAL_LIFECYCLES = new Set([
  'final',
  'correction',
  'completed',
  'cancelled',
  'canceled',
  'deleted',
]);

export type DiamondLiveEngagementIdentity = {
  teamId: string;
  gameId: string;
  instanceId: string;
  requestId: string;
};

export type DiamondLiveInteractionWindowIdentity = Omit<DiamondLiveEngagementIdentity, 'requestId'>;

function normalizeId(value: unknown, field: string) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > 128 || normalized.includes('/')) {
    throw new Error(`${field} is invalid.`);
  }
  return normalized;
}

function normalizeUuid(value: unknown, field: string) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID_V4_PATTERN.test(normalized)) throw new Error(`${field} is invalid.`);
  return normalized;
}

export function createDiamondLiveEngagementRequestId(
  cryptoSource: Pick<Crypto, 'randomUUID' | 'getRandomValues'> | null | undefined = globalThis.crypto,
) {
  if (typeof cryptoSource?.randomUUID === 'function') {
    const requestId = cryptoSource.randomUUID();
    if (UUID_V4_PATTERN.test(requestId)) return requestId.toLowerCase();
  }
  if (typeof cryptoSource?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoSource.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    if (UUID_V4_PATTERN.test(requestId)) return requestId;
  }
  throw new Error('Secure live-interaction identity is unavailable.');
}

function normalizeIdentity(identity: DiamondLiveEngagementIdentity) {
  return {
    teamId: normalizeId(identity.teamId, 'teamId'),
    gameId: normalizeId(identity.gameId, 'gameId'),
    instanceId: normalizeUuid(identity.instanceId, 'instanceId'),
    requestId: normalizeUuid(identity.requestId, 'requestId'),
  };
}

async function callDiamondLiveEngagement<T>(
  name: 'getPublicDiamondGame' | 'postDiamondLiveChat' | 'postDiamondLiveReaction' | 'moderateDiamondLiveChat',
  payload: Record<string, unknown>,
) {
  if (isNativeRuntime()) {
    return callNativeFirebaseFunction<T>(name, payload, {
      errorLabel: 'Diamond live engagement',
    });
  }
  return (await httpsCallable(functions, name)(payload))?.data as T;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

export async function loadDiamondLiveInteractionWindow(
  identity: DiamondLiveInteractionWindowIdentity,
) {
  const expected = {
    teamId: normalizeId(identity.teamId, 'teamId'),
    gameId: normalizeId(identity.gameId, 'gameId'),
    instanceId: normalizeUuid(identity.instanceId, 'instanceId'),
  };
  const response = requireRecord(await callDiamondLiveEngagement('getPublicDiamondGame', {
    teamId: expected.teamId,
    gameId: expected.gameId,
    limit: 1,
    cursor: null,
  }), 'The Diamond interaction window response is invalid.');
  if (response.instanceId !== expected.instanceId) {
    throw new Error('The Diamond game generation changed. Refresh before interacting.');
  }
  const game = requireRecord(response.game, 'The Diamond interaction window response is invalid.');
  const state = requireRecord(game.state, 'The Diamond interaction window response is invalid.');
  const lifecycle = state.status;
  if (
    game.trackingEngine !== 'diamond-v2'
    || typeof lifecycle !== 'string'
    || lifecycle !== lifecycle.trim()
    || lifecycle !== lifecycle.toLowerCase()
    || !DIAMOND_INTERACTION_LIFECYCLES.has(lifecycle)
    || typeof game.interactionWindowOpen !== 'boolean'
  ) {
    throw new Error('The Diamond interaction window response is invalid.');
  }
  if (DIAMOND_TERMINAL_LIFECYCLES.has(lifecycle)) return false;
  return game.interactionWindowOpen === true;
}

function validateResponse(
  response: unknown,
  identity: ReturnType<typeof normalizeIdentity>,
  resultField: 'messageId' | 'reactionId',
) {
  const value = response && typeof response === 'object'
    ? response as Record<string, unknown>
    : {};
  if (
    value.outcome !== 'accepted'
    || value.requestId !== identity.requestId
    || value.instanceId !== identity.instanceId
    || typeof value[resultField] !== 'string'
    || !value[resultField]
  ) {
    throw new Error('The server did not confirm the live interaction.');
  }
  return value;
}

export async function postDiamondLiveChat(
  identity: DiamondLiveEngagementIdentity,
  text: string,
) {
  const normalized = normalizeIdentity(identity);
  const normalizedText = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!normalizedText || normalizedText.length > 2000) {
    throw new Error('Enter a live-chat message of 2,000 characters or fewer.');
  }
  const response = await callDiamondLiveEngagement('postDiamondLiveChat', {
    schemaVersion: 1,
    requestId: normalized.requestId,
    teamId: normalized.teamId,
    gameId: normalized.gameId,
    expectedInstanceId: normalized.instanceId,
    viewerMode: 'live',
    text: normalizedText,
  });
  return validateResponse(response, normalized, 'messageId');
}

export async function postDiamondLiveReaction(
  identity: DiamondLiveEngagementIdentity,
  type: string,
) {
  const normalized = normalizeIdentity(identity);
  if (!['fire', 'clap', 'wow', 'heart', 'hundred'].includes(type)) {
    throw new Error('Choose a supported reaction.');
  }
  const response = await callDiamondLiveEngagement('postDiamondLiveReaction', {
    schemaVersion: 1,
    requestId: normalized.requestId,
    teamId: normalized.teamId,
    gameId: normalized.gameId,
    expectedInstanceId: normalized.instanceId,
    viewerMode: 'live',
    type,
  });
  return validateResponse(response, normalized, 'reactionId');
}

export async function moderateDiamondLiveChat(
  identity: DiamondLiveEngagementIdentity,
  messageId: string,
) {
  const normalized = normalizeIdentity(identity);
  const normalizedMessageId = normalizeId(messageId, 'messageId');
  if (!/^diamond-chat-[a-f0-9]{64}$/.test(normalizedMessageId)) {
    throw new Error('Live chat message identity is invalid.');
  }
  const response = await callDiamondLiveEngagement('moderateDiamondLiveChat', {
    schemaVersion: 1,
    requestId: normalized.requestId,
    teamId: normalized.teamId,
    gameId: normalized.gameId,
    expectedInstanceId: normalized.instanceId,
    messageId: normalizedMessageId,
  });
  const validated = validateResponse(response, normalized, 'messageId');
  if (validated.removed !== true || validated.messageId !== normalizedMessageId) {
    throw new Error('The server did not confirm live chat removal.');
  }
  return validated;
}

export function subscribeDiamondLiveChat<T>(
  teamId: string,
  gameId: string,
  instanceId: string,
  callback: (messages: T[]) => void,
  onError?: (error: unknown) => void,
) {
  return subscribeDiamondLiveChatAdapter<T>(
    normalizeId(teamId, 'teamId'),
    normalizeId(gameId, 'gameId'),
    normalizeUuid(instanceId, 'instanceId'),
    callback,
    onError,
  );
}

export function subscribeDiamondLiveReactions<T>(
  teamId: string,
  gameId: string,
  instanceId: string,
  callback: (reaction: T) => void,
  onError?: (error: unknown) => void,
) {
  return subscribeDiamondLiveReactionsAdapter<T>(
    normalizeId(teamId, 'teamId'),
    normalizeId(gameId, 'gameId'),
    normalizeUuid(instanceId, 'instanceId'),
    callback,
    onError,
  );
}
