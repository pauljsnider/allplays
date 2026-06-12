import { sendReaction, subscribeReactions } from '../../../../js/db.js';
import { isViewerChatEnabled } from '../../../../js/live-game-chat.js';
import type { AuthUser } from './types';

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

  const senderId = compactString(input.user?.uid);
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
  onError?: (error: unknown) => void
) {
  return subscribeReactions(teamId, gameId, callback, onError);
}

export async function sendLiveGameReaction(
  teamId: string,
  gameId: string,
  input: {
    type: LiveGameReactionType;
    user?: AuthUser | null;
    senderId?: string | null;
  }
) {
  const payload = buildLiveGameReactionPayload(input);
  await sendReaction(teamId, gameId, payload);
  return payload;
}
