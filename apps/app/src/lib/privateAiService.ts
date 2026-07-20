import {
  addDoc,
  collection,
  db,
  doc,
  getAI,
  getApp,
  getDoc,
  getDocs,
  getGenerativeModel,
  getUserProfile,
  GoogleAIBackend,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from './adapters/legacyPrivateAi';
import {
  getChatInboxPreview,
  loadChatConversations,
  loadChatInbox,
  sendTeamChatMessage
} from './chatService';
import { searchHelpKnowledge } from './helpKnowledgeService';
import { loadParentHome } from './homeService';
import { createLogger } from './logger';
import {
  createParentFamilyShare,
  createParentHouseholdMemberInvite,
  discoverParentAccessTeams,
  loadFamilyShareModel,
  loadParentAccessModel,
  loadParentAccessPlayers,
  loadParentCertificates,
  loadParentFeesForApp,
  loadParentHouseholdInviteModel,
  loadParentRegistrations,
  revokeParentFamilyShare,
  submitParentAccessRequest,
  updateParentFamilyShareCalendars
} from './parentToolsService';
import {
  loadParentPlayerDetailWithAthleteProfile,
  loadParentPlayerStatTotals,
  loadParentPlayerVideoClips,
  markParentPlayerIncentivePaid,
  retireParentPlayerIncentiveRule,
  saveParentPlayerIncentiveCap,
  saveParentPlayerIncentiveRule,
  toggleParentPlayerIncentiveRule,
  updateParentPlayerEditableProfile
} from './playerService';
import {
  formatEventDateLabel,
  formatEventTimeLabel,
  getOpenScheduleAssignments,
  getScheduleTitle,
  normalizeScheduleDate,
  normalizeRsvpResponse,
  type ParentScheduleEvent
} from './scheduleLogic';
import {
  cancelParentScheduleRideRequest,
  claimParentScheduleAssignmentSlot,
  createParentScheduleRideOffer,
  loadParentPracticePacket,
  loadParentSchedule,
  loadParentScheduleAssignments,
  loadParentScheduleEventDetail,
  loadParentScheduleRideOffers,
  markParentPracticePacketComplete,
  requestParentScheduleRideSpot,
  releaseParentScheduleAssignmentClaim,
  setParentScheduleRideOfferStatus,
  submitParentScheduleRsvp,
  submitParentScheduleRsvpForChildren,
  summarizeParentScheduleRideOffers
} from './scheduleService';
import { loadParentTeamDetail } from './teamDetailService';
import type { AuthUser } from './types';

export type PrivateAiRole = 'user' | 'assistant';

export type PrivateAiMessage = {
  id: string;
  role: PrivateAiRole;
  text: string;
  createdAt: Date;
  conversationId?: string;
  toolNames?: string[];
  error?: boolean;
};

export type PrivateAiConversation = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessagePreview?: string;
};

export type PrivateAiToolCall = {
  name: string;
  args?: Record<string, unknown>;
};

export type PrivateAiToolResult = {
  name: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  requiresConfirmation?: boolean;
  confirmationId?: string;
};

export type PrivateAiSendResult = {
  userMessage: PrivateAiMessage;
  assistantMessage: PrivateAiMessage;
  toolResults: PrivateAiToolResult[];
};

const privateAiCollectionName = 'privateAiMessages';
const privateAiConversationCollectionName = 'privateAiConversations';
const privateAiPendingActionCollectionName = 'privateAiPendingActions';
const logger = createLogger('private-ai');
export const DEFAULT_PRIVATE_AI_CONVERSATION_ID = 'default';
export const DRAFT_PRIVATE_AI_CONVERSATION_ID = '__draft__';
const maxLoadedMessages = 80;
const maxHistoryMessages = 12;
const maxToolRounds = 2;
const maxToolCallsPerRound = 3;
const maxPromptCharacters = 1800;
const maxAnswerCharacters = 2400;
const confirmationIdPrefix = 'ai';

let aiModelCache: any = null;
const pendingActionMemory = new Map<string, PrivateAiPendingAction>();

type PrivateAiToolMode = 'read' | 'write';

type PrivateAiPendingAction = {
  id: string;
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  createdAt: string;
  conversationId?: string;
  confirmationGroupId?: string;
};

type PrivateAiToolDefinition = {
  name: string;
  mode: PrivateAiToolMode;
  description: string;
  aliases?: string[];
  resolve: (user: AuthUser, args: Record<string, unknown>) => Promise<unknown>;
};

type PrivateAiToolContext = {
  conversationId?: string;
  confirmationGroupId?: string;
};

export function resetPrivateAiModel() {
  aiModelCache = null;
  pendingActionMemory.clear();
}

export async function loadPrivateAiConversations(user: AuthUser | null, conversationLimit = 30): Promise<PrivateAiConversation[]> {
  if (!user?.uid) return [];

  const [conversationSnapshot, messages] = await Promise.all([
    getDocs(query(
      collection(db, 'users', user.uid, privateAiConversationCollectionName),
      orderBy('updatedAt', 'desc'),
      limit(conversationLimit)
    )),
    loadPrivateAiMessageRecords(user, maxLoadedMessages).catch(() => [])
  ]);

  const storedConversations = (conversationSnapshot.docs || [])
    .map((document: any) => normalizePrivateAiConversation(document.id, document.data?.() || {}))
    .filter((conversation: PrivateAiConversation | null): conversation is PrivateAiConversation => Boolean(conversation));
  const recoveredConversations = recoverPrivateAiConversations(messages)
    .filter((conversation) => conversation.id !== DEFAULT_PRIVATE_AI_CONVERSATION_ID || storedConversations.length === 0);
  const conversationsById = new Map(
    recoveredConversations.map((conversation) => [conversation.id, conversation])
  );

  storedConversations.forEach((conversation: PrivateAiConversation) => conversationsById.set(conversation.id, conversation));
  return Array.from(conversationsById.values())
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

export async function createPrivateAiConversation(user: AuthUser | null, title = 'New chat'): Promise<PrivateAiConversation> {
  if (!user?.uid) {
    throw new Error('Sign in before starting an AI chat.');
  }

  const createdAt = new Date();
  const cleanTitle = compactText(title).slice(0, 80) || 'New chat';
  const payload = {
    title: cleanTitle,
    lastMessagePreview: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    clientCreatedAt: createdAt.toISOString(),
    clientUpdatedAt: createdAt.toISOString()
  };
  const document = await addDoc(collection(db, 'users', user.uid, privateAiConversationCollectionName), payload);
  return {
    id: document.id,
    title: cleanTitle,
    createdAt,
    updatedAt: createdAt,
    lastMessagePreview: ''
  };
}

export async function loadPrivateAiMessages(
  user: AuthUser | null,
  messageLimit = maxLoadedMessages,
  conversationId = DEFAULT_PRIVATE_AI_CONVERSATION_ID
): Promise<PrivateAiMessage[]> {
  if (!user?.uid) return [];

  const activeConversationId = normalizeConversationId(conversationId);
  const messages = await loadPrivateAiMessageRecords(user, Math.max(messageLimit, maxLoadedMessages));

  return messages
    .filter((message: PrivateAiMessage) => messageBelongsToConversation(message, activeConversationId))
    .reverse();
}

async function loadPrivateAiMessageRecords(user: AuthUser, messageLimit: number): Promise<PrivateAiMessage[]> {
  const snapshot = await getDocs(query(
    collection(db, 'users', user.uid, privateAiCollectionName),
    orderBy('createdAt', 'desc'),
    limit(messageLimit)
  ));

  return (snapshot.docs || [])
    .map((document: any) => normalizePrivateAiMessage(document.id, document.data?.() || {}))
    .filter((message: PrivateAiMessage | null): message is PrivateAiMessage => Boolean(message));
}

export async function sendPrivateAiMessage(
  user: AuthUser,
  prompt: string,
  conversationId = DEFAULT_PRIVATE_AI_CONVERSATION_ID
): Promise<PrivateAiSendResult> {
  if (!user?.uid) {
    throw new Error('Sign in before using the AI chat.');
  }

  const question = compactText(prompt).slice(0, maxPromptCharacters);
  if (!question) {
    throw new Error('Type a message first.');
  }

  const requestedConversationId = normalizeConversationId(conversationId);
  const isDraftConversation = requestedConversationId === DRAFT_PRIVATE_AI_CONVERSATION_ID;
  const activeConversationId = isDraftConversation
    ? await createPrivateAiConversation(user, buildConversationTitle(question)).then((conversation) => conversation.id)
    : requestedConversationId;
  const priorMessages = isDraftConversation
    ? []
    : await loadPrivateAiMessages(user, maxHistoryMessages, activeConversationId).catch(() => []);
  const userMessage = await savePrivateAiMessage(user, {
    role: 'user',
    text: question,
    conversationId: activeConversationId
  });
  await touchPrivateAiConversation(user, activeConversationId, {
    title: buildConversationTitle(question),
    lastMessagePreview: question
  }).catch(() => {});

  try {
    const aiResult = await generatePrivateAiAnswer(user, question, priorMessages, {
      conversationId: activeConversationId
    });
    const assistantMessage = await savePrivateAiMessage(user, {
      role: 'assistant',
      text: aiResult.answer,
      conversationId: activeConversationId,
      toolNames: aiResult.toolResults.filter((result) => result.ok).map((result) => result.name)
    });
    await touchPrivateAiConversation(user, activeConversationId, {
      title: buildConversationTitle(question),
      lastMessagePreview: aiResult.answer
    }).catch(() => {});

    return {
      userMessage,
      assistantMessage,
      toolResults: aiResult.toolResults
    };
  } catch (error: any) {
    logger.warn('Unable to generate answer.', { error });
    const assistantMessage = await savePrivateAiMessage(user, {
      role: 'assistant',
      text: 'I could not reach ALL PLAYS AI right now. Try again in a moment.',
      conversationId: activeConversationId,
      error: true
    });
    await touchPrivateAiConversation(user, activeConversationId, {
      title: buildConversationTitle(question),
      lastMessagePreview: assistantMessage.text
    }).catch(() => {});

    return {
      userMessage,
      assistantMessage,
      toolResults: []
    };
  }
}

export async function generatePrivateAiAnswer(
  user: AuthUser,
  question: string,
  priorMessages: PrivateAiMessage[] = [],
  context: PrivateAiToolContext = {}
): Promise<{ answer: string; toolResults: PrivateAiToolResult[] }> {
  const naturalConfirmation = isNaturalConfirmation(question);
  const explicitConfirmationId = parseConfirmationId(question);
  const confirmedActionIds = explicitConfirmationId
    ? [explicitConfirmationId]
    : naturalConfirmation
      ? await resolvePendingActionIdsForNaturalConfirmation(user, priorMessages, context)
      : [];
  if (confirmedActionIds.length) {
    const confirmationResults = await Promise.all(confirmedActionIds.map((id) => executeConfirmedPrivateAiAction(user, id)));
    const failedResult = confirmationResults.find((result) => !result.ok);
    return {
      answer: failedResult
        ? `I could not complete that confirmed action: ${failedResult.error || 'Action failed.'}`
        : `Confirmed. ${summarizeExecutedActions(confirmationResults)}`,
      toolResults: confirmationResults
    };
  }
  if (naturalConfirmation) {
    return {
      answer: 'I do not have a pending change to confirm. Tell me what you want updated and I will stage it for approval.',
      toolResults: []
    };
  }

  const model = await getPrivateAiModel();
  const history = summarizeChatHistory(priorMessages);
  const toolResults: PrivateAiToolResult[] = [];
  const confirmationGroupId = createConfirmationGroupId();
  const toolContext = {
    ...context,
    confirmationGroupId
  };
  if (looksLikeFunctionalHelpQuestion(question)) {
    toolResults.push(await runPrivateAiTool(user, {
      name: 'get_help',
      args: {
        query: question,
        limit: 5
      }
    }, toolContext));
  }
  if (looksLikeLastGameQuestion(question)) {
    toolResults.push(await runPrivateAiTool(user, {
      name: 'get_last_game',
      args: {}
    }, toolContext));
  }
  let plannerInput = buildPlannerPrompt({ user, question, history, toolResults });

  for (let round = 0; round < maxToolRounds; round += 1) {
    const plannerText = await generateModelText(model, plannerInput);
    const planner = parsePrivateAiPlannerResponse(plannerText);

    if (planner.answer && !planner.toolCalls.length) {
      return {
        answer: clampAnswer(planner.answer),
        toolResults
      };
    }

    const calls = planner.toolCalls.slice(0, maxToolCallsPerRound);
    if (!calls.length) {
      return {
        answer: clampAnswer(plannerText || 'I need a little more information to answer that.'),
        toolResults
      };
    }

    const roundResults = await Promise.all(calls.map((call) => runPrivateAiTool(user, call, toolContext)));
    toolResults.push(...roundResults);
    plannerInput = buildPlannerPrompt({ user, question, history, toolResults });
  }

  const finalPrompt = buildFinalAnswerPrompt({ user, question, history, toolResults });
  const finalText = await generateModelText(model, finalPrompt);
  const parsed = parsePrivateAiPlannerResponse(finalText);
  return {
    answer: clampAnswer(parsed.answer || finalText || 'I found data, but I could not format an answer.'),
    toolResults
  };
}

export function parsePrivateAiPlannerResponse(text: string): { answer: string; toolCalls: PrivateAiToolCall[] } {
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return { answer: compactText(text), toolCalls: [] };
  }

  const answer = compactText(parsed.answer);
  const rawCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
  const toolCalls = rawCalls
    .map((call: any) => ({
      name: compactText(call?.name),
      args: isPlainObject(call?.args) ? call.args : {}
    }))
    .filter((call: PrivateAiToolCall) => Boolean(call.name));

  return { answer, toolCalls };
}

