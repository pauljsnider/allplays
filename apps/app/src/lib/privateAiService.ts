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
  runTransaction,
  serverTimestamp,
  startAfter,
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
  createScheduleImportGame,
  createScheduleImportPractice,
  finalizeScheduleImportBatch,
  setParentScheduleRideOfferStatus,
  submitParentScheduleRsvp,
  submitParentScheduleRsvpForChildren,
  summarizeParentScheduleRideOffers
} from './scheduleService';
import {
  applyRosterImportPlanForApp,
  createRosterParentInviteForApp,
  loadParentTeamDetail,
  loadRosterImportContextForApp,
  retryRosterParentInviteEmailForApp,
  type RosterImportPlannedOperationForApp
} from './teamDetailService';
import {
  buildRosterAiImportCommitPlan,
  extractPastedRosterCsv,
  generateRosterAiImportRows,
  normalizeRosterAiImportResponse,
  type RosterAiImportPreviewRow
} from './rosterAiImport';
import {
  generateScheduleAiImportRows
} from './scheduleAiImport';
import {
  buildScheduleImportPreview,
  inferScheduleCsvMapping,
  normalizeScheduleImportDraft,
  parseCsvText,
  type ScheduleCsvImportPreviewRow
} from './scheduleCsvImport';
import type { AuthUser } from './types';
import { startWorkflowTimer, WORKFLOW_TIMING } from './workflowTiming';

export type PrivateAiRole = 'user' | 'assistant';

export type PrivateAiMessage = {
  id: string;
  role: PrivateAiRole;
  text: string;
  createdAt: Date;
  conversationId?: string;
  attachment?: PrivateAiAttachmentReceipt;
  toolNames?: string[];
  pendingActionIds?: string[];
  artifacts?: PrivateAiArtifactReference[];
  error?: boolean;
};

export type PrivateAiAttachmentReceipt = {
  name: string;
  kind: 'csv' | 'image' | 'pdf';
  mimeType: string;
};

export type PrivateAiRosterArtifactReference = {
  type: 'roster-import';
  confirmationId: string;
  teamId: string;
  teamName: string;
  source: 'csv' | 'ai-text' | 'ai-image' | 'ai-document';
  summary: {
    total: number;
    add: number;
    update: number;
    deactivate: number;
    reactivate: number;
    invitations: number;
    errors: number;
  };
  previewRows?: RosterAiImportPreviewRow[];
};

export type PrivateAiScheduleArtifactReference = {
  type: 'schedule-import';
  confirmationId: string;
  teamId: string;
  teamName: string;
  source: 'csv' | 'ai-text' | 'ai-image' | 'ai-document';
  summary: {
    total: number;
    games: number;
    practices: number;
    errors: number;
  };
  previewRows?: ScheduleCsvImportPreviewRow[];
};

export type PrivateAiDocumentArtifactReference = {
  type: 'document-analysis';
  confirmationId: '';
  teamId: string;
  teamName: string;
  source: 'csv' | 'image' | 'pdf';
  fileName: string;
  mimeType: string;
  summary: {
    total: 1;
    errors: number;
  };
};

export type PrivateAiArtifactReference =
  | PrivateAiRosterArtifactReference
  | PrivateAiScheduleArtifactReference
  | PrivateAiDocumentArtifactReference;

export type PrivateAiRosterProposalRevision = {
  confirmationId: string;
  teamId: string;
  messageId: string;
  rows: RosterAiImportPreviewRow[];
};

export type PrivateAiScheduleProposalRevision = {
  confirmationId: string;
  teamId: string;
  messageId?: string;
  rows: ScheduleCsvImportPreviewRow[];
};

export type PrivateAiAttachmentIntent = 'roster-import' | 'schedule-import' | 'general-analysis';

export type PrivateAiAttachmentInput = {
  teamId?: string;
  teamName?: string;
  text?: string;
  file: File;
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
const teamPrivateAiPendingActionCollectionName = 'privateAiPendingActions';
const logger = createLogger('private-ai');
export const DEFAULT_PRIVATE_AI_CONVERSATION_ID = 'default';
export const DRAFT_PRIVATE_AI_CONVERSATION_ID = '__draft__';
const maxLoadedMessages = 80;
const maxConversationRecoveryPages = 30;
const maxHistoryMessages = 12;
const maxToolRounds = 2;
const maxToolCallsPerRound = 3;
const maxPromptCharacters = 1800;
const maxAnswerCharacters = 2400;
const confirmationIdPrefix = 'ai';
export const maxPrivateAiAttachmentBytes = 10 * 1024 * 1024;
const confirmedWriteExecutionToken = Symbol('confirmed-private-ai-write');

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
  previewSummary?: Record<string, unknown>;
  teamId?: string;
  payloadScope?: 'user' | 'team';
  expiresAt: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'superseded';
};

type PrivateAiToolDefinition = {
  name: string;
  mode: PrivateAiToolMode;
  description: string;
  aliases?: string[];
  domain?: string;
  audience?: 'all' | 'family' | 'manager';
  prepare?: (user: AuthUser, args: Record<string, unknown>) => Promise<{
    args: Record<string, unknown>;
    summary?: string;
    previewSummary?: Record<string, unknown>;
  }>;
  resolve: (user: AuthUser, args: Record<string, unknown>) => Promise<unknown>;
};

type PrivateAiToolContext = {
  conversationId?: string;
  confirmationGroupId?: string;
  allowedToolNames?: string[];
};

type InternalPrivateAiToolContext = PrivateAiToolContext & {
  confirmedWriteToken?: symbol;
};

const pendingActionLifetimeMs = 30 * 60 * 1000;

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
    loadPrivateAiConversationRecoveryMessages(user).catch(() => [])
  ]);

  const storedConversations = (conversationSnapshot.docs || [])
    .map((document: any) => normalizePrivateAiConversation(document.id, document.data?.() || {}))
    .filter((conversation: PrivateAiConversation | null): conversation is PrivateAiConversation => Boolean(conversation));
  const recoveredConversations = recoverPrivateAiConversations(messages);
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
  const messages = await loadPrivateAiMessagesForConversation(
    user,
    activeConversationId,
    Math.max(messageLimit, maxLoadedMessages)
  );

  return messages.reverse();
}

