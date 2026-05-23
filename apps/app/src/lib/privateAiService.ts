import {
  getChatMessages,
  getGames,
  getParentTeams,
  getPlayers,
  getTeam,
  getUnreadChatCounts,
  getUserProfile,
  getUserTeamsWithAccess,
  listParentTeamFeeRecipients
} from '../../../../js/db.js';
import {
  db,
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp
} from '../../../../js/firebase.js';
import { getApp } from '../../../../js/vendor/firebase-app.js';
import { getAI, getGenerativeModel, GoogleAIBackend } from '../../../../js/vendor/firebase-ai.js';
import {
  formatEventDateLabel,
  formatEventTimeLabel,
  getOpenScheduleAssignments,
  getScheduleTitle,
  normalizeScheduleDate,
  type ParentScheduleEvent
} from './scheduleLogic';
import { loadParentSchedule } from './scheduleService';
import type { AuthUser } from './types';

export type PrivateAiRole = 'user' | 'assistant';

export type PrivateAiMessage = {
  id: string;
  role: PrivateAiRole;
  text: string;
  createdAt: Date;
  toolNames?: string[];
  error?: boolean;
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

export async function loadPrivateAiMessages(user: AuthUser | null, messageLimit = maxLoadedMessages): Promise<PrivateAiMessage[]> {
  if (!user?.uid) return [];

  const snapshot = await getDocs(query(
    collection(db, 'users', user.uid, privateAiCollectionName),
    orderBy('createdAt', 'desc'),
    limit(messageLimit)
  ));

  return (snapshot.docs || [])
    .map((document: any) => normalizePrivateAiMessage(document.id, document.data?.() || {}))
    .filter((message: PrivateAiMessage | null): message is PrivateAiMessage => Boolean(message))
    .reverse();
}

export async function sendPrivateAiMessage(user: AuthUser, prompt: string): Promise<PrivateAiSendResult> {
  if (!user?.uid) {
    throw new Error('Sign in before using the AI chat.');
  }

  const question = compactText(prompt).slice(0, maxPromptCharacters);
  if (!question) {
    throw new Error('Type a message first.');
  }

  const priorMessages = await loadPrivateAiMessages(user, maxHistoryMessages).catch(() => []);
  const userMessage = await savePrivateAiMessage(user, {
    role: 'user',
    text: question
  });

  try {
    const aiResult = await generatePrivateAiAnswer(user, question, priorMessages);
    const assistantMessage = await savePrivateAiMessage(user, {
      role: 'assistant',
      text: aiResult.answer,
      toolNames: aiResult.toolResults.filter((result) => result.ok).map((result) => result.name)
    });

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
      error: true
    });

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
          data: summarizeHome(await loadPrivateAiHome(user))
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
          data: summarizeMessages(await loadPrivateAiChatInbox(user))
        };
      case 'get_team_detail': {
        const teamId = await resolveAccessibleTeamId(user, args);
        if (!teamId) {
          return { name, ok: false, error: 'No matching team was found for this account.' };
        }
        return {
          name,
          ok: true,
          data: summarizeTeamDetail(await loadPrivateAiTeamDetail(teamId, user))
        };
      }
      case 'get_fees':
        return {
          name,
          ok: true,
          data: summarizeFees(await loadPrivateAiFees(user))
        };
      case 'get_parent_tools': {
        return {
          name,
          ok: true,
          data: {
            registrations: [],
            certificates: []
          }
        };
      }
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