export async function runPrivateAiTool(user: AuthUser, call: PrivateAiToolCall, context: PrivateAiToolContext = {}): Promise<PrivateAiToolResult> {
  const name = compactText(call.name);
  const args = isPlainObject(call.args) ? call.args : {};
  const definition = getPrivateAiToolDefinition(name);

  try {
    if (!definition) {
      return { name, ok: false, error: `Unsupported tool: ${name}` };
    }

    if (definition.mode === 'write' && args.__confirmed !== true) {
      const pending = await savePrivateAiPendingAction(user, definition, args, context);
      return {
        name,
        ok: true,
        requiresConfirmation: true,
        confirmationId: pending.id,
        data: {
          summary: pending.summary,
          confirmationText: 'Reply "yes" to apply this change.'
        }
      };
    }

    const data = await definition.resolve(user, args);
    if (definition.mode === 'write') {
      await savePrivateAiActionAudit(user, definition.name, args, data).catch(() => {});
    }
    return {
      name,
      ok: true,
      data
    };
  } catch (error: any) {
    return {
      name,
      ok: false,
      error: error?.message || 'Tool failed.'
    };
  }
}

const privateAiToolDefinitions: PrivateAiToolDefinition[] = [
  {
    name: 'get_profile',
    mode: 'read',
    description: 'Account profile, roles, notification preferences, linked teams, and linked players.',
    resolve: async (user) => summarizeProfile(user, await getUserProfile(user.uid).catch(() => null))
  },
  {
    name: 'get_home',
    mode: 'read',
    description: 'Parent dashboard tasks, players, teams, next events, unread messages, packets, fees, and priority actions.',
    aliases: ['list_tasks'],
    resolve: async (user) => summarizeHome(await loadParentHome(user))
  },
  {
    name: 'list_schedule',
    mode: 'read',
    description: 'Schedule events with RSVP, rideshare, assignments, score, location, and player context.',
    aliases: ['get_schedule'],
    resolve: async (user, args) => {
      const range = compactText(args.range).toLowerCase();
      return summarizeSchedule(await loadParentSchedule(user, {
        includePastGames: range === 'all'
      }), args);
    }
  },
  {
    name: 'get_last_game',
    mode: 'read',
    description: 'Most recent past game for the parent account, including RSVP status. Args: teamId, teamName, playerId, childId, playerName, childName.',
    aliases: ['last_game', 'get_previous_game'],
    resolve: async (user, args) => summarizeLastGame(await loadParentSchedule(user, {
      includePastGames: true
    }), args)
  },
  {
    name: 'get_schedule_event',
    mode: 'read',
    description: 'One schedule event with detail context. Args: eventId, teamId, playerName, teamName.',
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, args);
      if (!event) throw new Error('No matching event was found for this account.');
      const detail = await loadParentScheduleEventDetail(user, {
        teamId: event.teamId,
        eventId: event.id,
        childId: event.childId,
        eventType: event.type
      } as any).catch(() => null);
      return {
        event: summarizeScheduleEvent(event),
        childEvents: (detail?.events || []).slice(0, 8).map(summarizeScheduleEvent)
      };
    }
  },
  {
    name: 'list_rsvps',
    mode: 'read',
    description: 'RSVP status and summaries for schedule events.',
    resolve: async (user, args) => {
      const schedule = await loadParentSchedule(user, { includePastGames: compactText(args.range).toLowerCase() === 'all' });
      return {
        events: summarizeSchedule(schedule, args).events.map((event: any) => pickFields(event, [
          'eventId',
          'teamId',
          'teamName',
          'title',
          'childId',
          'childName',
          'date',
          'dateLabel',
          'timeLabel',
          'myRsvp',
          'rsvpSummary'
        ]))
      };
    }
  },
  {
    name: 'list_ride_offers',
    mode: 'read',
    description: 'Rideshare offers and requests for one event. Args: eventId, teamId, playerName, teamName.',
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, args);
      if (!event) throw new Error('No matching event was found for this account.');
      const offers = await loadParentScheduleRideOffers(event);
      return {
        event: summarizeScheduleEvent(event),
        summary: summarizeParentScheduleRideOffers(offers),
        offers: offers.slice(0, 20).map(summarizeRideOffer)
      };
    }
  },
  {
    name: 'list_assignments',
    mode: 'read',
    description: 'Volunteer/task assignments for one schedule event. Args: eventId, teamId, playerName, teamName.',
    aliases: ['get_assignments', 'list_tasks_for_event'],
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, args);
      if (!event) throw new Error('No matching event was found for this account.');
      const assignments = await loadParentScheduleAssignments(event);
      return {
        event: summarizeScheduleEvent(event),
        assignments: assignments.map(summarizeAssignment)
      };
    }
  },
  {
    name: 'get_practice_packet',
    mode: 'read',
    description: 'Parent practice/home packet details and completion status for a practice. Args: eventId, teamId, playerName, teamName.',
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, buildPracticePacketEventArgs(args));
      if (!event) throw new Error('No matching practice was found for this account.');
      const packet = await loadPracticePacketForAi(user, event);
      if (!packet) throw new Error('No practice packet was found for this practice.');
      return summarizePracticePacket(packet);
    }
  },
  {
    name: 'get_messages',
    mode: 'read',
    description: 'Team chat inbox, unread counts, and latest previews.',
    resolve: async (user) => summarizeMessages(await loadChatInbox(user))
  },
  {
    name: 'list_message_threads',
    mode: 'read',
    description: 'Message conversations/threads for an accessible team. Args: teamId or teamName.',
    aliases: ['get_message_threads'],
    resolve: async (user, args) => {
      const teamId = await resolveAccessibleTeamId(user, args);
      if (!teamId) throw new Error('No matching team was found for this account.');
      const detail = await loadParentTeamDetail(teamId, user);
      const conversations = await loadChatConversations(teamId, user, detail.team || { id: teamId }, Boolean(detail.canManageTeam), {
        activeConversationId: compactText(args.conversationId) || null
      });
      return summarizeMessageThreads(teamId, detail.team, conversations);
    }
  },
  {
    name: 'get_team_detail',
    mode: 'read',
    description: 'Accessible team detail, roster sample, upcoming events, recent results, leaderboards, and tracking summaries.',
    aliases: ['get_teams'],
    resolve: async (user, args) => {
      const teamId = await resolveAccessibleTeamId(user, args);
      if (!teamId) throw new Error('No matching team was found for this account.');
      return summarizeTeamDetail(await loadParentTeamDetail(teamId, user));
    }
  },
  {
    name: 'get_player_stats',
    mode: 'read',
    description: 'Linked player profile, recent game stats/data, tracking, incentives, certificates, clips, and development context.',
    aliases: ['get_player_development', 'get_players'],
    resolve: async (user, args) => summarizePlayerDevelopment(await loadPlayerDetailForAi(user, args))
  },
  {
    name: 'get_fees',
    mode: 'read',
    description: 'Parent fee records, balances, statuses, due dates, line items, and checkout availability.',
    resolve: async (user) => summarizeFees(await loadParentFeesForApp(user))
  },
  {
    name: 'get_registrations',
    mode: 'read',
    description: 'Published parent registration options for linked teams.',
    aliases: ['get_parent_tools'],
    resolve: async (user) => {
      const [registrations, certificates] = await Promise.all([
        loadParentRegistrations(user).catch(() => []),
        loadParentCertificates(user).catch(() => [])
      ]);
      return {
        registrations: registrations.slice(0, 10),
        certificates: certificates.slice(0, 10)
      };
    }
  },
  {
    name: 'get_certificates',
    mode: 'read',
    description: 'Published certificates for linked players.',
    resolve: async (user) => ({ certificates: (await loadParentCertificates(user)).slice(0, 20) })
  },
  {
    name: 'get_household',
    mode: 'read',
    description: 'Linked players and household invite/member state.',
    resolve: async (user) => summarizeHousehold(await loadParentHouseholdInviteModel(user))
  },
  {
    name: 'get_family_share',
    mode: 'read',
    description: 'Family share children and share links.',
    resolve: async (user) => summarizeFamilyShare(await loadFamilyShareModel(user))
  },
  {
    name: 'get_access_requests',
    mode: 'read',
    description: 'Parent access request status and searchable team/player options. Args: query, teamId.',
    aliases: ['list_access_requests', 'find_access_teams'],
    resolve: async (user, args) => {
      const teamId = compactText(args.teamId);
      const [model, teams, players] = await Promise.all([
        loadParentAccessModel(user),
        compactText(args.query || args.teamName)
          ? discoverParentAccessTeams({ searchText: compactText(args.query || args.teamName), pageSize: 10 }).catch(() => ({ teams: [], nextCursor: null }))
          : Promise.resolve({ teams: [], nextCursor: null }),
        teamId ? loadParentAccessPlayers(teamId).catch(() => []) : Promise.resolve([])
      ]);
      return {
        requests: (model.requests || []).slice(0, 15),
        teams: (teams.teams || []).slice(0, 10),
        players: players.slice(0, 20)
      };
    }
  },
  {
    name: 'get_help',
    mode: 'read',
    description: 'ALL PLAYS help/workflow documentation.',
    resolve: async (user, args) => summarizeHelpKnowledge(searchHelpKnowledge({
      query: compactText(args.query) || compactText(args.topic) || compactText(args.question),
      roles: user.roles || [],
      limit: Number(args.limit || 5)
    }))
  },
  {
    name: 'update_rsvp',
    mode: 'write',
    description: 'Update one linked child RSVP. Args: eventId, teamId, childId/playerId optional, response going|maybe|not_going, note.',
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, args);
      if (!event) throw new Error('No matching event was found for this account.');
      const response = normalizeAiRsvp(args.response);
      const result = await submitParentScheduleRsvp(event, user, response, compactText(args.note));
      return { event: summarizeScheduleEvent({ ...event, myRsvp: response, myRsvpNote: compactText(args.note) }), result };
    }
  },
  {
    name: 'update_rsvps_for_children',
    mode: 'write',
    description: 'Update multiple linked children on the same event. Args: eventId, teamId, response going|maybe|not_going, note.',
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, args);
      if (!event) throw new Error('No matching event was found for this account.');
      const schedule = await loadParentSchedule(user, { includePastGames: true });
      const events = (schedule.events || []).filter((candidate: ParentScheduleEvent) => (
        candidate.teamId === event.teamId && candidate.id === event.id && candidate.isLinkedParentChild === true
      ));
      const response = normalizeAiRsvp(args.response);
      const summary = await submitParentScheduleRsvpForChildren(events, user, response, compactText(args.note));
      return { updatedChildren: events.map((candidate) => candidate.childName), response, summary };
    }
  },
  {
    name: 'claim_assignment',
    mode: 'write',
    description: 'Claim a volunteer/task assignment slot. Args: eventId, teamId, role.',
    aliases: ['claim_task'],
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, args);
      if (!event) throw new Error('No matching event was found for this account.');
      const role = compactText(args.role || args.assignment || args.task);
      await claimParentScheduleAssignmentSlot(event, user, role);
      return { event: summarizeScheduleEvent(event), role, claimed: true };
    }
  },
  {
    name: 'release_assignment',
    mode: 'write',
    description: 'Release a volunteer/task assignment claim. Args: eventId, teamId, role.',
    aliases: ['release_task'],
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, args);
      if (!event) throw new Error('No matching event was found for this account.');
      const role = compactText(args.role || args.assignment || args.task);
      await releaseParentScheduleAssignmentClaim(event, role);
      return { event: summarizeScheduleEvent(event), role, released: true };
    }
  },
  {
    name: 'mark_practice_packet_complete',
    mode: 'write',
    description: 'Mark a practice/home packet complete for a linked child. Args: eventId, teamId, childId/playerId optional, playerName optional.',
    aliases: ['complete_practice_packet'],
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, buildPracticePacketEventArgs(args));
      if (!event) throw new Error('No matching practice was found for this account.');
      const packet = await loadPracticePacketForAi(user, event);
      if (!packet) throw new Error('No practice packet was found for this practice.');
      const child = resolvePracticePacketChild(packet, args);
      const completion = await markParentPracticePacketComplete(packet, user, child);
      return { packet: summarizePracticePacket(packet), child, completion };
    }
  },
  {
    name: 'create_ride_offer',
    mode: 'write',
    description: 'Create a rideshare offer. Args: eventId, teamId, seatCapacity, direction to|from|round-trip, note.',
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, args);
      if (!event) throw new Error('No matching event was found for this account.');
      const result = await createParentScheduleRideOffer(event, user, {
        seatCapacity: Number(args.seatCapacity || args.seats || 0),
        direction: compactText(args.direction) as any,
        note: compactText(args.note)
      });
      return { event: summarizeScheduleEvent(event), result };
    }
  },
  {
    name: 'request_ride_spot',
    mode: 'write',
    description: 'Request a seat for a linked child. Args: eventId, teamId, offerId, childId/playerId optional.',
    resolve: async (user, args) => {
      const { event, offer } = await resolveAccessibleRideOffer(user, args);
      const childId = compactText(args.childId || args.playerId) || event.childId;
      const childName = compactText(args.childName || args.playerName) || event.childName || 'Player';
      const result = await requestParentScheduleRideSpot(event, offer, user, { childId, childName });
      return { event: summarizeScheduleEvent(event), offer: summarizeRideOffer(offer), result };
    }
  },
  {
    name: 'cancel_ride_request',
    mode: 'write',
    description: 'Cancel a ride request. Args: eventId, teamId, offerId, requestId.',
    resolve: async (user, args) => {
      const { event, offer } = await resolveAccessibleRideOffer(user, args);
      const requestId = compactText(args.requestId);
      if (!requestId) throw new Error('requestId is required.');
      await cancelParentScheduleRideRequest(event, offer, requestId);
      return { event: summarizeScheduleEvent(event), offerId: offer.id, requestId, cancelled: true };
    }
  },
  {
    name: 'set_ride_offer_status',
    mode: 'write',
    description: 'Close or reopen a ride offer. Args: eventId, teamId, offerId, status open|closed|cancelled.',
    aliases: ['close_or_reopen_ride_offer'],
    resolve: async (user, args) => {
      const { event, offer } = await resolveAccessibleRideOffer(user, args);
      const status = compactText(args.status).toLowerCase();
      if (!['open', 'closed', 'cancelled'].includes(status)) throw new Error('Status must be open, closed, or cancelled.');
      await setParentScheduleRideOfferStatus(event, offer, status as any);
      return { event: summarizeScheduleEvent(event), offerId: offer.id, status };
    }
  },
  {
    name: 'send_team_message',
    mode: 'write',
    description: 'Send a team chat message. Args: teamId or teamName, text/message, target full_team|staff.',
    aliases: ['send_message'],
    resolve: async (user, args) => {
      const teamId = await resolveAccessibleTeamId(user, args);
      if (!teamId) throw new Error('No matching team was found for this account.');
      const text = compactText(args.text || args.message);
      if (!text) throw new Error('Message text is required.');
      const profile = await getUserProfile(user.uid).catch(() => ({}));
      const target = compactText(args.target).toLowerCase() === 'staff' ? 'staff' : 'full_team';
      const result = await sendTeamChatMessage({
        teamId,
        user,
        profile: profile || {},
        text,
        selectedConversationId: compactText(args.conversationId),
        selectedRecipientTarget: target,
        selectedRecipientIds: [],
        skipInteractionTiming: true
      });
      return { teamId, text, target, result };
    }
  },
  {
    name: 'create_household_invite',
    mode: 'write',
    description: 'Invite a household contact for a linked player. Args: playerKey or teamId+playerId, email, displayName, relation.',
    resolve: async (user, args) => {
      const playerKey = compactText(args.playerKey) || `${compactText(args.teamId)}::${compactText(args.playerId)}`;
      return createParentHouseholdMemberInvite(user, {
        playerKey,
        email: compactText(args.email),
        displayName: compactText(args.displayName),
        relation: compactText(args.relation) || 'Parent'
      });
    }
  },
  {
    name: 'create_family_share_link',
    mode: 'write',
    description: 'Create a family share link. Args: label, extraCalendarUrls.',
    resolve: async (user, args) => createParentFamilyShare(
      user,
      compactText(args.label) || 'Family share',
      Array.isArray(args.extraCalendarUrls) ? args.extraCalendarUrls.map(compactText).filter(Boolean) : []
    )
  },
  {
    name: 'revoke_family_share_link',
    mode: 'write',
    description: 'Revoke a family share link. Args: tokenId.',
    aliases: ['revoke_family_share'],
    resolve: async (user, args) => {
      const token = await resolveFamilyShareToken(user, args);
      await revokeParentFamilyShare(token.id);
      return { tokenId: token.id, revoked: true };
    }
  },
  {
    name: 'update_family_share_calendars',
    mode: 'write',
    description: 'Update extra calendar URLs attached to a family share link. Args: tokenId, extraCalendarUrls.',
    resolve: async (user, args) => {
      const token = await resolveFamilyShareToken(user, args);
      const urls = Array.isArray(args.extraCalendarUrls) ? args.extraCalendarUrls.map(compactText).filter(Boolean) : [];
      await updateParentFamilyShareCalendars(token.id, urls);
      return { tokenId: token.id, extraCalendarUrls: urls };
    }
  },
  {
    name: 'submit_access_request',
    mode: 'write',
    description: 'Request parent access to a team/player. Args: teamId, playerId, relation.',
    aliases: ['request_parent_access'],
    resolve: async (user, args) => {
      const teamId = compactText(args.teamId);
      const playerId = compactText(args.playerId || args.childId);
      if (!teamId || !playerId) throw new Error('teamId and playerId are required.');
      const relation = compactText(args.relation) || 'Parent';
      const result = await submitParentAccessRequest(teamId, playerId, relation);
      return { teamId, playerId, relation, result };
    }
  },
  {
    name: 'update_player_profile',
    mode: 'write',
    description: 'Update parent-editable private player profile fields. Args: teamId, playerId, emergencyContactName, emergencyContactPhone, medicalInfo.',
    resolve: async (user, args) => {
      const mergedArgs = await buildMergedPlayerEditableProfileArgs(user, args);
      return updateParentPlayerEditableProfile(mergedArgs);
    }
  },
  {
    name: 'save_player_incentive_rule',
    mode: 'write',
    description: 'Create or update a parent player incentive rule. Args: teamId, playerId/playerName, statKey, amountCents or amount, type per_unit|threshold, threshold, thresholdOp.',
    aliases: ['set_player_incentive_rule'],
    resolve: async (user, args) => {
      const player = await resolveAccessiblePlayer(user, args);
      if (!player) throw new Error('No matching player was found for this account.');
      const rule = {
        id: compactText(args.ruleId || args.id) || undefined,
        statKey: compactText(args.statKey || args.stat),
        type: compactText(args.type).toLowerCase() === 'threshold' ? 'threshold' : 'per_unit',
        amountCents: resolveAiAmountCents(args),
        threshold: Number(args.threshold || 0),
        thresholdOp: compactText(args.thresholdOp).toLowerCase() === 'gte' ? 'gte' : 'gt',
        active: args.active !== false
      };
      if (!rule.statKey) throw new Error('statKey is required.');
      if (!Number.isFinite(rule.amountCents) || rule.amountCents <= 0) throw new Error('amountCents must be greater than 0.');
      return saveParentPlayerIncentiveRule({
        user,
        teamId: player.teamId,
        playerId: player.playerId,
        playerName: player.name || 'Player',
        rule
      });
    }
  },
  {
    name: 'toggle_player_incentive_rule',
    mode: 'write',
    description: 'Activate or deactivate a player incentive rule. Args: teamId, playerId/playerName, ruleId, active true|false.',
    resolve: async (user, args) => {
      const { player, rule } = await resolvePlayerIncentiveRule(user, args);
      return toggleParentPlayerIncentiveRule(user, player.teamId, player.playerId, {
        ...rule,
        active: args.active !== false
      } as any);
    }
  },
  {
    name: 'retire_player_incentive_rule',
    mode: 'write',
    description: 'Retire/remove a player incentive rule. Args: teamId, playerId/playerName, ruleId.',
    resolve: async (user, args) => {
      const player = await resolveAccessiblePlayer(user, args);
      if (!player) throw new Error('No matching player was found for this account.');
      const ruleId = compactText(args.ruleId || args.id);
      if (!ruleId) throw new Error('ruleId is required.');
      return retireParentPlayerIncentiveRule(user, player.teamId, player.playerId, ruleId);
    }
  },
  {
    name: 'set_player_incentive_cap',
    mode: 'write',
    description: 'Set or clear a per-game incentive cap. Args: teamId, playerId/playerName, maxPerGameCents or maxPerGameAmount.',
    resolve: async (user, args) => {
      const player = await resolveAccessiblePlayer(user, args);
      if (!player) throw new Error('No matching player was found for this account.');
      const cap = hasOwn(args, 'maxPerGameCents') || hasOwn(args, 'maxPerGameAmount') || hasOwn(args, 'amount')
        ? resolveAiAmountCents({ amountCents: args.maxPerGameCents, amount: args.maxPerGameAmount ?? args.amount })
        : null;
      return saveParentPlayerIncentiveCap(user, player.teamId, player.playerId, cap);
    }
  },
  {
    name: 'mark_player_incentive_paid',
    mode: 'write',
    description: 'Mark player incentive earnings paid for a game. Args: teamId, playerId/playerName, gameId, amountCents or amount.',
    resolve: async (user, args) => {
      const player = await resolveAccessiblePlayer(user, args);
      if (!player) throw new Error('No matching player was found for this account.');
      const gameId = compactText(args.gameId || args.eventId);
      if (!gameId) throw new Error('gameId is required.');
      return markParentPlayerIncentivePaid(user, player.teamId, player.playerId, gameId, resolveAiAmountCents(args));
    }
  }
];