async function loadPrivateAiConversationRecoveryMessages(user: AuthUser): Promise<PrivateAiMessage[]> {
  const recoveredMessages: PrivateAiMessage[] = [];
  let cursor: any = null;

  for (let page = 0; page < maxConversationRecoveryPages; page += 1) {
    const snapshot = await getDocs(query(
      collection(db, 'users', user.uid, privateAiCollectionName),
      orderBy('createdAt', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(maxLoadedMessages)
    ));
    const documents = snapshot.docs || [];
    const pageMessages = documents
      .map((document: any) => normalizePrivateAiMessage(document.id, document.data?.() || {}))
      .filter((message: PrivateAiMessage | null): message is PrivateAiMessage => Boolean(message));

    recoveredMessages.push(...pageMessages);
    if (documents.length < maxLoadedMessages) break;
    cursor = documents[documents.length - 1];
    if (!cursor) break;
  }

  return recoveredMessages;
}

async function loadPrivateAiMessagesForConversation(
  user: AuthUser,
  conversationId: string,
  messageLimit: number
): Promise<PrivateAiMessage[]> {
  const conversationMessages: PrivateAiMessage[] = [];
  let cursor: any = null;

  for (let page = 0; page < maxConversationRecoveryPages; page += 1) {
    const snapshot = await getDocs(query(
      collection(db, 'users', user.uid, privateAiCollectionName),
      orderBy('createdAt', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(maxLoadedMessages)
    ));
    const documents = snapshot.docs || [];
    const pageMessages: PrivateAiMessage[] = documents
      .map((document: any) => normalizePrivateAiMessage(document.id, document.data?.() || {}))
      .filter((message: PrivateAiMessage | null): message is PrivateAiMessage => Boolean(message))
      .filter((message: PrivateAiMessage) => messageBelongsToConversation(message, conversationId));

    conversationMessages.push(...pageMessages);
    if (conversationMessages.length >= messageLimit || documents.length < maxLoadedMessages) break;
    cursor = documents[documents.length - 1];
    if (!cursor) break;
  }

  return conversationMessages.slice(0, messageLimit);
}

export async function sendPrivateAiMessage(
  user: AuthUser,
  prompt: string,
  conversationId = DEFAULT_PRIVATE_AI_CONVERSATION_ID,
  requestContext: { teamId?: string; teamName?: string } = {}
): Promise<PrivateAiSendResult> {
  if (!user?.uid) {
    throw new Error('Sign in before using the AI chat.');
  }

  const untruncatedRawQuestion = String(prompt || '').trim();
  const rawQuestion = untruncatedRawQuestion.slice(0, maxPromptCharacters);
  const question = compactText(rawQuestion);
  if (!question) {
    throw new Error('Type a message first.');
  }
  if (isPrivateAiRosterImportRequest(untruncatedRawQuestion)) {
    const csvText = extractPastedRosterCsv(untruncatedRawQuestion);
    const rosterInstruction = stripPastedRosterCsvFromInstruction(
      untruncatedRawQuestion,
      csvText
    ).slice(0, maxPromptCharacters);
    return sendPrivateAiRosterImportMessage(user, {
      teamId: compactText(requestContext.teamId),
      teamName: compactText(requestContext.teamName),
      text: rosterInstruction,
      csvText: csvText || undefined
    }, conversationId);
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
      toolNames: aiResult.toolResults.filter((result) => result.ok).map((result) => result.name),
      pendingActionIds: aiResult.toolResults
        .filter((result) => result.ok && result.requiresConfirmation === true)
        .map((result) => compactText(result.confirmationId))
        .filter(Boolean)
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

export function getPrivateAiAttachmentValidationError(file: File | null): string {
  if (!file) return 'Choose an image, CSV, or PDF first.';
  const fileName = file.name.toLowerCase();
  const supported = file.type === 'application/pdf'
    || file.type === 'text/csv'
    || file.type === 'application/csv'
    || file.type.startsWith('image/')
    || /\.(csv|pdf|png|jpe?g|webp|heic|heif)$/.test(fileName);
  if (!supported) return 'Attach a CSV, PDF, PNG, JPEG, WebP, HEIC, or HEIF file.';
  if (file.size <= 0) return 'That attachment is empty.';
  if (file.size > maxPrivateAiAttachmentBytes) return 'Attachments must be 10 MB or smaller.';
  return '';
}

export function inferPrivateAiAttachmentIntent(input: {
  text?: string;
  fileName?: string;
  csvText?: string;
}): PrivateAiAttachmentIntent {
  const instruction = compactText(input.text).toLowerCase();
  const fileName = compactText(input.fileName).toLowerCase();
  const header = String(input.csvText || '').split(/\r?\n/, 1)[0].toLowerCase();
  const rosterInstruction = /\b(roster|player|players|athlete|athletes|jersey|guardian|parent contacts?|family contacts?)\b/.test(instruction);
  const scheduleInstruction = /\b(schedule|calendar|games?|practices?|fixtures?|tournament)\b/.test(instruction);
  if (rosterInstruction && !scheduleInstruction) return 'roster-import';
  if (scheduleInstruction && !rosterInstruction) return 'schedule-import';

  const rosterHeaderScore = [
    /\b(player|player name|athlete|athlete name)\b/.test(header),
    /\b(jersey|jersey number|position)\b/.test(header),
    /\b(parent|guardian|emergency contact)\b/.test(header)
  ].filter(Boolean).length;
  const scheduleHeaderScore = [
    /\b(date|start date|start date time|start time)\b/.test(header),
    /\b(opponent|event type|game|practice)\b/.test(header),
    /\b(location|arrival time|home|away)\b/.test(header)
  ].filter(Boolean).length;
  if (rosterHeaderScore >= 2 && rosterHeaderScore > scheduleHeaderScore) return 'roster-import';
  if (scheduleHeaderScore >= 2 && scheduleHeaderScore > rosterHeaderScore) return 'schedule-import';

  if (/\b(roster|players?|athletes?)\b/.test(fileName)) return 'roster-import';
  if (/\b(schedule|calendar|games?|fixtures?)\b/.test(fileName)) return 'schedule-import';
  return 'general-analysis';
}

export function isPrivateAiScheduleAttachmentMutationRequest(value: unknown) {
  const text = compactText(value).toLowerCase();
  if (!text) return false;
  if (/\b(cancel|delete|remove|reschedule|postpone)\b/.test(text)) return true;
  return /\b(update|change|edit|move|correct)\b/.test(text)
    && /\b(schedule|calendar|events?|games?|practices?|fixtures?|dates?|times?|locations?|opponents?|existing|current|these|those)\b/.test(text);
}

export async function sendPrivateAiAttachmentMessage(
  user: AuthUser,
  input: PrivateAiAttachmentInput,
  conversationId = DEFAULT_PRIVATE_AI_CONVERSATION_ID
): Promise<PrivateAiSendResult> {
  if (!user?.uid) throw new Error('Sign in before using the AI chat.');
  const validationError = getPrivateAiAttachmentValidationError(input.file);
  if (validationError) throw new Error(validationError);

  const isCsv = isPrivateAiCsvFile(input.file);
  const csvText = isCsv ? await input.file.text() : '';
  const attachment = buildPrivateAiAttachmentReceipt(input.file);
  const intent = await classifyPrivateAiAttachment({
    text: input.text,
    file: input.file,
    csvText
  });

  if (intent === 'roster-import') {
    return sendPrivateAiRosterImportMessage(user, {
      teamId: input.teamId,
      teamName: input.teamName,
      text: input.text,
      csvText,
      imageFile: isCsv ? null : input.file,
      attachmentName: input.file.name,
      attachment
    }, conversationId);
  }
  if (intent === 'schedule-import') {
    if (isPrivateAiScheduleAttachmentMutationRequest(input.text)) {
      return sendPrivateAiScheduleManagementAttachmentMessage(user, {
        teamId: input.teamId,
        teamName: input.teamName,
        text: input.text,
        file: input.file,
        csvText,
        attachment
      }, conversationId);
    }
    return sendPrivateAiScheduleImportMessage(user, {
      teamId: input.teamId,
      teamName: input.teamName,
      text: input.text,
      csvText,
      documentFile: isCsv ? null : input.file,
      attachmentName: input.file.name,
      attachment
    }, conversationId);
  }
  return sendPrivateAiDocumentAnalysisMessage(user, {
    ...input,
    csvText
  }, conversationId);
}

async function sendPrivateAiScheduleManagementAttachmentMessage(
  user: AuthUser,
  input: {
    teamId?: string;
    teamName?: string;
    text?: string;
    file: File;
    csvText?: string;
    attachment: PrivateAiAttachmentReceipt;
  },
  conversationId: string
): Promise<PrivateAiSendResult> {
  const question = compactText(input.text) || 'Update the existing schedule events shown in this attachment.';
  const teamId = await resolveAccessibleTeamId(user, {
    teamId: input.teamId,
    teamName: input.teamName,
    text: question
  }, { requireManager: true });
  if (!teamId) throw new Error('Choose the managed team whose existing schedule should be changed.');
  const detail = await loadParentTeamDetail(teamId, user);
  if (!detail.canManageTeam) throw new Error('You do not have permission to manage this team schedule.');
  const teamName = compactText(detail.team?.name) || compactText(input.teamName) || 'Team';
  const requestedConversationId = normalizeConversationId(conversationId);
  const activeConversationId = requestedConversationId === DRAFT_PRIVATE_AI_CONVERSATION_ID
    ? await createPrivateAiConversation(user, buildConversationTitle(question)).then((conversation) => conversation.id)
    : requestedConversationId;
  const priorMessages = requestedConversationId === DRAFT_PRIVATE_AI_CONVERSATION_ID
    ? []
    : await loadPrivateAiMessages(user, maxHistoryMessages, activeConversationId).catch(() => []);
  const userMessage = await savePrivateAiMessage(user, {
    role: 'user',
    text: question,
    conversationId: activeConversationId,
    attachment: input.attachment
  });

  try {
    const attachmentReference = input.csvText
      ? input.csvText.slice(0, 60_000)
      : await extractScheduleAttachmentReference(input.file, question, teamName);
    const plannerQuestion = [
      `User request: ${question}`,
      `Managed team: ${teamName} (${teamId})`,
      'The attachment below is reference data for matching existing schedule events.',
      'Use list_schedule or get_schedule_event when an event must be matched.',
      'Use update_schedule_event or cancel_schedule_event to stage the requested changes.',
      'Do not add or import events. Do not call create_schedule_event or apply_schedule_import.',
      `Attachment reference:\n${attachmentReference.slice(0, 60_000)}`
    ].join('\n');
    const aiResult = await generatePrivateAiAnswer(user, plannerQuestion, priorMessages, {
      conversationId: activeConversationId,
      allowedToolNames: [
        'list_schedule',
        'get_schedule_event',
        'update_schedule_event',
        'cancel_schedule_event'
      ]
    });
    const assistantMessage = await savePrivateAiMessage(user, {
      role: 'assistant',
      text: aiResult.answer,
      conversationId: activeConversationId,
      toolNames: aiResult.toolResults.filter((result) => result.ok).map((result) => result.name),
      pendingActionIds: aiResult.toolResults
        .filter((result) => result.ok && result.requiresConfirmation === true)
        .map((result) => compactText(result.confirmationId))
        .filter(Boolean)
    });
    await touchPrivateAiConversation(user, activeConversationId, {
      title: buildConversationTitle(question),
      lastMessagePreview: aiResult.answer
    }).catch(() => {});
    return { userMessage, assistantMessage, toolResults: aiResult.toolResults };
  } catch (error: any) {
    logger.warn('Unable to prepare schedule attachment changes.', { error });
    const assistantMessage = await savePrivateAiMessage(user, {
      role: 'assistant',
      text: error?.message
        ? `I could not prepare those schedule changes: ${error.message}`
        : 'I could not prepare those schedule changes. Try a clearer attachment or identify the event in your message.',
      conversationId: activeConversationId,
      error: true
    });
    await touchPrivateAiConversation(user, activeConversationId, {
      title: buildConversationTitle(question),
      lastMessagePreview: assistantMessage.text
    }).catch(() => {});
    return { userMessage, assistantMessage, toolResults: [] };
  }
}

async function extractScheduleAttachmentReference(file: File, question: string, teamName: string) {
  const model = await getPrivateAiModel();
  const prompt = `Transcribe the schedule information visible in this attachment so existing ALL PLAYS events can be matched.
Return concise plain text, not JSON. Include every visible date, time, event type, opponent, title, location, status, and identifier.
Do not propose changes and do not invent missing information.
Managed team: ${teamName}
User request: ${question}
File name: ${compactText(file.name)}`;
  const result = await model.generateContent([prompt, await fileToPrivateAiGenerativePart(file)]);
  const reference = compactText(result?.response?.text?.());
  if (!reference) throw new Error('AI could not read any schedule details from that attachment.');
  return reference;
}

async function classifyPrivateAiAttachment(input: {
  text?: string;
  file: File;
  csvText?: string;
}): Promise<PrivateAiAttachmentIntent> {
  const inferred = inferPrivateAiAttachmentIntent({
    text: input.text,
    fileName: input.file.name,
    csvText: input.csvText
  });
  if (inferred !== 'general-analysis') return inferred;

  try {
    const model = await getPrivateAiModel();
    const prompt = `Classify one attachment for ALL PLAYS. Return strict JSON only as {"intent":"roster-import|schedule-import|general-analysis"}.
Choose roster-import only when the attachment contains player, staff, guardian, emergency-contact, or roster-status rows intended to manage a team roster.
Choose schedule-import only when it contains games, practices, fixtures, dates, opponents, or locations intended to manage a team schedule.
Choose general-analysis for flyers, policies, forms, reports, receipts, instructions, or anything the user only wants summarized or explained.
User instruction: ${compactText(input.text) || 'Analyze this attachment.'}
File name: ${compactText(input.file.name)}
${input.csvText ? `CSV content:\n${input.csvText.slice(0, 60_000)}` : ''}`;
    const parts: any[] = [prompt];
    if (!input.csvText) parts.push(await fileToPrivateAiGenerativePart(input.file));
    const result = await model.generateContent(parts);
    const parsed = parseJsonObject(result?.response?.text?.() || '');
    const intent = compactText(parsed?.intent) as PrivateAiAttachmentIntent;
    return ['roster-import', 'schedule-import', 'general-analysis'].includes(intent)
      ? intent
      : 'general-analysis';
  } catch (error) {
    logger.warn('Attachment classification failed; using general analysis.', { error });
    return 'general-analysis';
  }
}

async function sendPrivateAiDocumentAnalysisMessage(
  user: AuthUser,
  input: PrivateAiAttachmentInput & { csvText?: string },
  conversationId: string
): Promise<PrivateAiSendResult> {
  const question = compactText(input.text) || `Analyze ${compactText(input.file.name) || 'this attachment'}.`;
  const attachment = buildPrivateAiAttachmentReceipt(input.file);
  const requestedConversationId = normalizeConversationId(conversationId);
  const activeConversationId = requestedConversationId === DRAFT_PRIVATE_AI_CONVERSATION_ID
    ? await createPrivateAiConversation(user, buildConversationTitle(question)).then((conversation) => conversation.id)
    : requestedConversationId;
  const userMessage = await savePrivateAiMessage(user, {
    role: 'user',
    text: question,
    conversationId: activeConversationId,
    attachment
  });
  const kind = getPrivateAiAttachmentKind(input.file);
  const artifact: PrivateAiDocumentArtifactReference = {
    type: 'document-analysis',
    confirmationId: '',
    teamId: compactText(input.teamId),
    teamName: compactText(input.teamName),
    source: kind,
    fileName: compactText(input.file.name) || 'Attachment',
    mimeType: compactText(input.file.type) || getPrivateAiAttachmentMimeType(input.file),
    summary: { total: 1, errors: 0 }
  };

  let answer = '';
  let error = false;
  try {
    const model = await getPrivateAiModel();
    const prompt = `You are ALL PLAYS, a private youth-sports assistant. Analyze the attached ${kind}.
Answer the user's request clearly. Extract relevant dates, people, requirements, amounts, contacts, and action items when present.
Do not claim that any ALL PLAYS data was changed. If the user appears to want roster or schedule changes, explain that they should identify the managed team and ask you to prepare an import preview.
Do not reproduce sensitive content that is unrelated to the user's request.
User request: ${question}
File name: ${artifact.fileName}
${input.csvText ? `CSV content:\n${input.csvText.slice(0, 120_000)}` : ''}`;
    const parts: any[] = [prompt];
    if (!input.csvText) parts.push(await fileToPrivateAiGenerativePart(input.file));
    const result = await model.generateContent(parts);
    answer = clampAnswer(result?.response?.text?.() || '');
    if (!answer) throw new Error('AI returned an empty attachment analysis.');
  } catch (analysisError: any) {
    logger.warn('Unable to analyze private AI attachment.', { analysisError });
    artifact.summary.errors = 1;
    answer = analysisError?.message
      ? `I could not analyze that attachment: ${analysisError.message}`
      : 'I could not analyze that attachment. Try a clearer image or a text-based PDF.';
    error = true;
  }

  const assistantMessage = await savePrivateAiMessage(user, {
    role: 'assistant',
    text: answer,
    conversationId: activeConversationId,
    artifacts: [artifact],
    error
  });
  assistantMessage.artifacts = [artifact];
  await touchPrivateAiConversation(user, activeConversationId, {
    title: buildConversationTitle(question),
    lastMessagePreview: answer
  }).catch(() => {});
  return { userMessage, assistantMessage, toolResults: [] };
}

async function savePrivateAiImportFailureResult(
  user: AuthUser,
  input: {
    userMessage: PrivateAiMessage;
    conversationId: string;
    question: string;
    workflowLabel: string;
    cause?: unknown;
    toolResults?: PrivateAiToolResult[];
  }
): Promise<PrivateAiSendResult> {
  const reason = compactText((input.cause as any)?.message || input.cause);
  const assistantText = [
    `I could not prepare that ${input.workflowLabel}${reason ? `: ${reason}` : '.'}`,
    'Your request is saved in this chat, but nothing is waiting for confirmation.',
    'Use Edit request to correct or retry it.'
  ].join(' ');
  const assistantMessage = await savePrivateAiMessage(user, {
    role: 'assistant',
    text: assistantText,
    conversationId: input.conversationId,
    error: true
  });
  await touchPrivateAiConversation(user, input.conversationId, {
    title: buildConversationTitle(input.question),
    lastMessagePreview: assistantText
  }).catch(() => {});
  return {
    userMessage: input.userMessage,
    assistantMessage,
    toolResults: input.toolResults || []
  };
}

async function sendPrivateAiScheduleImportMessage(
  user: AuthUser,
  input: {
    teamId?: string;
    teamName?: string;
    text?: string;
    csvText?: string;
    documentFile?: File | null;
    attachmentName?: string;
    attachment?: PrivateAiAttachmentReceipt;
  },
  conversationId: string
): Promise<PrivateAiSendResult> {
  const teamId = await resolveAccessibleTeamId(user, input, { requireManager: true });
  if (!teamId) throw new Error('Choose a team you manage before importing a schedule.');
  const detail = await loadParentTeamDetail(teamId, user);
  if (!detail.canManageTeam) throw new Error('You do not have permission to manage this team schedule.');
  const teamName = compactText(detail.team?.name) || compactText(input.teamName) || 'Team';
  const source = input.csvText
    ? 'csv'
    : input.documentFile
      ? getPrivateAiAttachmentKind(input.documentFile) === 'pdf' ? 'ai-document' : 'ai-image'
      : 'ai-text';
  const sourceLabel = source === 'csv' ? 'schedule CSV' : source === 'ai-document' ? 'schedule PDF' : source === 'ai-image' ? 'schedule image' : 'schedule instructions';
  const question = compactText(input.text) || `Review the attached ${sourceLabel} for schedule import.`;
  const requestedConversationId = normalizeConversationId(conversationId);
  const activeConversationId = requestedConversationId === DRAFT_PRIVATE_AI_CONVERSATION_ID
    ? await createPrivateAiConversation(user, buildConversationTitle(question)).then((conversation) => conversation.id)
    : requestedConversationId;
  const userMessage = await savePrivateAiMessage(user, {
    role: 'user',
    text: question,
    conversationId: activeConversationId,
    attachment: input.attachment
  });
  const previewTimer = startWorkflowTimer(WORKFLOW_TIMING.scheduleAiPreview, {
    source,
    teamId
  });
  let rows: ScheduleCsvImportPreviewRow[] = [];
  let previewErrors: string[] = [];
  let previewTimerEnded = false;
  const endPreviewTimer = () => {
    if (previewTimerEnded) return;
    previewTimerEnded = true;
    previewTimer.end({
      rowCount: rows.length,
      errorCount: previewErrors.length
    });
  };

  try {
    const schedule = await loadParentSchedule(user, { includePastGames: true });
    const currentGames = (schedule.events || [])
      .filter((event) => event.teamId === teamId && event.type === 'game' && event.isDbGame)
      .map((event) => ({
        id: event.id,
        date: event.date,
        opponent: event.opponent,
        location: event.location,
        status: event.isCancelled ? 'cancelled' : 'scheduled'
      }));

    if (input.csvText) {
      try {
        const parsed = parseCsvText(input.csvText);
        const mapping = inferScheduleCsvMapping(parsed.headers);
        const deterministic = buildScheduleImportPreview({ rows: parsed.rows, mapping, teamName });
        rows = deterministic.rows;
        previewErrors = deterministic.errors;
      } catch (csvError: any) {
        previewErrors = [csvError?.message || 'Could not parse the schedule CSV.'];
      }
      if (previewErrors.length || !rows.length) {
        const fallback = await generateScheduleAiImportRows({
          teamName,
          text: `${input.text || ''}\n\nSchedule CSV:\n${input.csvText.slice(0, 120_000)}`,
          currentGames
        });
        if (fallback.rows.length) {
          rows = fallback.rows;
          previewErrors = fallback.errors;
        } else {
          previewErrors = [...previewErrors, ...fallback.errors];
        }
      }
    } else {
      const preview = await generateScheduleAiImportRows({
        teamName,
        text: input.text,
        imageFile: input.documentFile,
        currentGames
      });
      rows = preview.rows;
      previewErrors = preview.errors;
    }
    endPreviewTimer();
    if (rows.length > 200) {
      rows = rows.slice(0, 200);
      previewErrors.push('Import at most 200 schedule rows at a time.');
    }

    const invalidRows = rows.filter((row) => row.errors.length > 0);
    const summary = summarizeSchedulePreview(rows);
    let toolResult: PrivateAiToolResult | null = null;
    let assistantText = '';
    if (previewErrors.length || invalidRows.length || !rows.length) {
      assistantText = [
        `I reviewed the ${sourceLabel} for ${teamName}, but it is not ready to confirm.`,
        ...previewErrors,
        ...invalidRows.flatMap((row) => row.errors),
        rows.length ? 'Send corrected instructions or attach a corrected file to prepare a new preview.' : ''
      ].filter(Boolean).join(' ');
    } else {
      toolResult = await runPrivateAiTool(user, {
        name: 'apply_schedule_import',
        args: {
          teamId,
          __preparedScheduleRows: rows.map((row) => row.normalized),
          source
        }
      }, {
        conversationId: activeConversationId,
        confirmationGroupId: createConfirmationGroupId()
      });
      if (!toolResult.ok) {
        return savePrivateAiImportFailureResult(user, {
          userMessage,
          conversationId: activeConversationId,
          question,
          workflowLabel: 'schedule import',
          cause: toolResult.error,
          toolResults: [toolResult]
        });
      }
      assistantText = `I prepared ${summary.total} schedule row${summary.total === 1 ? '' : 's'} for ${teamName}: ${summary.games} game${summary.games === 1 ? '' : 's'} and ${summary.practices} practice${summary.practices === 1 ? '' : 's'}. Reply yes to import this schedule.`;
    }

    const artifact: PrivateAiScheduleArtifactReference = {
      type: 'schedule-import',
      confirmationId: toolResult?.confirmationId || '',
      teamId,
      teamName,
      source,
      summary: {
        ...summary,
        errors: previewErrors.length + invalidRows.reduce((count, row) => count + row.errors.length, 0)
      },
      previewRows: rows
    };
    const assistantMessage = await savePrivateAiMessage(user, {
      role: 'assistant',
      text: assistantText,
      conversationId: activeConversationId,
      toolNames: toolResult?.ok ? ['apply_schedule_import'] : [],
      pendingActionIds: toolResult?.ok && toolResult.requiresConfirmation && toolResult.confirmationId
        ? [toolResult.confirmationId]
        : [],
      artifacts: [artifact]
    });
    assistantMessage.artifacts = [artifact];
    await touchPrivateAiConversation(user, activeConversationId, {
      title: buildConversationTitle(question),
      lastMessagePreview: assistantText
    }).catch(() => {});
    return {
      userMessage,
      assistantMessage,
      toolResults: toolResult ? [toolResult] : []
    };
  } catch (error: any) {
    endPreviewTimer();
    logger.warn('Unable to prepare private AI schedule import.', { error });
    return savePrivateAiImportFailureResult(user, {
      userMessage,
      conversationId: activeConversationId,
      question,
      workflowLabel: 'schedule import',
      cause: error
    });
  }
}

export async function sendPrivateAiRosterImportMessage(
  user: AuthUser,
  input: {
    teamId?: string;
    teamName?: string;
    text?: string;
    csvText?: string;
    imageFile?: File | null;
    attachmentName?: string;
    attachment?: PrivateAiAttachmentReceipt;
  },
  conversationId = DEFAULT_PRIVATE_AI_CONVERSATION_ID
): Promise<PrivateAiSendResult> {
  if (!user?.uid) throw new Error('Sign in before using the AI chat.');
  const teamId = await resolveAccessibleTeamId(user, input, { requireManager: true });
  if (!teamId) throw new Error('Choose a team you manage before importing a roster.');

  const requestedConversationId = normalizeConversationId(conversationId);
  const sourceLabel = input.csvText
    ? 'CSV'
    : input.imageFile
      ? getPrivateAiAttachmentKind(input.imageFile) === 'pdf' ? 'roster PDF' : 'roster image'
      : 'roster instructions';
  const question = String(input.text || '').trim().slice(0, maxPromptCharacters)
    || (input.csvText
      ? 'Review pasted roster CSV data for import.'
      : input.imageFile
        ? `Review the attached ${sourceLabel} for roster import.`
        : 'Review roster instructions for import.');
  const activeConversationId = requestedConversationId === DRAFT_PRIVATE_AI_CONVERSATION_ID
    ? await createPrivateAiConversation(user, buildConversationTitle(question)).then((conversation) => conversation.id)
    : requestedConversationId;
  const [context, detail] = await Promise.all([
    loadRosterImportContextForApp(teamId, user),
    loadParentTeamDetail(teamId, user)
  ]);
  if (!detail.canManageTeam) throw new Error('You do not have permission to manage this team roster.');

  const userMessage = await savePrivateAiMessage(user, {
    role: 'user',
    text: question,
    conversationId: activeConversationId,
    attachment: input.attachment
  });
  try {
    const preview = await generateRosterAiImportRows({
      text: input.text,
      csvText: input.csvText,
      imageFile: input.imageFile,
      currentPlayers: context.players,
      rosterFields: context.fields
    });
    const summary = summarizeRosterPreview(preview.rows);
    const invalidRows = preview.rows.filter((row) => row.errors.length > 0);
    const teamName = compactText(detail.team?.name) || compactText(input.teamName) || 'Team';
    let toolResult: PrivateAiToolResult | null = null;
    let assistantText = '';

    if (preview.errors.length || invalidRows.length || !preview.rows.length) {
      assistantText = [
        `I reviewed the ${sourceLabel} for ${teamName}, but it is not ready to confirm.`,
        ...preview.errors,
        ...invalidRows.flatMap((row) => row.errors)
      ].filter(Boolean).join(' ');
      if (preview.rows.length && invalidRows.length) {
        const plan = buildRosterAiImportCommitPlan(preview.rows);
        const validationErrors = invalidRows.flatMap((row) => row.errors);
        const definition = getPrivateAiToolDefinition('apply_roster_import');
        if (definition) {
          const pending = await savePrivateAiPendingAction(user, definition, {
            teamId,
            operations: plan.operations,
            __rosterValidationErrors: validationErrors
          }, {
            conversationId: activeConversationId,
            confirmationGroupId: createConfirmationGroupId()
          }, {
            summary: `Roster import | Team: ${teamId} | ${summary.total} operations | ${summary.invitations} invitations | ${validationErrors.length} errors`,
            previewSummary: { ...summary, errors: validationErrors.length }
          });
          toolResult = {
            name: definition.name,
            ok: true,
            requiresConfirmation: true,
            confirmationId: pending.id,
            data: {
              summary: pending.summary,
              previewSummary: pending.previewSummary
            }
          };
          assistantText += ' Edit the highlighted fields in this review; confirmation stays blocked until every error is fixed.';
        }
      }
    } else {
      const plan = buildRosterAiImportCommitPlan(preview.rows);
      toolResult = await runPrivateAiTool(user, {
        name: 'apply_roster_import',
        args: {
          teamId,
          __preparedRosterOperations: plan.operations,
          source: preview.source
        }
      }, {
        conversationId: activeConversationId,
        confirmationGroupId: createConfirmationGroupId()
      });
      if (!toolResult.ok) {
        return savePrivateAiImportFailureResult(user, {
          userMessage,
          conversationId: activeConversationId,
          question,
          workflowLabel: 'roster import',
          cause: toolResult.error,
          toolResults: [toolResult]
        });
      }
      assistantText = `I prepared ${summary.total} roster operation${summary.total === 1 ? '' : 's'} for ${teamName}: ${summary.add} add, ${summary.update} update, ${summary.deactivate} deactivate, ${summary.reactivate} reactivate, and ${summary.invitations} family invitation${summary.invitations === 1 ? '' : 's'}. Reply yes to import these players and email these contacts.`;
    }

    const artifact: PrivateAiArtifactReference = {
      type: 'roster-import',
      confirmationId: toolResult?.confirmationId || '',
      teamId,
      teamName,
      source: preview.source,
      summary: {
        ...summary,
        errors: preview.errors.length + invalidRows.reduce((count, row) => count + row.errors.length, 0)
      },
      previewRows: preview.rows
    };
    const assistantMessage = await savePrivateAiMessage(user, {
      role: 'assistant',
      text: assistantText,
      conversationId: activeConversationId,
      toolNames: toolResult?.ok ? ['apply_roster_import'] : [],
      pendingActionIds: toolResult?.ok && toolResult.requiresConfirmation && toolResult.confirmationId
        ? [toolResult.confirmationId]
        : [],
      artifacts: [artifact]
    });
    assistantMessage.artifacts = [artifact];
    await touchPrivateAiConversation(user, activeConversationId, {
      title: buildConversationTitle(question),
      lastMessagePreview: assistantText
    }).catch(() => {});

    return {
      userMessage,
      assistantMessage,
      toolResults: toolResult ? [toolResult] : []
    };
  } catch (error: any) {
    logger.warn('Unable to prepare private AI roster import.', { error });
    return savePrivateAiImportFailureResult(user, {
      userMessage,
      conversationId: activeConversationId,
      question,
      workflowLabel: 'roster import',
      cause: error
    });
  }
}

export async function revisePrivateAiRosterImportProposal(
  user: AuthUser,
  revision: PrivateAiRosterProposalRevision
): Promise<PrivateAiRosterArtifactReference['summary']> {
  if (!user?.uid) throw new Error('Sign in before editing an AI roster proposal.');
  const confirmationId = compactText(revision.confirmationId);
  const teamId = compactText(revision.teamId);
  const messageId = compactText(revision.messageId);
  if (!confirmationId || !teamId || !messageId) {
    throw new Error('This roster proposal is no longer editable.');
  }

  const pending = await loadPrivateAiPendingAction(user, confirmationId);
  if (!pending || pending.toolName !== 'apply_roster_import') {
    throw new Error('This roster proposal expired, was replaced, or was already confirmed.');
  }
  if (compactText(pending.args.teamId) !== teamId) {
    throw new Error('This roster proposal does not match the selected team.');
  }
  const authorizedTeamId = await resolveAccessibleTeamId(user, { teamId }, { requireManager: true });
  if (authorizedTeamId !== teamId) {
    throw new Error('You no longer have permission to manage this team roster.');
  }

  const rows = Array.isArray(revision.rows) ? revision.rows : [];
  if (!rows.length) throw new Error('Keep at least one roster row in the proposal.');
  if (rows.length > 200) throw new Error('Import at most 200 roster rows at a time.');
  const plan = buildRosterAiImportCommitPlan(rows);
  const validationErrors = rows.flatMap((row) => row.errors || []);
  const rosterSummary = summarizeRosterPreview(rows);
  const artifactSummary = {
    ...rosterSummary,
    errors: validationErrors.length
  };
  const nextArgs = {
    teamId,
    operations: plan.operations,
    ...(validationErrors.length ? { __rosterValidationErrors: validationErrors } : {})
  };
  const nextSummary = `Roster import | Team: ${teamId} | ${rosterSummary.total} operations | ${rosterSummary.invitations} invitations${validationErrors.length ? ` | ${validationErrors.length} errors` : ''}`;
  const pendingRef = doc(db, 'users', user.uid, privateAiPendingActionCollectionName, confirmationId);
  const teamPayloadRef = doc(db, 'teams', teamId, teamPrivateAiPendingActionCollectionName, confirmationId);
  const messageRef = doc(db, 'users', user.uid, privateAiCollectionName, messageId);

  const updated = await runTransaction(db, async (transaction: any) => {
    const [snapshot, messageSnapshot] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(messageRef)
    ]);
    const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
    if (
      !snapshot?.exists?.()
      || !isPlainObject(data)
      || data.status !== 'pending'
      || compactText(data.userId) !== user.uid
      || compactText(data.toolName) !== 'apply_roster_import'
      || compactText(data.teamId || (isPlainObject(data.args) ? data.args.teamId : '')) !== teamId
      || Date.parse(compactText(data.expiresAt)) <= Date.now()
    ) return false;
    const messageData = typeof messageSnapshot?.data === 'function' ? messageSnapshot.data() : null;
    const storedArtifacts = isPlainObject(messageData) && Array.isArray(messageData.artifacts)
      ? messageData.artifacts
      : [];
    const matchingArtifact = storedArtifacts.find((artifact) => (
      isPlainObject(artifact)
      && artifact.type === 'roster-import'
      && compactText(artifact.confirmationId) === confirmationId
      && compactText(artifact.teamId) === teamId
    ));
    if (!matchingArtifact) return false;
    transaction.set(pendingRef, {
      args: sanitizePendingActionArgsForUserStorage('apply_roster_import', nextArgs),
      summary: nextSummary,
      previewSummary: artifactSummary,
      editedAt: serverTimestamp(),
      audit: {
        lastEditedBy: user.uid,
        lastEditedAt: new Date().toISOString()
      }
    }, { merge: true });
    transaction.set(teamPayloadRef, {
      userId: user.uid,
      toolName: 'apply_roster_import',
      args: nextArgs,
      status: 'pending',
      editedAt: serverTimestamp(),
      expiresAt: pending.expiresAt
    }, { merge: true });
    transaction.set(messageRef, {
      artifacts: storedArtifacts.map((artifact) => {
        if (
          !isPlainObject(artifact)
          || artifact.type !== 'roster-import'
          || compactText(artifact.confirmationId) !== confirmationId
          || compactText(artifact.teamId) !== teamId
        ) return artifact;
        return stripPrivateAiArtifactForStorage({
          type: 'roster-import',
          confirmationId,
          teamId,
          teamName: compactText(artifact.teamName) || 'Team',
          source: normalizePrivateAiImportSource(artifact.source),
          summary: artifactSummary,
          previewRows: rows
        });
      })
    }, { merge: true });
    return true;
  });
  if (!updated) {
    throw new Error('This roster proposal expired, was replaced, or is currently being confirmed.');
  }

  pending.args = nextArgs;
  pending.summary = nextSummary;
  pending.previewSummary = artifactSummary;
  pendingActionMemory.set(`${user.uid}:${confirmationId}`, pending);
  return artifactSummary;
}

export async function revisePrivateAiScheduleImportProposal(
  user: AuthUser,
  revision: PrivateAiScheduleProposalRevision
): Promise<{
  summary: PrivateAiScheduleArtifactReference['summary'];
  rows: ScheduleCsvImportPreviewRow[];
}> {
  if (!user?.uid) throw new Error('Sign in before editing an AI schedule proposal.');
  const confirmationId = compactText(revision.confirmationId);
  const teamId = compactText(revision.teamId);
  const messageId = compactText(revision.messageId);
  if (!confirmationId || !teamId) throw new Error('This schedule proposal is no longer editable.');

  const pending = await loadPrivateAiPendingAction(user, confirmationId);
  if (!pending || pending.toolName !== 'apply_schedule_import') {
    throw new Error('This schedule proposal expired, was replaced, or was already confirmed.');
  }
  if (compactText(pending.args.teamId) !== teamId) {
    throw new Error('This schedule proposal does not match the selected team.');
  }
  const authorizedTeamId = await resolveAccessibleTeamId(user, { teamId }, { requireManager: true });
  if (authorizedTeamId !== teamId) {
    throw new Error('You no longer have permission to manage this team schedule.');
  }

  const inputRows = Array.isArray(revision.rows) ? revision.rows : [];
  if (!inputRows.length) throw new Error('Keep at least one schedule row in the proposal.');
  if (inputRows.length > 200) throw new Error('Import at most 200 schedule rows at a time.');
  const rows = inputRows.map((row, index) => normalizeScheduleImportDraft({
    eventType: row.draft?.eventType ?? row.normalized.eventType,
    startsAt: row.draft?.startsAt ?? row.normalized.startsAt,
    endsAt: row.draft?.endsAt ?? row.normalized.endsAt ?? '',
    opponent: row.draft?.opponent ?? row.normalized.opponent ?? '',
    title: row.draft?.title ?? row.normalized.title ?? '',
    location: row.draft?.location ?? row.normalized.location ?? '',
    arrivalTime: row.draft?.arrivalTime ?? row.normalized.arrivalTime ?? '',
    isHome: row.draft?.isHome ?? row.normalized.isHome,
    notes: row.draft?.notes ?? row.normalized.notes ?? ''
  }, { rowNumber: index + 1 })) as ScheduleCsvImportPreviewRow[];
  const validationErrors = rows.flatMap((row) => row.errors || []);
  const counts = summarizeSchedulePreview(rows);
  const summary = {
    ...counts,
    errors: validationErrors.length
  };
  const nextArgs = {
    teamId,
    rows: rows.map((row) => row.normalized),
    source: compactText(pending.args.source) || 'ai',
    ...(validationErrors.length ? { __scheduleValidationErrors: validationErrors } : {})
  };
  const pendingRef = doc(db, 'users', user.uid, privateAiPendingActionCollectionName, confirmationId);
  const messageRef = messageId
    ? doc(db, 'users', user.uid, privateAiCollectionName, messageId)
    : null;
  const updated = await runTransaction(db, async (transaction: any) => {
    const [snapshot, messageSnapshot] = await Promise.all([
      transaction.get(pendingRef),
      messageRef ? transaction.get(messageRef) : Promise.resolve(null)
    ]);
    const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
    if (
      !snapshot?.exists?.()
      || !isPlainObject(data)
      || data.status !== 'pending'
      || compactText(data.userId) !== user.uid
      || compactText(data.toolName) !== 'apply_schedule_import'
      || compactText(data.teamId || (isPlainObject(data.args) ? data.args.teamId : '')) !== teamId
      || Date.parse(compactText(data.expiresAt)) <= Date.now()
    ) return false;
    const messageData = typeof messageSnapshot?.data === 'function' ? messageSnapshot.data() : null;
    const storedArtifacts = isPlainObject(messageData) && Array.isArray(messageData.artifacts)
      ? messageData.artifacts
      : [];
    const hasStoredArtifact = !messageRef || storedArtifacts.some((artifact) => (
      isPlainObject(artifact)
      && artifact.type === 'schedule-import'
      && compactText(artifact.confirmationId) === confirmationId
    ));
    if (!hasStoredArtifact) return false;
    transaction.set(pendingRef, {
      args: nextArgs,
      summary: `Schedule import | Team: ${teamId} | ${summary.total} rows${validationErrors.length ? ` | ${validationErrors.length} errors` : ''}`,
      previewSummary: summary,
      editedAt: serverTimestamp(),
      audit: {
        lastEditedBy: user.uid,
        lastEditedAt: new Date().toISOString()
      }
    }, { merge: true });
    if (messageRef) {
      transaction.set(messageRef, {
        artifacts: storedArtifacts.map((artifact) => {
          if (
            !isPlainObject(artifact)
            || artifact.type !== 'schedule-import'
            || compactText(artifact.confirmationId) !== confirmationId
          ) return artifact;
          return stripPrivateAiArtifactForStorage({
            type: 'schedule-import',
            confirmationId,
            teamId,
            teamName: compactText(artifact.teamName) || 'Team',
            source: normalizePrivateAiImportSource(artifact.source),
            summary,
            previewRows: rows
          });
        })
      }, { merge: true });
    }
    return true;
  });
  if (!updated) {
    throw new Error('This schedule proposal expired, was replaced, or is currently being confirmed.');
  }

  pending.args = nextArgs;
  pending.previewSummary = summary;
  pendingActionMemory.set(`${user.uid}:${confirmationId}`, pending);
  return { summary, rows };
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

    const requestedCalls = planner.toolCalls.slice(0, maxToolCallsPerRound);
    const allowedToolNames = context.allowedToolNames?.length
      ? new Set(context.allowedToolNames.map(compactText).filter(Boolean))
      : null;
    const calls = allowedToolNames
      ? requestedCalls.filter((call) => allowedToolNames.has(compactText(call.name)))
      : requestedCalls;
    const blockedCalls = allowedToolNames
      ? requestedCalls.filter((call) => !allowedToolNames.has(compactText(call.name)))
      : [];
    blockedCalls.forEach((call) => toolResults.push({
      name: compactText(call.name),
      ok: false,
      error: 'That tool is not allowed for this attachment request.'
    }));
    if (!calls.length) {
      if (blockedCalls.length) {
        plannerInput = buildPlannerPrompt({ user, question, history, toolResults });
        continue;
      }
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
  return runPrivateAiToolInternal(user, call, context);
}

async function runPrivateAiToolInternal(
  user: AuthUser,
  call: PrivateAiToolCall,
  context: InternalPrivateAiToolContext = {}
): Promise<PrivateAiToolResult> {
  const name = compactText(call.name);
  const args = sanitizeToolCallArgs(isPlainObject(call.args) ? call.args : {});
  const definition = getPrivateAiToolDefinition(name);
  let scheduleImportTimer: ReturnType<typeof startWorkflowTimer> | null = null;
  const isConfirmedWrite = context.confirmedWriteToken === confirmedWriteExecutionToken;

  try {
    if (!definition) {
      return { name, ok: false, error: `Unsupported tool: ${name}` };
    }

    if (definition.mode === 'write' && !isConfirmedWrite) {
      const prepared = definition.prepare ? await definition.prepare(user, args) : { args };
      const pending = await savePrivateAiPendingAction(user, definition, prepared.args, context, prepared);
      return {
        name,
        ok: true,
        requiresConfirmation: true,
        confirmationId: pending.id,
        data: {
          summary: pending.summary,
          previewSummary: pending.previewSummary,
          confirmationText: 'Reply "yes" to apply this change.'
        }
      };
    }

    if (definition.name === 'apply_schedule_import' && isConfirmedWrite) {
      scheduleImportTimer = startWorkflowTimer(WORKFLOW_TIMING.scheduleImport, {
        teamId: compactText(args.teamId),
        rowCount: Array.isArray(args.rows) ? args.rows.length : 0
      });
    }
    const data = await definition.resolve(user, args);
    scheduleImportTimer?.end({ success: true });
    if (definition.mode === 'write') {
      await savePrivateAiActionAudit(user, definition.name, args, data).catch(() => {});
    }
    return {
      name,
      ok: true,
      data
    };
  } catch (error: any) {
    scheduleImportTimer?.end({ success: false });
    return {
      name,
      ok: false,
      error: error?.message || 'Tool failed.'
    };
  }
}

const privateAiToolDefinitions: PrivateAiToolDefinition[] = [
  ...buildCoachAdminPrivateAiToolDefinitions(),
  {
    name: 'get_profile',
    mode: 'read',
    description: 'Account profile, roles, notification preferences, linked teams, and linked players.',
    resolve: async (user) => summarizeProfile(user, await getUserProfile(user.uid).catch(() => null))
  },
  {
    name: 'get_home',
    mode: 'read',
    domain: 'account-and-discovery',
    description: 'Combined family/player and coach/admin dashboard context: tasks, players, teams, managed teams, next events, unread messages, packets, fees, and priority actions.',
    aliases: ['list_tasks'],
    resolve: async (user) => {
      const [home, teams] = await Promise.all([
        loadParentHome(user),
        loadAccessibleAiTeams(user)
      ]);
      return {
        ...summarizeHome(home),
        managedTeams: teams.filter((team) => team.canManageTeam).map((team) => ({
          teamId: team.teamId,
          teamName: team.teamName,
          playerCount: team.playerCount
        }))
      };
    }
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
    name: 'list_managed_teams',
    mode: 'read',
    domain: 'team-management',
    audience: 'manager',
    description: 'Teams the signed-in coach or administrator can manage, including roster and schedule context.',
    aliases: ['get_managed_teams'],
    resolve: async (user) => {
      const teams = await loadAccessibleAiTeams(user);
      return {
        teams: teams
          .filter((team) => team.canManageTeam)
          .map((team) => ({
            teamId: team.teamId,
            teamName: team.teamName,
            playerCount: team.playerCount,
            canManageTeam: true
          }))
      };
    }
  },
  {
    name: 'get_team_roster',
    mode: 'read',
    domain: 'roster-and-invites',
    audience: 'manager',
    description: 'Managed team roster with active/inactive state and family invitation context. Args: teamId or teamName.',
    aliases: ['list_team_roster'],
    resolve: async (user, args) => {
      const teamId = await resolveAccessibleTeamId(user, args, { requireManager: true });
      if (!teamId) throw new Error('No managed team matched that request.');
      const detail = await loadParentTeamDetail(teamId, user);
      return {
        teamId,
        teamName: detail.team?.name || '',
        players: [...(detail.players || []), ...(detail.inactivePlayers || [])].map((player: any) => pickFields(player, [
          'id',
          'name',
          'number',
          'position',
          'active',
          'parentContacts'
        ]))
      };
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
    name: 'apply_roster_import',
    mode: 'write',
    domain: 'roster-and-invites',
    audience: 'manager',
    description: 'Prepare a grouped roster import for a managed team. Supports add, update, deactivate/reactivate, all roster fields, address, family contacts, and mandatory contact invitations. Args: teamId/teamName and operations.',
    aliases: ['bulk_import_roster', 'manage_roster_players'],
    prepare: async (user, args) => {
      const teamId = await resolveAccessibleTeamId(user, args, { requireManager: true });
      if (!teamId) throw new Error('No managed team matched that roster import.');
      const context = await loadRosterImportContextForApp(teamId, user);
      let operations: RosterImportPlannedOperationForApp[];
      if (Array.isArray(args.__preparedRosterOperations)) {
        operations = args.__preparedRosterOperations as RosterImportPlannedOperationForApp[];
      } else {
        const rawOperations = Array.isArray(args.operations) ? args.operations as Array<Record<string, unknown>> : [];
        const preview = normalizeRosterAiImportResponse({ operations: rawOperations }, {
          currentPlayers: context.players,
          rosterFields: context.fields
        });
        if (preview.errors.length) throw new Error(preview.errors.join(' '));
        operations = buildRosterAiImportCommitPlan(preview.rows).operations;
      }
      if (!operations.length) throw new Error('No roster operations were provided.');
      if (operations.length > 200) throw new Error('Import at most 200 roster rows at a time.');
      const invalid = operations.flatMap((operation) => operation.errors || []);
      if (invalid.length) throw new Error(invalid.join(' '));
      const summary = summarizeRosterOperations(operations);
      return {
        args: {
          teamId,
          operations
        },
        summary: `Roster import | Team: ${teamId} | ${summary.total} operations | ${summary.invitations} invitations`,
        previewSummary: summary
      };
    },
    resolve: async (user, args) => {
      const teamId = await resolveAccessibleTeamId(user, args, { requireManager: true });
      if (!teamId) throw new Error('You no longer have permission to manage this team.');
      const validationErrors = Array.isArray(args.__rosterValidationErrors)
        ? args.__rosterValidationErrors.map(compactText).filter(Boolean)
        : [];
      if (validationErrors.length) {
        throw new Error(`Fix the roster review errors before confirming. ${validationErrors.join(' ')}`);
      }
      const operations = Array.isArray(args.operations) ? args.operations as RosterImportPlannedOperationForApp[] : [];
      if (!operations.length) throw new Error('No valid roster operations remain to import.');
      return applyRosterImportPlanForApp(teamId, user, operations);
    }
  },
  {
    name: 'apply_schedule_import',
    mode: 'write',
    domain: 'schedule-attendance-planning',
    audience: 'manager',
    description: 'Prepare one grouped schedule import from an image, CSV, PDF, or pasted text. Supports reviewed game and practice rows. Args: teamId/teamName and rows.',
    aliases: ['bulk_import_schedule', 'import_schedule_rows'],
    prepare: async (user, args) => {
      const teamId = await resolveAccessibleTeamId(user, args, { requireManager: true });
      if (!teamId) throw new Error('No managed team matched that schedule import.');
      const rows = Array.isArray(args.__preparedScheduleRows)
        ? args.__preparedScheduleRows as ScheduleCsvImportPreviewRow['normalized'][]
        : Array.isArray(args.rows)
          ? args.rows as ScheduleCsvImportPreviewRow['normalized'][]
          : [];
      if (!rows.length) throw new Error('No schedule rows were provided.');
      if (rows.length > 200) throw new Error('Import at most 200 schedule rows at a time.');
      const invalidRows = rows.filter((row) => (
        !row
        || !['game', 'practice'].includes(compactText(row.eventType).toLowerCase())
        || !compactText(row.startsAt)
        || (compactText(row.eventType).toLowerCase() === 'game' && !compactText(row.opponent))
      ));
      if (invalidRows.length) throw new Error(`${invalidRows.length} schedule row${invalidRows.length === 1 ? ' is' : 's are'} incomplete.`);
      const summary = summarizeScheduleRows(rows);
      return {
        args: {
          teamId,
          rows,
          source: compactText(args.source) || 'ai'
        },
        summary: `Schedule import | Team: ${teamId} | ${summary.total} rows`,
        previewSummary: summary
      };
    },
    resolve: async (user, args) => {
      const teamId = await resolveAccessibleTeamId(user, args, { requireManager: true });
      if (!teamId) throw new Error('You no longer have permission to manage this team.');
      const validationErrors = Array.isArray(args.__scheduleValidationErrors)
        ? args.__scheduleValidationErrors.map(compactText).filter(Boolean)
        : [];
      if (validationErrors.length) {
        throw new Error(`Fix the schedule review errors before confirming. ${validationErrors.join(' ')}`);
      }
      const rows = Array.isArray(args.rows) ? args.rows as ScheduleCsvImportPreviewRow['normalized'][] : [];
      if (!rows.length) throw new Error('No valid schedule rows remain to import.');
      const batchId = `ai-schedule-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const importedAt = new Date().toISOString();
      const createdIds: string[] = [];
      const failures: Array<{ rowNumber: number; error: string }> = [];
      for (const [index, row] of rows.entries()) {
        const normalizedRow = {
          ...row,
          importBatch: {
            batchId,
            totalCount: rows.length,
            rowNumber: row.rowNumber || index + 1,
            importedAt,
            importedBy: user.uid
          }
        };
        try {
          const createdId = row.eventType === 'practice'
            ? await createScheduleImportPractice(teamId, normalizedRow, user)
            : await createScheduleImportGame(teamId, normalizedRow, user);
          if (createdId) createdIds.push(createdId);
        } catch (error: any) {
          failures.push({
            rowNumber: row.rowNumber || index + 1,
            error: error?.message || 'Schedule row import failed.'
          });
        }
      }
      if (rows.length > 3 && createdIds.length) {
        await finalizeScheduleImportBatch(teamId, batchId, createdIds.length, user).catch(() => {});
      }
      if (!createdIds.length && failures.length) {
        const failedRows = failures.map((failure) => failure.rowNumber).join(', ');
        throw new Error(`Schedule import failed: no rows were saved. Failed row${failures.length === 1 ? '' : 's'}: ${failedRows}.`);
      }
      return {
        teamId,
        importedCount: createdIds.length,
        failedCount: failures.length,
        failures
      };
    }
  },
  {
    name: 'invite_roster_parent',
    mode: 'write',
    domain: 'roster-and-invites',
    audience: 'manager',
    description: 'Invite a parent or guardian to one player on a managed team using the normal acceptance email. Args: playerId/playerName, email, relation, and optional teamId/teamName. A unique managed-roster player match resolves the team automatically.',
    aliases: ['invite_parent_to_player'],
    prepare: async (user, args) => {
      const target = await resolveManagedRosterPlayer(user, args);
      const email = compactText(args.email).toLowerCase();
      if (!email || !email.includes('@')) throw new Error('A valid parent email is required.');
      return {
        args: {
          teamId: target.teamId,
          playerId: target.player.id,
          email,
          relation: compactText(args.relation) || 'Parent'
        },
        summary: `Invite ${email} to ${target.player.name} on ${target.teamName}.`,
        previewSummary: {
          teamId: target.teamId,
          teamName: target.teamName,
          playerId: target.player.id,
          playerName: target.player.name,
          email
        }
      };
    },
    resolve: async (user, args) => {
      const teamId = await resolveAccessibleTeamId(user, args, { requireManager: true });
      if (!teamId) throw new Error('You no longer have permission to manage this team.');
      const detail = await loadParentTeamDetail(teamId, user);
      const player = resolveTeamDetailPlayer(detail, args);
      if (!player) throw new Error('No matching roster player was found.');
      return createRosterParentInviteForApp(teamId, user, player, {
        email: compactText(args.email),
        relation: compactText(args.relation) || 'Parent'
      });
    }
  },
  {
    name: 'resend_roster_parent_invite',
    mode: 'write',
    domain: 'roster-and-invites',
    audience: 'manager',
    description: 'Retry the email for an existing pending or auto-linked parent invitation. Args: playerId/playerName, email, and optional teamId/teamName. A unique managed-roster player match resolves the team automatically.',
    aliases: ['retry_parent_invite_email', 'resend_parent_invite'],
    prepare: async (user, args) => {
      const target = await resolveManagedRosterPlayer(user, args);
      const email = compactText(args.email).toLowerCase();
      if (!email || !email.includes('@')) throw new Error('A valid parent email is required.');
      return {
        args: {
          teamId: target.teamId,
          playerId: target.player.id,
          email
        },
        summary: `Retry the invitation email to ${email} for ${target.player.name} on ${target.teamName}.`,
        previewSummary: {
          teamId: target.teamId,
          teamName: target.teamName,
          playerId: target.player.id,
          playerName: target.player.name,
          email
        }
      };
    },
    resolve: async (user, args) => {
      const teamId = await resolveAccessibleTeamId(user, args, { requireManager: true });
      if (!teamId) throw new Error('You no longer have permission to manage this team.');
      const detail = await loadParentTeamDetail(teamId, user);
      const player = resolveTeamDetailPlayer(detail, args);
      if (!player) throw new Error('No matching roster player was found.');
      return retryRosterParentInviteEmailForApp(teamId, user, player, compactText(args.email));
    }
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

function buildCoachAdminPrivateAiToolDefinitions(): PrivateAiToolDefinition[] {
  const definitions: PrivateAiToolDefinition[] = [
    {
      name: 'get_team_management_overview',
      mode: 'read',
      domain: 'team-management',
      description: 'Managed team settings, roster, staff permissions, tracking items, parent invites, schedule, and analytics. Args: teamId or teamName.',
      resolve: async (user, args) => {
        const teamId = await resolveAccessibleTeamId(user, args, { requireManager: true });
        if (!teamId) throw new Error('No managed team matched that request.');
        const service = await import('./teamDetailService');
        const [detail, staff, tracking, invites] = await Promise.all([
          service.loadParentTeamDetail(teamId, user),
          service.loadTeamStaffPermissions(teamId, user),
          service.loadTeamTrackingAdmin(teamId, user),
          service.loadTeamRosterParentInvites(teamId, user)
        ]);
        return {
          detail: summarizeTeamDetail(detail),
          staff,
          tracking,
          parentInvites: invites
        };
      }
    },
    {
      name: 'update_team_settings',
      mode: 'write',
      domain: 'team-management',
      description: 'Update managed team name, sport, ZIP, public visibility, league URL, or livestream URL. Args: teamId/teamName and settings.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Update team settings'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const service = await import('./teamDetailService');
        const detail = await service.loadParentTeamDetail(teamId, user);
        const input = isPlainObject(args.settings) ? args.settings : args;
        return service.updateTeamSettingsForApp(teamId, user, {
          name: hasOwn(input, 'name') ? compactText(input.name) : compactText(detail.team?.name),
          sport: hasOwn(input, 'sport') ? compactText(input.sport) : compactText(detail.team?.sport),
          zip: hasOwn(input, 'zip') ? compactText(input.zip) : compactText(detail.team?.zip),
          isPublic: hasOwn(input, 'isPublic') ? input.isPublic === true : detail.team?.isPublic === true,
          leagueUrl: hasOwn(input, 'leagueUrl') ? compactText(input.leagueUrl) : compactText(detail.team?.leagueUrl),
          streamUrl: hasOwn(input, 'streamUrl') ? compactText(input.streamUrl) : compactText(detail.team?.streamUrl)
        });
      }
    },
    {
      name: 'invite_team_admin',
      mode: 'write',
      domain: 'staff-access',
      description: 'Invite an administrator to a managed team. Args: teamId/teamName and email.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, `Invite team admin ${compactText(args.email)}`),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const { inviteTeamAdminForApp } = await import('./teamDetailService');
        return inviteTeamAdminForApp(teamId, compactText(args.email), user);
      }
    },
    {
      name: 'save_team_tracking_item',
      mode: 'write',
      domain: 'tracking-and-stats',
      description: 'Create or update a managed-team tracking requirement. Args: teamId/teamName, itemId optional, title, description, type, dueDate, required.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Save team tracking item'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const { saveTeamTrackingItemForApp } = await import('./teamDetailService');
        const input = isPlainObject(args.item) ? args.item : args;
        return saveTeamTrackingItemForApp(teamId, user, input as any, { itemId: compactText(args.itemId) });
      }
    },
    {
      name: 'set_player_tracking_status',
      mode: 'write',
      domain: 'tracking-and-stats',
      description: 'Mark a team tracking item complete or incomplete for a roster player. Args: teamId/teamName, playerId/playerName, itemId, complete.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Update player tracking status'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const detail = await loadParentTeamDetail(teamId, user);
        const player = resolveTeamDetailPlayer(detail, args);
        if (!player) throw new Error('No matching roster player was found.');
        const { setPlayerTrackingStatusForApp } = await import('./teamDetailService');
        return setPlayerTrackingStatusForApp(teamId, user, compactText(args.itemId), player, args.complete === true);
      }
    },
    {
      name: 'save_stat_configuration',
      mode: 'write',
      domain: 'tracking-and-stats',
      description: 'Create or update a team stat-tracker configuration. Args: teamId/teamName, configId optional, config.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Save stat configuration'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const service = await import('./teamDetailService');
        const config = isPlainObject(args.config) ? args.config : args;
        return compactText(args.configId)
          ? service.updateStatTrackerConfigForApp(teamId, compactText(args.configId), user, config as any)
          : service.createStatTrackerConfigForApp(teamId, user, config as any);
      }
    },
    {
      name: 'create_schedule_event',
      mode: 'write',
      domain: 'schedule-attendance-planning',
      description: 'Create a managed-team game or practice. Args: teamId/teamName, eventType game|practice, and input with dates, location, opponent/title, notifications, recurrence, and tracker config.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Create schedule event'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const service = await import('./scheduleService');
        const input = (isPlainObject(args.input) ? args.input : args) as any;
        return compactText(args.eventType || args.type).toLowerCase() === 'practice'
          ? service.createScheduledPracticeForApp(teamId, input, user)
          : service.createScheduledGameForApp(teamId, input, user);
      }
    },
    {
      name: 'update_schedule_event',
      mode: 'write',
      domain: 'schedule-attendance-planning',
      description: 'Update a managed-team game or practice. Args: teamId, eventId, eventType, input, and practice scope occurrence|series.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Update schedule event'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const service = await import('./scheduleService');
        const input = (isPlainObject(args.input) ? args.input : args) as any;
        const eventId = compactText(args.eventId || args.gameId);
        return compactText(args.eventType || args.type).toLowerCase() === 'practice'
          ? service.updateScheduledPracticeForApp(teamId, input, user, {
              eventId,
              scope: compactText(args.scope) === 'occurrence' ? 'occurrence' : 'series',
              instanceDate: compactText(args.instanceDate)
            } as any)
          : service.updateScheduledGameForApp(teamId, eventId, input, user);
      }
    },
    {
      name: 'cancel_schedule_event',
      mode: 'write',
      domain: 'schedule-attendance-planning',
      description: 'Cancel a managed-team game or practice without deleting history. Args: teamId, eventId, eventType.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Cancel schedule event'),
      resolve: async (user, args) => {
        await requireManagedTeamId(user, args);
        const event = await resolveAccessibleScheduleEvent(user, args);
        if (!event) throw new Error('No matching schedule event was found.');
        const service = await import('./scheduleService');
        return event.type === 'practice'
          ? service.cancelPracticeOccurrenceForApp(event, user)
          : service.cancelScheduledGameForApp(event, user);
      }
    },
    {
      name: 'send_rsvp_reminder',
      mode: 'write',
      domain: 'schedule-attendance-planning',
      description: 'Send the normal staff RSVP reminder for a managed-team event. Args: teamId, eventId.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Send RSVP reminder'),
      resolve: async (user, args) => {
        await requireManagedTeamId(user, args);
        const event = await resolveAccessibleScheduleEvent(user, args);
        if (!event) throw new Error('No matching schedule event was found.');
        const { sendStaffRsvpReminder } = await import('./scheduleService');
        return sendStaffRsvpReminder(event, user, await getUserProfile(user.uid).catch(() => ({})));
      }
    },
    {
      name: 'manage_schedule_assignment',
      mode: 'write',
      domain: 'schedule-attendance-planning',
      description: 'Create, update, or remove a managed event assignment. Args: teamId, eventId, action create|update|remove, role/currentRole, assignment.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Manage schedule assignment'),
      resolve: async (user, args) => {
        await requireManagedTeamId(user, args);
        const event = await resolveAccessibleScheduleEvent(user, args);
        if (!event) throw new Error('No matching schedule event was found.');
        const service = await import('./scheduleService');
        const action = compactText(args.action).toLowerCase();
        if (action === 'remove') return service.removeScheduleAssignment(event, user, compactText(args.role || args.currentRole));
        if (action === 'update') return service.updateScheduleAssignment(event, user, compactText(args.currentRole || args.role), (isPlainObject(args.assignment) ? args.assignment : args) as any);
        return service.createScheduleAssignment(event, user, (isPlainObject(args.assignment) ? args.assignment : args) as any);
      }
    },
    {
      name: 'save_practice_attendance',
      mode: 'write',
      domain: 'schedule-attendance-planning',
      description: 'Save player attendance for a managed practice. Args: teamId, eventId, attendance with player statuses and notes.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Save practice attendance'),
      resolve: async (user, args) => {
        await requireManagedTeamId(user, args);
        const event = await resolveAccessibleScheduleEvent(user, { ...args, type: 'practice' });
        if (!event) throw new Error('No matching practice was found.');
        const service = await import('./scheduleService');
        const currentAttendance = await service.loadStaffPracticeAttendance(event, user);
        const attendanceInput = isPlainObject(args.attendance) ? args.attendance : args;
        const suppliedPlayers = Array.isArray(attendanceInput.players) ? attendanceInput.players : [];
        if (suppliedPlayers.length === 0) {
          throw new Error('At least one player attendance change is required.');
        }
        const playersById = new Map(currentAttendance.players.map((player) => [player.playerId, player]));
        suppliedPlayers.forEach((player, index) => {
          const playerId = compactText(player?.playerId);
          if (!playerId) {
            throw new Error(`Attendance change ${index + 1} is missing a player ID.`);
          }
          const currentPlayer = playersById.get(playerId);
          if (!currentPlayer) {
            throw new Error(`Player ${playerId} is not on the current practice roster.`);
          }
          const status = compactText(player?.status).toLowerCase();
          if (!['not_marked', 'present', 'late', 'absent'].includes(status)) {
            throw new Error(`Attendance status for ${currentPlayer.displayName || playerId} must be present, late, absent, or not_marked.`);
          }
          playersById.set(playerId, {
            ...currentPlayer,
            status,
            ...(hasOwn(player, 'note') ? { note: compactText(player.note) || null } : {})
          } as typeof currentPlayer);
        });
        const attendance = {
          ...currentAttendance,
          players: Array.from(playersById.values())
        };
        return service.saveStaffPracticeAttendance(event, user, attendance as any);
      }
    },
    {
      name: 'save_practice_packet',
      mode: 'write',
      domain: 'schedule-attendance-planning',
      description: 'Save the home/practice packet for a managed practice. Args: teamId, eventId, packet with title, due date, notes, and blocks.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Save practice packet'),
      resolve: async (user, args) => {
        await requireManagedTeamId(user, args);
        const event = await resolveAccessibleScheduleEvent(user, { ...args, type: 'practice' });
        if (!event) throw new Error('No matching practice was found.');
        const { saveStaffPracticePacket } = await import('./scheduleService');
        return saveStaffPracticePacket(event, user, (isPlainObject(args.packet) ? args.packet : args) as any, []);
      }
    },
    {
      name: 'update_game_score',
      mode: 'write',
      domain: 'game-planning-and-wrap-up',
      description: 'Update the score for a managed game. Args: teamId, eventId/gameId, homeScore, awayScore.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Update game score'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const { updateGameScore } = await import('./scheduleService');
        return updateGameScore(teamId, compactText(args.gameId || args.eventId), {
          homeScore: Number(args.homeScore),
          awayScore: Number(args.awayScore)
        }, user);
      }
    },
    {
      name: 'complete_game_wrapup',
      mode: 'write',
      domain: 'game-planning-and-wrap-up',
      description: 'Complete a managed game wrap-up with final report payload. Args: teamId, gameId/eventId, payload.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Complete game wrap-up'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const { completeGameWrapupForApp } = await import('./scheduleService');
        return completeGameWrapupForApp(teamId, compactText(args.gameId || args.eventId), isPlainObject(args.payload) ? args.payload : args, user);
      }
    },
    {
      name: 'send_team_email',
      mode: 'write',
      domain: 'team-communications',
      description: 'Send a managed-team email using the normal team email service. Args: teamId/teamName, subject, body, targetType full_team|staff|individuals, recipientIds.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, `Send team email: ${compactText(args.subject)}`),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const { sendTeamEmailMessage } = await import('./chatService');
        const requestedTargetType = compactText(args.targetType || args.target).toLowerCase();
        const targetType = requestedTargetType === 'staff' || requestedTargetType === 'individuals'
          ? requestedTargetType
          : 'full_team';
        return sendTeamEmailMessage({
          teamId,
          subject: compactText(args.subject),
          body: compactText(args.body || args.message),
          targetType,
          recipientIds: Array.isArray(args.recipientIds) ? args.recipientIds.map(compactText).filter(Boolean) : []
        });
      }
    },
    {
      name: 'create_team_fee',
      mode: 'write',
      domain: 'fees-payments-registration',
      description: 'Create a managed-team fee for the whole roster or selected player IDs. Args: teamId, title, amount, dueDate, recipientIds, applyToWholeRoster, installmentPlan.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Create team fee'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const { createTeamFeeBatchForApp } = await import('./teamFeesService');
        return createTeamFeeBatchForApp({
          teamId,
          title: compactText(args.title),
          amount: args.amount as any,
          dueDate: compactText(args.dueDate),
          recipientIds: Array.isArray(args.recipientIds) ? args.recipientIds.map(compactText).filter(Boolean) : [],
          applyToWholeRoster: args.applyToWholeRoster === true,
          installmentPlan: isPlainObject(args.installmentPlan) ? args.installmentPlan as any : null,
          user
        });
      }
    },
    {
      name: 'review_registration',
      mode: 'write',
      domain: 'fees-payments-registration',
      description: 'Approve, reject, extend, or accept a managed-team registration/waitlist offer. Args: teamId, formId, registrationId, action, playerId, decisionNote.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Review registration'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const service = await import('./parentRegistrationsService');
        const formId = compactText(args.formId);
        const registrationId = compactText(args.registrationId);
        const note = compactText(args.decisionNote);
        const action = compactText(args.action).toLowerCase();
        if (action === 'reject') return service.rejectTeamRegistrationForApp(user, teamId, formId, registrationId, note);
        if (action === 'extend') return service.extendTeamRegistrationOfferForApp(user, teamId, formId, registrationId, note);
        if (action === 'accept') return service.acceptTeamRegistrationOfferForApp(user, teamId, formId, registrationId, note);
        return service.approveTeamRegistrationForApp(user, teamId, formId, registrationId, { playerId: compactText(args.playerId), decisionNote: note });
      }
    },
    {
      name: 'set_team_drill_favorite',
      mode: 'write',
      domain: 'drills-practice-awards-social',
      description: 'Add or remove a drill from a managed team’s favorites. Args: teamId, drillId, favorite.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Update team drill favorite'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const { setTeamDrillFavorite } = await import('./teamDrillsService');
        await setTeamDrillFavorite(teamId, user, compactText(args.drillId), args.favorite !== false);
        return { teamId, drillId: compactText(args.drillId), favorite: args.favorite !== false };
      }
    },
    {
      name: 'save_practice_timeline',
      mode: 'write',
      domain: 'drills-practice-awards-social',
      description: 'Save a managed practice timeline with ordered drill blocks. Args: teamId, eventId, sessionId optional, title, date, location, blocks.',
      prepare: (user, args) => prepareManagedTeamAction(user, args, 'Save practice timeline'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const { savePracticeTimelineForApp } = await import('./practiceTimelineService');
        return savePracticeTimelineForApp({
          teamId,
          eventId: compactText(args.eventId),
          sessionId: compactText(args.sessionId) || null,
          title: compactText(args.title),
          date: args.date as any,
          location: compactText(args.location),
          blocks: Array.isArray(args.blocks) ? args.blocks as any : [],
          user
        });
      }
    }
  ];
  return definitions.map((definition) => ({ ...definition, audience: 'manager' as const }));
}

async function requireManagedTeamId(user: AuthUser, args: Record<string, unknown>) {
  const teamId = await resolveAccessibleTeamId(user, args, { requireManager: true });
  if (!teamId) throw new Error('No managed team matched that request or your access changed.');
  return teamId;
}

async function prepareManagedTeamAction(user: AuthUser, args: Record<string, unknown>, label: string) {
  const teamId = await requireManagedTeamId(user, args);
  return {
    args: {
      ...args,
      teamId
    },
    summary: `${label} | Team: ${teamId}`,
    previewSummary: {
      domain: 'team-management',
      teamId,
      action: label
    }
  };
}

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
  context: PrivateAiToolContext = {},
  prepared: {
    summary?: string;
    previewSummary?: Record<string, unknown>;
  } = {}
): Promise<PrivateAiPendingAction> {
  const id = createConfirmationId();
  const createdAt = new Date();
  const conversationId = normalizeConversationId(context.conversationId);
  const confirmationGroupId = compactText(context.confirmationGroupId) || createConfirmationGroupId();
  const preparedArgs = sanitizePendingActionPayloadArgs(args);
  const teamId = compactText(args.teamId);
  const payloadScope = isTeamScopedPrivateAiPayload(definition.name) ? 'team' : 'user';
  if (payloadScope === 'team' && !teamId) {
    throw new Error('A managed team is required to securely prepare this AI action.');
  }
  const pending: PrivateAiPendingAction = {
    id,
    userId: user.uid,
    toolName: definition.name,
    args: preparedArgs,
    summary: compactText(prepared.summary) || buildPendingActionSummary(definition, args),
    createdAt: createdAt.toISOString(),
    conversationId,
    confirmationGroupId,
    previewSummary: prepared.previewSummary,
    teamId: teamId || undefined,
    payloadScope,
    expiresAt: new Date(createdAt.getTime() + pendingActionLifetimeMs).toISOString(),
    status: 'pending'
  };
  const userPayload = {
    ...pending,
    args: sanitizePendingActionArgsForUserStorage(definition.name, preparedArgs),
    createdAt: serverTimestamp(),
    clientCreatedAt: pending.createdAt,
    expiresAt: pending.expiresAt,
    status: pending.status,
    audit: {
      preparedBy: user.uid,
      preparedAt: pending.createdAt,
      conversationId,
      confirmationGroupId
    }
  };
  const teamPayload = payloadScope === 'team' ? {
    userId: user.uid,
    teamId,
    toolName: definition.name,
    args: preparedArgs,
    status: pending.status,
    createdAt: serverTimestamp(),
    clientCreatedAt: pending.createdAt,
    expiresAt: pending.expiresAt,
    expiresAtAt: new Date(pending.expiresAt),
    audit: {
      preparedBy: user.uid,
      preparedAt: pending.createdAt,
      conversationId,
      confirmationGroupId
    }
  } : null;

  // Read the recent durable actions before opening the transaction. Failure is
  // fatal: replacing a proposal without knowing which older actions to
  // supersede can make an old confirmation executable after the UI replaced it.
  const recentSnapshot = await getDocs(query(
    collection(db, 'users', user.uid, privateAiPendingActionCollectionName),
    orderBy('createdAt', 'desc'),
    limit(100)
  ));
  const recentIds = new Set<string>();
  (recentSnapshot.docs || []).forEach((candidate: any) => {
    const candidateId = compactText(candidate?.id);
    const data = typeof candidate?.data === 'function' ? candidate.data() : null;
    if (
      candidateId
      && isPlainObject(data)
      && data.status === 'pending'
      && compactText(data.userId) === user.uid
      && normalizeConversationId(data.conversationId) === conversationId
    ) recentIds.add(candidateId);
  });
  pendingActionMemory.forEach((candidate) => {
    if (
      candidate.userId === user.uid
      && candidate.status === 'pending'
      && normalizeConversationId(candidate.conversationId) === conversationId
    ) recentIds.add(candidate.id);
  });

  const conversationRef = doc(db, 'users', user.uid, privateAiConversationCollectionName, conversationId);
  const userPendingRef = doc(db, 'users', user.uid, privateAiPendingActionCollectionName, id);
  await runTransaction(db, async (transaction: any) => {
    const conversationSnapshot = await transaction.get(conversationRef);
    const conversationData = typeof conversationSnapshot?.data === 'function'
      ? conversationSnapshot.data()
      : {};
    const storedHeadIds = Array.isArray(conversationData?.pendingActionIds)
      ? conversationData.pendingActionIds.map(compactText).filter(Boolean)
      : [];
    storedHeadIds.forEach((candidateId: string) => recentIds.add(candidateId));

    const candidateIds = [...recentIds].filter((candidateId) => candidateId && candidateId !== id);
    const candidateRecords = await Promise.all(candidateIds.map(async (candidateId) => {
      const reference = doc(db, 'users', user.uid, privateAiPendingActionCollectionName, candidateId);
      const snapshot = await transaction.get(reference);
      const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
      return { id: candidateId, reference, snapshot, data };
    }));
    const pendingRecords = candidateRecords.filter((candidate) => (
      candidate.snapshot?.exists?.()
      && isPlainObject(candidate.data)
      && candidate.data.status === 'pending'
      && compactText(candidate.data.userId) === user.uid
      && normalizeConversationId(candidate.data.conversationId) === conversationId
    ));
    const supersededRecords = pendingRecords.filter((candidate) => (
      compactText(candidate.data.confirmationGroupId) !== confirmationGroupId
    ));
    const sameGroupIds = pendingRecords
      .filter((candidate) => compactText(candidate.data.confirmationGroupId) === confirmationGroupId)
      .map((candidate) => candidate.id);
    const teamRecords = await Promise.all(supersededRecords.map(async (candidate) => {
      const oldTeamId = compactText(candidate.data.teamId);
      if (candidate.data.payloadScope !== 'team' || !oldTeamId) return null;
      const reference = doc(db, 'teams', oldTeamId, teamPrivateAiPendingActionCollectionName, candidate.id);
      const snapshot = await transaction.get(reference);
      const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
      return { reference, snapshot, data };
    }));

    supersededRecords.forEach((candidate) => {
      transaction.set(candidate.reference, {
        status: 'superseded',
        supersededAt: serverTimestamp(),
        supersededBy: id
      }, { merge: true });
    });
    teamRecords.forEach((candidate) => {
      if (
        !candidate?.snapshot?.exists?.()
        || !isPlainObject(candidate.data)
        || compactText(candidate.data.userId) !== user.uid
      ) return;
      transaction.set(candidate.reference, {
        args: {},
        status: 'superseded',
        payloadClearedAt: serverTimestamp(),
        payloadClearedBy: user.uid,
        supersededBy: id
      }, { merge: true });
    });
    if (teamPayload) {
      transaction.set(doc(db, 'teams', teamId, teamPrivateAiPendingActionCollectionName, id), teamPayload);
    }
    transaction.set(userPendingRef, userPayload);
    transaction.set(conversationRef, {
      pendingActionIds: [...new Set([...sameGroupIds, id])],
      pendingGroupId: confirmationGroupId,
      pendingUpdatedAt: serverTimestamp()
    }, { merge: true });
  });

  pendingActionMemory.forEach((candidate, key) => {
    if (
      candidate.userId === user.uid
      && candidate.status === 'pending'
      && normalizeConversationId(candidate.conversationId) === conversationId
      && candidate.confirmationGroupId !== confirmationGroupId
    ) {
      candidate.status = 'superseded';
      pendingActionMemory.set(key, candidate);
    }
  });
  pendingActionMemory.set(`${user.uid}:${id}`, pending);
  return pending;
}

async function claimPrivateAiPendingAction(
  user: AuthUser,
  pending: PrivateAiPendingAction
): Promise<PrivateAiPendingAction | null> {
  const memoryKey = `${user.uid}:${pending.id}`;
  const memoryPending = pendingActionMemory.get(memoryKey);
  if (memoryPending && memoryPending.status !== 'pending') return null;

  if (typeof runTransaction !== 'function') {
    if (!memoryPending || pending.payloadScope === 'team') return null;
    memoryPending.status = 'executing';
    pendingActionMemory.set(memoryKey, memoryPending);
    return memoryPending;
  }
  const pendingRef = doc(db, 'users', user.uid, privateAiPendingActionCollectionName, pending.id);
  try {
    const claimed = await runTransaction(db, async (transaction: any): Promise<PrivateAiPendingAction | null> => {
      const snapshot = await transaction.get(pendingRef);
      const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
      const expiresAt = compactText(data?.expiresAt);
      if (
        !snapshot?.exists?.()
        || !isPlainObject(data)
        || data.status !== 'pending'
        || compactText(data.userId) !== user.uid
        || !expiresAt
        || Date.parse(expiresAt) <= Date.now()
      ) return null;

      const toolName = compactText(data.toolName);
      const teamId = compactText(data.teamId);
      const payloadScope = data.payloadScope === 'team' ? 'team' : 'user';
      let args = isPlainObject(data.args) ? data.args : {};
      let teamPayloadRef: ReturnType<typeof doc> | null = null;
      if (payloadScope === 'team') {
        if (!teamId) return null;
        teamPayloadRef = doc(
          db,
          'teams',
          teamId,
          teamPrivateAiPendingActionCollectionName,
          pending.id
        );
        const payloadSnapshot = await transaction.get(teamPayloadRef);
        const payload = typeof payloadSnapshot?.data === 'function' ? payloadSnapshot.data() : null;
        if (
          !payloadSnapshot?.exists?.()
          || !isPlainObject(payload)
          || payload.status !== 'pending'
          || compactText(payload.userId) !== user.uid
          || compactText(payload.toolName) !== toolName
          || compactText(payload.teamId || (isPlainObject(payload.args) ? payload.args.teamId : '')) !== teamId
          || !isPlainObject(payload.args)
          || (compactText(payload.expiresAt) && Date.parse(compactText(payload.expiresAt)) <= Date.now())
        ) return null;
        args = payload.args;
      }

      const executionState = {
        status: 'executing',
        executionStartedAt: serverTimestamp(),
        executionStartedBy: user.uid
      };
      transaction.set(pendingRef, {
        ...executionState
      }, { merge: true });
      if (teamPayloadRef) {
        transaction.set(teamPayloadRef, executionState, { merge: true });
      }
      return {
        id: pending.id,
        userId: user.uid,
        toolName,
        args,
        summary: compactText(data.summary),
        createdAt: normalizeScheduleDate(data.createdAt)?.toISOString()
          || compactText(data.clientCreatedAt)
          || pending.createdAt,
        conversationId: normalizeConversationId(data.conversationId),
        confirmationGroupId: compactText(data.confirmationGroupId),
        previewSummary: isPlainObject(data.previewSummary) ? data.previewSummary : undefined,
        teamId: teamId || undefined,
        payloadScope,
        expiresAt,
        status: 'executing'
      };
    });
    if (claimed) pendingActionMemory.set(memoryKey, claimed);
    return claimed;
  } catch (error) {
    logger.warn('Unable to transactionally claim private AI action.', { error, confirmationId: pending.id });
    return null;
  }
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
  if (Date.parse(pending.expiresAt) <= Date.now()) {
    return { name: pending.toolName, ok: false, error: 'That AI preview expired. Prepare the change again before confirming.' };
  }
  const claimedPending = await claimPrivateAiPendingAction(user, pending);
  if (!claimedPending) {
    return { name: pending.toolName, ok: false, error: 'That AI change was already confirmed, superseded, or is currently running.' };
  }

  const result = await runPrivateAiToolInternal(user, {
    name: definition.name,
    args: claimedPending.args
  }, {
    confirmedWriteToken: confirmedWriteExecutionToken
  });
  if (result.ok) {
    claimedPending.status = 'completed';
    pendingActionMemory.set(`${user.uid}:${id}`, claimedPending);
    await setDoc(doc(db, 'users', user.uid, privateAiPendingActionCollectionName, id), {
      status: 'completed',
      completedAt: serverTimestamp(),
      completedBy: user.uid
    }, { merge: true }).catch(() => {});
    await clearTeamScopedPrivateAiPayload(user, claimedPending, 'completed');
  } else {
    claimedPending.status = 'failed';
    pendingActionMemory.set(`${user.uid}:${id}`, claimedPending);
    await setDoc(doc(db, 'users', user.uid, privateAiPendingActionCollectionName, id), {
      status: 'failed',
      failedAt: serverTimestamp(),
      failure: result.error || 'Action failed.'
    }, { merge: true }).catch(() => {});
    await clearTeamScopedPrivateAiPayload(user, claimedPending, 'failed');
  }
  return {
    ...result,
    confirmationId: id
  };
}

async function clearTeamScopedPrivateAiPayload(
  user: AuthUser,
  pending: PrivateAiPendingAction,
  status: 'completed' | 'failed' | 'superseded'
) {
  if (pending.payloadScope !== 'team' || !pending.teamId) return;
  await setDoc(doc(
    db,
    'teams',
    pending.teamId,
    teamPrivateAiPendingActionCollectionName,
    pending.id
  ), {
    args: {},
    status,
    payloadClearedAt: serverTimestamp(),
    payloadClearedBy: user.uid
  }, { merge: true }).catch((error) => {
    logger.warn('Unable to clear team-scoped private AI payload.', {
      error,
      teamId: pending.teamId,
      confirmationId: pending.id
    });
  });
}

async function loadPrivateAiPendingAction(user: AuthUser, confirmationId: string): Promise<PrivateAiPendingAction | null> {
  const memoryKey = `${user.uid}:${confirmationId}`;
  const fromMemory = pendingActionMemory.get(memoryKey);
  if (fromMemory?.status === 'pending' && fromMemory.payloadScope !== 'team') return fromMemory;

  const snapshot = await getDoc(doc(db, 'users', user.uid, privateAiPendingActionCollectionName, confirmationId)).catch(() => null);
  const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
  if (!snapshot?.exists?.() || !isPlainObject(data) || data.status !== 'pending') return null;
  if (compactText(data.userId) !== user.uid) return null;
  const toolName = compactText(data.toolName);
  const teamId = compactText(data.teamId);
  const payloadScope = data.payloadScope === 'team' ? 'team' : 'user';
  let args = isPlainObject(data.args) ? data.args : {};
  if (payloadScope === 'team') {
    if (!teamId) return null;
    const detail = await loadParentTeamDetail(teamId, user).catch(() => null);
    if (!detail?.team || detail.canManageTeam !== true) return null;
    const payloadSnapshot = await getDoc(doc(
      db,
      'teams',
      teamId,
      teamPrivateAiPendingActionCollectionName,
      confirmationId
    )).catch(() => null);
    const payload = typeof payloadSnapshot?.data === 'function' ? payloadSnapshot.data() : null;
    if (
      !payloadSnapshot?.exists?.()
      || !isPlainObject(payload)
      || payload.status !== 'pending'
      || compactText(payload.userId) !== user.uid
      || compactText(payload.toolName) !== toolName
      || !isPlainObject(payload.args)
    ) return null;
    args = payload.args;
  }
  return {
    id: confirmationId,
    userId: user.uid,
    toolName,
    args,
    summary: compactText(data.summary),
    createdAt: normalizeScheduleDate(data.createdAt)?.toISOString() || compactText(data.clientCreatedAt) || new Date().toISOString(),
    conversationId: normalizeConversationId(data.conversationId),
    confirmationGroupId: compactText(data.confirmationGroupId),
    previewSummary: isPlainObject(data.previewSummary) ? data.previewSummary : undefined,
    teamId: teamId || undefined,
    payloadScope,
    expiresAt: compactText(data.expiresAt) || new Date(Date.now() + pendingActionLifetimeMs).toISOString(),
    status: 'pending'
  };
}

async function resolvePendingActionIdsForNaturalConfirmation(
  user: AuthUser,
  priorMessages: PrivateAiMessage[] = [],
  context: PrivateAiToolContext = {}
) {
  const conversationId = normalizeConversationId(context.conversationId);
  const fromMessageReference = [...priorMessages]
    .reverse()
    .find((message) => (
      message.role === 'assistant'
      && messageBelongsToConversation(message, conversationId)
      && Array.isArray(message.pendingActionIds)
      && message.pendingActionIds.length > 0
    ));
  if (fromMessageReference?.pendingActionIds?.length) {
    return fromMessageReference.pendingActionIds;
  }

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
      confirmationGroupId: compactText(data.confirmationGroupId),
      previewSummary: isPlainObject(data.previewSummary) ? data.previewSummary : undefined,
      expiresAt: compactText(data.expiresAt) || new Date(Date.now() + pendingActionLifetimeMs).toISOString(),
      status: 'pending' as const
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
    args: sanitizePendingActionArgsForUserStorage(toolName, args),
    result: summarizeAuditResult(result),
    createdAt: serverTimestamp(),
    clientCreatedAt: new Date().toISOString()
  });
}

function parseConfirmationId(question: string) {
  const match = compactText(question).match(/\bconfirm\s+(ai_[a-z0-9]{6,32})\b/i);
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
    .filter((pending) => pending.id && pending.status === 'pending' && Date.parse(pending.expiresAt) > Date.now())
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

function sanitizeToolCallArgs(args: Record<string, unknown>) {
  return Object.entries(args).reduce<Record<string, unknown>>((sanitized, [key, value]) => {
    if (key === '__confirmed') return sanitized;
    sanitized[key] = value;
    return sanitized;
  }, {});
}

function sanitizePendingActionPayloadArgs(args: Record<string, unknown>) {
  const blocked = new Set(['__confirmed', 'photoFile', 'file', 'profilePhotoFile', 'highlightClipFile']);
  return Object.entries(args).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (blocked.has(key)) return acc;
    if (value === undefined || typeof value === 'function') return acc;
    acc[key] = value;
    return acc;
  }, {});
}

function isTeamScopedPrivateAiPayload(toolName: string) {
  return toolName === 'apply_roster_import';
}

function sanitizePendingActionArgsForUserStorage(toolName: string, args: Record<string, unknown>) {
  const sanitized = sanitizePendingActionPayloadArgs(args);
  if (!isTeamScopedPrivateAiPayload(toolName)) return sanitized;
  const operations = Array.isArray(sanitized.operations)
    ? sanitized.operations as RosterImportPlannedOperationForApp[]
    : [];
  return {
    teamId: compactText(sanitized.teamId),
    source: compactText(sanitized.source),
    operationSummary: summarizeRosterOperations(operations),
    validationErrorCount: Array.isArray(sanitized.__rosterValidationErrors)
      ? sanitized.__rosterValidationErrors.length
      : 0
  };
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
  if (result.name === 'apply_roster_import') {
    const data = isPlainObject(result.data) ? result.data : {};
    const savedCount = Array.isArray(data.savedOperations) ? data.savedOperations.length : 0;
    const invitationSummary = isPlainObject(data.invitationSummary)
      ? data.invitationSummary
      : summarizeRosterInvitationResults(data.inviteResults);
    const linked = Number(invitationSummary.linked || 0);
    const emailed = Number(invitationSummary.emailed || 0);
    const retryable = Number(invitationSummary.retryable || 0);
    const failed = Number(invitationSummary.failed || 0);
    const retryableRecipients = Array.isArray(invitationSummary.retryableRecipients)
      ? invitationSummary.retryableRecipients.map(compactText).filter(Boolean)
      : [];
    const failedRecipients = Array.isArray(invitationSummary.failedRecipients)
      ? invitationSummary.failedRecipients.map(compactText).filter(Boolean)
      : [];
    const deliveryDetails = [
      `${linked} linked`,
      `${emailed} emailed`,
      `${retryable} retryable`,
      `${failed} failed`
    ].join(', ');
    const followUp = [
      retryableRecipients.length ? `Retry email for: ${retryableRecipients.join(', ')}.` : '',
      failedRecipients.length ? `Invitation failed for: ${failedRecipients.join(', ')}.` : ''
    ].filter(Boolean).join(' ');
    return `Roster import saved ${savedCount} operation${savedCount === 1 ? '' : 's'}. Invitations: ${deliveryDetails}.${followUp ? ` ${followUp}` : ''}`;
  }
  if (result.name === 'apply_schedule_import') {
    const data = isPlainObject(result.data) ? result.data : {};
    const importedCount = Number(data.importedCount || 0);
    const failedCount = Number(data.failedCount || 0);
    if (failedCount > 0) {
      const failedRows = Array.isArray(data.failures)
        ? data.failures
          .map((failure) => isPlainObject(failure) ? Number(failure.rowNumber || 0) : 0)
          .filter(Boolean)
        : [];
      return `Schedule import partially completed: ${importedCount} imported and ${failedCount} failed${failedRows.length ? ` (rows ${failedRows.join(', ')})` : ''}. Correct and retry only the failed rows.`;
    }
    return `Schedule imported: ${importedCount} row${importedCount === 1 ? '' : 's'} saved.`;
  }
  if (result.name === 'invite_roster_parent') {
    const data = isPlainObject(result.data) ? result.data : {};
    const email = compactText(data.email);
    const playerName = compactText(data.playerName);
    const recipient = [email, playerName ? `for ${playerName}` : ''].filter(Boolean).join(' ');
    if (data.emailQueued === true || data.emailSent === true) {
      return data.emailDeduplicated === true
        ? `The parent invitation ${recipient} was already queued for email.`
        : `Parent invitation created and acceptance email queued ${recipient}.`;
    }
    if (data.autoLinked === true) {
      return `The existing parent account ${recipient} was linked, but the notification email could not be queued. Ask me to retry the invitation email.`;
    }
    return `Parent invitation created ${recipient}, but its acceptance email could not be queued. Ask me to retry the invitation email.`;
  }
  if (result.name === 'resend_roster_parent_invite') {
    const data = isPlainObject(result.data) ? result.data : {};
    return data.emailDeduplicated === true
      ? 'The parent invitation email was already queued.'
      : 'The parent invitation email was queued again.';
  }
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

function summarizeRosterInvitationResults(value: unknown) {
  const results = Array.isArray(value) ? value : [];
  return results.reduce((summary, invite) => {
    if (!isPlainObject(invite)) return summary;
    const status = compactText(invite.status);
    const emailStatus = compactText(invite.emailStatus);
    const email = compactText(invite.email);
    if (status === 'linked') summary.linked += 1;
    if (emailStatus === 'emailed' || (!emailStatus && status === 'emailed')) summary.emailed += 1;
    if (emailStatus === 'retryable' || (!emailStatus && status === 'code-created')) {
      summary.retryable += 1;
      if (email) summary.retryableRecipients.push(email);
    }
    if (status === 'failed') {
      summary.failed += 1;
      if (email) summary.failedRecipients.push(email);
    }
    return summary;
  }, {
    linked: 0,
    emailed: 0,
    retryable: 0,
    failed: 0,
    retryableRecipients: [] as string[],
    failedRecipients: [] as string[]
  });
}

function summarizeExecutedActions(results: PrivateAiToolResult[]) {
  return results.map(summarizeExecutedAction).join(' ');
}

function summarizeAuditResult(result: unknown) {
  if (!isPlainObject(result)) return result;
  return pickFields(result, ['event', 'offerId', 'requestId', 'status', 'response', 'updatedChildren', 'tokenId', 'url', 'email', 'role', 'teamId', 'playerId', 'child', 'text', 'target', 'importedCount', 'failedCount']);
}

function summarizeRosterPreview(rows: RosterAiImportPreviewRow[]) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    summary[row.action] += 1;
    summary.invitations += row.inviteCount;
    return summary;
  }, {
    total: 0,
    add: 0,
    update: 0,
    deactivate: 0,
    reactivate: 0,
    invitations: 0
  });
}

function summarizeRosterOperations(operations: RosterImportPlannedOperationForApp[]) {
  return operations.reduce((summary, operation) => {
    summary.total += 1;
    summary[operation.type] += 1;
    summary.invitations += operation.inviteRequests?.length || 0;
    return summary;
  }, {
    total: 0,
    add: 0,
    update: 0,
    deactivate: 0,
    reactivate: 0,
    invitations: 0
  });
}

function summarizeSchedulePreview(rows: ScheduleCsvImportPreviewRow[]) {
  return summarizeScheduleRows(rows.map((row) => row.normalized));
}

function summarizeScheduleRows(rows: ScheduleCsvImportPreviewRow['normalized'][]) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    if (row.eventType === 'practice') summary.practices += 1;
    else summary.games += 1;
    return summary;
  }, {
    total: 0,
    games: 0,
    practices: 0
  });
}

function stripPrivateAiArtifactForStorage(artifact: PrivateAiArtifactReference) {
  const stored: Record<string, unknown> = {
    type: artifact.type,
    confirmationId: artifact.confirmationId,
    teamId: artifact.teamId,
    teamName: artifact.teamName,
    source: artifact.source,
    summary: artifact.summary
  };
  if (artifact.type === 'document-analysis') {
    stored.fileName = artifact.fileName;
    stored.mimeType = artifact.mimeType;
  } else if (artifact.type === 'roster-import' && artifact.previewRows?.length) {
    stored.previewRows = sanitizePrivateAiStorageValue(artifact.previewRows.slice(0, 200).map((row) => ({
      rowNumber: row.rowNumber,
      action: row.action,
      playerId: row.playerId,
      name: row.name,
      number: row.number,
      reason: row.reason,
      fields: row.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        ...(field.section ? { section: field.section } : {}),
        value: field.value,
        ...(field.options?.length ? { options: field.options } : {})
      })),
      contacts: row.contacts.map((contact) => ({
        ...(hasOwn(contact, 'name') ? { name: contact.name } : {}),
        ...(hasOwn(contact, 'email') ? { email: contact.email } : {}),
        ...(hasOwn(contact, 'phone') ? { phone: contact.phone } : {}),
        ...(hasOwn(contact, 'relation') ? { relation: contact.relation } : {}),
        ...(hasOwn(contact, 'bucket') ? { bucket: contact.bucket } : {}),
        ...(contact.providedKeys?.length ? { providedKeys: contact.providedKeys } : {})
      })),
      inviteCount: row.inviteCount,
      duplicatePlayerId: row.duplicatePlayerId,
      duplicatePlayerName: row.duplicatePlayerName,
      errors: row.errors
    })));
  } else if (artifact.type === 'schedule-import' && artifact.previewRows?.length) {
    stored.previewRows = sanitizePrivateAiStorageValue(artifact.previewRows.slice(0, 200).map((row) => ({
      rowNumber: row.rowNumber,
      normalized: row.normalized,
      errors: row.errors
    })));
  }
  return stored;
}

function normalizePrivateAiArtifact(value: unknown): PrivateAiArtifactReference | null {
  if (!isPlainObject(value)) return null;
  const summary = isPlainObject(value.summary) ? value.summary : {};
  if (value.type === 'document-analysis') {
    return {
      type: 'document-analysis',
      confirmationId: '',
      teamId: compactText(value.teamId),
      teamName: compactText(value.teamName),
      source: value.source === 'csv' || value.source === 'pdf' ? value.source : 'image',
      fileName: compactText(value.fileName) || 'Attachment',
      mimeType: compactText(value.mimeType),
      summary: {
        total: 1,
        errors: Number(summary.errors || 0)
      }
    };
  }
  if (value.type === 'schedule-import') {
    return {
      type: 'schedule-import',
      confirmationId: compactText(value.confirmationId),
      teamId: compactText(value.teamId),
      teamName: compactText(value.teamName) || 'Team',
      source: normalizePrivateAiImportSource(value.source),
      summary: {
        total: Number(summary.total || 0),
        games: Number(summary.games || 0),
        practices: Number(summary.practices || 0),
        errors: Number(summary.errors || 0)
      },
      previewRows: normalizeStoredSchedulePreviewRows(value.previewRows)
    };
  }
  if (value.type !== 'roster-import') return null;
  return {
    type: 'roster-import',
    confirmationId: compactText(value.confirmationId),
    teamId: compactText(value.teamId),
    teamName: compactText(value.teamName) || 'Team',
    source: normalizePrivateAiImportSource(value.source),
    summary: {
      total: Number(summary.total || 0),
      add: Number(summary.add || 0),
      update: Number(summary.update || 0),
      deactivate: Number(summary.deactivate || 0),
      reactivate: Number(summary.reactivate || 0),
      invitations: Number(summary.invitations || 0),
      errors: Number(summary.errors || 0)
    },
    previewRows: normalizeStoredRosterPreviewRows(value.previewRows)
  };
}

function normalizeStoredRosterPreviewRows(value: unknown): RosterAiImportPreviewRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.slice(0, 200).map((candidate, index) => {
    if (!isPlainObject(candidate)) return null;
    const action = ['add', 'update', 'deactivate', 'reactivate'].includes(String(candidate.action))
      ? candidate.action as RosterAiImportPreviewRow['action']
      : null;
    if (!action) return null;
    const fields = Array.isArray(candidate.fields)
      ? candidate.fields.filter((field) => isPlainObject(field)
        && compactText(field.key)
        && compactText(field.label)
        && ['text', 'menu', 'checkbox', 'date'].includes(String(field.type))) as RosterAiImportPreviewRow['fields']
      : [];
    const contacts = Array.isArray(candidate.contacts)
      ? candidate.contacts.filter(isPlainObject) as RosterAiImportPreviewRow['contacts']
      : [];
    return {
      rowNumber: Number(candidate.rowNumber) || index + 1,
      action,
      playerId: compactText(candidate.playerId),
      name: compactText(candidate.name),
      number: compactText(candidate.number),
      reason: compactText(candidate.reason),
      fields,
      contacts,
      inviteCount: Number(candidate.inviteCount) || 0,
      duplicatePlayerId: compactText(candidate.duplicatePlayerId),
      duplicatePlayerName: compactText(candidate.duplicatePlayerName),
      errors: Array.isArray(candidate.errors)
        ? candidate.errors.map((error) => compactText(error)).filter(Boolean)
        : [],
      operation: (isPlainObject(candidate.operation)
        ? candidate.operation
        : {
            type: action,
            playerId: compactText(candidate.playerId),
            payload: {},
            errors: Array.isArray(candidate.errors)
              ? candidate.errors.map((error) => compactText(error)).filter(Boolean)
              : []
          }) as unknown as RosterAiImportPreviewRow['operation'],
      rawOperation: isPlainObject(candidate.rawOperation)
        ? candidate.rawOperation
        : undefined
    };
  }).filter(Boolean) as RosterAiImportPreviewRow[];
  return rows.length ? rows : undefined;
}

function normalizeStoredSchedulePreviewRows(value: unknown): ScheduleCsvImportPreviewRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.slice(0, 200).map((candidate, index) => {
    if (!isPlainObject(candidate) || !isPlainObject(candidate.normalized)) return null;
    const normalized = candidate.normalized;
    const eventType = normalized.eventType === 'practice' ? 'practice' : normalized.eventType === 'game' ? 'game' : null;
    if (!eventType) return null;
    return {
      rowNumber: Number(candidate.rowNumber) || index + 1,
      draft: {},
      normalized: {
        rowNumber: Number(normalized.rowNumber) || Number(candidate.rowNumber) || index + 1,
        eventType,
        startsAt: compactText(normalized.startsAt),
        endsAt: normalized.endsAt == null ? null : compactText(normalized.endsAt),
        opponent: normalized.opponent == null ? null : compactText(normalized.opponent),
        title: normalized.title == null ? null : compactText(normalized.title),
        location: normalized.location == null ? null : compactText(normalized.location),
        arrivalTime: normalized.arrivalTime == null ? null : compactText(normalized.arrivalTime),
        isHome: typeof normalized.isHome === 'boolean' ? normalized.isHome : null,
        notes: normalized.notes == null ? null : compactText(normalized.notes)
      },
      errors: Array.isArray(candidate.errors)
        ? candidate.errors.map((error) => compactText(error)).filter(Boolean)
        : []
    };
  }).filter(Boolean) as ScheduleCsvImportPreviewRow[];
  return rows.length ? rows : undefined;
}

function sanitizePrivateAiStorageValue(value: unknown): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (Array.isArray(value)) {
    return value
      .map(sanitizePrivateAiStorageValue)
      .filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return value;
  return Object.entries(value).reduce<Record<string, unknown>>((stored, [key, item]) => {
    const sanitized = sanitizePrivateAiStorageValue(item);
    if (sanitized !== undefined) stored[key] = sanitized;
    return stored;
  }, {});
}

function normalizePrivateAiImportSource(value: unknown): 'csv' | 'ai-text' | 'ai-image' | 'ai-document' {
  if (value === 'csv' || value === 'ai-image' || value === 'ai-document') return value;
  return 'ai-text';
}

function stripPastedRosterCsvFromInstruction(value: string, csvText: string) {
  const source = String(value || '').trim();
  const csvHeader = String(csvText || '').split(/\r?\n/, 1)[0]?.trim();
  if (!source || !csvHeader) return source;

  const lines = source.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === csvHeader);
  if (headerIndex < 0) return source;

  let endIndex = headerIndex + 1;
  let dataRowCount = 0;
  while (endIndex < lines.length) {
    const line = lines[endIndex]!;
    const trimmed = line.trim();
    if (!trimmed) {
      if (dataRowCount > 0) {
        endIndex += 1;
        break;
      }
      endIndex += 1;
      continue;
    }
    if (!line.includes(',')) break;
    dataRowCount += 1;
    endIndex += 1;
  }

  return [
    ...lines.slice(0, headerIndex),
    ...lines.slice(endIndex)
  ].join('\n').trim();
}

async function savePrivateAiMessage(user: AuthUser, input: {
  role: PrivateAiRole;
  text: string;
  conversationId?: string;
  attachment?: PrivateAiAttachmentReceipt;
  toolNames?: string[];
  pendingActionIds?: string[];
  artifacts?: PrivateAiArtifactReference[];
  error?: boolean;
}): Promise<PrivateAiMessage> {
  const createdAt = new Date();
  const conversationId = normalizeConversationId(input.conversationId);
  const payload = {
    role: input.role,
    text: input.text,
    conversationId,
    ...(input.attachment ? { attachment: input.attachment } : {}),
    toolNames: input.toolNames || [],
    pendingActionIds: (input.pendingActionIds || []).map(compactText).filter(Boolean),
    artifacts: (input.artifacts || []).map(stripPrivateAiArtifactForStorage),
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
    attachment: input.attachment,
    toolNames: input.toolNames || [],
    pendingActionIds: (input.pendingActionIds || []).map(compactText).filter(Boolean),
    artifacts: input.artifacts || [],
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
    attachment: normalizePrivateAiAttachmentReceipt(data.attachment),
    toolNames: Array.isArray(data.toolNames) ? data.toolNames.map((name: unknown) => compactText(name)).filter(Boolean) : [],
    pendingActionIds: Array.isArray(data.pendingActionIds)
      ? data.pendingActionIds.map((id: unknown) => compactText(id)).filter(Boolean)
      : [],
    artifacts: Array.isArray(data.artifacts) ? data.artifacts.map(normalizePrivateAiArtifact).filter(Boolean) as PrivateAiArtifactReference[] : [],
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
    `For a parent/guardian roster invitation, call invite_roster_parent with the player name and email even when the team was not stated. The tool searches every managed roster, resolves a unique player automatically, and reports ambiguity when a team choice is genuinely required.\n` +
    `If the user asks to retry a failed parent invitation email, call resend_roster_parent_invite with the player name and email from the recent chat.\n` +
    `If you have enough information, return {"answer":"..."}.\n\n` +
    `AVAILABLE ROLE-AUTHORIZED TOOLS (family/player and coach/admin capabilities are combined):\n` +
    getRoleAuthorizedPrivateAiToolDefinitions(user).map((definition) => (
      `- [${definition.domain || inferPrivateAiToolDomain(definition.name)}] ${definition.name} (${definition.mode}): ${definition.description}`
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

function inferPrivateAiToolDomain(name: string) {
  if (/profile|help|home/.test(name)) return 'account-profile-notifications-discovery';
  if (/roster|team|message/.test(name)) return 'team-roster-communications';
  if (/schedule|rsvp|assignment|ride|practice_packet/.test(name)) return 'schedule-attendance-planning';
  if (/fee|registration|incentive|paid/.test(name)) return 'fees-payments-registration-incentives';
  if (/household|family_share|access_request|player/.test(name)) return 'family-player-household-sharing';
  return 'account-authorized-operations';
}

function getRoleAuthorizedPrivateAiToolDefinitions(user: AuthUser) {
  const roles = new Set((user.roles || []).map((role) => compactText(role).toLowerCase()));
  const hasManagerRole = Boolean(
    user.isAdmin
    || user.isPlatformAdmin
    || user.coachOf?.length
    || ['coach', 'admin', 'administrator', 'platformadmin', 'platform-admin', 'platform_admin', 'team-admin', 'team_admin', 'staff', 'manager'].some((role) => roles.has(role))
  );
  return privateAiToolDefinitions.filter((definition) => definition.audience !== 'manager' || hasManagerRole);
}

function summarizeSignedInUser(user: AuthUser) {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles || [],
    linkedPlayerCount: user.parentPlayerKeys?.length || user.parentOf?.length || 0,
    managedTeamCount: user.coachOf?.length || 0,
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

async function loadAccessibleAiTeams(user: AuthUser) {
  const home = await loadParentHome(user);
  const teamIds = new Set<string>();
  (home.teams || []).forEach((team: any) => {
    const teamId = compactText(team.teamId || team.id);
    if (teamId) teamIds.add(teamId);
  });
  (user.coachOf || []).forEach((teamId) => {
    const normalized = compactText(teamId);
    if (normalized) teamIds.add(normalized);
  });

  const details = await Promise.all(Array.from(teamIds).slice(0, 60).map(async (teamId) => {
    const detail = await loadParentTeamDetail(teamId, user);
    if (!detail?.team) {
      throw new Error(`Could not verify access to team ${teamId}. Try again before making changes.`);
    }
    return {
      teamId,
      teamName: compactText(detail.team.name) || teamId,
      canManageTeam: detail.canManageTeam === true,
      playerCount: (detail.players || []).length + (detail.inactivePlayers || []).length,
      detail
    };
  }));
  return details;
}

async function resolveAccessibleTeamId(
  user: AuthUser,
  args: Record<string, unknown>,
  options: { requireManager?: boolean } = {}
) {
  const teamId = compactText(args.teamId);
  const teamName = compactText(args.teamName).toLowerCase();
  const teams = await loadAccessibleAiTeams(user);
  const eligibleTeams = options.requireManager ? teams.filter((team) => team.canManageTeam) : teams;
  if (teamId && eligibleTeams.some((team) => team.teamId === teamId)) return teamId;
  if (teamId && options.requireManager) {
    const directDetail = await loadParentTeamDetail(teamId, user);
    if (directDetail?.team && directDetail.canManageTeam === true) return teamId;
  }
  if (teamId) return null;
  if (teamName) {
    return eligibleTeams.find((team) => compactText(team.teamName).toLowerCase().includes(teamName))?.teamId || null;
  }
  const requestText = compactText(args.text || args.prompt || args.query).toLowerCase();
  if (requestText) {
    const scoredTeams = eligibleTeams
      .map((team) => ({
        team,
        score: scoreTeamNameMention(requestText, compactText(team.teamName))
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    if (scoredTeams.length && (scoredTeams.length === 1 || scoredTeams[0].score > scoredTeams[1].score)) {
      return scoredTeams[0].team.teamId;
    }
  }
  return eligibleTeams.length === 1 ? eligibleTeams[0].teamId : null;
}

function scoreTeamNameMention(requestText: string, teamName: string): number {
  const normalizedName = compactText(teamName).toLowerCase();
  if (!normalizedName) return 0;
  if (requestText.includes(normalizedName)) return 1000 + normalizedName.length;
  const ignoredTokens = new Set(['team', 'club', 'soccer', 'football', 'baseball', 'basketball']);
  return normalizedName
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !ignoredTokens.has(token))
    .reduce((score, token) => requestText.includes(token) ? score + token.length : score, 0);
}

function isPrivateAiRosterImportRequest(question: string): boolean {
  const rawQuestion = String(question || '').trim();
  if (extractPastedRosterCsv(rawQuestion)) return true;

  const normalized = compactText(rawQuestion).toLowerCase();
  const mentionsRosterData = /\b(roster|players?|athletes?|jersey(?:\s+number)?|family\s+contacts?|parents?|guardians?)\b/.test(normalized);
  const startsWithQuestion = /^(?:can|could|would|should|how|what|who|when|where|why|is|are|do|does|did|will|may)\b/.test(normalized);
  const requestsBulkImport = !startsWithQuestion && /\b(import|bulk)\b/.test(normalized);
  const startsWithRosterMutation = /^(?:(?:for|on)\s+.{1,100},\s*)?(?:please\s+)?(?:add|update|deactivate|reactivate|remove|delete)\b/.test(normalized);
  const preparesRosterMutation = /\b(?:prepare|stage|draft)\b.{0,80}\b(?:add|update|deactivate|reactivate|remove|delete)\b/.test(normalized);
  return mentionsRosterData && (requestsBulkImport || startsWithRosterMutation || preparesRosterMutation);
}

async function resolveManagedRosterPlayer(user: AuthUser, args: Record<string, unknown>) {
  const requestedTeamId = compactText(args.teamId);
  const requestedTeamName = compactText(args.teamName).toLowerCase();
  const requestedPlayerId = compactText(args.playerId || args.childId);
  const requestedPlayerName = compactText(args.playerName || args.childName).toLowerCase();
  if (!requestedPlayerId && !requestedPlayerName) {
    throw new Error('A player name or player ID is required for a parent invitation.');
  }

  let managedTeams: any[] = (await loadAccessibleAiTeams(user))
    .filter((team) => team.canManageTeam);
  if (requestedTeamId && !managedTeams.some((team) => team.teamId === requestedTeamId)) {
    const directDetail = await loadParentTeamDetail(requestedTeamId, user);
    if (directDetail?.team && directDetail.canManageTeam === true) {
      managedTeams.push({
        teamId: requestedTeamId,
        teamName: compactText(directDetail.team.name) || requestedTeamId,
        canManageTeam: true,
        detail: directDetail
      });
    }
  }

  if (requestedTeamId) {
    managedTeams = managedTeams.filter((team) => team.teamId === requestedTeamId);
  } else if (requestedTeamName) {
    const exactTeams = managedTeams.filter((team) => compactText(team.teamName).toLowerCase() === requestedTeamName);
    const matchingTeams = exactTeams.length
      ? exactTeams
      : managedTeams.filter((team) => compactText(team.teamName).toLowerCase().includes(requestedTeamName));
    if (matchingTeams.length > 1) {
      throw new Error(`More than one managed team matches "${compactText(args.teamName)}". Choose one team.`);
    }
    managedTeams = matchingTeams;
  }
  if (!managedTeams.length) {
    throw new Error('No managed team matched that parent invitation.');
  }

  const candidates = managedTeams.flatMap((team) => [
    ...(team.detail.players || []).map((player: any) => ({ team, player, inactive: false })),
    ...(team.detail.inactivePlayers || []).map((player: any) => ({ team, player, inactive: true }))
  ]);
  let matchingPlayers = requestedPlayerId
    ? candidates.filter((candidate) => compactText(candidate.player.id || candidate.player.playerId) === requestedPlayerId)
    : candidates.filter((candidate) => compactText(candidate.player.name || candidate.player.playerName).toLowerCase() === requestedPlayerName);
  if (!matchingPlayers.length && requestedPlayerName) {
    matchingPlayers = candidates.filter((candidate) => (
      compactText(candidate.player.name || candidate.player.playerName).toLowerCase().includes(requestedPlayerName)
    ));
  }
  const activeMatches = matchingPlayers.filter((candidate) => !candidate.inactive);
  if (activeMatches.length) matchingPlayers = activeMatches;

  const uniqueMatches = Array.from(new Map(matchingPlayers.map((candidate) => [
    `${candidate.team.teamId}:${compactText(candidate.player.id || candidate.player.playerId)}`,
    candidate
  ])).values());
  if (!uniqueMatches.length) {
    throw new Error(`No managed roster player matched "${compactText(args.playerName || args.playerId)}".`);
  }
  if (uniqueMatches.length > 1) {
    const teamNames = Array.from(new Set(uniqueMatches.map((candidate) => compactText(candidate.team.teamName) || candidate.team.teamId)));
    throw new Error(
      `Multiple managed roster players match "${compactText(args.playerName || args.playerId)}" (${teamNames.join(', ')}). Tell me which team.`
    );
  }

  const match = uniqueMatches[0]!;
  return {
    teamId: match.team.teamId,
    teamName: compactText(match.team.teamName) || match.team.teamId,
    detail: match.team.detail,
    player: match.player
  };
}

async function resolveAccessiblePlayer(user: AuthUser, args: Record<string, unknown>) {
  const requestedTeamId = compactText(args.teamId);
  const requestedPlayerId = compactText(args.playerId);
  const requestedPlayerName = compactText(args.playerName).toLowerCase();
  const home = await loadParentHome(user);
  const accessibleTeams = await loadAccessibleAiTeams(user);
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
    }))),
    ...accessibleTeams.flatMap((team) => [
      ...(team.detail.players || []),
      ...(team.detail.inactivePlayers || [])
    ].map((player: any) => ({
      teamId: team.teamId,
      playerId: player.id || player.playerId,
      name: player.name || player.playerName,
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

function resolveTeamDetailPlayer(detail: any, args: Record<string, unknown>) {
  const playerId = compactText(args.playerId || args.childId);
  const playerName = compactText(args.playerName || args.childName).toLowerCase();
  const players = [...(detail.players || []), ...(detail.inactivePlayers || [])];
  if (playerId) return players.find((player: any) => compactText(player.id) === playerId) || null;
  if (playerName) return players.find((player: any) => compactText(player.name).toLowerCase().includes(playerName)) || null;
  return players.length === 1 ? players[0] : null;
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

function isPrivateAiCsvFile(file: File) {
  return file.type === 'text/csv'
    || file.type === 'application/csv'
    || file.name.toLowerCase().endsWith('.csv');
}

function getPrivateAiAttachmentKind(file: File): 'csv' | 'image' | 'pdf' {
  if (isPrivateAiCsvFile(file)) return 'csv';
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'pdf';
  return 'image';
}

function buildPrivateAiAttachmentReceipt(file: File): PrivateAiAttachmentReceipt {
  return {
    name: compactText(file.name) || 'Attachment',
    kind: getPrivateAiAttachmentKind(file),
    mimeType: compactText(file.type) || getPrivateAiAttachmentMimeType(file)
  };
}

function normalizePrivateAiAttachmentReceipt(value: unknown): PrivateAiAttachmentReceipt | undefined {
  if (!isPlainObject(value)) return undefined;
  const name = compactText(value.name);
  const kind = ['csv', 'image', 'pdf'].includes(String(value.kind))
    ? value.kind as PrivateAiAttachmentReceipt['kind']
    : null;
  if (!name || !kind) return undefined;
  return {
    name,
    kind,
    mimeType: compactText(value.mimeType)
  };
}

function getPrivateAiAttachmentMimeType(file: File) {
  const kind = getPrivateAiAttachmentKind(file);
  if (kind === 'csv') return 'text/csv';
  if (kind === 'pdf') return 'application/pdf';
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return 'image/png';
}

async function fileToPrivateAiGenerativePart(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return {
    inlineData: {
      data: btoa(binary),
      mimeType: compactText(file.type) || getPrivateAiAttachmentMimeType(file)
    }
  };
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