async function loadPrivateAiHome(user: AuthUser) {
  const schedule = await loadParentSchedule(user);
  const [messages, fees] = await Promise.all([
    loadPrivateAiChatInbox(user).catch(() => ({ teams: [] })),
    loadPrivateAiFees(user).catch(() => [])
  ]);
  const upcomingEvents = schedule.events
    .filter((event) => !event.isCancelled && event.date.getTime() >= startOfDay(new Date()).getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const teamsById = new Map<string, any>();

  schedule.children.forEach((child) => {
    if (!teamsById.has(child.teamId)) {
      teamsById.set(child.teamId, {
        teamId: child.teamId,
        teamName: child.teamName,
        sport: null,
        role: 'Parent',
        players: [],
        unreadCount: 0,
        openActions: 0,
        nextEvent: null
      });
    }
    teamsById.get(child.teamId).players.push({
      playerId: child.playerId,
      playerName: child.playerName,
      teamId: child.teamId,
      teamName: child.teamName
    });
  });

  messages.teams.forEach((team: any) => {
    if (!teamsById.has(team.teamId)) {
      teamsById.set(team.teamId, {
        teamId: team.teamId,
        teamName: team.teamName,
        sport: team.sport || null,
        role: team.role || 'Team',
        players: [],
        unreadCount: 0,
        openActions: 0,
        nextEvent: null
      });
    }
    const existing = teamsById.get(team.teamId);
    existing.unreadCount = Number(team.unreadCount || 0);
    existing.sport = existing.sport || team.sport || null;
    existing.role = team.role || existing.role;
  });

  const teams = [...teamsById.values()].map((team) => {
    const teamEvents = upcomingEvents.filter((event) => event.teamId === team.teamId);
    return {
      ...team,
      nextEvent: teamEvents[0] || null,
      openActions: teamEvents.filter((event) => event.myRsvp === 'not_responded').length + Number(team.unreadCount || 0)
    };
  });

  const rsvpNeeded = upcomingEvents.filter((event) => event.isDbGame && !event.availabilityLocked && event.myRsvp === 'not_responded').length;
  const packetsReady = upcomingEvents.filter((event) => event.practiceHomePacketSummary).length;
  const actionItems = [
    ...upcomingEvents
      .filter((event) => event.isDbGame && !event.availabilityLocked && event.myRsvp === 'not_responded')
      .slice(0, 5)
      .map((event) => ({
        kind: 'rsvp',
        title: `${event.childName} needs availability`,
        detail: `${event.teamName} ${getScheduleTitle(event)} · ${formatEventDateLabel(event.date)} ${formatEventTimeLabel(event.date)}`,
        to: `/schedule/${event.teamId}/${event.id}`,
        priority: 10
      })),
    ...messages.teams
      .filter((team: any) => Number(team.unreadCount || 0) > 0)
      .slice(0, 5)
      .map((team: any) => ({
        kind: 'message',
        title: `${team.unreadCount} unread message${Number(team.unreadCount) === 1 ? '' : 's'}`,
        detail: team.teamName,
        to: `/messages/${team.teamId}`,
        priority: 60
      }))
  ];

  return {
    metrics: {
      players: schedule.children.length,
      teams: teams.length,
      rsvpNeeded,
      unreadMessages: messages.teams.reduce((total: number, team: any) => total + Number(team.unreadCount || 0), 0),
      packetsReady
    },
    actionItems,
    players: schedule.children.map((child) => ({
      playerId: child.playerId,
      playerName: child.playerName,
      teamId: child.teamId,
      teamName: child.teamName,
      nextEvent: upcomingEvents.find((event) => event.teamId === child.teamId && event.childId === child.playerId) || null
    })),
    teams,
    upcomingEvents: upcomingEvents.slice(0, 8),
    fees
  };
}

async function loadPrivateAiChatInbox(user: AuthUser) {
  const teams = await loadAccessibleTeams(user);
  const teamIds = teams.map((team: any) => team.id).filter(Boolean);
  const unreadCounts = teamIds.length ? await getUnreadChatCounts(user.uid, teamIds).catch(() => ({})) : {};
  const inboxTeams = await Promise.all(teams.map(async (team: any) => {
    const messages = await Promise.resolve(getChatMessages(team.id, { limit: 1 })).catch(() => []);
    const lastMessage = messages[0] || null;
    return {
      id: team.id,
      teamId: team.id,
      name: team.name || 'Team',
      teamName: team.name || 'Team',
      sport: team.sport || null,
      role: getAccessibleTeamRole(user, team),
      unreadCount: Number((unreadCounts as Record<string, number>)[team.id] || 0),
      lastMessage
    };
  }));

  return { teams: inboxTeams };
}

async function loadPrivateAiFees(user: AuthUser) {
  const schedule = await loadParentSchedule(user).catch(() => ({ children: [], events: [] }));
  return Promise.resolve(listParentTeamFeeRecipients(user.uid, schedule.children)).catch(() => []);
}

async function loadPrivateAiTeamDetail(teamId: string, user: AuthUser) {
  const [team, players, games] = await Promise.all([
    Promise.resolve(getTeam(teamId, { includeInactive: true })),
    Promise.resolve(getPlayers(teamId, { includeInactive: true })).catch(() => []),
    Promise.resolve(getGames(teamId)).catch(() => [])
  ]);
  const now = new Date();
  const sortedGames = (Array.isArray(games) ? games : [])
    .map((game: any) => ({ ...game, date: normalizeScheduleDate(game.date || game.dateTime || game.startTime) || new Date(0) }))
    .sort((a: any, b: any) => a.date.getTime() - b.date.getTime());
  const linkedPlayerIds = new Set((user.parentOf || [])
    .filter((link: any) => link?.teamId === teamId)
    .map((link: any) => String(link.playerId || link.childId || '').trim())
    .filter(Boolean));
  const normalizedPlayers = (Array.isArray(players) ? players : []).map((player: any) => ({
    id: player.id,
    name: player.name || player.playerName || 'Player',
    number: player.number || '',
    position: player.position || '',
    photoUrl: player.photoUrl || player.imageUrl || null,
    isLinked: linkedPlayerIds.has(player.id)
  }));

  return {
    team: {
      id: teamId,
      name: team?.name || 'Team',
      sport: team?.sport || null,
      photoUrl: team?.photoUrl || team?.teamPhotoUrl || null,
      description: team?.description || ''
    },
    players: normalizedPlayers,
    linkedPlayers: normalizedPlayers.filter((player) => player.isLinked),
    upcomingEvents: sortedGames.filter((game: any) => game.date.getTime() >= startOfDay(now).getTime()).slice(0, 8),
    recentResults: sortedGames.filter((game: any) => game.date.getTime() < startOfDay(now).getTime()).reverse().slice(0, 6),
    nextEvent: sortedGames.find((game: any) => game.date.getTime() >= startOfDay(now).getTime()) || null,
    record: null,
    standings: { enabled: false },
    leaderboards: [],
    trackingSummaries: [],
    counts: {
      games: sortedGames.filter((game: any) => String(game.type || 'game').toLowerCase() !== 'practice').length,
      practices: sortedGames.filter((game: any) => String(game.type || '').toLowerCase() === 'practice').length,
      completedGames: sortedGames.filter((game: any) => String(game.status || '').toLowerCase() === 'completed').length
    }
  };
}

async function loadAccessibleTeams(user: AuthUser) {
  const [parentTeams, accessTeams] = await Promise.all([
    Promise.resolve(getParentTeams(user.uid, { includeInactive: true })).catch(() => []),
    Promise.resolve(getUserTeamsWithAccess(user.uid, user.email, { includeInactive: true })).catch(() => [])
  ]);
  const byId = new Map<string, any>();
  [...(parentTeams || []), ...(accessTeams || [])].forEach((team: any) => {
    if (team?.id) byId.set(team.id, team);
  });
  return [...byId.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function getAccessibleTeamRole(user: AuthUser, team: any) {
  const email = String(user.email || '').toLowerCase();
  if (team.ownerId === user.uid) return 'Admin';
  if (Array.isArray(team.adminEmails) && team.adminEmails.map((value: unknown) => String(value || '').toLowerCase()).includes(email)) return 'Coach';
  if ((user.parentOf || []).some((link: any) => link?.teamId === team.id)) return 'Parent';
  return 'Team';
}

function getChatInboxPreview(message: any) {
  if (!message) return 'No messages yet';
  const sender = message.ai ? 'ALL PLAYS' : message.senderName || message.senderEmail || 'Unknown';
  const text = String(message.text || '').trim();
  return `${sender}: ${text || 'Attachment'}`;
}

async function savePrivateAiMessage(user: AuthUser, input: {
  role: PrivateAiRole;
  text: string;
  toolNames?: string[];
  error?: boolean;
}): Promise<PrivateAiMessage> {
  const createdAt = new Date();
  const payload = {
    role: input.role,
    text: input.text,
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
    createdAt,
    toolNames: input.toolNames || [],
    error: input.error === true
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
    createdAt: normalizeScheduleDate(data.createdAt) || normalizeScheduleDate(data.clientCreatedAt) || new Date(0),
    toolNames: Array.isArray(data.toolNames) ? data.toolNames.map((name: unknown) => compactText(name)).filter(Boolean) : [],
    error: data.error === true
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
    `- get_fees: open parent fee records.\n` +
    `- get_parent_tools: registrations and certificates.\n\n` +
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
      name: player.name || player.childName || player.playerName,
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
      players: (team.players || []).map((player: any) => player.name || player.childName || player.playerName).filter(Boolean),
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
    children: (schedule.children || []).slice(0, 20).map((child: any) => pickFields(child, ['playerId', 'childId', 'name', 'childName', 'playerName', 'teamId', 'teamName'])),
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

async function resolveAccessibleTeamId(user: AuthUser, args: Record<string, unknown>) {
  const teamId = compactText(args.teamId);
  const teamName = compactText(args.teamName).toLowerCase();
  const teams = await loadAccessibleTeams(user);
  if (teamId && teams.some((team: any) => team.id === teamId)) return teamId;
  if (teamId) return null;
  if (teamName) {
    return teams.find((team: any) => compactText(team.name).toLowerCase().includes(teamName))?.id || null;
  }
  return teams[0]?.id || null;
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

function clampAnswer(answer: string) {
  return compactText(answer).slice(0, maxAnswerCharacters) || 'I could not find enough information to answer that.';
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