function getPrivateAiToolDefinition(name: string) {
  const normalized = compactText(name);
  return privateAiToolDefinitions.find((definition) => (
    definition.name === normalized || (definition.aliases || []).includes(normalized)
  )) || null;
}

async function loadPlayerDetailForAi(user: AuthUser, args: Record<string, unknown>) {
  const player = await resolveAccessiblePlayer(user, args);
  if (!player) {
    throw new Error('No matching player was found for this account.');
  }
  const [detail, clips, statTotals] = await Promise.all([
    loadParentPlayerDetailWithAthleteProfile(user, player.teamId, player.playerId),
    loadParentPlayerVideoClips(user, player.teamId, player.playerId).catch(() => []),
    loadParentPlayerStatTotals(user, player.teamId, player.playerId).catch(() => null)
  ]);
  return {
    ...detail,
    clips,
    seasonStatTotals: statTotals
  };
}

async function buildMergedPlayerEditableProfileArgs(user: AuthUser, args: Record<string, unknown>) {
  const teamId = compactText(args.teamId);
  const playerId = compactText(args.playerId);
  if (!teamId || !playerId) {
    throw new Error('teamId and playerId are required.');
  }

  const detail = await loadParentPlayerDetailWithAthleteProfile(user, teamId, playerId);
  const existingPrivateProfile = isPlainObject(detail.privateProfile) ? detail.privateProfile : {};
  const existingEmergencyContact = isPlainObject(existingPrivateProfile.emergencyContact)
    ? existingPrivateProfile.emergencyContact
    : {};
  return {
    user,
    teamId,
    playerId,
    emergencyContactName: hasOwn(args, 'emergencyContactName')
      ? compactText(args.emergencyContactName)
      : compactText(existingEmergencyContact.name),
    emergencyContactPhone: hasOwn(args, 'emergencyContactPhone')
      ? compactText(args.emergencyContactPhone)
      : compactText(existingEmergencyContact.phone),
    medicalInfo: hasOwn(args, 'medicalInfo')
      ? compactText(args.medicalInfo)
      : compactText(existingPrivateProfile.medicalInfo)
  };
}

