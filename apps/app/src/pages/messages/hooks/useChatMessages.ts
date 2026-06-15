import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadOlderTeamChatMessages,
  subscribeToTeamChatMessages,
  type ChatMessage
} from '../../../lib/chatService';
import { getSortedChatMessages, mergeChatMessageLists } from '../../../lib/chatLogic';
import type { AuthState } from '../../../lib/types';

type UseChatMessagesParams = {
  teamId: string;
  team: Record<string, any> | null;
  user: AuthState['user'];
  selectedConversationId: string;
  onBeforeLiveUpdate?: () => boolean;
  onLiveUpdateState?: (state: { isInitialSnapshot: boolean; wasNearBottom: boolean }) => void;
  onMessagesReset?: () => void;
  onMarkRead?: () => void;
};

export function useChatMessages({
  teamId,
  team,
  user,
  selectedConversationId,
  onBeforeLiveUpdate,
  onLiveUpdateState,
  onMessagesReset,
  onMarkRead
}: UseChatMessagesParams) {
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [liveOldestDoc, setLiveOldestDoc] = useState<unknown | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialSnapshotLoadedRef = useRef(false);

  const messages = useMemo(() => mergeChatMessageLists(olderMessages, liveMessages), [liveMessages, olderMessages]);

  useEffect(() => {
    if (!team || !user) return undefined;

    setLoadingMessages(true);
    setError(null);
    setOlderMessages([]);
    setLiveMessages([]);
    setLiveOldestDoc(null);
    setHasMoreMessages(false);
    initialSnapshotLoadedRef.current = false;
    onMessagesReset?.();

    const subscription = subscribeToTeamChatMessages(
      teamId,
      selectedConversationId,
      (incomingMessages, oldestDoc) => {
        const isInitialSnapshot = !initialSnapshotLoadedRef.current;
        const wasNearBottom = onBeforeLiveUpdate?.() ?? true;
        setLiveOldestDoc(oldestDoc || incomingMessages[incomingMessages.length - 1]?._doc || null);
        setLiveMessages(getSortedChatMessages(incomingMessages));
        setHasMoreMessages(incomingMessages.length >= 50);
        setLoadingMessages(false);
        onLiveUpdateState?.({ isInitialSnapshot, wasNearBottom });
        initialSnapshotLoadedRef.current = true;
        onMarkRead?.();
      },
      (subscribeError) => {
        setError(subscribeError.message || 'Unable to load chat messages.');
        setLoadingMessages(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [onBeforeLiveUpdate, onLiveUpdateState, onMarkRead, onMessagesReset, selectedConversationId, team, teamId, user]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMoreMessages) return;
    const cursor = olderMessages[0]?._doc || liveOldestDoc;
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const batch = await loadOlderTeamChatMessages(teamId, selectedConversationId, cursor);
      if (batch.length < 50) setHasMoreMessages(false);
      setOlderMessages((current) => mergeChatMessageLists(getSortedChatMessages(batch), current));
    } catch (loadError: any) {
      throw loadError;
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMoreMessages, liveOldestDoc, loadingOlder, olderMessages, selectedConversationId, teamId]);

  return {
    liveMessages,
    olderMessages,
    messages,
    liveOldestDoc,
    hasMoreMessages,
    loadingMessages,
    loadingOlder,
    error,
    setError,
    loadOlderMessages,
    initialSnapshotLoadedRef
  };
}
