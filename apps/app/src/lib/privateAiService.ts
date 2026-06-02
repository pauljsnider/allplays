import { getUserProfile } from '../../../../js/db.js';
import {
  db,
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from '../../../../js/firebase.js';
import { getApp } from '../../../../js/vendor/firebase-app.js';
import { getAI, getGenerativeModel, GoogleAIBackend } from '../../../../js/vendor/firebase-ai.js';
import { getChatInboxPreview, loadChatInbox } from './chatService';
import { searchHelpKnowledge } from './helpKnowledgeService';
import { loadParentHome } from './homeService';
import {
  loadParentCertificates,
  loadParentFeesForApp,
  loadParentRegistrations
} from './parentToolsService';
import { loadParentPlayerDetail } from './playerService';
import {
  formatEventDateLabel,
  formatEventTimeLabel,
  getOpenScheduleAssignments,
  getScheduleTitle,
  normalizeScheduleDate,
  type ParentScheduleEvent
} from './scheduleLogic';
import { loadParentSchedule } from './scheduleService';
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
};

export type PrivateAiSendResult = {
  userMessage: PrivateAiMessage;
  assistantMessage: PrivateAiMessage;
  toolResults: PrivateAiToolResult[];
};

const privateAiCollectionName = 'privateAiMessages';
const privateAiConversationCollectionName = 'privateAiConversations';
export const DEFAULT_PRIVATE_AI_CONVERSATION_ID = 'default';
export const DRAFT_PRIVATE_AI_CONVERSATION_ID = '__draft__';
const maxLoadedMessages = 80;
const maxHistoryMessages = 12;
const maxToolRounds = 2;
const maxToolCallsPerRound = 3;
const maxPromptCharacters = 1800;
const maxAnswerCharacters = 2400;

let aiModelCache: any = null;

export function resetPrivateAiModelForTests() {
  aiModelCache = null;
}