async function resolveAccessibleScheduleEvent(user: AuthUser, args: Record<string, unknown>): Promise<ParentScheduleEvent | null> {
  const requestedEventId = compactText(args.eventId || args.gameId || args.id);
  const requestedTeamId = compactText(args.teamId);
  const requestedChildId = compactText(args.childId || args.playerId);
  const requestedEventType = compactText(args.type || args.eventType).toLowerCase();
  const requestedTeamName = compactText(args.teamName).toLowerCase();
  const requestedPlayerName = compactText(args.playerName || args.childName).toLowerCase();
  const requestedTitle = compactText(args.title || args.opponent).toLowerCase();
  const schedule = await loadParentSchedule(user, { includePastGames: true });
  const events = Array.isArray(schedule.events) ? schedule.events : [];

  return events.find((event: ParentScheduleEvent) => {
    if (requestedEventId && event.id !== requestedEventId) return false;
    if (requestedTeamId && event.teamId !== requestedTeamId) return false;
    if (requestedChildId && event.childId !== requestedChildId) return false;
    if ((requestedEventType === 'game' || requestedEventType === 'practice') && event.type !== requestedEventType) return false;
    if (requestedTeamName && !event.teamName.toLowerCase().includes(requestedTeamName)) return false;
    if (requestedPlayerName && !event.childName.toLowerCase().includes(requestedPlayerName)) return false;
    if (requestedTitle) {
      const title = `${getScheduleTitle(event)} ${event.opponent || ''}`.toLowerCase();
      if (!title.includes(requestedTitle)) return false;
    }
    return true;
  }) || null;
}

async function loadPracticePacketForAi(user: AuthUser, event: ParentScheduleEvent) {
  const detail = await loadParentScheduleEventDetail(user, {
    teamId: event.teamId,
    eventId: event.id,
    childId: event.childId,
    eventType: event.type
  } as any).catch(() => null);
  return loadParentPracticePacket(event, detail?.events || []);
}

function buildPracticePacketEventArgs(args: Record<string, unknown>) {
  return {
    ...args,
    childId: '',
    childName: '',
    playerId: '',
    playerName: '',
    type: 'practice'
  };
}

