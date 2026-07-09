import { useCallback, useEffect, useState } from 'react';
import {
  loadChatConversations,
  loadChatTeamContext,
  type ChatConversation,
  type ChatTeam
} from '../../../lib/chatService';
import { DEFAULT_TEAM_CONVERSATION_ID, isDefaultTeamConversation } from '../../../lib/chatLogic';
import type { AuthState } from '../../../lib/types';

type UseChatTeamParams = {
  teamId: string;
  user: AuthState['user'];
  inboxTeam?: ChatTeam;
  preferredConversationId?: string;
  onTeamReset?: () => void;
};

export function useChatTeam({ teamId, user, inboxTeam, preferredConversationId = '', onTeamReset }: UseChatTeamParams) {
  const [team, setTeam] = useState<Record<string, any> | null>(inboxTeam || null);
  const [profile, setProfile] = useState<Record<string, any>>({});
  const [canModerate, setCanModerate] = useState(inboxTeam?.canModerate || false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>(DEFAULT_TEAM_CONVERSATION_ID);
  const [loadingContext, setLoadingContext] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadContext() {
      if (!user) return;
      const nextConversationId = preferredConversationId || DEFAULT_TEAM_CONVERSATION_ID;
      const shouldBlockOnConversationHydration = !isDefaultTeamConversation(nextConversationId);
      setLoadingContext(true);
      setError(null);
      setConversations([]);
      setSelectedConversationId(nextConversationId);
      onTeamReset?.();

      try {
        const context = await loadChatTeamContext(teamId, user);
        if (cancelled) return;
        setTeam(context.team);
        setProfile(context.profile);
        setCanModerate(context.canModerate);
        if (!shouldBlockOnConversationHydration) {
          setLoadingContext(false);
        }

        try {
          const loadedConversations = await loadChatConversations(teamId, user, context.team, context.canModerate, {
            activeConversationId: nextConversationId
          });
          if (cancelled) return;
          setConversations(loadedConversations);
          setSelectedConversationId((current: string) => {
            if (loadedConversations.some((conversation) => conversation.id === current)) {
              return current;
            }
            if (preferredConversationId && loadedConversations.some((conversation) => conversation.id === preferredConversationId)) {
              return preferredConversationId;
            }
            return DEFAULT_TEAM_CONVERSATION_ID;
          });
          setLoadingContext(false);
        } catch {
          if (!cancelled) {
            setConversations([]);
            setLoadingContext(false);
          }
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setError(loadError?.message || 'Unable to load team chat.');
          setLoadingContext(false);
        }
      }
    }

    loadContext();
    return () => {
      cancelled = true;
    };
  }, [onTeamReset, preferredConversationId, teamId, user?.uid]);

  const reloadConversations = useCallback(async () => {
    if (!user || !team) return undefined;
    const loadedConversations = await loadChatConversations(teamId, user, team, canModerate, {
      activeConversationId: selectedConversationId
    });
    setConversations(loadedConversations);
    return loadedConversations;
  }, [canModerate, selectedConversationId, team, teamId, user]);

  const switchConversation = useCallback((conversationId: string) => {
    if (!conversationId || selectedConversationId === conversationId) return false;
    setSelectedConversationId(conversationId);
    return true;
  }, [selectedConversationId]);

  return {
    team,
    profile,
    canModerate,
    conversations,
    setConversations,
    selectedConversationId,
    setSelectedConversationId,
    loadingContext,
    error,
    setError,
    reloadConversations,
    switchConversation
  };
}
