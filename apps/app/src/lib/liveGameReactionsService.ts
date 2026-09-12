import { isViewerChatEnabled, sendReaction, subscribeReactions } from './adapters/legacyLiveGameReactions';
import {
  createDiamondLiveEngagementRequestId,
  postDiamondLiveReaction,
  subscribeDiamondLiveReactions,
} from './diamondLiveEngagementService';
import type { AuthUser } from './types';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pendingDiamondReactionRequests = new Map<string, string>();

export type DiamondLiveReactionContext = {
  trackingEngine: 'diamond-v2';
  instanceId: string;
};

export const liveGameReactionOptions = [
  { key: 'fire', emoji: '🔥', label: 'Fire' },
  { key: 'clap', emoji: '👏', label: 'Clap' },
  { key: 'wow', emoji: '😲', label: 'Wow' },
  { key: 'heart', emoji: '❤️', label: 'Heart' },
  { key: 'hundred', emoji: '💯', label: 'Hundred' }
] as const;

export type LiveGameReactionType = typeof liveGameReactionOptions[number]['key'];

export type LiveGameReaction = {
  id: string;
  type: LiveGameReactionType;
  senderId?: string | null;
  createdAt?: unknown;
};

export type LiveGameReactionEligibilityGame = {
  date?: Date | string | { toDate: () => Date } | null;
  liveStatus?: string | null;
  status?: string | null;
};

export type LiveGameReactionPayload = {
  type: LiveGameReactionType;
  senderId: string;
};

const liveGameReactionTypeKeys = new Set<string>(liveGameReactionOptions.map((reaction) => reaction.key));

function compactString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function canUseLiveGameReactions(game: LiveGameReactionEligibilityGame | null | undefined, options?: { isReplay?: boolean; now?: Date }) {
  return isViewerChatEnabled({
    ...game,
    liveStatus: game?.liveStatus || (game?.status === 'live' ? 'live' : null)
  }, options);
}

export function getLiveGameReactionNotice(game: LiveGameReactionEligibilityGame | null | undefined, options?: { isReplay?: boolean; now?: Date }) {
  if (options?.isReplay) {
    return 'Live reactions are closed during replay.';
  }
  if (canUseLiveGameReactions(game, options)) {
    return null;
  }
  return 'Live reactions open on game day and close after the live window ends.';
}

export function buildLiveGameReactionPayload(input: {
  type: LiveGameReactionType;
  user?: AuthUser | null;
  senderId?: string | null;
}): LiveGameReactionPayload {
  if (!liveGameReactionTypeKeys.has(input.type)) {
    throw new Error('Choose a supported reaction.');
  }

  const senderId = compactString(input.user?.uid) || compactString(input.senderId);
  if (!senderId) {
    throw new Error('Sign in before reacting.');
  }

  return {
    type: input.type,
    senderId
  };
}

export function subscribeToLiveGameReactions(
  teamId: string,
  gameId: string,
  callback: (reaction: LiveGameReaction) => void,
  onError?: (error: unknown) => void,
  options?: { diamond?: DiamondLiveReactionContext | null }
) {
  if (options?.diamond) {
    return subscribeDiamondLiveReactions<LiveGameReaction>(
      teamId,
      gameId,
      options.diamond.instanceId,
      callback,
      onError
    );
  }
  return subscribeReactions(teamId, gameId, callback, onError);
}

export async function sendLiveGameReaction(
  teamId: string,
  gameId: string,
  input: {
    type: LiveGameReactionType;
    user?: AuthUser | null;
    senderId?: string | null;
    diamond?: DiamondLiveReactionContext | null;
  }
) {
  const payload = buildLiveGameReactionPayload(input);
  if (input.diamond) {
    if (!input.user?.uid) {
      throw new Error('Sign in before reacting to a Diamond game.');
    }
    const instanceId = compactString(input.diamond.instanceId).toLowerCase();
    if (
      input.diamond.trackingEngine !== 'diamond-v2'
      || !UUID_V4_PATTERN.test(instanceId)
    ) {
      throw new Error('The Diamond game generation is unavailable.');
    }
    const pendingKey = JSON.stringify([teamId, gameId, instanceId, payload.type]);
    const requestId = pendingDiamondReactionRequests.get(pendingKey)
      || createDiamondLiveEngagementRequestId();
    pendingDiamondReactionRequests.set(pendingKey, requestId);
    await postDiamondLiveReaction({ teamId, gameId, instanceId, requestId }, payload.type);
    if (pendingDiamondReactionRequests.get(pendingKey) === requestId) {
      pendingDiamondReactionRequests.delete(pendingKey);
    }
    return payload;
  }
  await sendReaction(teamId, gameId, payload);
  return payload;
}