async function resolveAccessibleRideOffer(user: AuthUser, args: Record<string, unknown>) {
  const event = await resolveAccessibleScheduleEvent(user, args);
  if (!event) {
    throw new Error('No matching event was found for this account.');
  }
  const offerId = compactText(args.offerId);
  if (!offerId) {
    throw new Error('offerId is required.');
  }
  const offers = await loadParentScheduleRideOffers(event);
  const offer = offers.find((candidate) => candidate.id === offerId);
  if (!offer) {
    throw new Error('No matching ride offer was found for this event.');
  }
  return { event, offer };
}

function normalizeAiRsvp(value: unknown): 'going' | 'maybe' | 'not_going' {
  const normalized = normalizeRsvpResponse(value);
  if (normalized === 'going' || normalized === 'maybe' || normalized === 'not_going') {
    return normalized;
  }
  throw new Error('RSVP response must be going, maybe, or not_going.');
}

async function savePrivateAiPendingAction(
  user: AuthUser,
  definition: PrivateAiToolDefinition,
  args: Record<string, unknown>,
  context: PrivateAiToolContext = {}
): Promise<PrivateAiPendingAction> {
  const id = createConfirmationId();
  const pending: PrivateAiPendingAction = {
    id,
    userId: user.uid,
    toolName: definition.name,
    args: sanitizePendingActionArgs(args),
    summary: buildPendingActionSummary(definition, args),
    createdAt: new Date().toISOString(),
    conversationId: normalizeConversationId(context.conversationId),
    confirmationGroupId: compactText(context.confirmationGroupId)
  };
  pendingActionMemory.set(`${user.uid}:${id}`, pending);
  await setDoc(doc(db, 'users', user.uid, privateAiPendingActionCollectionName, id), {
    ...pending,
    createdAt: serverTimestamp(),
    clientCreatedAt: pending.createdAt,
    status: 'pending'
  }).catch((error) => {
    logger.warn('Unable to persist private AI pending action.', { error, toolName: definition.name });
  });
  return pending;
}

async function executeConfirmedPrivateAiAction(user: AuthUser, confirmationId: string): Promise<PrivateAiToolResult> {
  const id = compactText(confirmationId);
  const pending = await loadPrivateAiPendingAction(user, id);
  if (!pending) {
    return { name: 'confirm_action', ok: false, error: 'No pending AI action matched that confirmation code.' };
  }
  const definition = getPrivateAiToolDefinition(pending.toolName);
  if (!definition || definition.mode !== 'write') {
    return { name: pending.toolName || 'confirm_action', ok: false, error: 'That pending AI action is no longer supported.' };
  }

  const result = await runPrivateAiTool(user, {
    name: definition.name,
    args: {
      ...pending.args,
      __confirmed: true
    }
  });
  if (result.ok) {
    pendingActionMemory.delete(`${user.uid}:${id}`);
    await setDoc(doc(db, 'users', user.uid, privateAiPendingActionCollectionName, id), {
      status: 'completed',
      completedAt: serverTimestamp()
    }, { merge: true }).catch(() => {});
  }
  return {
    ...result,
    confirmationId: id
  };
}

async function loadPrivateAiPendingAction(user: AuthUser, confirmationId: string): Promise<PrivateAiPendingAction | null> {
  const memoryKey = `${user.uid}:${confirmationId}`;
  const fromMemory = pendingActionMemory.get(memoryKey);
  if (fromMemory) return fromMemory;

  const snapshot = await getDoc(doc(db, 'users', user.uid, privateAiPendingActionCollectionName, confirmationId)).catch(() => null);
  const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
  if (!snapshot?.exists?.() || !isPlainObject(data) || data.status !== 'pending') return null;
  if (compactText(data.userId) !== user.uid) return null;
  return {
    id: confirmationId,
    userId: user.uid,
    toolName: compactText(data.toolName),
    args: isPlainObject(data.args) ? data.args : {},
    summary: compactText(data.summary),
    createdAt: normalizeScheduleDate(data.createdAt)?.toISOString() || compactText(data.clientCreatedAt) || new Date().toISOString(),
    conversationId: normalizeConversationId(data.conversationId),
    confirmationGroupId: compactText(data.confirmationGroupId)
  };
}

async function resolvePendingActionIdsForNaturalConfirmation(
  user: AuthUser,
  priorMessages: PrivateAiMessage[] = [],
  context: PrivateAiToolContext = {}
) {
  const conversationId = normalizeConversationId(context.conversationId);
  const fromHistory = [...priorMessages]
    .reverse()
    .map((message) => parseConfirmationId(message.text))
    .find(Boolean);
  if (fromHistory) return [fromHistory];

  const fromMemory = selectPendingActionsForNaturalConfirmation(
    [...pendingActionMemory.values()].filter((pending) => pending.userId === user.uid && normalizeConversationId(pending.conversationId) === conversationId)
  );
  if (fromMemory.length) return fromMemory.map((pending) => pending.id);

  const snapshot = await getDocs(query(
    collection(db, 'users', user.uid, privateAiPendingActionCollectionName),
    orderBy('createdAt', 'desc'),
    limit(5)
  )).catch(() => null);
  const pendingActions = (snapshot?.docs || []).map((candidate: any) => {
    const data = typeof candidate?.data === 'function' ? candidate.data() : null;
    if (!isPlainObject(data) || data.status !== 'pending' || compactText(data.userId) !== user.uid) return null;
    if (normalizeConversationId(data.conversationId) !== conversationId) return null;
    return {
      id: compactText(candidate?.id),
      userId: user.uid,
      toolName: compactText(data.toolName),
      args: isPlainObject(data.args) ? data.args : {},
      summary: compactText(data.summary),
      createdAt: normalizeScheduleDate(data.createdAt)?.toISOString() || compactText(data.clientCreatedAt) || new Date().toISOString(),
      conversationId,
      confirmationGroupId: compactText(data.confirmationGroupId)
    };
  }).filter((pending: PrivateAiPendingAction | null): pending is PrivateAiPendingAction => Boolean(pending?.id));
  return selectPendingActionsForNaturalConfirmation(pendingActions).map((pending) => pending.id);
}

async function savePrivateAiActionAudit(
  user: AuthUser,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown
) {
  const auditId = createConfirmationId();
  await setDoc(doc(db, 'users', user.uid, 'privateAiActionAudit', auditId), {
    toolName,
    args: sanitizePendingActionArgs(args),
    result: summarizeAuditResult(result),
    createdAt: serverTimestamp(),
    clientCreatedAt: new Date().toISOString()
  });
}

function parseConfirmationId(question: string) {
  const match = compactText(question).match(/\bconfirm\s+([a-z0-9_-]{4,24})\b/i);
  return match?.[1] || '';
}

function isNaturalConfirmation(question: string) {
  return /^(yes|y|yeah|yep|confirm|confirmed|do it|go ahead|please do|apply it|looks good|ok|okay)$/i.test(compactText(question));
}

function createConfirmationId() {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8)
    || Math.random().toString(36).slice(2, 10);
  return `${confirmationIdPrefix}_${random}`.toLowerCase();
}

function createConfirmationGroupId() {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8)
    || Math.random().toString(36).slice(2, 10);
  return `group_${random}`.toLowerCase();
}

function selectPendingActionsForNaturalConfirmation(actions: PrivateAiPendingAction[]) {
  const sorted = actions
    .filter((pending) => pending.id)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const latest = sorted[0];
  if (!latest) return [];
  if (!latest.confirmationGroupId) return [latest];
  return sorted
    .filter((pending) => pending.confirmationGroupId === latest.confirmationGroupId)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function sanitizePendingActionArgs(args: Record<string, unknown>) {
  const blocked = new Set(['__confirmed', 'photoFile', 'file', 'profilePhotoFile', 'highlightClipFile']);
  return Object.entries(args).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (blocked.has(key)) return acc;
    if (value === undefined || typeof value === 'function') return acc;
    acc[key] = value;
    return acc;
  }, {});
}

function buildPendingActionSummary(definition: PrivateAiToolDefinition, args: Record<string, unknown>) {
  const bits = [
    definition.description,
    compactText(args.teamName || args.teamId) ? `Team: ${compactText(args.teamName || args.teamId)}` : '',
    compactText(args.playerName || args.childName || args.playerId || args.childId) ? `Player: ${compactText(args.playerName || args.childName || args.playerId || args.childId)}` : '',
    compactText(args.eventId || args.gameId) ? `Event: ${compactText(args.eventId || args.gameId)}` : '',
    compactText(args.response) ? `RSVP: ${compactText(args.response)}` : '',
    compactText(args.status) ? `Status: ${compactText(args.status)}` : '',
    compactText(args.email) ? `Email: ${compactText(args.email)}` : ''
  ].filter(Boolean);
  return bits.join(' | ');
}

function summarizeExecutedAction(result: PrivateAiToolResult) {
  if (result.name === 'update_rsvp') return 'RSVP updated.';
  if (result.name === 'update_rsvps_for_children') return 'Family RSVPs updated.';
  if (result.name === 'claim_assignment') return 'Assignment claimed.';
  if (result.name === 'release_assignment') return 'Assignment released.';
  if (result.name === 'mark_practice_packet_complete') return 'Practice packet marked complete.';
  if (result.name === 'create_ride_offer') return 'Ride offer created.';
  if (result.name === 'request_ride_spot') return 'Ride request submitted.';
  if (result.name === 'cancel_ride_request') return 'Ride request cancelled.';
  if (result.name === 'set_ride_offer_status') return 'Ride offer updated.';
  if (result.name === 'send_team_message') return 'Team message sent.';
  if (result.name === 'create_household_invite') return 'Household invite created.';
  if (result.name === 'create_family_share_link') return 'Family share link created.';
  if (result.name === 'revoke_family_share_link') return 'Family share link revoked.';
  if (result.name === 'update_family_share_calendars') return 'Family share calendars updated.';
  if (result.name === 'submit_access_request') return 'Access request submitted.';
  if (result.name === 'update_player_profile') return 'Player profile updated.';
  if (result.name === 'save_player_incentive_rule') return 'Player incentive rule saved.';
  if (result.name === 'toggle_player_incentive_rule') return 'Player incentive rule updated.';
  if (result.name === 'retire_player_incentive_rule') return 'Player incentive rule retired.';
  if (result.name === 'set_player_incentive_cap') return 'Player incentive cap updated.';
  if (result.name === 'mark_player_incentive_paid') return 'Player incentive marked paid.';
  return `${result.name} completed.`;
}