export async function loadPrivateAiConversations(user: AuthUser | null, conversationLimit = 30): Promise<PrivateAiConversation[]> {
  if (!user?.uid) return [];

  const snapshot = await getDocs(query(
    collection(db, 'users', user.uid, privateAiConversationCollectionName),
    orderBy('updatedAt', 'desc'),
    limit(conversationLimit)
  ));

  const conversations = (snapshot.docs || [])
    .map((document: any) => normalizePrivateAiConversation(document.id, document.data?.() || {}))
    .filter((conversation: PrivateAiConversation | null): conversation is PrivateAiConversation => Boolean(conversation));

  if (conversations.length) {
    return conversations;
  }

  const legacyMessages = await loadPrivateAiMessages(user, maxHistoryMessages, DEFAULT_PRIVATE_AI_CONVERSATION_ID).catch(() => []);
  return legacyMessages.length ? [buildDefaultConversation(legacyMessages)] : [];
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
  const snapshot = await getDocs(query(
    collection(db, 'users', user.uid, privateAiCollectionName),
    orderBy('createdAt', 'desc'),
    limit(Math.max(messageLimit, maxLoadedMessages))
  ));

  return (snapshot.docs || [])
    .map((document: any) => normalizePrivateAiMessage(document.id, document.data?.() || {}))
    .filter((message: PrivateAiMessage | null): message is PrivateAiMessage => Boolean(message))
    .filter((message: PrivateAiMessage) => messageBelongsToConversation(message, activeConversationId))
    .reverse();
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
    const aiResult = await generatePrivateAiAnswer(user, question, priorMessages);
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
    console.warn('[private-ai] Unable to generate answer:', error);
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
  priorMessages: PrivateAiMessage[] = []
): Promise<{ answer: string; toolResults: PrivateAiToolResult[] }> {
  const model = await getPrivateAiModel();
  const history = summarizeChatHistory(priorMessages);
  const toolResults: PrivateAiToolResult[] = [];
  if (looksLikeFunctionalHelpQuestion(question)) {
    toolResults.push(await runPrivateAiTool(user, {
      name: 'get_help',
      args: {
        query: question,
        limit: 5
      }
    }));
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

    const roundResults = await Promise.all(calls.map((call) => runPrivateAiTool(user, call)));
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

export async function runPrivateAiTool(user: AuthUser, call: PrivateAiToolCall): Promise<PrivateAiToolResult> {
  const name = compactText(call.name);
  const args = isPlainObject(call.args) ? call.args : {};

  try {
    switch (name) {
      case 'get_profile':
        return {
          name,
          ok: true,
          data: summarizeProfile(user, await getUserProfile(user.uid).catch(() => null))
        };
      case 'get_home':
        return {
          name,
          ok: true,
          data: summarizeHome(await loadParentHome(user))
        };
      case 'get_schedule':
        return {
          name,
          ok: true,
          data: summarizeSchedule(await loadParentSchedule(user), args)
        };
      case 'get_messages':
        return {
          name,
          ok: true,
          data: summarizeMessages(await loadChatInbox(user))
        };
      case 'get_team_detail': {
        const teamId = await resolveAccessibleTeamId(user, args);
        if (!teamId) {
          return { name, ok: false, error: 'No matching team was found for this account.' };
        }
        return {
          name,
          ok: true,
          data: summarizeTeamDetail(await loadParentTeamDetail(teamId, user))
        };
      }
      case 'get_player_development': {
        const player = await resolveAccessiblePlayer(user, args);
        if (!player) {
          return { name, ok: false, error: 'No matching player was found for this account.' };
        }
        return {
          name,
          ok: true,
          data: summarizePlayerDevelopment(await loadParentPlayerDetail(user, player.teamId, player.playerId))
        };
      }
      case 'get_fees':
        return {
          name,
          ok: true,
          data: summarizeFees(await loadParentFeesForApp(user))
        };
      case 'get_parent_tools': {
        const [registrations, certificates] = await Promise.all([
          loadParentRegistrations(user).catch(() => []),
          loadParentCertificates(user).catch(() => [])
        ]);
        return {
          name,
          ok: true,
          data: {
            registrations: registrations.slice(0, 10),
            certificates: certificates.slice(0, 10)
          }
        };
      }
      case 'get_help':
        return {
          name,
          ok: true,
          data: summarizeHelpKnowledge(searchHelpKnowledge({
            query: compactText(args.query) || compactText(args.topic) || compactText(args.question),
            roles: user.roles || [],
            limit: Number(args.limit || 5)
          }))
        };
      default:
        return { name, ok: false, error: `Unsupported tool: ${name}` };
    }
  } catch (error: any) {
    return {
      name,
      ok: false,
      error: error?.message || 'Tool failed.'
    };
  }
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

function buildDefaultConversation(messages: PrivateAiMessage[]): PrivateAiConversation {
  const latest = messages[messages.length - 1];
  const now = latest?.createdAt || new Date(0);
  return {
    id: DEFAULT_PRIVATE_AI_CONVERSATION_ID,
    title: 'Recent chat',
    createdAt: messages[0]?.createdAt || now,
    updatedAt: now,
    lastMessagePreview: latest?.text || ''
  };
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
    `If you need data, return {"toolCalls":[{"name":"get_schedule","args":{"range":"upcoming","limit":8}}]}.\n` +
    `If you have enough information, return {"answer":"..."}.\n\n` +
    `AVAILABLE TOOLS:\n` +
    `- get_profile: account profile and role summary.\n` +
    `- get_home: players, teams, next events, unread messages, packets, fees, and priority actions.\n` +
    `- get_schedule: schedule events. Args: range upcoming|recent|all, type game|practice, teamId, teamName, playerName, limit.\n` +
    `- get_messages: team chat inbox, unread counts, and latest previews.\n` +
    `- get_team_detail: one accessible team. Args: teamId or teamName.\n` +
    `- get_player_development: one linked player, recent stats, tracking summaries, incentives, profile, clips, and next actions for coaching/development. Args: playerId, teamId, playerName.\n` +
    `- get_fees: open parent fee records.\n` +
    `- get_parent_tools: registrations and certificates.\n` +
    `- get_help: ALL PLAYS help/workflow documentation for how-to, setup, feature, and troubleshooting questions. Args: query, limit.\n\n` +
    `USER:\n${JSON.stringify(summarizeSignedInUser(user))}\n\n` +
    `RECENT CHAT HISTORY:\n${JSON.stringify(history)}\n\n` +
    `QUESTION:\n${question}\n\n` +
    `TOOL RESULTS SO FAR:\n${JSON.stringify(toolResults)}\n`;
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
    `Answer concisely. Include dates, times, team names, and player names when relevant.\n` +
    `Return strict JSON only: {"answer":"..."}.\n\n` +
    `USER:\n${JSON.stringify(summarizeSignedInUser(user))}\n\n` +
    `RECENT CHAT HISTORY:\n${JSON.stringify(history)}\n\n` +
    `QUESTION:\n${question}\n\n` +
    `TOOL RESULTS:\n${JSON.stringify(toolResults)}\n`;
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

function clampAnswer(answer: string) {
  return compactText(answer).slice(0, maxAnswerCharacters) || 'I could not find enough information to answer that.';
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
