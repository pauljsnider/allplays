import { postLiveChatMessage as legacyPostLiveChatMessage, subscribeLiveChat as legacySubscribeLiveChat } from '@legacy/db.js';
import { isViewerChatEnabled as legacyIsViewerChatEnabled } from '@legacy/live-game-chat.js';

/**
 * Typed adapter boundary for the legacy js/ live-game chat helpers (#2066), so
 * liveGameChatService imports a typed surface instead of deep `../../../../js/*`.
 */
export type LegacyLiveChatPayload = {
  text: string;
  senderId: string | null;
  senderName: string;
  senderPhotoUrl: string | null;
  isAnonymous: boolean;
};

export type LegacyViewerChatOptions = {
  isReplay?: boolean;
  now?: Date;
};

export function postLiveChatMessage(teamId: string, gameId: string, payload: LegacyLiveChatPayload): Promise<unknown> {
  return Promise.resolve(legacyPostLiveChatMessage(teamId, gameId, payload));
}

export function subscribeLiveChat<T>(
  teamId: string,
  gameId: string,
  options: { limit?: number },
  callback: (messages: T) => void,
  onError?: (error: unknown) => void
): () => void {
  return legacySubscribeLiveChat(teamId, gameId, options, callback, onError);
}

export function isViewerChatEnabled(game: unknown, options?: LegacyViewerChatOptions): boolean {
  return legacyIsViewerChatEnabled(game, options) === true;
}