function summarizeExecutedActions(results: PrivateAiToolResult[]) {
  return results.map(summarizeExecutedAction).join(' ');
}

function summarizeAuditResult(result: unknown) {
  if (!isPlainObject(result)) return result;
  return pickFields(result, ['event', 'offerId', 'requestId', 'status', 'response', 'updatedChildren', 'tokenId', 'url', 'email', 'role', 'teamId', 'playerId', 'child', 'text', 'target']);
}

async function savePrivateAiMessage(user: AuthUser, input: {
  role: PrivateAiRole;
  text: string;
  conversationId?: string;
  toolNames?: string[];
  error?: boolean;
}): Promise<PrivateAiMessage> {
  const createdAt = new Date();
  const conversationId = normalizeConversationId(input.conversationId);
  const payload = {
    role: input.role,
    text: input.text,
    conversationId,
    toolNames: input.toolNames || [],
    error: input.error === true,
    createdAt: serverTimestamp(),
    clientCreatedAt: createdAt.toISOString()
  };
  const document = await addDoc(collection(db, 'users', user.uid, privateAiCollectionName), payload);
  return {
    id: document.id,
    role: input.role,
    text: input.text,
    conversationId,
    createdAt,
    toolNames: input.toolNames || [],
    error: input.error === true
  };
}

async function touchPrivateAiConversation(user: AuthUser, conversationId: string, input: {
  title: string;
  lastMessagePreview: string;
}) {
  const updatedAt = new Date();
  const cleanTitle = compactText(input.title).slice(0, 80) || 'New chat';
  await setDoc(doc(db, 'users', user.uid, privateAiConversationCollectionName, normalizeConversationId(conversationId)), {
    title: cleanTitle,
    lastMessagePreview: compactText(input.lastMessagePreview).slice(0, 180),
    updatedAt: serverTimestamp(),
    clientUpdatedAt: updatedAt.toISOString(),
    createdAt: serverTimestamp(),
    clientCreatedAt: updatedAt.toISOString()
  }, { merge: true });
}

function normalizePrivateAiConversation(id: string, data: Record<string, any>): PrivateAiConversation | null {
  if (!id) return null;
  const createdAt = normalizeScheduleDate(data.createdAt) || normalizeScheduleDate(data.clientCreatedAt) || new Date(0);
  const updatedAt = normalizeScheduleDate(data.updatedAt) || normalizeScheduleDate(data.clientUpdatedAt) || createdAt;
  return {
    id,
    title: compactText(data.title).slice(0, 80) || 'New chat',
    createdAt,
    updatedAt,
    lastMessagePreview: compactText(data.lastMessagePreview).slice(0, 180)
  };
}

function normalizePrivateAiMessage(id: string, data: Record<string, any>): PrivateAiMessage | null {
  const role = data.role === 'assistant' ? 'assistant' : data.role === 'user' ? 'user' : null;
  const text = compactText(data.text);
  if (!id || !role || !text) return null;

  return {
    id,
    role,
    text,
    conversationId: compactText(data.conversationId) || DEFAULT_PRIVATE_AI_CONVERSATION_ID,
    createdAt: normalizeScheduleDate(data.createdAt) || normalizeScheduleDate(data.clientCreatedAt) || new Date(0),
    toolNames: Array.isArray(data.toolNames) ? data.toolNames.map((name: unknown) => compactText(name)).filter(Boolean) : [],
    error: data.error === true
  };
}

function recoverPrivateAiConversations(messages: PrivateAiMessage[]): PrivateAiConversation[] {
  const messagesByConversationId = new Map<string, PrivateAiMessage[]>();
  messages.forEach((message) => {
    const conversationId = normalizeConversationId(message.conversationId);
    const conversationMessages = messagesByConversationId.get(conversationId) || [];
    conversationMessages.push(message);
    messagesByConversationId.set(conversationId, conversationMessages);
  });

  return Array.from(messagesByConversationId, ([id, conversationMessages]) => {
    const orderedMessages = [...conversationMessages]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const first = orderedMessages[0];
    const latest = orderedMessages[orderedMessages.length - 1] || first;
    const firstUserMessage = orderedMessages.find((message) => message.role === 'user');
    const timestamp = latest?.createdAt || new Date(0);
    return {
      id,
      title: firstUserMessage ? buildConversationTitle(firstUserMessage.text) : 'Recent chat',
      createdAt: first?.createdAt || timestamp,
      updatedAt: timestamp,
      lastMessagePreview: latest?.text || ''
    };
  });
}

async function getPrivateAiModel() {
  if (aiModelCache) return aiModelCache;
  const firebaseApp = getApp();
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  aiModelCache = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
  return aiModelCache;
}

async function generateModelText(model: any, prompt: string) {
  const result = await model.generateContent(prompt);
  return compactText(result?.response?.text?.() || '');
}

function buildPlannerPrompt({
  user,
  question,
  history,
  toolResults
}: {
  user: AuthUser;
  question: string;
  history: unknown;
  toolResults: PrivateAiToolResult[];
}) {
  return `You are ALL PLAYS, a private assistant for the signed-in youth sports parent or coach.\n` +
    `You may answer from conversation context for general navigation. For account-specific facts, request tools first.\n` +
    `Use only the available tools; never ask for or invent Firestore paths.\n` +
    `Return strict JSON only, with no markdown.\n` +
    `If you need data, return {"toolCalls":[{"name":"list_schedule","args":{"range":"upcoming","limit":8}}]}.\n` +
    `For last/previous game questions, call get_last_game. For game-specific questions, do not answer with practices as substitutes.\n` +
    `For writes, call the write tool with normalized args. The app will stage it and require user confirmation before execution.\n` +
    `If you have enough information, return {"answer":"..."}.\n\n` +
    `AVAILABLE TOOLS:\n` +
    privateAiToolDefinitions.map((definition) => (
      `- ${definition.name} (${definition.mode}): ${definition.description}`
    )).join('\n') + `\n\n` +
    `USER:\n${JSON.stringify(summarizeSignedInUser(user))}\n\n` +
    `RECENT CHAT HISTORY:\n${JSON.stringify(history)}\n\n` +
    `QUESTION:\n${question}\n\n` +
    `TOOL RESULTS SO FAR:\n${JSON.stringify(formatToolResultsForPrompt(toolResults))}\n`;
}

function buildFinalAnswerPrompt({
  user,
  question,
  history,
  toolResults
}: {
  user: AuthUser;
  question: string;
  history: unknown;
  toolResults: PrivateAiToolResult[];
}) {
  return `You are ALL PLAYS, a private assistant for the signed-in youth sports parent or coach.\n` +
    `Use ONLY this account-scoped data. If the data is missing, say what is missing.\n` +
    `For product/how-to questions, use help documentation results and include the relevant help page when useful.\n` +
    `If a tool result requires confirmation, state the proposed change clearly and tell the user they can reply "yes" to confirm. Do not mention internal confirmation IDs or codes.\n` +
    `When the user asks for a game, answer from game records only; if only practices are available, say no matching game was found.\n` +
    `Answer concisely. Include dates, times, team names, and player names when relevant.\n` +
    `Return strict JSON only: {"answer":"..."}.\n\n` +
    `USER:\n${JSON.stringify(summarizeSignedInUser(user))}\n\n` +
    `RECENT CHAT HISTORY:\n${JSON.stringify(history)}\n\n` +
    `QUESTION:\n${question}\n\n` +
    `TOOL RESULTS:\n${JSON.stringify(formatToolResultsForPrompt(toolResults))}\n`;
}

function formatToolResultsForPrompt(toolResults: PrivateAiToolResult[]) {
  return toolResults.map((result) => ({
    name: result.name,
    ok: result.ok,
    data: result.data,
    error: result.error,
    requiresConfirmation: result.requiresConfirmation === true
  }));
}

function summarizeSignedInUser(user: AuthUser) {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles || [],
    emailVerified: user.emailVerified === true
  };
}

function summarizeChatHistory(messages: PrivateAiMessage[]) {
  return messages
    .slice(-maxHistoryMessages)
    .map((message) => ({
      role: message.role,
      text: message.text.slice(0, 500),
      createdAt: message.createdAt.toISOString()
    }));
}

function summarizeProfile(user: AuthUser, profile: Record<string, any> | null) {
  return {
    account: summarizeSignedInUser(user),
    profile: pickFields(profile || {}, [
      'fullName',
      'displayName',
      'email',
      'phone',
      'photoUrl',
      'emailVerified',
      'notificationPreferences',
      'parentTeamIds',
      'parentPlayerKeys',
      'coachTeamIds'
    ])
  };
}

function summarizeHome(home: any) {
  return {
    metrics: home.metrics,
    actionItems: (home.actionItems || []).slice(0, 10).map((action: any) => pickFields(action, ['kind', 'title', 'detail', 'to', 'priority'])),
    players: (home.players || []).slice(0, 12).map((player: any) => ({
      playerId: player.playerId,
      childId: player.childId,
      name: player.name || player.childName,
      teamId: player.teamId,
      teamName: player.teamName,
      rsvpNeeded: player.rsvpNeeded,
      packetsReady: player.packetsReady,
      openAssignments: player.openAssignments,
      unreadCount: player.unreadCount,
      nextEvent: player.nextEvent ? summarizeScheduleEvent(player.nextEvent) : null
    })),
    teams: (home.teams || []).slice(0, 12).map((team: any) => ({
      teamId: team.teamId,
      teamName: team.teamName,
      sport: team.sport,
      role: team.role,
      players: (team.players || []).map((player: any) => player.name || player.childName).filter(Boolean),
      unreadCount: team.unreadCount,
      openActions: team.openActions,
      nextEvent: team.nextEvent ? summarizeScheduleEvent(team.nextEvent) : null
    })),
    upcomingEvents: (home.upcomingEvents || []).slice(0, 8).map(summarizeScheduleEvent),
    fees: (home.fees || []).slice(0, 8)
  };
}

