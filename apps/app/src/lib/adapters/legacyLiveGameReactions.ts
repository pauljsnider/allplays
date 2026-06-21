import { sendReaction as legacySendReaction, subscribeReactions as legacySubscribeReactions } from '@legacy/db.js';
import { isViewerChatEnabled as legacyIsViewerChatEnabled } from '@legacy/live-game-chat.js';

/**
 * Typed adapter boundary for the legacy js/ live-game reaction helpers (#2066),
 * so liveGameReactionsService imports a typed surface instead of reaching deep
 * into untyped `../../../../js/*` modules.
 */
export type LegacyLiveGameReactionPayload = {
  type: string;
  senderId: string;
};

export type LegacyViewerChatOptions = {
  isReplay?: boolean;
  now?: Date;
};

export function sendReaction(teamId: string, gameId: string, payload: LegacyLiveGameReactionPayload): Promise<unknown> {
  return Promise.resolve(legacySendReaction(teamId, gameId, payload));
}

export function subscribeReactions<T>(
  teamId: string,
  gameId: string,
  callback: (reaction: T) => void,
  onError?: (error: unknown) => void
): () => void {
  return legacySubscribeReactions(teamId, gameId, callback, onError);
}

export function isViewerChatEnabled(game: unknown, options?: LegacyViewerChatOptions): boolean {
  return legacyIsViewerChatEnabled(game, options) === true;
}