function summarizeSchedule(schedule: any, args: Record<string, unknown>) {
  const now = new Date();
  const requestedLimit = Number(args.limit || 12);
  const itemLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 25) : 12;
  const range = compactText(args.range || 'upcoming').toLowerCase();
  const eventType = compactText(args.type).toLowerCase();
  const teamId = compactText(args.teamId);
  const teamName = compactText(args.teamName).toLowerCase();
  const playerName = compactText(args.playerName).toLowerCase();

  let events = Array.isArray(schedule.events) ? schedule.events.slice() : [];
  if (range === 'upcoming') {
    events = events.filter((event: ParentScheduleEvent) => event.date.getTime() >= startOfDay(now).getTime());
  } else if (range === 'recent') {
    events = events.filter((event: ParentScheduleEvent) => event.date.getTime() < startOfDay(now).getTime()).reverse();
  }
  if (eventType === 'game' || eventType === 'practice') {
    events = events.filter((event: ParentScheduleEvent) => event.type === eventType);
  }
  if (teamId) {
    events = events.filter((event: ParentScheduleEvent) => event.teamId === teamId);
  }
  if (teamName) {
    events = events.filter((event: ParentScheduleEvent) => event.teamName.toLowerCase().includes(teamName));
  }
  if (playerName) {
    events = events.filter((event: ParentScheduleEvent) => event.childName.toLowerCase().includes(playerName));
  }

  return {
    children: (schedule.children || []).slice(0, 20).map((child: any) => pickFields(child, ['playerId', 'childId', 'name', 'childName', 'teamId', 'teamName'])),
    events: events.slice(0, itemLimit).map(summarizeScheduleEvent)
  };
}

function summarizeLastGame(schedule: any, args: Record<string, unknown>) {
  const now = new Date();
  const requestedTeamId = compactText(args.teamId);
  const requestedChildId = compactText(args.childId || args.playerId);
  const requestedTeamName = compactText(args.teamName).toLowerCase();
  const requestedPlayerName = compactText(args.playerName || args.childName).toLowerCase();
  const allEvents = Array.isArray(schedule.events) ? schedule.events : [];
  const matchingGames = allEvents
    .filter((event: ParentScheduleEvent) => event.type === 'game')
    .filter((event: ParentScheduleEvent) => !requestedTeamId || event.teamId === requestedTeamId)
    .filter((event: ParentScheduleEvent) => !requestedChildId || event.childId === requestedChildId)
    .filter((event: ParentScheduleEvent) => !requestedTeamName || event.teamName.toLowerCase().includes(requestedTeamName))
    .filter((event: ParentScheduleEvent) => !requestedPlayerName || event.childName.toLowerCase().includes(requestedPlayerName));
  const pastGames = matchingGames
    .filter((event: ParentScheduleEvent) => event.date.getTime() < now.getTime())
    .sort((a: ParentScheduleEvent, b: ParentScheduleEvent) => b.date.getTime() - a.date.getTime());
  const upcomingGames = matchingGames
    .filter((event: ParentScheduleEvent) => event.date.getTime() >= now.getTime())
    .sort((a: ParentScheduleEvent, b: ParentScheduleEvent) => a.date.getTime() - b.date.getTime());

  return {
    lastGame: pastGames[0] ? summarizeScheduleEvent(pastGames[0]) : null,
    recentGames: pastGames.slice(0, 5).map(summarizeScheduleEvent),
    upcomingGames: upcomingGames.slice(0, 3).map(summarizeScheduleEvent),
    message: pastGames.length
      ? ''
      : 'No past games were found for the requested player or team.'
  };
}

function summarizeMessages(inbox: any) {
  return {
    teams: (inbox.teams || []).slice(0, 20).map((team: any) => ({
      teamId: team.id,
      teamName: team.name,
      sport: team.sport,
      role: team.role,
      unreadCount: Number(team.unreadCount || 0),
      preview: getChatInboxPreview(team.lastMessage),
      lastMessageAt: normalizeScheduleDate(team.lastMessage?.createdAt)?.toISOString() || null
    }))
  };
}

function summarizeMessageThreads(teamId: string, team: any, conversations: any[]) {
  return {
    teamId,
    teamName: team?.name || team?.teamName || '',
    threads: (conversations || []).slice(0, 20).map((conversation: any) => pickFields(conversation, [
      'id',
      'name',
      'type',
      'participantIds',
      'participantRoles',
      'lastMessageAt',
      'lastMessagePreview',
      'unreadCount',
      'muted'
    ]))
  };
}

function summarizeAssignment(assignment: any) {
  return pickFields(assignment || {}, [
    'role',
    'value',
    'claimable',
    'claimed',
    'claimedBy',
    'claimedByName',
    'claimantName',
    'note'
  ]);
}

function summarizePracticePacket(packet: any) {
  return {
    sessionId: packet.sessionId,
    teamId: packet.teamId,
    eventId: packet.eventId,
    title: packet.title,
    date: normalizeScheduleDate(packet.date)?.toISOString() || null,
    location: packet.location,
    homePacket: packet.homePacket,
    children: (packet.children || []).map((child: any) => pickFields(child, ['id', 'name'])),
    completions: (packet.completions || []).map((completion: any) => pickFields(completion, [
      'id',
      'childId',
      'childName',
      'status',
      'completedAt',
      'updatedAt'
    ]))
  };
}

function summarizeTeamDetail(detail: any) {
  return {
    team: detail.team,
    counts: detail.counts,
    record: detail.record,
    nextEvent: detail.nextEvent ? summarizeTeamEvent(detail.nextEvent) : null,
    linkedPlayers: (detail.linkedPlayers || []).slice(0, 10).map((player: any) => pickFields(player, ['id', 'name', 'number', 'position'])),
    rosterSummary: {
      rosterSize: (detail.players || []).length,
      sample: (detail.players || []).slice(0, 12).map((player: any) => pickFields(player, ['id', 'name', 'number', 'position']))
    },
    upcomingEvents: (detail.upcomingEvents || []).slice(0, 8).map(summarizeTeamEvent),
    recentResults: (detail.recentResults || []).slice(0, 6).map(summarizeTeamEvent),
    standings: detail.standings?.enabled ? pickFields(detail.standings, ['label', 'currentRow']) : null,
    leaderboards: (detail.leaderboards || []).slice(0, 5).map((board: any) => ({
      label: board.label,
      leaders: (board.leaders || []).slice(0, 3)
    })),
    trackingSummaries: (detail.trackingSummaries || []).slice(0, 8)
  };
}

function summarizePlayerDevelopment(detail: any) {
  return {
    player: {
      id: detail.player?.id || detail.child?.playerId,
      name: detail.player?.name || detail.child?.playerName,
      number: detail.player?.number || null,
      position: detail.player?.position || null,
      teamId: detail.child?.teamId,
      teamName: detail.child?.teamName,
      sport: detail.team?.sport || null
    },
    nextEvent: detail.nextEvent ? summarizeScheduleEvent(detail.nextEvent) : null,
    actionCounts: detail.actionCounts,
    recentGames: (detail.statRows || []).slice(0, 6).map((row: any) => ({
      event: summarizeScheduleEvent(row.event),
      stats: row.stats || {}
    })),
    seasonStatTotals: detail.seasonStatTotals ? {
      gameCount: detail.seasonStatTotals.gameCount,
      totals: detail.seasonStatTotals.totals || {}
    } : summarizeStatRowsTotals(detail.statRows || []),
    trackingSummary: (detail.trackingSummary || []).slice(0, 12),
    incentives: detail.incentives ? {
      activeRules: (detail.incentives.currentRules || []).slice(0, 8),
      totalEarnedCents: detail.incentives.totalEarnedCents,
      unpaidCents: detail.incentives.unpaidCents,
      recentEarnings: (detail.incentives.seasonGameEarnings || []).slice(0, 5).map((earning: any) => ({
        event: summarizeScheduleEvent(earning.event),
        totalCents: earning.totalCents,
        paid: earning.paid,
        breakdown: earning.breakdown
      }))
    } : null,
    athleteProfile: detail.athleteProfile ? {
      hasProfile: Boolean(detail.athleteProfile.profile),
      shareUrl: detail.athleteProfile.shareUrl || '',
      builderUrl: detail.athleteProfile.builderUrl || ''
    } : null,
    certificates: (detail.certificates || []).slice(0, 5),
    clips: (detail.clips || []).slice(0, 8),
    coachingPrompt: 'Use recent stats, tracking, incentives, upcoming schedule, and profile gaps to suggest practical next steps for the player. Avoid medical advice.'
  };
}

function summarizeFees(fees: any[]) {
  return {
    fees: (fees || []).slice(0, 15).map((fee) => pickFields(fee, [
      'id',
      'title',
      'teamId',
      'teamName',
      'playerId',
      'playerName',
      'status',
      'dueDate',
      'balanceDueCents',
      'totalAmountCents',
      'checkoutUrl'
    ]))
  };
}

function summarizeStatRowsTotals(rows: any[]) {
  const totals = (Array.isArray(rows) ? rows : []).reduce<Record<string, number>>((acc, row) => {
    Object.entries(row?.stats || {}).forEach(([key, value]) => {
      const numeric = Number(value);
      if (key && Number.isFinite(numeric)) {
        acc[key] = (acc[key] || 0) + numeric;
      }
    });
    return acc;
  }, {});
  return {
    gameCount: Array.isArray(rows) ? rows.length : 0,
    totals
  };
}

function summarizeRideOffer(offer: any) {
  return {
    id: offer.id,
    sourceGameId: offer.sourceGameId || null,
    driverUserId: offer.driverUserId || null,
    driverName: offer.driverName || null,
    seatCapacity: offer.seatCapacity,
    seatCountConfirmed: offer.seatCountConfirmed,
    seatsLeft: Math.max(0, Number(offer.seatCapacity || 0) - Number(offer.seatCountConfirmed || 0)),
    direction: offer.direction,
    status: offer.status,
    note: offer.note || null,
    requests: (offer.requests || []).slice(0, 12).map((request: any) => pickFields(request, [
      'id',
      'parentUserId',
      'childId',
      'childName',
      'status'
    ]))
  };
}

function summarizeHousehold(model: any) {
  return {
    linkedPlayers: (model.linkedPlayers || []).slice(0, 20).map((player: any) => pickFields(player, [
      'teamId',
      'teamName',
      'playerId',
      'playerName',
      'playerNumber'
    ])),
    members: (model.members || []).slice(0, 20).map((member: any) => pickFields(member, [
      'id',
      'email',
      'displayName',
      'status',
      'teamName',
      'playerName',
      'relation',
      'inviteUrl'
    ]))
  };
}

function summarizeFamilyShare(model: any) {
  return {
    children: (model.children || []).slice(0, 20).map((child: any) => pickFields(child, [
      'teamId',
      'teamName',
      'playerId',
      'playerName',
      'playerNumber'
    ])),
    tokens: (model.tokens || []).slice(0, 20).map((token: any) => pickFields(token, [
      'id',
      'label',
      'statusLabel',
      'expired',
      'childCount',
      'url'
    ]))
  };
}

function summarizeHelpKnowledge(results: ReturnType<typeof searchHelpKnowledge>) {
  return {
    results: results.map((result) => ({
      id: result.id,
      title: result.title,
      file: result.file,
      url: result.url,
      roles: result.roles,
      summary: result.summary,
      snippet: result.snippet
    }))
  };
}

async function resolveAccessibleTeamId(user: AuthUser, args: Record<string, unknown>) {
  const teamId = compactText(args.teamId);
  const teamName = compactText(args.teamName).toLowerCase();
  const home = await loadParentHome(user);
  const teams = home.teams || [];
  if (teamId && teams.some((team: any) => team.teamId === teamId)) return teamId;
  if (teamId) return null;
  if (teamName) {
    return teams.find((team: any) => compactText(team.teamName).toLowerCase().includes(teamName))?.teamId || null;
  }
  return teams[0]?.teamId || null;
}

async function resolveAccessiblePlayer(user: AuthUser, args: Record<string, unknown>) {
  const requestedTeamId = compactText(args.teamId);
  const requestedPlayerId = compactText(args.playerId);
  const requestedPlayerName = compactText(args.playerName).toLowerCase();
  const home = await loadParentHome(user);
  const players = [
    ...(home.players || []).map((player: any) => ({
      teamId: player.teamId,
      playerId: player.playerId || player.childId,
      name: player.name || player.childName || player.playerName,
      teamName: player.teamName
    })),
    ...(home.teams || []).flatMap((team: any) => (team.players || []).map((player: any) => ({
      teamId: team.teamId,
      playerId: player.playerId || player.childId || player.id,
      name: player.name || player.childName || player.playerName,
      teamName: team.teamName
    })))
  ].filter((player: any) => player.teamId && player.playerId);

  if (requestedTeamId && requestedPlayerId) {
    return players.find((player: any) => player.teamId === requestedTeamId && player.playerId === requestedPlayerId) || null;
  }
  if (requestedPlayerId) {
    return players.find((player: any) => player.playerId === requestedPlayerId) || null;
  }
  if (requestedPlayerName) {
    return players.find((player: any) => compactText(player.name).toLowerCase().includes(requestedPlayerName)) || null;
  }
  return players[0] || null;
}

function resolvePracticePacketChild(packet: any, args: Record<string, unknown>) {
  const requestedChildId = compactText(args.childId || args.playerId);
  const requestedPlayerName = compactText(args.playerName || args.childName).toLowerCase();
  const children = Array.isArray(packet.children) ? packet.children : [];
  if ((requestedChildId || requestedPlayerName) && !children.length) {
    throw new Error('No linked child was found for this practice packet.');
  }
  const child = children.find((candidate: any) => (
    (!requestedChildId || candidate.id === requestedChildId)
    && (!requestedPlayerName || compactText(candidate.name).toLowerCase().includes(requestedPlayerName))
  ));
  if ((requestedChildId || requestedPlayerName) && !child) {
    throw new Error('No matching child was found for this practice packet.');
  }
  const fallbackChild = child || children[0];
  if (!fallbackChild) throw new Error('No linked child was found for this practice packet.');
  return fallbackChild;
}

async function resolveFamilyShareToken(user: AuthUser, args: Record<string, unknown>) {
  const tokenId = compactText(args.tokenId || args.id);
  if (!tokenId) throw new Error('tokenId is required for family share changes.');
  const model = await loadFamilyShareModel(user);
  const token = (model.tokens || []).find((candidate: any) => candidate.id === tokenId);
  if (!token) throw new Error('No matching family share link was found.');
  return token;
}

function resolveAiAmountCents(args: Record<string, unknown>) {
  const cents = Number(args.amountCents);
  if (Number.isFinite(cents) && cents >= 0) return Math.round(cents);
  const amount = Number(args.amount || args.maxPerGameAmount);
  if (Number.isFinite(amount) && amount >= 0) return Math.round(amount * 100);
  return 0;
}

async function resolvePlayerIncentiveRule(user: AuthUser, args: Record<string, unknown>) {
  const player = await resolveAccessiblePlayer(user, args);
  if (!player) throw new Error('No matching player was found for this account.');
  const detail = await loadPlayerDetailForAi(user, { ...args, teamId: player.teamId, playerId: player.playerId });
  const ruleId = compactText(args.ruleId || args.id);
  const rule = (detail.incentives?.currentRules || []).find((candidate: any) => (
    ruleId ? candidate.id === ruleId : compactText(candidate.statKey).toLowerCase() === compactText(args.statKey || args.stat).toLowerCase()
  ));
  if (!rule) throw new Error('No matching incentive rule was found for this player.');
  return { player, rule };
}

function summarizeScheduleEvent(event: ParentScheduleEvent) {
  const openAssignments = getOpenScheduleAssignments(event.assignments || []);
  return {
    eventId: event.id,
    teamId: event.teamId,
    teamName: event.teamName,
    type: event.type,
    title: getScheduleTitle(event),
    childId: event.childId,
    childName: event.childName,
    date: event.date.toISOString(),
    dateLabel: formatEventDateLabel(event.date),
    timeLabel: formatEventTimeLabel(event.date),
    location: event.location,
    status: event.status || null,
    isCancelled: event.isCancelled,
    myRsvp: event.myRsvp || 'not_responded',
    rsvpSummary: event.rsvpSummary || null,
    rideshareSummary: event.rideshareSummary || null,
    openAssignments: openAssignments.map((assignment) => assignment.role).filter(Boolean),
    practiceHomePacketSummary: event.practiceHomePacketSummary || null,
    score: typeof event.homeScore === 'number' || typeof event.awayScore === 'number'
      ? { home: event.homeScore ?? null, away: event.awayScore ?? null }
      : null
  };
}

function summarizeTeamEvent(event: any) {
  const date = normalizeScheduleDate(event.date);
  return {
    eventId: event.id,
    type: event.type,
    title: event.title || (event.type === 'practice' ? 'Practice' : `vs. ${event.opponent || 'TBD'}`),
    date: date?.toISOString() || null,
    dateLabel: date ? formatEventDateLabel(date) : '',
    timeLabel: date ? formatEventTimeLabel(date) : '',
    location: event.location,
    opponent: event.opponent || null,
    status: event.status || null,
    score: typeof event.homeScore === 'number' || typeof event.awayScore === 'number'
      ? { home: event.homeScore ?? null, away: event.awayScore ?? null }
      : null
  };
}

function parseJsonObject(text: string): any | null {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function pickFields(source: Record<string, any>, fields: string[]) {
  return fields.reduce<Record<string, any>>((acc, field) => {
    const value = source?.[field];
    if (value !== undefined && value !== null && value !== '') {
      acc[field] = value;
    }
    return acc;
  }, {});
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compactText(value: unknown) {
  return String(value || '').trim();
}

function buildConversationTitle(prompt: string) {
  const compact = compactText(prompt).replace(/\s+/g, ' ');
  return compact.length > 52 ? `${compact.slice(0, 49)}...` : compact || 'New chat';
}

function normalizeConversationId(conversationId: unknown) {
  return compactText(conversationId) || DEFAULT_PRIVATE_AI_CONVERSATION_ID;
}

function messageBelongsToConversation(message: PrivateAiMessage, conversationId: string) {
  const activeConversationId = normalizeConversationId(conversationId);
  const messageConversationId = normalizeConversationId(message.conversationId);
  return activeConversationId === DEFAULT_PRIVATE_AI_CONVERSATION_ID
    ? messageConversationId === DEFAULT_PRIVATE_AI_CONVERSATION_ID
    : messageConversationId === activeConversationId;
}

function looksLikeFunctionalHelpQuestion(question: string) {
  const text = compactText(question).toLowerCase();
  if (!text) return false;
  return [
    'how do ',
    'how can ',
    'where do ',
    'where can ',
    'what does ',
    'what is ',
    'can i ',
    'why can',
    'help',
    'troubleshoot',
    'setup',
    'set up',
    'create',
    'invite',
    'reset password',
    'verify email',
    'upload',
    'share',
    'export',
    'import',
    'rsvp',
    'rideshare',
    'registration',
    'fees',
    'payments',
    'roster',
    'schedule',
    'track',
    'live game',
    'replay',
    'match report'
  ].some((term) => text.includes(term));
}

function looksLikeLastGameQuestion(question: string) {
  const text = compactText(question).toLowerCase();
  return /\b(last|previous|most recent|latest|prior)\b/.test(text) && /\bgame|match\b/.test(text);
}

function clampAnswer(answer: string) {
  return compactText(answer).slice(0, maxAnswerCharacters) || 'I could not find enough information to answer that.';
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
