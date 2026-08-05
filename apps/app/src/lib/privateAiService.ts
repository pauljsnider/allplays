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
  loadParentScheduleScope,
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
  replanRosterAiImportOperations,
  type RosterAiImportPreviewRow
} from './rosterAiImport';
import {
  appendScheduleImportConflictErrors,
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
import { assertPrivateAiPendingPayloadFitsFirestore } from './privateAiStorageBounds';
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
  revision?: number;
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
  revision?: number;
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

type PrivateAiTeamArtifactDraft =
  | Omit<PrivateAiRosterArtifactReference, 'confirmationId'>
  | Omit<PrivateAiScheduleArtifactReference, 'confirmationId'>;

export type PrivateAiRosterProposalRevision = {
  confirmationId: string;
  expectedRevision?: number;
  teamId: string;
  messageId: string;
  rows: RosterAiImportPreviewRow[];
};

export type PrivateAiScheduleProposalRevision = {
  confirmationId: string;
  expectedRevision?: number;
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
  launchIntent?: Exclude<PrivateAiAttachmentIntent, 'general-analysis'>;
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
const recoverablePrivateAiExecutionTools = new Set([
  'apply_roster_import',
  'apply_schedule_import'
]);

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
  executionLeaseExpiresAt?: string;
  execution?: {
    rosterApplied?: boolean;
  };
  recoveringExecution?: boolean;
  recoveryBlocked?: boolean;
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
  resolve: (user: AuthUser, args: Record<string, unknown>, context?: PrivateAiToolContext) => Promise<unknown>;
};

type PrivateAiToolContext = {
  conversationId?: string;
  confirmationGroupId?: string;
  allowedToolNames?: string[];
  preparedArtifact?: PrivateAiTeamArtifactDraft;
  requestText?: string;
  teamId?: string;
  teamName?: string;
};

type PrivateAiPreparedWrite = {
  definitionName: string;
  args: Record<string, unknown>;
  summary?: string;
  previewSummary?: Record<string, unknown>;
};

type InternalPrivateAiToolContext = PrivateAiToolContext & {
  confirmedWriteToken?: symbol;
  preparedWrite?: PrivateAiPreparedWrite;
};

const pendingActionLifetimeMs = 30 * 60 * 1000;
const pendingActionExecutionLeaseMs = 90 * 1000;

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

  const hydratedMessages = await hydratePrivateAiTeamArtifactPreviews(user, messages);
  return hydratedMessages.reverse();
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
      conversationId: activeConversationId,
      teamId: compactText(requestContext.teamId),
      teamName: compactText(requestContext.teamName)
    });
    const assistantMessage = await savePrivateAiMessage(user, {
      role: 'assistant',
      text: aiResult.answer,
      conversationId: activeConversationId,
      toolNames: aiResult.toolResults.filter((result) => result.ok).map((result) => result.name),
      pendingActionIds: aiResult.toolResults
        .filter((result) => result.ok && result.requiresConfirmation === true)
        .map((result) => compactText(result.confirmationId))
        .filter(Boolean),
      artifacts: collectPrivateAiRetryArtifacts(aiResult.toolResults)
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

function isUneditedPrivateAiScheduleLaunchPrompt(value: unknown) {
  const text = compactText(value).toLowerCase();
  const match = text.match(
    /^manage the (.+?) schedule\. i can add or update games, add one-time or recurring practices, cancel events, send rsvp reminders, or attach a csv, image, or pdf for bulk schedule changes\. use (.+?) unless i explicitly choose another managed team, and show me an editable review before saving or sending anything\.$/
  );
  return Boolean(match && match[1] === match[2]);
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
  const intent = input.launchIntent || await classifyPrivateAiAttachment({
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
    if (
      isPrivateAiScheduleAttachmentMutationRequest(input.text)
      && !(
        input.launchIntent === 'schedule-import'
        && isUneditedPrivateAiScheduleLaunchPrompt(input.text)
      )
    ) {
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
    if (schedule.isPartial === true) {
      throw new Error('The existing schedule could not be loaded completely. Retry before reviewing an import so duplicate games and practices are not missed.');
    }
    const currentEvents = getCurrentScheduleImportEvents(schedule.events || [], teamId);

    if (input.csvText) {
      try {
        const parsed = parseCsvText(input.csvText);
        const mapping = inferScheduleCsvMapping(parsed.headers);
        const deterministic = buildScheduleImportPreview({ rows: parsed.rows, mapping, teamName });
        rows = appendScheduleImportConflictErrors(deterministic.rows, currentEvents);
        previewErrors = deterministic.errors;
      } catch (csvError: any) {
        previewErrors = [csvError?.message || 'Could not parse the schedule CSV.'];
      }
      if (previewErrors.length || !rows.length) {
        const fallback = await generateScheduleAiImportRows({
          teamName,
          text: `${input.text || ''}\n\nSchedule CSV:\n${input.csvText.slice(0, 120_000)}`,
          currentEvents
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
        currentEvents
      });
      rows = preview.rows;
      previewErrors = preview.errors;
    }
    endPreviewTimer();
    const sourceValidationErrors: string[] = [];
    if (rows.length > 200) {
      rows = rows.slice(0, 200);
      const rowLimitError = 'Import at most 200 schedule rows at a time.';
      previewErrors.push(rowLimitError);
      sourceValidationErrors.push(rowLimitError);
    }

    const invalidRows = rows.filter((row) => row.errors.length > 0);
    const summary = summarizeSchedulePreview(rows);
    const validationErrors = [
      ...previewErrors,
      ...invalidRows.flatMap((row) => row.errors)
    ];
    const artifactSummary = {
      ...summary,
      errors: validationErrors.length
    };
    const preparedArtifact: PrivateAiTeamArtifactDraft = {
      type: 'schedule-import',
      revision: 0,
      teamId,
      teamName,
      source,
      summary: artifactSummary,
      previewRows: rows
    };
    let toolResult: PrivateAiToolResult | null = null;
    let assistantText = '';
    if (previewErrors.length || invalidRows.length || !rows.length) {
      assistantText = [
        `I reviewed the ${sourceLabel} for ${teamName}, but it is not ready to confirm.`,
        ...previewErrors,
        ...invalidRows.flatMap((row) => row.errors),
        rows.length ? '' : 'Send corrected instructions or attach a corrected file to prepare a new preview.'
      ].filter(Boolean).join(' ');
      if (rows.length && validationErrors.length) {
        const definition = getPrivateAiToolDefinition('apply_schedule_import');
        if (definition) {
          const pending = await savePrivateAiPendingAction(user, definition, {
            teamId,
            rows: rows.map((row) => row.normalized),
            source,
            __scheduleValidationErrors: validationErrors,
            ...(sourceValidationErrors.length ? { __scheduleSourceValidationErrors: sourceValidationErrors } : {})
          }, {
            conversationId: activeConversationId,
            confirmationGroupId: createConfirmationGroupId(),
            preparedArtifact
          }, {
            summary: `Schedule import | Team: ${teamId} | ${summary.total} rows | ${validationErrors.length} errors`,
            previewSummary: artifactSummary
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
      toolResult = await runPrivateAiTool(user, {
        name: 'apply_schedule_import',
        args: {
          teamId,
          __preparedScheduleRows: rows.map((row) => row.normalized),
          source
        }
      }, {
        conversationId: activeConversationId,
        confirmationGroupId: createConfirmationGroupId(),
        preparedArtifact
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
      revision: toolResult?.confirmationId ? 0 : undefined,
      teamId,
      teamName,
      source,
      summary: artifactSummary,
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
    const artifactSummary = {
      ...summary,
      errors: preview.errors.length + invalidRows.reduce((count, row) => count + row.errors.length, 0)
    };
    const preparedArtifact: PrivateAiTeamArtifactDraft = {
      type: 'roster-import',
      revision: 0,
      teamId,
      teamName,
      source: preview.source,
      summary: artifactSummary,
      previewRows: preview.rows
    };
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
            confirmationGroupId: createConfirmationGroupId(),
            preparedArtifact
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
        confirmationGroupId: createConfirmationGroupId(),
        preparedArtifact
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
      const confirmationInstruction = summary.invitations
        ? 'Reply yes to import these players and email these contacts.'
        : 'Reply yes to apply these roster changes.';
      assistantText = `I prepared ${summary.total} roster operation${summary.total === 1 ? '' : 's'} for ${teamName}: ${summary.add} add, ${summary.update} update, ${summary.deactivate} deactivate, ${summary.reactivate} reactivate, and ${summary.invitations} family invitation${summary.invitations === 1 ? '' : 's'}. ${confirmationInstruction}`;
    }

    const artifact: PrivateAiArtifactReference = {
      type: 'roster-import',
      confirmationId: toolResult?.confirmationId || '',
      revision: toolResult?.confirmationId ? 0 : undefined,
      teamId,
      teamName,
      source: preview.source,
      summary: artifactSummary,
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
  const expectedRevision = Math.max(0, Number(revision.expectedRevision) || 0);
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
  const currentContext = await loadRosterImportContextForApp(teamId, user, { fresh: true });
  const revisedOperations = attachRosterImportPreconditions(
    assertRosterImportIdentityUnchanged(
      plan.operations,
      replanRosterAiImportOperations(plan.operations, currentContext.players, currentContext.fields)
    ),
    currentContext.players
  );
  const rosterSummary = summarizeRosterPreview(rows);
  const artifactSummary = {
    ...rosterSummary,
    errors: validationErrors.length
  };
  const nextArgs = {
    teamId,
    operations: revisedOperations,
    ...(validationErrors.length ? { __rosterValidationErrors: validationErrors } : {})
  };
  const nextArtifact = stripPrivateAiArtifactForTeamStorage({
    type: 'roster-import',
    confirmationId,
    revision: expectedRevision + 1,
    teamId,
    teamName: 'Team',
    source: 'ai-text',
    summary: artifactSummary,
    previewRows: rows
  });
  assertPrivateAiPendingPayloadFitsFirestore('roster', nextArgs, nextArtifact);
  const nextSummary = `Roster import | Team: ${teamId} | ${rosterSummary.total} operations | ${rosterSummary.invitations} invitations${validationErrors.length ? ` | ${validationErrors.length} errors` : ''}`;
  const pendingRef = doc(db, 'users', user.uid, privateAiPendingActionCollectionName, confirmationId);
  const teamPayloadRef = doc(db, 'teams', teamId, teamPrivateAiPendingActionCollectionName, confirmationId);
  const messageRef = doc(db, 'users', user.uid, privateAiCollectionName, messageId);

  const updated = await runTransaction(db, async (transaction: any) => {
    const [snapshot, teamPayloadSnapshot, messageSnapshot] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(teamPayloadRef),
      transaction.get(messageRef)
    ]);
    const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
    const teamPayload = typeof teamPayloadSnapshot?.data === 'function'
      ? teamPayloadSnapshot.data()
      : null;
    if (
      !snapshot?.exists?.()
      || !isPlainObject(data)
      || data.status !== 'pending'
      || compactText(data.userId) !== user.uid
      || compactText(data.toolName) !== 'apply_roster_import'
      || compactText(data.teamId || (isPlainObject(data.args) ? data.args.teamId : '')) !== teamId
      || Date.parse(compactText(data.expiresAt)) <= Date.now()
    ) return false;
    if (
      !teamPayloadSnapshot?.exists?.()
      || !isPlainObject(teamPayload)
      || teamPayload.status !== 'pending'
      || compactText(teamPayload.userId) !== user.uid
      || compactText(teamPayload.toolName) !== 'apply_roster_import'
      || compactText(teamPayload.teamId) !== teamId
      || Number(teamPayload.revision || 0) !== expectedRevision
      || (compactText(teamPayload.expiresAt) && Date.parse(compactText(teamPayload.expiresAt)) <= Date.now())
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
    const storedNextArtifact = {
      ...nextArtifact,
      teamName: compactText(matchingArtifact.teamName) || 'Team',
      source: normalizePrivateAiImportSource(matchingArtifact.source)
    };
    assertPrivateAiPendingPayloadFitsFirestore('roster', nextArgs, storedNextArtifact);
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
      teamId,
      toolName: 'apply_roster_import',
      revision: expectedRevision + 1,
      args: nextArgs,
      artifact: storedNextArtifact,
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
          revision: expectedRevision + 1,
          teamId,
          teamName: compactText(artifact.teamName) || 'Team',
          source: normalizePrivateAiImportSource(artifact.source),
          summary: artifactSummary
        });
      })
    }, { merge: true });
    return true;
  });
  if (!updated) {
    throw new Error('This roster proposal changed elsewhere, expired, was replaced, or is currently being confirmed. Reload the chat before editing again.');
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
  const expectedRevision = Math.max(0, Number(revision.expectedRevision) || 0);
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
  const normalizedRows = inputRows.map((row, index) => normalizeScheduleImportDraft({
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
  const schedule = await loadParentSchedule(user, { includePastGames: true });
  if (schedule.isPartial === true) {
    throw new Error('The existing schedule could not be loaded completely. Retry before editing this import so duplicate games and practices are not missed.');
  }
  const rows = appendScheduleImportConflictErrors(
    normalizedRows,
    getCurrentScheduleImportEvents(schedule.events || [], teamId)
  );
  const sourceValidationErrors = Array.isArray(pending.args.__scheduleSourceValidationErrors)
    ? pending.args.__scheduleSourceValidationErrors.map(compactText).filter(Boolean)
    : [];
  const validationErrors = [
    ...sourceValidationErrors,
    ...rows.flatMap((row) => row.errors || [])
  ];
  const counts = summarizeSchedulePreview(rows);
  const summary = {
    ...counts,
    errors: validationErrors.length
  };
  const nextArgs = {
    teamId,
    rows: rows.map((row) => row.normalized),
    source: compactText(pending.args.source) || 'ai',
    ...(validationErrors.length ? { __scheduleValidationErrors: validationErrors } : {}),
    ...(sourceValidationErrors.length ? { __scheduleSourceValidationErrors: sourceValidationErrors } : {})
  };
  const nextArtifact = stripPrivateAiArtifactForTeamStorage({
    type: 'schedule-import',
    confirmationId,
    revision: expectedRevision + 1,
    teamId,
    teamName: 'Team',
    source: normalizePrivateAiImportSource(pending.args.source),
    summary,
    previewRows: rows
  });
  assertPrivateAiPendingPayloadFitsFirestore('schedule', nextArgs, nextArtifact);
  const pendingRef = doc(db, 'users', user.uid, privateAiPendingActionCollectionName, confirmationId);
  const teamPayloadRef = doc(db, 'teams', teamId, teamPrivateAiPendingActionCollectionName, confirmationId);
  const messageRef = messageId
    ? doc(db, 'users', user.uid, privateAiCollectionName, messageId)
    : null;
  const updated = await runTransaction(db, async (transaction: any) => {
    const [snapshot, teamPayloadSnapshot, messageSnapshot] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(teamPayloadRef),
      messageRef ? transaction.get(messageRef) : Promise.resolve(null)
    ]);
    const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
    const teamPayload = typeof teamPayloadSnapshot?.data === 'function'
      ? teamPayloadSnapshot.data()
      : null;
    if (
      !snapshot?.exists?.()
      || !isPlainObject(data)
      || data.status !== 'pending'
      || compactText(data.userId) !== user.uid
      || compactText(data.toolName) !== 'apply_schedule_import'
      || compactText(data.teamId || (isPlainObject(data.args) ? data.args.teamId : '')) !== teamId
      || Date.parse(compactText(data.expiresAt)) <= Date.now()
    ) return false;
    if (
      !teamPayloadSnapshot?.exists?.()
      || !isPlainObject(teamPayload)
      || teamPayload.status !== 'pending'
      || compactText(teamPayload.userId) !== user.uid
      || compactText(teamPayload.toolName) !== 'apply_schedule_import'
      || compactText(teamPayload.teamId) !== teamId
      || Number(teamPayload.revision || 0) !== expectedRevision
      || (compactText(teamPayload.expiresAt) && Date.parse(compactText(teamPayload.expiresAt)) <= Date.now())
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
    const storedNextArtifact = {
      ...nextArtifact,
      teamName: compactText(storedArtifacts.find((artifact) => (
        isPlainObject(artifact)
        && artifact.type === 'schedule-import'
        && compactText(artifact.confirmationId) === confirmationId
      ))?.teamName) || 'Team'
    };
    assertPrivateAiPendingPayloadFitsFirestore('schedule', nextArgs, storedNextArtifact);
    transaction.set(pendingRef, {
      args: sanitizePendingActionArgsForUserStorage('apply_schedule_import', nextArgs),
      summary: `Schedule import | Team: ${teamId} | ${summary.total} rows${validationErrors.length ? ` | ${validationErrors.length} errors` : ''}`,
      previewSummary: summary,
      editedAt: serverTimestamp(),
      audit: {
        lastEditedBy: user.uid,
        lastEditedAt: new Date().toISOString()
      }
    }, { merge: true });
    transaction.set(teamPayloadRef, {
      userId: user.uid,
      teamId,
      toolName: 'apply_schedule_import',
      revision: expectedRevision + 1,
      args: nextArgs,
      artifact: storedNextArtifact,
      status: 'pending',
      editedAt: serverTimestamp(),
      expiresAt: pending.expiresAt,
      expiresAtAt: new Date(pending.expiresAt)
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
            revision: expectedRevision + 1,
            teamId,
            teamName: compactText(artifact.teamName) || 'Team',
            source: normalizePrivateAiImportSource(artifact.source),
            summary
          });
        })
      }, { merge: true });
    }
    return true;
  });
  if (!updated) {
    throw new Error('This schedule proposal changed elsewhere, expired, was replaced, or is currently being confirmed. Reload the chat before editing again.');
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
    const confirmationResults: PrivateAiToolResult[] = [];
    for (const id of confirmedActionIds) {
      confirmationResults.push(await executeConfirmedPrivateAiAction(user, id));
    }
    const successfulResults = confirmationResults.filter((result) => result.ok);
    const failedResults = confirmationResults.filter((result) => !result.ok);
    const partialFailure = successfulResults.length > 0 && failedResults.length > 0;
    return {
      answer: partialFailure
        ? `Partially completed this confirmation group. Completed: ${summarizeExecutedActions(successfulResults)} Failed: ${failedResults.map((result) => result.error || `${result.name} failed.`).join(' ')} Successful actions are already saved; do not retry the entire group. Prepare only the failed changes again.`
        : failedResults.length
          ? `I could not complete that confirmed action: ${failedResults.map((result) => result.error || 'Action failed.').join(' ')}`
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
  const roleCapabilities = await loadPrivateAiRoleCapabilities(user);
  const history = summarizeChatHistory(priorMessages);
  const toolResults: PrivateAiToolResult[] = [];
  const plannerToolCallKeys = new Set<string>();
  const confirmationGroupId = createConfirmationGroupId();
  const toolContext = {
    ...context,
    confirmationGroupId,
    requestText: question
  };
  const imperativeWriteRequest = looksLikeImperativePrivateAiWriteRequest(question);
  if (looksLikeFunctionalHelpQuestion(question) && !looksLikeImperativePrivateAiWriteRequest(question)) {
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
  if (looksLikeNextGameQuestion(question)) {
    toolResults.push(await runPrivateAiTool(user, {
      name: 'list_schedule',
      args: { range: 'upcoming', type: 'game', limit: 3 }
    }, toolContext));
    const groundedAnswer = buildGroundedNextGameAnswer(toolResults[toolResults.length - 1]);
    if (groundedAnswer && !imperativeWriteRequest) {
      return { answer: groundedAnswer, toolResults };
    }
  }
  let plannerInput = buildPlannerPrompt({ user, question, history, toolResults, roleCapabilities });

  for (let round = 0; round < maxToolRounds; round += 1) {
    const plannerText = await generateModelText(model, plannerInput);
    const planner = parsePrivateAiPlannerResponse(plannerText);

    if (planner.answer && !planner.toolCalls.length) {
      if (imperativeWriteRequest && !hasPrivateAiWriteToolResult(question, toolResults)) {
        plannerInput = `${buildPlannerPrompt({ user, question, history, toolResults, roleCapabilities })}\n` +
          `CORRECTION: Your prior response claimed or described a change without calling a write tool. ` +
          `Do not say a change is prepared, reviewed, staged, confirmed, or completed unless the matching write tool returned that result. ` +
          `Return toolCalls now for this imperative request.\n`;
        continue;
      }
      return {
        answer: clampAnswer(planner.answer),
        toolResults
      };
    }

    const requestedCalls = planner.toolCalls.slice(0, maxToolCallsPerRound);
    const allowedToolNames = context.allowedToolNames?.length
      ? new Set(context.allowedToolNames.map(compactText).filter(Boolean))
      : null;
    const allowedCalls = allowedToolNames
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
    if (!allowedCalls.length) {
      if (blockedCalls.length) {
        plannerInput = buildPlannerPrompt({ user, question, history, toolResults, roleCapabilities });
        continue;
      }
      if (imperativeWriteRequest && !hasPrivateAiWriteToolResult(question, toolResults)) {
        plannerInput = `${buildPlannerPrompt({ user, question, history, toolResults, roleCapabilities })}\n` +
          `CORRECTION: This is an imperative write request. Return the matching write toolCall; do not claim that a preview exists without one.\n`;
        continue;
      }
      return {
        answer: clampAnswer(plannerText || 'I need a little more information to answer that.'),
        toolResults
      };
    }

    const unrelatedWriteCalls = imperativeWriteRequest
      ? allowedCalls.filter((call) => (
          getPrivateAiToolDefinition(call.name)?.mode === 'write'
          && !privateAiWriteToolMatchesQuestion(question, call.name)
        ))
      : [];
    unrelatedWriteCalls.forEach((call) => toolResults.push({
      name: compactText(call.name),
      ok: false,
      error: getExpectedPrivateAiWriteToolNames(question) === null
        ? 'The requested write operation could not be classified safely.'
        : 'That write tool does not match the requested operation.'
    }));
    const executableCalls = unrelatedWriteCalls.length
      ? allowedCalls.filter((call) => !unrelatedWriteCalls.includes(call))
      : allowedCalls;
    if (!executableCalls.length) {
      plannerInput = buildPlannerPrompt({ user, question, history, toolResults, roleCapabilities });
      continue;
    }
    const roundResults: PrivateAiToolResult[] = [];
    let duplicateCallCount = 0;
    for (const call of executableCalls) {
      const definition = getPrivateAiToolDefinition(call.name);
      if (definition?.mode === 'write') {
        try {
          const preparedWrite = await preparePrivateAiWrite(user, call);
          const key = getPrivateAiPreparedWriteKey(preparedWrite);
          if (plannerToolCallKeys.has(key)) {
            duplicateCallCount += 1;
            continue;
          }
          plannerToolCallKeys.add(key);
          roundResults.push(await runPrivateAiToolInternal(user, call, {
            ...toolContext,
            preparedWrite
          }));
        } catch (error: any) {
          roundResults.push({
            name: compactText(call.name),
            ok: false,
            error: error?.message || 'Tool failed.'
          });
        }
        continue;
      }
      const key = getPrivateAiPlannerToolCallKey(call);
      if (plannerToolCallKeys.has(key)) {
        duplicateCallCount += 1;
        continue;
      }
      plannerToolCallKeys.add(key);
      roundResults.push(await runPrivateAiTool(user, call, toolContext));
    }
    toolResults.push(...roundResults);
    if (!roundResults.length && duplicateCallCount) break;
    plannerInput = buildPlannerPrompt({ user, question, history, toolResults, roleCapabilities });
  }

  if (imperativeWriteRequest && !hasPrivateAiWriteToolResult(question, toolResults)) {
    return {
      answer: 'I could not prepare that change because no reviewed action was staged. Please try the request again.',
      toolResults
    };
  }

  const finalPrompt = buildFinalAnswerPrompt({ user, question, history, toolResults, roleCapabilities });
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
      const prepared = context.preparedWrite;
      if (prepared && prepared.definitionName !== definition.name) {
        throw new Error('Prepared AI action does not match the requested write tool.');
      }
      const preparedAction = prepared
        ? {
            args: prepared.args,
            summary: prepared.summary,
            previewSummary: prepared.previewSummary
          }
        : definition.prepare
          ? await definition.prepare(user, args)
          : { args };
      const pending = await savePrivateAiPendingAction(user, definition, preparedAction.args, context, preparedAction);
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
    const data = await definition.resolve(user, args, context);
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
      const [home, access] = await Promise.all([
        loadParentHome(user),
        loadAccessibleAiTeams(user)
      ]);
      return {
        ...summarizeHome(home),
        managedTeams: access.teams.filter((team) => team.canManageTeam).map((team) => ({
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
    description: 'Schedule events with RSVP, rideshare, assignments, score, location, and player context. Args: range, type, teamId, teamName, playerName, limit. Include the requested team/player and game/practice scope; results report whether the matching set is complete.',
    aliases: ['get_schedule'],
    resolve: async (user, args, context) => {
      const range = compactText(args.range).toLowerCase();
      const targetScope = await resolvePrivateAiScheduleTargetScope(user, args, context);
      const schedule = await loadParentSchedule(user, {
        includePastGames: range === 'all',
        ...(targetScope.teamId ? { targetTeamId: targetScope.teamId } : {})
      });
      return summarizeSchedule(schedule, inferPrivateAiScheduleArgs(schedule, {
        ...args,
        ...(targetScope.teamId ? { teamId: targetScope.teamId } : {}),
        ...(targetScope.playerId ? { playerId: targetScope.playerId } : {})
      }, context?.requestText));
    }
  },
  {
    name: 'get_last_game',
    mode: 'read',
    description: 'Most recent past game for the parent account, including RSVP status. Args: teamId, teamName, playerId, childId, playerName, childName.',
    aliases: ['last_game', 'get_previous_game'],
    resolve: async (user, args, context) => {
      const targetScope = await resolvePrivateAiScheduleTargetScope(user, args, context);
      const schedule = await loadParentSchedule(user, {
        includePastGames: true,
        ...(targetScope.teamId ? { targetTeamId: targetScope.teamId } : {})
      });
      return summarizeLastGame(schedule, inferPrivateAiScheduleArgs(schedule, {
        ...args,
        ...(targetScope.teamId ? { teamId: targetScope.teamId } : {}),
        ...(targetScope.playerId ? { playerId: targetScope.playerId } : {})
      }, context?.requestText));
    }
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
    description: 'RSVP status and summaries for schedule events. Args: range, type, teamId, teamName, playerId, playerName, limit.',
    resolve: async (user, args, context) => {
      const targetScope = await resolvePrivateAiScheduleTargetScope(user, args, context);
      const schedule = await loadParentSchedule(user, {
        includePastGames: compactText(args.range).toLowerCase() === 'all',
        ...(targetScope.teamId ? { targetTeamId: targetScope.teamId } : {})
      });
      const summary = summarizeSchedule(schedule, inferPrivateAiScheduleArgs(schedule, {
        ...args,
        ...(targetScope.teamId ? { teamId: targetScope.teamId } : {}),
        ...(targetScope.playerId ? { playerId: targetScope.playerId } : {})
      }, context?.requestText));
      return {
        ...pickFields(summary, ['query', 'totalMatchingEvents', 'returnedEventCount', 'hasMoreEvents', 'resultComplete', 'absenceConfirmed']),
        events: summary.events.map((event: any) => pickFields(event, [
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
      const access = await loadAccessibleAiTeams(user);
      return {
        teams: access.teams
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
    description: 'Prepare a grouped roster import for a managed team. Supports name-only player adds plus update, deactivate/reactivate, all roster fields, address, and optional family contacts. Supplied family-contact emails create invitations; player adds do not require contact details. Args: teamId/teamName and operations.',
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
      operations = attachRosterImportPreconditions(operations, context.players);
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
      const pendingActionId = compactText(args.__pendingActionId);
      const rosterAlreadyApplied = args.__rosterAlreadyApplied === true;
      const executionOperations = rosterAlreadyApplied
        ? operations
        : await revalidateRosterImportOperationsForConfirmation(teamId, user, operations);
      return applyRosterImportPlanForApp(teamId, user, executionOperations, {
        pendingActionId,
        rosterAlreadyApplied
      });
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
      const pendingActionId = compactText(args.__pendingActionId);
      if (!pendingActionId) throw new Error('This schedule proposal is missing its durable action identifier. Prepare it again.');
      const schedule = await loadParentSchedule(user, { includePastGames: true });
      if (schedule.isPartial === true) {
        throw new Error('The existing schedule could not be loaded completely. Retry before confirming so duplicate games and practices are not missed.');
      }
      const conflicts = appendScheduleImportConflictErrors(
        rows.map((row, index) => ({
          rowNumber: Number(row.rowNumber) || index + 1,
          draft: {},
          normalized: row,
          errors: []
        })),
        getCurrentScheduleImportEvents(schedule.events || [], teamId)
          .filter((event) => !compactText(event.id).startsWith(`${pendingActionId}_event_`))
      ).flatMap((row) => row.errors || []);
      if (conflicts.length) {
        throw new Error(`The schedule changed after this preview. Review it again before importing. ${conflicts.join(' ')}`);
      }
      const batchId = `ai-schedule-import-${pendingActionId}`;
      const importedAt = new Date().toISOString();
      const createdIds: string[] = [];
      const failures: Array<{ rowNumber: number; error: string }> = [];
      const retryRows: ScheduleCsvImportPreviewRow['normalized'][] = [];
      for (const [index, row] of rows.entries()) {
        const normalizedRow = {
          ...row,
          importBatch: {
            batchId,
            totalCount: rows.length,
            rowNumber: row.rowNumber || index + 1,
            importedAt,
            importedBy: user.uid,
            actionId: pendingActionId
          }
        };
        try {
          const createdId = row.eventType === 'practice'
            ? await createScheduleImportPractice(teamId, normalizedRow, user)
            : await createScheduleImportGame(teamId, normalizedRow, user);
          if (createdId) createdIds.push(createdId);
        } catch (error: any) {
          retryRows.push(row);
          failures.push({
            rowNumber: row.rowNumber || index + 1,
            error: error?.message || 'Schedule row import failed.'
          });
        }
      }
      if (rows.length > 3 && createdIds.length) {
        await finalizeScheduleImportBatch(teamId, batchId, createdIds.length, user).catch(() => {});
      }
      return {
        teamId,
        importedCount: createdIds.length,
        failedCount: failures.length,
        failures,
        retryRows
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
    prepare: (user, args) => prepareScheduleEventAction(user, args, 'Update RSVP', { requireChildUnique: true }),
    resolve: async (user, args) => {
      const event = await resolveAccessibleScheduleEvent(user, args, { requireChildUnique: true });
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
    prepare: (user, args) => prepareScheduleEventAction(user, args, 'Update RSVPs for linked children'),
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
    prepare: (user, args) => prepareScheduleEventAction(user, args, 'Claim schedule assignment'),
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
    prepare: (user, args) => prepareScheduleEventAction(user, args, 'Release schedule assignment'),
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
    prepare: preparePracticePacketCompletionAction,
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
    prepare: (user, args) => prepareScheduleEventAction(user, args, 'Create ride offer'),
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
    prepare: (user, args) => prepareRideOfferAction(user, args, 'Request ride spot', { requireChildUnique: true }),
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
    prepare: (user, args) => prepareRideOfferAction(user, args, 'Cancel ride request'),
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
    prepare: (user, args) => prepareRideOfferAction(user, args, 'Update ride offer status'),
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
    prepare: (user, args) => prepareAccessibleTeamAction(user, args, 'Send team chat message'),
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
    prepare: async (user, args) => {
      const [teamId, playerId] = compactText(args.playerKey).split('::');
      const prepared = await prepareAccessiblePlayerAction(user, {
        ...args,
        teamId: compactText(args.teamId) || teamId,
        playerId: compactText(args.playerId) || playerId
      }, `Invite household contact ${compactText(args.email)}`);
      return {
        ...prepared,
        args: {
          ...prepared.args,
          playerKey: `${compactText(prepared.args.teamId)}::${compactText(prepared.args.playerId)}`
        }
      };
    },
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
    prepare: (user, args) => prepareAccessiblePlayerAction(user, args, 'Update player profile'),
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
    prepare: (user, args) => prepareAccessiblePlayerAction(user, args, 'Save player incentive rule'),
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
    prepare: (user, args) => prepareAccessiblePlayerAction(user, args, 'Update player incentive rule'),
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
    prepare: (user, args) => prepareAccessiblePlayerAction(user, args, 'Retire player incentive rule'),
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
    prepare: (user, args) => prepareAccessiblePlayerAction(user, args, 'Update player incentive cap'),
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
    prepare: (user, args) => prepareAccessiblePlayerAction(user, args, 'Mark player incentive paid'),
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
      prepare: (user, args) => prepareManagedTeamPlayerAction(user, args, 'Update player tracking status'),
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
      description: 'Create a managed-team game or practice. Args: teamId/teamName, eventType game|practice, and input with startDate as an ISO 8601 date-time including the requested time and UTC offset, location, opponent/title, notifications, recurrence, and tracker config. If date, time, and timeZone are supplied separately, they are combined without dropping the time.',
      prepare: (user, args) => prepareManagedScheduleEventCreateAction(user, args, 'Create schedule event'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const service = await import('./scheduleService');
        const input = normalizePrivateAiScheduleEventInput(args) as any;
        return compactText(args.eventType || args.type).toLowerCase() === 'practice'
          ? service.createScheduledPracticeForApp(teamId, input, user)
          : service.createScheduledGameForApp(teamId, input, user);
      }
    },
    {
      name: 'update_schedule_event',
      mode: 'write',
      domain: 'schedule-attendance-planning',
      description: 'Update a managed-team game or practice. Args: teamId, eventId, eventType, partial input fields to change, and practice scope occurrence|series.',
      prepare: (user, args) => prepareManagedScheduleEventUpdateAction(user, args, 'Update schedule event'),
      resolve: async (user, args) => {
        const teamId = await requireManagedTeamId(user, args);
        const service = await import('./scheduleService');
        const input = normalizePrivateAiScheduleEventInput(args) as any;
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
      prepare: (user, args) => prepareManagedScheduleEventAction(user, args, 'Cancel schedule event'),
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
      prepare: (user, args) => prepareManagedScheduleEventAction(user, args, 'Send RSVP reminder'),
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
      prepare: (user, args) => prepareManagedScheduleEventAction(user, args, 'Manage schedule assignment'),
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
      prepare: (user, args) => prepareManagedScheduleEventAction(user, args, 'Save practice attendance', { eventType: 'practice' }),
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
      prepare: (user, args) => prepareManagedScheduleEventAction(user, args, 'Save practice packet', { eventType: 'practice' }),
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
      prepare: (user, args) => prepareManagedScheduleEventAction(user, args, 'Update game score', { eventType: 'game' }),
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
      prepare: (user, args) => prepareManagedScheduleEventAction(user, args, 'Complete game wrap-up', { eventType: 'game' }),
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

async function prepareAccessibleTeamAction(user: AuthUser, args: Record<string, unknown>, label: string) {
  const teamId = await resolveAccessibleTeamId(user, args);
  if (!teamId) throw new Error('No accessible team matched that request.');
  const detail = await loadParentTeamDetail(teamId, user);
  const teamName = compactText(detail.team?.name) || teamId;
  return {
    args: {
      ...args,
      teamId
    },
    summary: `${label} | Team: ${teamName}`,
    previewSummary: {
      domain: 'team-communications',
      teamId,
      teamName,
      action: label
    }
  };
}

async function prepareAccessiblePlayerAction(user: AuthUser, args: Record<string, unknown>, label: string) {
  const player = await resolveAccessiblePlayer(user, args);
  if (!player) throw new Error('No matching player was found for this account.');
  return {
    args: {
      ...args,
      teamId: player.teamId,
      playerId: player.playerId
    },
    summary: `${label} | Player: ${player.name || player.playerId} | Team: ${player.teamName || player.teamId}`,
    previewSummary: {
      domain: 'family-player',
      teamId: player.teamId,
      teamName: player.teamName || player.teamId,
      playerId: player.playerId,
      playerName: player.name || player.playerId,
      action: label
    }
  };
}

async function prepareScheduleEventAction(
  user: AuthUser,
  args: Record<string, unknown>,
  label: string,
  options: { requireChildUnique?: boolean; eventType?: 'game' | 'practice' } = {}
) {
  const event = await resolveAccessibleScheduleEvent(user, {
    ...args,
    ...(options.eventType ? { eventType: options.eventType } : {})
  }, {
    requireChildUnique: options.requireChildUnique === true
  });
  if (!event) throw new Error('No matching schedule event was found for this account.');
  const eventSummary = summarizeScheduleEvent(event);
  return {
    args: {
      ...args,
      teamId: event.teamId,
      eventId: event.id,
      eventType: event.type,
      childId: event.childId || ''
    },
    summary: `${label} | ${event.teamName}: ${getScheduleTitle(event)}${event.childName ? ` | Player: ${event.childName}` : ''}`,
    previewSummary: {
      domain: 'schedule',
      action: label,
      event: eventSummary
    }
  };
}

async function prepareManagedScheduleEventAction(
  user: AuthUser,
  args: Record<string, unknown>,
  label: string,
  options: { eventType?: 'game' | 'practice' } = {}
) {
  const teamId = await requireManagedTeamId(user, args);
  const prepared = await prepareScheduleEventAction(user, {
    ...args,
    teamId
  }, label, options);
  return {
    ...prepared,
    previewSummary: {
      ...prepared.previewSummary,
      domain: 'team-management'
    }
  };
}

async function prepareManagedScheduleEventCreateAction(
  user: AuthUser,
  args: Record<string, unknown>,
  label: string
) {
  const teamId = await requireManagedTeamId(user, args);
  const sourceInput = isPlainObject(args.input) ? args.input : args;
  const input = normalizePrivateAiScheduleEventInput(args);
  const eventType = compactText(args.eventType || args.type).toLowerCase() === 'practice'
    ? 'practice'
    : 'game';
  const teamName = compactText(args.teamName) || teamId;
  const title = eventType === 'practice'
    ? compactText(input.title) || 'Practice'
    : compactText(input.opponent)
      ? `vs ${compactText(input.opponent)}`
      : 'Game';
  return {
    args: {
      teamId,
      eventType,
      input
    },
    summary: `${label} | ${teamName}: ${title}`,
    previewSummary: {
      domain: 'team-management',
      action: label,
      teamId,
      teamName,
      eventType,
      title,
      startDate: compactText(input.startDate),
      endDate: compactText(input.endDate),
      timeZone: compactText(sourceInput.timeZone || sourceInput.timezone),
      location: compactText(input.location),
      opponent: compactText(input.opponent)
    }
  };
}

function mergePrivateAiScheduleEventUpdateInput(
  event: ParentScheduleEvent,
  requestedInput: Record<string, unknown>
) {
  const requested = { ...requestedInput };
  const rawRequestedDate = requested.startDate ?? requested.startsAt ?? requested.date;
  const requestedDateText = compactText(rawRequestedDate);
  const requestedDatePart = requestedDateText.match(/^(\d{4}-\d{2}-\d{2})$/)?.[1] || '';
  const requestedTime = requested.time ?? requested.startTime;
  const timeZone = compactText(requested.timeZone ?? requested.timezone);
  const existingParts = getPrivateAiScheduleDateTimeParts(event.date, timeZone);
  if (requestedDatePart && !compactText(requestedTime)) {
    requested.startDate = formatPrivateAiLocalDateTime(
      requestedDatePart,
      `${existingParts.hour}:${existingParts.minute}:${existingParts.second}`,
      timeZone || 'UTC'
    );
  } else if (rawRequestedDate === undefined && compactText(requestedTime)) {
    requested.startDate = formatPrivateAiLocalDateTime(
      existingParts.date,
      requestedTime,
      timeZone || 'UTC'
    );
    delete requested.time;
    delete requested.startTime;
  }
  const input = normalizePrivateAiScheduleEventInput({ input: requested });
  const preserve = (key: string, value: unknown) => {
    if (!hasOwn(input, key)) input[key] = value;
  };
  const requestedStartDate = hasOwn(input, 'startDate')
    ? normalizeScheduleDate(input.startDate)
    : null;
  const shiftFromOriginalStart = (value: Date | null | undefined) => (
    requestedStartDate && value
      ? new Date(requestedStartDate.getTime() + (value.getTime() - event.date.getTime())).toISOString()
      : value?.toISOString() || ''
  );
  preserve('startDate', event.date.toISOString());
  preserve('endDate', shiftFromOriginalStart(event.endDate));
  preserve('location', event.location || '');
  preserve('arrivalTime', shiftFromOriginalStart(event.arrivalTime));
  preserve('notes', event.notes || '');
  if (event.type === 'practice') {
    preserve('title', event.title || 'Practice');
  } else {
    preserve('opponent', event.opponent || '');
    preserve('isHome', event.isHome ?? null);
    preserve('competitionType', event.competitionType || 'league');
    preserve('countsTowardSeasonRecord', event.countsTowardSeasonRecord !== false);
    preserve('statTrackerConfigId', event.statTrackerConfigId || '');
    preserve('opponentTeamId', event.opponentTeamId || '');
    preserve('opponentTeamName', event.opponentTeamName || '');
    preserve('opponentTeamPhoto', event.opponentTeamPhoto || '');
  }
  return input;
}

function getPrivateAiScheduleDateTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function applyPrivateAiScheduleEventUpdateInput(
  event: ParentScheduleEvent,
  input: Record<string, unknown>
): ParentScheduleEvent {
  return {
    ...event,
    date: normalizeScheduleDate(input.startDate) || event.date,
    endDate: normalizeScheduleDate(input.endDate),
    arrivalTime: normalizeScheduleDate(input.arrivalTime),
    location: compactText(input.location),
    notes: compactText(input.notes),
    ...(event.type === 'practice'
      ? { title: compactText(input.title) || 'Practice' }
      : {
          opponent: compactText(input.opponent),
          isHome: typeof input.isHome === 'boolean' ? input.isHome : event.isHome,
          competitionType: compactText(input.competitionType) || event.competitionType
        })
  };
}

async function prepareManagedScheduleEventUpdateAction(
  user: AuthUser,
  args: Record<string, unknown>,
  label: string
) {
  const teamId = await requireManagedTeamId(user, args);
  const event = await resolveAccessibleScheduleEvent(user, {
    ...args,
    teamId
  });
  if (!event) throw new Error('No matching schedule event was found for this account.');
  // Keep the tool's existing argument contract: planners may place editable
  // event fields either inside `input` or directly alongside the selectors.
  const requestedInput = isPlainObject(args.input) ? args.input : args;
  const input = mergePrivateAiScheduleEventUpdateInput(event, requestedInput);
  const proposedEvent = applyPrivateAiScheduleEventUpdateInput(event, input);
  const eventSummary = summarizeScheduleEvent(proposedEvent);
  return {
    args: {
      teamId: event.teamId,
      eventId: event.id,
      eventType: event.type,
      childId: event.childId || '',
      input,
      ...(event.type === 'practice'
        ? {
            scope: compactText(args.scope) === 'occurrence' ? 'occurrence' : 'series',
            instanceDate: compactText(args.instanceDate)
          }
        : {})
    },
    summary: `${label} | ${event.teamName}: ${getScheduleTitle(proposedEvent)}${event.childName ? ` | Player: ${event.childName}` : ''}`,
    previewSummary: {
      domain: 'team-management',
      action: label,
      timeZone: compactText(input.timeZone),
      event: eventSummary
    }
  };
}

async function prepareManagedTeamPlayerAction(
  user: AuthUser,
  args: Record<string, unknown>,
  label: string
) {
  const teamId = await requireManagedTeamId(user, args);
  const detail = await loadParentTeamDetail(teamId, user);
  const player = resolveTeamDetailPlayer(detail, args);
  if (!player) throw new Error('No matching roster player was found.');
  const teamName = compactText(detail.team?.name) || teamId;
  return {
    args: {
      ...args,
      teamId,
      playerId: compactText(player.id || player.playerId)
    },
    summary: `${label} | Player: ${compactText(player.name) || compactText(player.id)} | Team: ${teamName}`,
    previewSummary: {
      domain: 'team-management',
      teamId,
      teamName,
      playerId: compactText(player.id || player.playerId),
      playerName: compactText(player.name) || compactText(player.id),
      action: label
    }
  };
}

async function preparePracticePacketCompletionAction(user: AuthUser, args: Record<string, unknown>) {
  const prepared = await prepareScheduleEventAction(
    user,
    buildPracticePacketEventArgs(args),
    'Mark practice packet complete',
    { eventType: 'practice' }
  );
  const event = await resolveAccessibleScheduleEvent(user, prepared.args);
  if (!event) throw new Error('No matching practice was found for this account.');
  const packet = await loadPracticePacketForAi(user, event);
  if (!packet) throw new Error('No practice packet was found for this practice.');
  const child = resolvePracticePacketChild(packet, args);
  return {
    ...prepared,
    args: {
      ...prepared.args,
      childId: compactText(child.id)
    },
    summary: `Mark practice packet complete | ${event.teamName}: ${getScheduleTitle(event)} | Player: ${compactText(child.name) || child.id}`,
    previewSummary: {
      ...prepared.previewSummary,
      childId: compactText(child.id),
      childName: compactText(child.name) || compactText(child.id)
    }
  };
}

async function prepareRideOfferAction(
  user: AuthUser,
  args: Record<string, unknown>,
  label: string,
  options: { requireChildUnique?: boolean } = {}
) {
  const prepared = await prepareScheduleEventAction(user, args, label, options);
  const { offer } = await resolveAccessibleRideOffer(user, prepared.args);
  return {
    ...prepared,
    args: {
      ...prepared.args,
      offerId: offer.id
    },
    summary: `${prepared.summary} | Ride offer: ${offer.driverName || offer.id}`,
    previewSummary: {
      ...prepared.previewSummary,
      offer: summarizeRideOffer(offer)
    }
  };
}

function getPrivateAiToolDefinition(name: string) {
  const normalized = compactText(name);
  return privateAiToolDefinitions.find((definition) => (
    definition.name === normalized || (definition.aliases || []).includes(normalized)
  )) || null;
}

async function preparePrivateAiWrite(
  user: AuthUser,
  call: PrivateAiToolCall
): Promise<PrivateAiPreparedWrite> {
  const definition = getPrivateAiToolDefinition(call.name);
  if (!definition || definition.mode !== 'write') {
    throw new Error(`Unsupported write tool: ${compactText(call.name)}`);
  }
  const args = sanitizeToolCallArgs(isPlainObject(call.args) ? call.args : {});
  const prepared = definition.prepare ? await definition.prepare(user, args) : { args };
  return {
    definitionName: definition.name,
    args: sanitizeToolCallArgs(prepared.args),
    summary: prepared.summary,
    previewSummary: prepared.previewSummary
  };
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

async function resolveAccessibleScheduleEvent(
  user: AuthUser,
  args: Record<string, unknown>,
  options: { requireChildUnique?: boolean } = {}
): Promise<ParentScheduleEvent | null> {
  const requestedEventId = compactText(args.eventId || args.gameId || args.id);
  const requestedTeamId = compactText(args.teamId);
  const requestedChildId = compactText(args.childId || args.playerId);
  const requestedEventType = compactText(args.type || args.eventType).toLowerCase();
  const requestedTeamName = compactText(args.teamName).toLowerCase();
  const requestedPlayerName = compactText(args.playerName || args.childName).toLowerCase();
  const requestedTitle = compactText(args.title || args.opponent).toLowerCase();
  const schedule = await loadParentSchedule(user, { includePastGames: true });
  const events = Array.isArray(schedule.events) ? schedule.events : [];

  if (
    !requestedEventId
    && !requestedTeamId
    && !requestedChildId
    && !requestedTeamName
    && !requestedPlayerName
    && !requestedTitle
  ) {
    throw new Error('An event ID, team, player, or event title is required.');
  }

  const matches = events.filter((event: ParentScheduleEvent) => {
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
  });
  const uniqueMatches = Array.from(new Map(matches.map((event) => [
    options.requireChildUnique === true
      ? `${event.teamId}:${event.id}:${event.type}:${event.childId || ''}`
      : `${event.teamId}:${event.id}:${event.type}`,
    event
  ])).values());
  if (uniqueMatches.length > 1) {
    throw new Error('More than one schedule event matches that request. Choose the exact event.');
  }
  return uniqueMatches[0] || null;
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
  const preparedTeamArtifact = payloadScope === 'team' && context.preparedArtifact
    ? stripPrivateAiArtifactForTeamStorage({
        ...context.preparedArtifact,
        confirmationId: id,
        teamId
      })
    : null;
  if (payloadScope === 'team') {
    assertPrivateAiPendingPayloadFitsFirestore(
      definition.name === 'apply_roster_import' ? 'roster' : 'schedule',
      preparedArgs,
      preparedTeamArtifact
    );
  }
  const teamPayload = payloadScope === 'team' ? {
    userId: user.uid,
    teamId,
    toolName: definition.name,
    args: preparedArgs,
    ...(preparedTeamArtifact
      ? {
          revision: 0,
          artifact: preparedTeamArtifact
        }
      : {}),
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
      && Date.parse(compactText(candidate.data.expiresAt)) > Date.now()
    ));
    const supersededRecords = pendingRecords.filter((candidate) => (
      compactText(candidate.data.confirmationGroupId) !== confirmationGroupId
    ));
    const sameGroupIds = pendingRecords
      .filter((candidate) => compactText(candidate.data.confirmationGroupId) === confirmationGroupId)
      .map((candidate) => candidate.id);
    const teamRecords = await Promise.all(supersededRecords.map(async (candidate) => {
      const oldTeamId = compactText(candidate.data.teamId);
      // The new team payload create proves current access only for `teamId`.
      // Superseding the owner-readable user action is sufficient to make an
      // older cross-team action non-executable; avoid reading a youth-data
      // payload from a team the user may no longer manage.
      if (candidate.data.payloadScope !== 'team' || !oldTeamId || oldTeamId !== teamId) return null;
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
        artifact: {},
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
  if (
    memoryPending
    && memoryPending.status !== 'pending'
    && !(
      memoryPending.status === 'executing'
      && recoverablePrivateAiExecutionTools.has(memoryPending.toolName)
      && Date.parse(compactText(memoryPending.executionLeaseExpiresAt)) <= Date.now()
    )
  ) return null;

  if (typeof runTransaction !== 'function') {
    if (!memoryPending || pending.payloadScope === 'team') return null;
    memoryPending.status = 'executing';
    memoryPending.executionLeaseExpiresAt = new Date(Date.now() + pendingActionExecutionLeaseMs).toISOString();
    pendingActionMemory.set(memoryKey, memoryPending);
    return memoryPending;
  }
  const pendingRef = doc(db, 'users', user.uid, privateAiPendingActionCollectionName, pending.id);
  try {
    const claimed = await runTransaction(db, async (transaction: any): Promise<PrivateAiPendingAction | null> => {
      const snapshot = await transaction.get(pendingRef);
      const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
      const expiresAt = compactText(data?.expiresAt);
      const toolName = compactText(data?.toolName);
      const recoveringExecution = data?.status === 'executing'
        && recoverablePrivateAiExecutionTools.has(toolName)
        && Date.parse(compactText(data?.executionLeaseExpiresAt)) <= Date.now();
      if (
        !snapshot?.exists?.()
        || !isPlainObject(data)
        || (data.status !== 'pending' && !recoveringExecution)
        || compactText(data.userId) !== user.uid
        || !expiresAt
        || Date.parse(expiresAt) <= Date.now()
      ) return null;

      const teamId = compactText(data.teamId);
      const payloadScope = data.payloadScope === 'team' ? 'team' : 'user';
      let args = isPlainObject(data.args) ? data.args : {};
      let teamPayloadRef: ReturnType<typeof doc> | null = null;
      let execution: PrivateAiPendingAction['execution'] = undefined;
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
          || (
            payload.status !== 'pending'
            && !(
              payload.status === 'executing'
              && recoverablePrivateAiExecutionTools.has(toolName)
              && Date.parse(compactText(payload.executionLeaseExpiresAt)) <= Date.now()
            )
          )
          || compactText(payload.userId) !== user.uid
          || compactText(payload.toolName) !== toolName
          || compactText(payload.teamId || (isPlainObject(payload.args) ? payload.args.teamId : '')) !== teamId
          || !isPlainObject(payload.args)
          || (compactText(payload.expiresAt) && Date.parse(compactText(payload.expiresAt)) <= Date.now())
        ) return null;
        args = payload.args;
        execution = isPlainObject(payload.execution)
          ? { rosterApplied: payload.execution.rosterApplied === true }
          : undefined;
      }

      const executionLeaseExpiresAt = new Date(Date.now() + pendingActionExecutionLeaseMs).toISOString();
      const executionState = {
        status: 'executing',
        executionStartedAt: serverTimestamp(),
        executionStartedBy: user.uid,
        executionLeaseExpiresAt
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
        status: 'executing',
        executionLeaseExpiresAt,
        execution,
        recoveringExecution
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
  const pending = await loadPrivateAiPendingAction(user, id, { allowTeamMemoryCandidate: true });
  if (!pending) {
    return { name: 'confirm_action', ok: false, error: 'No pending AI action matched that confirmation code.' };
  }
  if (pending.recoveryBlocked) {
    return {
      name: pending.toolName || 'confirm_action',
      ok: false,
      error: 'This action may already have completed, so AI will not run it again and risk a duplicate. Check the app, then prepare a new change only if it is still needed.'
    };
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
    args: {
      ...claimedPending.args,
      ...(isTeamScopedPrivateAiPayload(definition.name)
        ? {
            __pendingActionId: id,
            __recoveringExecution: claimedPending.recoveringExecution === true,
            ...(definition.name === 'apply_roster_import'
              ? { __rosterAlreadyApplied: claimedPending.execution?.rosterApplied === true }
              : {})
          }
        : {})
    }
  }, {
    confirmedWriteToken: confirmedWriteExecutionToken
  });
  if (
    result.ok
    && result.name === 'apply_schedule_import'
    && isPlainObject(result.data)
    && Number(result.data.failedCount || 0) > 0
    && Array.isArray(result.data.retryRows)
  ) {
    try {
      const retryArtifact = await restorePartialSchedulePendingAction(
        user,
        claimedPending,
        result.data.retryRows as ScheduleCsvImportPreviewRow['normalized'][]
      );
      const retryData = { ...result.data };
      delete retryData.retryRows;
      retryData.retryReady = true;
      retryData.retryArtifact = retryArtifact;
      return {
        ...result,
        data: retryData,
        requiresConfirmation: true,
        confirmationId: id
      };
    } catch (error: any) {
      result.ok = false;
      result.error = `Some schedule rows may already be saved, but the failed rows could not be preserved for retry: ${error?.message || 'proposal update failed.'}`;
    }
  }
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

async function restorePartialSchedulePendingAction(
  user: AuthUser,
  pending: PrivateAiPendingAction,
  retryRows: ScheduleCsvImportPreviewRow['normalized'][]
): Promise<PrivateAiScheduleArtifactReference> {
  if (
    pending.payloadScope !== 'team'
    || pending.toolName !== 'apply_schedule_import'
    || !pending.teamId
    || !retryRows.length
  ) {
    throw new Error('No failed schedule rows were available to retry.');
  }
  const teamId = pending.teamId;
  const rows = retryRows.slice(0, 200).map((row, index) => ({
    rowNumber: Number(row.rowNumber) || index + 1,
    draft: {},
    normalized: {
      ...row,
      rowNumber: Number(row.rowNumber) || index + 1
    },
    errors: []
  })) as ScheduleCsvImportPreviewRow[];
  const summary = {
    ...summarizeSchedulePreview(rows),
    errors: 0
  };
  const nextArgs = {
    teamId,
    rows: rows.map((row) => row.normalized),
    source: compactText(pending.args.source) || 'ai'
  };
  const pendingRef = doc(db, 'users', user.uid, privateAiPendingActionCollectionName, pending.id);
  const teamPayloadRef = doc(
    db,
    'teams',
    teamId,
    teamPrivateAiPendingActionCollectionName,
    pending.id
  );
  const restoredArtifact = await runTransaction(db, async (transaction: any) => {
    const [pendingSnapshot, teamPayloadSnapshot] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(teamPayloadRef)
    ]);
    const pendingData = typeof pendingSnapshot?.data === 'function' ? pendingSnapshot.data() : null;
    const teamPayload = typeof teamPayloadSnapshot?.data === 'function'
      ? teamPayloadSnapshot.data()
      : null;
    if (
      !pendingSnapshot?.exists?.()
      || !isPlainObject(pendingData)
      || !['pending', 'executing'].includes(compactText(pendingData.status))
      || compactText(pendingData.userId) !== user.uid
      || compactText(pendingData.toolName) !== 'apply_schedule_import'
      || compactText(pendingData.teamId || (isPlainObject(pendingData.args) ? pendingData.args.teamId : '')) !== teamId
      || Date.parse(compactText(pendingData.expiresAt)) <= Date.now()
      || !teamPayloadSnapshot?.exists?.()
      || !isPlainObject(teamPayload)
      || !['pending', 'executing'].includes(compactText(teamPayload.status))
      || compactText(teamPayload.userId) !== user.uid
      || compactText(teamPayload.toolName) !== 'apply_schedule_import'
      || compactText(teamPayload.teamId) !== teamId
    ) {
      return null;
    }
    const previousArtifact = normalizePrivateAiArtifact(teamPayload.artifact);
    const nextArtifact = stripPrivateAiArtifactForTeamStorage({
      type: 'schedule-import',
      confirmationId: pending.id,
      revision: Math.max(0, Number(teamPayload.revision) || 0) + 1,
      teamId,
      teamName: previousArtifact?.type === 'schedule-import'
        ? previousArtifact.teamName
        : 'Team',
      source: normalizePrivateAiImportSource(pending.args.source),
      summary,
      previewRows: rows
    });
    assertPrivateAiPendingPayloadFitsFirestore('schedule', nextArgs, nextArtifact);
    transaction.set(pendingRef, {
      status: 'pending',
      args: sanitizePendingActionArgsForUserStorage('apply_schedule_import', nextArgs),
      summary: `Schedule retry | Team: ${teamId} | ${summary.total} failed row${summary.total === 1 ? '' : 's'}`,
      previewSummary: summary,
      retryPreparedAt: serverTimestamp(),
      retryPreparedBy: user.uid
    }, { merge: true });
    transaction.set(teamPayloadRef, {
      status: 'pending',
      revision: Math.max(0, Number(teamPayload.revision) || 0) + 1,
      args: nextArgs,
      artifact: nextArtifact,
      retryPreparedAt: serverTimestamp(),
      retryPreparedBy: user.uid
    }, { merge: true });
    return normalizePrivateAiArtifact(nextArtifact);
  });
  if (!restoredArtifact || restoredArtifact.type !== 'schedule-import') {
    throw new Error('The schedule proposal changed before failed rows could be staged.');
  }
  pending.status = 'pending';
  pending.args = nextArgs;
  pending.previewSummary = summary;
  pendingActionMemory.set(`${user.uid}:${pending.id}`, pending);
  return restoredArtifact;
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
    artifact: {},
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

async function loadPrivateAiPendingAction(
  user: AuthUser,
  confirmationId: string,
  options: { allowTeamMemoryCandidate?: boolean } = {}
): Promise<PrivateAiPendingAction | null> {
  const memoryKey = `${user.uid}:${confirmationId}`;
  const fromMemory = pendingActionMemory.get(memoryKey);
  // The claim transaction below re-reads both durable records and revalidates
  // their status. Keeping the just-staged team action as a candidate avoids an
  // unnecessary pre-claim read failure without allowing memory-only execution.
  if (
    fromMemory?.status === 'pending'
    && (fromMemory.payloadScope !== 'team' || options.allowTeamMemoryCandidate === true)
  ) return fromMemory;

  const snapshot = await getDoc(doc(db, 'users', user.uid, privateAiPendingActionCollectionName, confirmationId)).catch(() => null);
  const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
  if (!snapshot?.exists?.() || !isPlainObject(data)) return null;
  if (compactText(data.userId) !== user.uid) return null;
  const toolName = compactText(data.toolName);
  const recoveringExecution = data.status === 'executing'
    && Date.parse(compactText(data.executionLeaseExpiresAt)) <= Date.now();
  if (data.status !== 'pending' && !recoveringExecution) return null;
  const teamId = compactText(data.teamId);
  const payloadScope = data.payloadScope === 'team' ? 'team' : 'user';
  if (recoveringExecution && !recoverablePrivateAiExecutionTools.has(toolName)) {
    return {
      id: confirmationId,
      userId: user.uid,
      toolName,
      args: {},
      summary: compactText(data.summary),
      createdAt: normalizeScheduleDate(data.createdAt)?.toISOString()
        || compactText(data.clientCreatedAt)
        || new Date().toISOString(),
      conversationId: normalizeConversationId(data.conversationId),
      confirmationGroupId: compactText(data.confirmationGroupId),
      previewSummary: isPlainObject(data.previewSummary) ? data.previewSummary : undefined,
      teamId: teamId || undefined,
      payloadScope,
      expiresAt: compactText(data.expiresAt) || new Date(Date.now() + pendingActionLifetimeMs).toISOString(),
      status: 'executing',
      executionLeaseExpiresAt: compactText(data.executionLeaseExpiresAt) || undefined,
      recoveryBlocked: true
    };
  }
  let args = isPlainObject(data.args) ? data.args : {};
  let execution: PrivateAiPendingAction['execution'] = isPlainObject(data.execution)
    ? { rosterApplied: data.execution.rosterApplied === true }
    : undefined;
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
      || (
        payload.status !== 'pending'
        && !(
          payload.status === 'executing'
          && recoverablePrivateAiExecutionTools.has(toolName)
          && Date.parse(compactText(payload.executionLeaseExpiresAt)) <= Date.now()
        )
      )
      || compactText(payload.userId) !== user.uid
      || compactText(payload.toolName) !== toolName
      || !isPlainObject(payload.args)
    ) return null;
    args = payload.args;
    execution = isPlainObject(payload.execution)
      ? { rosterApplied: payload.execution.rosterApplied === true }
      : undefined;
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
    status: data.status === 'executing' ? 'executing' : 'pending',
    executionLeaseExpiresAt: compactText(data.executionLeaseExpiresAt) || undefined,
    execution
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
    if (
      !isPlainObject(data)
      || (
        data.status !== 'pending'
        && !(
          data.status === 'executing'
          && Date.parse(compactText(data.executionLeaseExpiresAt)) <= Date.now()
        )
      )
      || compactText(data.userId) !== user.uid
    ) return null;
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
      status: data.status === 'executing' ? 'executing' as const : 'pending' as const,
      executionLeaseExpiresAt: compactText(data.executionLeaseExpiresAt) || undefined
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
    .filter((pending) => (
      pending.id
      && (
        pending.status === 'pending'
        || (
          pending.status === 'executing'
          && Date.parse(compactText(pending.executionLeaseExpiresAt)) <= Date.now()
        )
      )
      && Date.parse(pending.expiresAt) > Date.now()
    ))
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
  return toolName === 'apply_roster_import' || toolName === 'apply_schedule_import';
}

function sanitizePendingActionArgsForUserStorage(toolName: string, args: Record<string, unknown>) {
  const sanitized = sanitizePendingActionPayloadArgs(args);
  if (!isTeamScopedPrivateAiPayload(toolName)) return sanitized;
  if (toolName === 'apply_schedule_import') {
    const rows = Array.isArray(sanitized.rows)
      ? sanitized.rows as ScheduleCsvImportPreviewRow['normalized'][]
      : [];
    return {
      teamId: compactText(sanitized.teamId),
      source: compactText(sanitized.source),
      rowSummary: summarizeScheduleRows(rows),
      validationErrorCount: Array.isArray(sanitized.__scheduleValidationErrors)
        ? sanitized.__scheduleValidationErrors.length
        : 0
    };
  }
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
      const resultLabel = importedCount > 0
        ? `Schedule import partially completed: ${importedCount} imported and ${failedCount} failed`
        : `No schedule rows were saved: ${failedCount} failed`;
      const retryMessage = data.retryReady === true
        ? 'The failed rows remain in an editable review. Correct them if needed, then reply yes to retry only those rows.'
        : 'Prepare only the failed rows again.';
      return `${resultLabel}${failedRows.length ? ` (rows ${failedRows.join(', ')})` : ''}. ${retryMessage}`;
    }
    return `Schedule imported: ${importedCount} row${importedCount === 1 ? '' : 's'} saved.`;
  }
  if (result.name === 'invite_roster_parent') {
    const data = isPlainObject(result.data) ? result.data : {};
    const email = compactText(data.email);
    const playerName = compactText(data.playerName);
    const recipient = [email, playerName ? `for ${playerName}` : ''].filter(Boolean).join(' ');
    if (data.emailQueued === true || data.emailSent === true) {
      if (data.autoLinked === true) {
        return `The existing parent account ${recipient} was linked and a notification email was queued.`;
      }
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

function collectPrivateAiRetryArtifacts(results: PrivateAiToolResult[]) {
  return results.map((result) => {
    const data = isPlainObject(result.data) ? result.data : {};
    return normalizePrivateAiArtifact(data.retryArtifact);
  }).filter((artifact): artifact is PrivateAiArtifactReference => Boolean(artifact));
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

function normalizeRosterFingerprintValue(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as any)?.toDate === 'function') {
    return (value as any).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(normalizeRosterFingerprintValue);
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const normalized = normalizeRosterFingerprintValue((value as Record<string, unknown>)[key]);
        if (normalized !== undefined) result[key] = normalized;
        return result;
      }, {});
  }
  return undefined;
}

function hashRosterFingerprint(value: unknown) {
  const source = JSON.stringify(normalizeRosterFingerprintValue(value));
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619) >>> 0;
    second = Math.imul(second ^ code, 3266489917) >>> 0;
  }
  return `v1_${first.toString(36)}${second.toString(36)}`;
}

function getRosterPlayerFingerprint(player: Record<string, any> | undefined) {
  if (!player) return '';
  return hashRosterFingerprint(player);
}

function attachRosterImportPreconditions(
  operations: RosterImportPlannedOperationForApp[],
  currentPlayers: Array<Record<string, any>>
) {
  return operations.map((operation) => {
    if (operation.type === 'add') {
      return {
        ...operation,
        precondition: {}
      };
    }
    const playerId = compactText(operation.playerId);
    const player = currentPlayers.find((candidate) => compactText(candidate.id) === playerId);
    return {
      ...operation,
      precondition: {
        playerId,
        playerFingerprint: getRosterPlayerFingerprint(player)
      }
    };
  });
}

function assertRosterImportIdentityUnchanged(
  original: RosterImportPlannedOperationForApp[],
  current: RosterImportPlannedOperationForApp[]
) {
  if (original.length !== current.length) {
    throw new Error('The roster changed after this preview. Review the import again before confirming.');
  }
  current.forEach((operation, index) => {
    const prior = original[index];
    const errors = operation.errors || [];
    if (
      errors.length
      || operation.type !== prior.type
      || (operation.type !== 'add' && compactText(operation.playerId) !== compactText(prior.playerId))
    ) {
      throw new Error(
        `The roster changed after this preview. Review the import again before confirming.${errors.length ? ` ${errors.join(' ')}` : ''}`
      );
    }
  });
  return current;
}

async function revalidateRosterImportOperationsForConfirmation(
  teamId: string,
  user: AuthUser,
  operations: RosterImportPlannedOperationForApp[]
) {
  const currentContext = await loadRosterImportContextForApp(teamId, user, { fresh: true });
  operations.forEach((operation) => {
    if (!operation.precondition) {
      throw new Error('This roster preview predates current-state validation. Prepare it again before confirming.');
    }
    if (operation.type === 'add') return;
    const playerId = compactText(operation.playerId);
    const currentPlayer = currentContext.players.find((candidate) => compactText(candidate.id) === playerId);
    if (
      compactText(operation.precondition.playerId) !== playerId
      || compactText(operation.precondition.playerFingerprint) !== getRosterPlayerFingerprint(currentPlayer)
    ) {
      throw new Error('The roster changed after this preview. Review the import again before confirming.');
    }
  });
  const rebased = assertRosterImportIdentityUnchanged(
    operations,
    replanRosterAiImportOperations(operations, currentContext.players, currentContext.fields)
  );
  return rebased.map((operation, index) => ({
    ...operation,
    precondition: operations[index].precondition
  }));
}

function summarizeSchedulePreview(rows: ScheduleCsvImportPreviewRow[]) {
  return summarizeScheduleRows(rows.map((row) => row.normalized));
}

function getCurrentScheduleImportEvents(events: ParentScheduleEvent[], teamId: string) {
  return events
    .filter((event) => (
      event.teamId === teamId
      && (
        (event.type === 'game' && event.isDbGame)
        || event.type === 'practice'
      )
    ))
    .map((event) => ({
      id: event.id,
      type: event.type === 'practice' ? 'practice' as const : 'game' as const,
      date: event.date,
      opponent: event.opponent,
      title: event.title,
      location: event.location,
      status: event.isCancelled ? 'cancelled' : 'scheduled'
    }));
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
  if (artifact.type !== 'document-analysis') {
    stored.revision = Math.max(0, Number(artifact.revision) || 0);
  }
  if (artifact.type === 'document-analysis') {
    stored.fileName = artifact.fileName;
    stored.mimeType = artifact.mimeType;
  }
  return stored;
}

function stripPrivateAiArtifactForTeamStorage(artifact: PrivateAiRosterArtifactReference | PrivateAiScheduleArtifactReference) {
  const stored = stripPrivateAiArtifactForStorage(artifact);
  if (artifact.type === 'roster-import' && artifact.previewRows?.length) {
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

async function hydratePrivateAiTeamArtifactPreviews(
  user: AuthUser,
  messages: PrivateAiMessage[]
): Promise<PrivateAiMessage[]> {
  const payloads = new Map<string, Promise<PrivateAiArtifactReference | null>>();
  const loadArtifact = (
    artifact: PrivateAiRosterArtifactReference | PrivateAiScheduleArtifactReference
  ) => {
    const key = `${artifact.teamId}:${artifact.confirmationId}`;
    const existing = payloads.get(key);
    if (existing) return existing;
    const request = getDoc(doc(
      db,
      'teams',
      artifact.teamId,
      teamPrivateAiPendingActionCollectionName,
      artifact.confirmationId
    )).then((snapshot: any) => {
      const data = typeof snapshot?.data === 'function' ? snapshot.data() : null;
      const expectedToolName = artifact.type === 'roster-import'
        ? 'apply_roster_import'
        : 'apply_schedule_import';
      const expiresAt = compactText(data?.expiresAt);
      if (
        !snapshot?.exists?.()
        || !isPlainObject(data)
        || data.status !== 'pending'
        || compactText(data.userId) !== user.uid
        || compactText(data.teamId) !== artifact.teamId
        || compactText(data.toolName) !== expectedToolName
        || (expiresAt && Date.parse(expiresAt) <= Date.now())
      ) return null;
      const secureArtifact = normalizePrivateAiArtifact(data.artifact);
      if (
        !secureArtifact
        || secureArtifact.type === 'document-analysis'
        || secureArtifact.type !== artifact.type
        || secureArtifact.confirmationId !== artifact.confirmationId
        || secureArtifact.teamId !== artifact.teamId
      ) return null;
      return secureArtifact;
    }).catch(() => null);
    payloads.set(key, request);
    return request;
  };

  return Promise.all(messages.map(async (message) => {
    if (!message.artifacts?.length) return message;
    const artifacts = await Promise.all(message.artifacts.map(async (artifact) => {
      if (
        artifact.type === 'document-analysis'
        || !artifact.confirmationId
        || !artifact.teamId
      ) return artifact;
      const summaryArtifact = stripPrivateAiArtifactForStorage(artifact) as
        PrivateAiRosterArtifactReference | PrivateAiScheduleArtifactReference;
      const secureArtifact = await loadArtifact(artifact);
      if (!secureArtifact || secureArtifact.type === 'document-analysis') return summaryArtifact;
      return {
        ...summaryArtifact,
        revision: secureArtifact.revision,
        source: secureArtifact.source,
        summary: secureArtifact.summary,
        previewRows: secureArtifact.previewRows
      } as PrivateAiArtifactReference;
    }));
    return {
      ...message,
      artifacts
    };
  }));
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
      revision: Math.max(0, Number(value.revision) || 0),
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
    revision: Math.max(0, Number(value.revision) || 0),
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
  toolResults,
  roleCapabilities
}: {
  user: AuthUser;
  question: string;
  history: unknown;
  toolResults: PrivateAiToolResult[];
  roleCapabilities: PrivateAiRoleCapabilities;
}) {
  return `You are ALL PLAYS, a private assistant for the signed-in youth sports parent or coach.\n` +
    `You may answer from conversation context for general navigation. For account-specific facts, request tools first.\n` +
    `Use only the available tools; never ask for or invent Firestore paths.\n` +
    `Return strict JSON only, with no markdown.\n` +
    `For schedule data, include the exact requested team/player and game/practice type in list_schedule args whenever the question supplies them.\n` +
    `Example: {"toolCalls":[{"name":"list_schedule","args":{"range":"upcoming","type":"game","teamName":"Bears","limit":8}}]}.\n` +
    `For last/previous game questions, call get_last_game. For game-specific questions, do not answer with practices as substitutes.\n` +
    `Never claim that no matching schedule event exists unless the tool result says absenceConfirmed is true. If schedule coverage is partial, say the complete schedule could not be verified.\n` +
    `For writes, call the write tool with normalized args. The app will stage it and require user confirmation before execution.\n` +
    `Imperative requests that ask to add, invite, create, update, remove, cancel, or send something are write requests, not help questions. Call the matching write tool instead of get_help.\n` +
    (roleCapabilities.isTeamManager
      ? `Adding roster players does not require parent or guardian email addresses. If the user asks to add players only, call apply_roster_import with name-only add operations and no familyContacts. Do not ask for contact details or call invite_roster_parent unless the user explicitly asks to invite a parent or guardian.\n`
      : '') +
    `For a parent/guardian roster invitation, call invite_roster_parent with the player name and email. When the user states a team, include that exact teamName; otherwise the tool searches every managed roster, resolves a unique player automatically, and reports ambiguity when a team choice is genuinely required.\n` +
    `If the user asks to retry a failed parent invitation email, call resend_roster_parent_invite with the player name and email from the recent chat.\n` +
    `If you have enough information, return {"answer":"..."}.\n\n` +
    `AVAILABLE ROLE-AUTHORIZED TOOLS (family/player and coach/admin capabilities are combined):\n` +
    getRoleAuthorizedPrivateAiToolDefinitions(user, roleCapabilities).map((definition) => (
      `- [${definition.domain || inferPrivateAiToolDomain(definition.name)}] ${definition.name} (${definition.mode}): ${definition.description}`
    )).join('\n') + `\n\n` +
    `USER:\n${JSON.stringify(summarizeSignedInUser(user, roleCapabilities))}\n\n` +
    `RECENT CHAT HISTORY:\n${JSON.stringify(history)}\n\n` +
    `QUESTION:\n${question}\n\n` +
    `TOOL RESULTS SO FAR:\n${JSON.stringify(formatToolResultsForPrompt(toolResults))}\n`;
}

function buildFinalAnswerPrompt({
  user,
  question,
  history,
  toolResults,
  roleCapabilities
}: {
  user: AuthUser;
  question: string;
  history: unknown;
  toolResults: PrivateAiToolResult[];
  roleCapabilities: PrivateAiRoleCapabilities;
}) {
  return `You are ALL PLAYS, a private assistant for the signed-in youth sports parent or coach.\n` +
    `Use ONLY this account-scoped data. If the data is missing, say what is missing.\n` +
    `For product/how-to questions, use help documentation results and include the relevant help page when useful.\n` +
    `If a tool result requires confirmation, state the proposed change clearly and tell the user they can reply "yes" to confirm. Do not mention internal confirmation IDs or codes.\n` +
    `For schedule confirmations, restate the team, game or practice, date and time, time zone, opponent or title, and location when those details are present. Never answer with only a confirmation instruction.\n` +
    `When the user asks for a game, answer from game records only; if only practices are available, say no matching game was found.\n` +
    `Never claim that no matching schedule event exists unless the schedule result says absenceConfirmed is true. If coverage is incomplete, say the complete schedule could not be verified.\n` +
    `Answer concisely. Include dates, times, team names, and player names when relevant.\n` +
    `Return strict JSON only: {"answer":"..."}.\n\n` +
    `USER:\n${JSON.stringify(summarizeSignedInUser(user, roleCapabilities))}\n\n` +
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

export type PrivateAiRoleCapabilities = {
  isTeamManager: boolean;
  managedTeamCount: number;
};

function hasDeclaredPrivateAiManagerRole(user: AuthUser) {
  const roles = new Set((user.roles || []).map((role) => compactText(role).toLowerCase()));
  return Boolean(
    user.isAdmin
    || user.isPlatformAdmin
    || user.coachOf?.length
    || ['coach', 'admin', 'administrator', 'platformadmin', 'platform-admin', 'platform_admin', 'team-admin', 'team_admin', 'staff', 'manager'].some((role) => roles.has(role))
  );
}

export async function loadPrivateAiRoleCapabilities(user: AuthUser): Promise<PrivateAiRoleCapabilities> {
  const declaredManagedTeamIds = new Set((user.coachOf || []).map(compactText).filter(Boolean));

  try {
    const scope = await loadParentScheduleScope(user);
    const managedTeamIds = new Set(declaredManagedTeamIds);
    (scope.staffTeams || []).forEach((team) => {
      const teamId = compactText(team.teamId);
      if (teamId) managedTeamIds.add(teamId);
    });
    return {
      isTeamManager: managedTeamIds.size > 0,
      managedTeamCount: managedTeamIds.size
    };
  } catch (error) {
    logger.warn('Unable to discover private AI manager capabilities.', { error });
    return {
      isTeamManager: declaredManagedTeamIds.size > 0,
      managedTeamCount: declaredManagedTeamIds.size
    };
  }
}

function getRoleAuthorizedPrivateAiToolDefinitions(
  _user: AuthUser,
  roleCapabilities: PrivateAiRoleCapabilities
) {
  return privateAiToolDefinitions.filter(
    (definition) => definition.audience !== 'manager' || roleCapabilities.isTeamManager
  );
}

function summarizeSignedInUser(
  user: AuthUser,
  roleCapabilities: PrivateAiRoleCapabilities = {
    isTeamManager: hasDeclaredPrivateAiManagerRole(user),
    managedTeamCount: user.coachOf?.length || 0
  }
) {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles || [],
    linkedPlayerCount: user.parentPlayerKeys?.length || user.parentOf?.length || 0,
    managedTeamCount: roleCapabilities.managedTeamCount,
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

function inferPrivateAiScheduleArgs(
  schedule: any,
  args: Record<string, unknown>,
  requestText = ''
) {
  const inferred = { ...args };
  const normalizedRequest = normalizeScheduleMentionText(requestText);
  const requestedType = compactText(args.type || args.eventType).toLowerCase();
  if (!requestedType && normalizedRequest) {
    const mentionsGame = /\b(?:game|games|match|matches)\b/.test(normalizedRequest);
    const mentionsPractice = /\b(?:practice|practices|training|workout|workouts)\b/.test(normalizedRequest);
    if (mentionsGame !== mentionsPractice) inferred.type = mentionsGame ? 'game' : 'practice';
  } else if (/^(?:game|games|match|matches)$/.test(requestedType)) {
    inferred.type = 'game';
  } else if (/^(?:practice|practices|training|workout|workouts)$/.test(requestedType)) {
    inferred.type = 'practice';
  }

  if (!compactText(args.teamId || args.teamName) && normalizedRequest) {
    const team = findUniqueScheduleMention(normalizedRequest, collectScheduleTeamMentions(schedule), 'team');
    if (team) inferred.teamId = team.id;
  }
  if (!compactText(args.childId || args.playerId || args.childName || args.playerName) && normalizedRequest) {
    const player = findUniqueScheduleMention(normalizedRequest, collectSchedulePlayerMentions(schedule), 'player');
    if (player) inferred.playerId = player.id;
  }
  return inferred;
}

function normalizeScheduleMentionText(value: unknown) {
  return compactText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function collectScheduleTeamMentions(schedule: any) {
  const mentions = new Map<string, { id: string; name: string }>();
  const add = (value: any) => {
    const id = compactText(value?.teamId || value?.id);
    const name = compactText(value?.teamName || value?.name);
    if (id && name && !mentions.has(id)) mentions.set(id, { id, name });
  };
  (schedule?.children || []).forEach(add);
  (schedule?.staffTeams || []).forEach(add);
  (schedule?.events || []).forEach(add);
  return Array.from(mentions.values());
}

function collectSchedulePlayerMentions(schedule: any) {
  const mentions = new Map<string, { id: string; name: string }>();
  const add = (value: any) => {
    const id = compactText(value?.childId || value?.playerId);
    const name = compactText(value?.childName || value?.name);
    if (id && name && !mentions.has(id)) mentions.set(id, { id, name });
  };
  (schedule?.children || []).forEach(add);
  (schedule?.events || []).forEach(add);
  return Array.from(mentions.values());
}

function findUniqueScheduleMention<T extends { id: string; name: string }>(
  normalizedRequest: string,
  candidates: T[],
  label: 'team' | 'player'
): T | null {
  const normalizedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      normalizedName: normalizeScheduleMentionText(candidate.name)
    }));
  const paddedRequest = ` ${normalizedRequest} `;
  const matches = normalizedCandidates
    .filter((candidate) => {
      if (!candidate.normalizedName) return false;
      if (label === 'player' && !candidate.normalizedName.includes(' ')) return false;
      return paddedRequest.includes(` ${candidate.normalizedName} `);
    })
    .sort((left, right) => right.normalizedName.length - left.normalizedName.length);
  if (matches.length) {
    const longestLength = matches[0].normalizedName.length;
    const longestMatches = matches.filter((candidate) => candidate.normalizedName.length === longestLength);
    if (new Set(longestMatches.map((candidate) => candidate.id)).size > 1) {
      throw new Error(`More than one accessible ${label} matches that schedule question. Choose one ${label}.`);
    }
    return longestMatches[0];
  }

  if (label !== 'player') return null;
  const requestTokens = normalizedRequest.split(' ').filter(Boolean);
  const scheduleContinuationTokens = new Set([
    'game', 'games', 'last', 'month', 'next', 'practice', 'practices', 'recent',
    'rsvp', 'rsvps', 'schedule', 'this', 'today', 'tomorrow', 'upcoming', 'week'
  ]);
  let hasUnmatchedFullNameSyntax = false;
  const firstNameMatches = normalizedCandidates.filter((candidate) => {
    const [firstName] = candidate.normalizedName.split(' ');
    if (!firstName) return false;
    return requestTokens.some((token, index) => {
      if (token !== firstName) return false;
      const previousToken = requestTokens[index - 1] || '';
      const nextToken = requestTokens[index + 1] || '';
      if (nextToken === 's') return true;
      const tokenAfterNext = requestTokens[index + 2] || '';
      if (
        nextToken
        && !scheduleContinuationTokens.has(nextToken)
        && (
          previousToken === 'for'
          || previousToken === 'player'
          || tokenAfterNext === 's'
          || scheduleContinuationTokens.has(tokenAfterNext)
        )
      ) {
        hasUnmatchedFullNameSyntax = true;
      }
      if (previousToken !== 'for' && previousToken !== 'player') return false;
      if (!nextToken || scheduleContinuationTokens.has(nextToken)) return true;
      hasUnmatchedFullNameSyntax = true;
      return false;
    });
  });
  if (new Set(firstNameMatches.map((candidate) => candidate.id)).size > 1) {
    throw new Error('More than one accessible player has that first name. Choose the full player name.');
  }
  if (!firstNameMatches.length && hasUnmatchedFullNameSyntax) {
    throw new Error('No accessible player matches that full name. Choose an active linked player.');
  }
  return firstNameMatches[0] || null;
}

function collectAccessibleSchedulePlayerMentions(access: AccessibleAiTeamsResult, teamId = '') {
  return access.schedulePlayers.filter((player) => !teamId || player.teamId === teamId);
}

function resolveExplicitSchedulePlayer(
  args: Record<string, unknown>,
  access: AccessibleAiTeamsResult,
  teamId = ''
) {
  const requestedPlayerId = compactText(args.playerId || args.childId);
  const requestedPlayerName = normalizeScheduleMentionText(args.playerName || args.childName);
  if (!requestedPlayerId && !requestedPlayerName) return null;
  const candidates = collectAccessibleSchedulePlayerMentions(access, teamId)
    .filter((candidate) => !requestedPlayerId || candidate.playerId === requestedPlayerId)
    .filter((candidate) => !requestedPlayerName || normalizeScheduleMentionText(candidate.name) === requestedPlayerName);
  if (candidates.length > 1) {
    throw new Error('More than one accessible player matches that schedule request. Choose the team and player.');
  }
  return candidates[0] || null;
}

async function resolvePrivateAiScheduleTargetScope(
  user: AuthUser,
  args: Record<string, unknown>,
  context: PrivateAiToolContext = {}
) {
  const normalizedRequest = normalizeScheduleMentionText(context.requestText);
  const access = await loadAccessibleAiTeams(user);
  const mentionedTeam = normalizedRequest
    ? findUniqueScheduleMention(normalizedRequest, access.scheduleTeams, 'team')
    : null;
  const mentionedPlayer = normalizedRequest
    ? findUniqueScheduleMention(
        normalizedRequest,
        collectAccessibleSchedulePlayerMentions(access),
        'player'
      )
    : null;
  const unavailablePlayer = normalizedRequest && !mentionedPlayer
    ? findUniqueScheduleMention(normalizedRequest, access.unavailableSchedulePlayers, 'player')
    : null;
  if (unavailablePlayer) {
    throw new Error('That player is not available in this account schedule. Choose an active linked player.');
  }
  if (mentionedTeam && mentionedPlayer && mentionedTeam.id !== mentionedPlayer.teamId) {
    throw new Error('The named team and player do not match. Choose the correct team or player.');
  }
  if (mentionedTeam || mentionedPlayer) {
    return {
      teamId: mentionedTeam?.id || mentionedPlayer?.teamId || '',
      playerId: mentionedPlayer?.playerId || ''
    };
  }

  const explicitTeamId = compactText(args.teamId);
  const explicitTeamName = compactText(args.teamName);
  let resolvedExplicitTeamId = explicitTeamId;
  if (!resolvedExplicitTeamId && explicitTeamName) {
    resolvedExplicitTeamId = await resolveAccessibleTeamId(user, { teamName: explicitTeamName }) || '';
    if (!resolvedExplicitTeamId) throw new Error(`No accessible team matches "${explicitTeamName}".`);
  }
  const hasExplicitPlayerSelector = Boolean(compactText(args.playerId || args.childId || args.playerName || args.childName));
  const explicitPlayer = resolveExplicitSchedulePlayer(args, access, resolvedExplicitTeamId);
  if (hasExplicitPlayerSelector && !explicitPlayer) {
    throw new Error('No accessible player matches that schedule request.');
  }
  if (resolvedExplicitTeamId || explicitPlayer) {
    return {
      teamId: resolvedExplicitTeamId || explicitPlayer?.teamId || '',
      playerId: explicitPlayer?.playerId || ''
    };
  }

  const launcherTeamId = compactText(context.teamId);
  if (launcherTeamId) return { teamId: launcherTeamId, playerId: '' };
  const launcherTeamName = compactText(context.teamName);
  if (launcherTeamName) {
    const launcherResolvedTeamId = await resolveAccessibleTeamId(user, { teamName: launcherTeamName });
    if (!launcherResolvedTeamId) throw new Error(`No accessible team matches "${launcherTeamName}".`);
    return { teamId: launcherResolvedTeamId, playerId: '' };
  }
  return { teamId: '', playerId: '' };
}

function summarizeSchedule(schedule: any, args: Record<string, unknown>) {
  const now = new Date();
  const requestedLimit = Number(args.limit || 12);
  const itemLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 25) : 12;
  const range = compactText(args.range || 'upcoming').toLowerCase();
  const eventType = compactText(args.type).toLowerCase();
  const teamId = compactText(args.teamId);
  const teamName = compactText(args.teamName).toLowerCase();
  const playerId = compactText(args.playerId || args.childId);
  const playerName = compactText(args.playerName || args.childName).toLowerCase();

  let events = Array.isArray(schedule.events) ? schedule.events.slice() : [];
  if (range === 'upcoming') {
    events = events
      .filter((event: ParentScheduleEvent) => event.date.getTime() >= startOfDay(now).getTime())
      .sort((left: ParentScheduleEvent, right: ParentScheduleEvent) => left.date.getTime() - right.date.getTime());
  } else if (range === 'recent') {
    events = events
      .filter((event: ParentScheduleEvent) => event.date.getTime() < startOfDay(now).getTime())
      .sort((left: ParentScheduleEvent, right: ParentScheduleEvent) => right.date.getTime() - left.date.getTime());
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
  if (playerId) {
    events = events.filter((event: ParentScheduleEvent) => event.childId === playerId);
  }
  if (playerName) {
    events = events.filter((event: ParentScheduleEvent) => event.childName.toLowerCase().includes(playerName));
  }

  const totalMatchingEvents = events.length;
  const returnedEventCount = Math.min(totalMatchingEvents, itemLimit);
  const hasMoreEvents = totalMatchingEvents > returnedEventCount;
  const sourceComplete = schedule?.isPartial !== true;

  return {
    query: {
      range,
      ...(eventType ? { type: eventType } : {}),
      ...(teamId ? { teamId } : {}),
      ...(teamName ? { teamName } : {}),
      ...(playerId ? { playerId } : {}),
      ...(playerName ? { playerName } : {})
    },
    totalMatchingEvents,
    returnedEventCount,
    hasMoreEvents,
    resultComplete: sourceComplete && !hasMoreEvents,
    absenceConfirmed: sourceComplete && totalMatchingEvents === 0,
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
    resultComplete: schedule?.isPartial !== true,
    absenceConfirmed: schedule?.isPartial !== true && pastGames.length === 0,
    message: pastGames.length
      ? ''
      : schedule?.isPartial === true
        ? 'The complete schedule could not be verified.'
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

type AccessibleAiTeam = {
  teamId: string;
  teamName: string;
  canManageTeam: boolean;
  playerCount: number;
  detail: any;
};

type AccessibleAiSchedulePlayer = {
  id: string;
  name: string;
  teamId: string;
  playerId: string;
};

type AccessibleAiTeamsResult = {
  teams: AccessibleAiTeam[];
  scheduleTeams: Array<{ id: string; name: string }>;
  schedulePlayers: AccessibleAiSchedulePlayer[];
  unavailableSchedulePlayers: AccessibleAiSchedulePlayer[];
  isPartial: boolean;
  partialError?: unknown;
  managerTeamsPartial: boolean;
  managerPartialError?: unknown;
};

async function loadAccessibleAiTeams(user: AuthUser): Promise<AccessibleAiTeamsResult> {
  const [homeResult, scheduleScopeResult] = await Promise.allSettled([
    loadParentHome(user),
    loadParentScheduleScope(user)
  ]);
  let isPartial = homeResult.status === 'rejected' || scheduleScopeResult.status === 'rejected';
  let partialError: unknown = homeResult.status === 'rejected'
    ? homeResult.reason
    : scheduleScopeResult.status === 'rejected'
      ? scheduleScopeResult.reason
      : undefined;
  if (homeResult.status === 'rejected') {
    logger.warn('Unable to load home teams for private AI access discovery.', { error: homeResult.reason });
  }
  if (scheduleScopeResult.status === 'rejected') {
    logger.warn('Unable to load schedule teams for private AI access discovery.', { error: scheduleScopeResult.reason });
  }
  const home = homeResult.status === 'fulfilled'
    ? homeResult.value
    : { teams: [] };
  const scheduleScope = scheduleScopeResult.status === 'fulfilled'
    ? scheduleScopeResult.value
    : { children: [], staffTeams: [], isPartial: true, staffTeamsPartial: true };
  const scheduleTeams = new Map<string, { id: string; name: string }>();
  const schedulePlayers = new Map<string, AccessibleAiSchedulePlayer>();
  const unavailableSchedulePlayers = new Map<string, AccessibleAiSchedulePlayer>();
  const addScheduleTeam = (value: unknown) => {
    const candidate = (value || {}) as Record<string, unknown>;
    const id = compactText(candidate.teamId || candidate.id);
    const name = compactText(candidate.teamName || candidate.name) || id;
    if (id && name && !scheduleTeams.has(id)) scheduleTeams.set(id, { id, name });
  };
  const addSchedulePlayer = (value: unknown, teamIdOverride = '', teamNameOverride = '') => {
    const candidate = (value || {}) as Record<string, unknown>;
    const teamId = compactText(teamIdOverride || candidate.teamId);
    const teamName = compactText(teamNameOverride || candidate.teamName);
    const playerId = compactText(candidate.playerId || candidate.childId || candidate.id);
    const name = compactText(candidate.playerName || candidate.childName || candidate.name);
    const id = `${teamId}:${playerId}`;
    if (teamId && playerId && name && !schedulePlayers.has(id)) {
      schedulePlayers.set(id, { id, name, teamId, playerId });
      unavailableSchedulePlayers.delete(id);
      addScheduleTeam({ teamId, teamName });
    }
  };
  const addUnavailableSchedulePlayer = (value: unknown, teamIdOverride = '') => {
    const candidate = (value || {}) as Record<string, unknown>;
    const teamId = compactText(teamIdOverride || candidate.teamId);
    const playerId = compactText(candidate.playerId || candidate.childId || candidate.id);
    const name = compactText(candidate.playerName || candidate.childName || candidate.name);
    const id = `${teamId}:${playerId}`;
    if (teamId && playerId && name && !schedulePlayers.has(id) && !unavailableSchedulePlayers.has(id)) {
      unavailableSchedulePlayers.set(id, { id, name, teamId, playerId });
    }
  };
  (home.teams || []).forEach(addScheduleTeam);
  (scheduleScope.staffTeams || []).forEach(addScheduleTeam);
  (scheduleScope.children || []).forEach((child) => {
    addScheduleTeam(child);
    addSchedulePlayer(child);
  });
  if (scheduleScope.isPartial === true) isPartial = true;
  let managerTeamsPartial = scheduleScopeResult.status === 'rejected'
    || (scheduleScope.staffTeamsPartial ?? scheduleScope.isPartial) === true;
  let managerPartialError: unknown = scheduleScopeResult.status === 'rejected'
    ? scheduleScopeResult.reason
    : undefined;
  const teamIds = new Set<string>();
  const managerTeamIds = new Set<string>();
  (home.teams || []).forEach((team: any) => {
    const teamId = compactText(team.teamId || team.id);
    if (teamId) teamIds.add(teamId);
  });
  (scheduleScope.children || []).forEach((child) => {
    const teamId = compactText(child.teamId);
    if (teamId) teamIds.add(teamId);
  });
  (scheduleScope.staffTeams || []).forEach((team) => {
    const teamId = compactText(team.teamId);
    if (teamId) {
      teamIds.add(teamId);
      managerTeamIds.add(teamId);
    }
  });
  (user.coachOf || []).forEach((teamId) => {
    const normalized = compactText(teamId);
    if (normalized) {
      teamIds.add(normalized);
      managerTeamIds.add(normalized);
    }
  });

  const candidateTeamIds = Array.from(teamIds);
  const loadedTeamIds = candidateTeamIds.slice(0, 60);
  if (candidateTeamIds.length > loadedTeamIds.length) {
    isPartial = true;
    if (candidateTeamIds.slice(60).some((teamId) => managerTeamIds.has(teamId))) {
      managerTeamsPartial = true;
    }
  }
  const detailResults = await Promise.allSettled(loadedTeamIds.map(async (teamId) => {
    const detail = await loadParentTeamDetail(teamId, user);
    if (!detail?.team) return null;
    return {
      teamId,
      teamName: compactText(detail.team.name) || teamId,
      canManageTeam: detail.canManageTeam === true,
      playerCount: (detail.players || []).length + (detail.inactivePlayers || []).length,
      detail
    } satisfies AccessibleAiTeam;
  }));
  const details: AccessibleAiTeam[] = [];
  detailResults.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      details.push(result.value);
    } else {
      isPartial = true;
      if (managerTeamIds.has(loadedTeamIds[index])) {
        managerTeamsPartial = true;
      }
      if (result.status === 'rejected') {
        partialError ||= result.reason;
        if (managerTeamIds.has(loadedTeamIds[index])) {
          managerPartialError ||= result.reason;
        }
        logger.warn('Unable to verify one private AI team.', { error: result.reason });
      }
    }
  });
  details.forEach((team) => {
    addScheduleTeam({ teamId: team.teamId, teamName: team.teamName });
    (team.detail?.linkedPlayers || []).forEach((player: unknown) => {
      addSchedulePlayer(player, team.teamId, team.teamName);
    });
    if (team.canManageTeam) {
      (team.detail?.players || []).forEach((player: unknown) => {
        addSchedulePlayer(player, team.teamId, team.teamName);
      });
    } else {
      (team.detail?.players || []).forEach((player: unknown) => {
        addUnavailableSchedulePlayer(player, team.teamId);
      });
    }
    (team.detail?.inactivePlayers || []).forEach((player: unknown) => {
      addUnavailableSchedulePlayer(player, team.teamId);
    });
  });
  return {
    teams: details,
    scheduleTeams: Array.from(scheduleTeams.values()),
    schedulePlayers: Array.from(schedulePlayers.values()),
    unavailableSchedulePlayers: Array.from(unavailableSchedulePlayers.values()),
    isPartial,
    managerTeamsPartial,
    ...(partialError ? { partialError } : {}),
    ...(managerPartialError ? { managerPartialError } : {})
  };
}

async function resolveAccessibleTeamId(
  user: AuthUser,
  args: Record<string, unknown>,
  options: { requireManager?: boolean } = {}
) {
  const teamId = compactText(args.teamId);
  const teamName = compactText(args.teamName).toLowerCase();
  const access = await loadAccessibleAiTeams(user);
  const eligibleTeams = options.requireManager
    ? access.teams.filter((team) => team.canManageTeam)
    : access.teams;
  if (teamId && eligibleTeams.some((team) => team.teamId === teamId)) return teamId;
  if (teamId && options.requireManager) {
    const directDetail = await loadParentTeamDetail(teamId, user);
    if (directDetail?.team && directDetail.canManageTeam === true) return teamId;
  }
  if (teamId) return null;
  const requestText = compactText(args.text || args.prompt || args.query).toLowerCase();
  const exactNamedTeams = teamName
    ? eligibleTeams.filter((team) => compactText(team.teamName).toLowerCase() === teamName)
    : [];
  if (exactNamedTeams.length > 1) {
    throw new Error(`More than one accessible team matches "${compactText(args.teamName)}". Choose one team.`);
  }
  if (exactNamedTeams.length === 1) {
    return exactNamedTeams[0].teamId;
  }
  const exactPromptTeams = !teamName && requestText
    ? eligibleTeams.filter((team) => {
        const name = compactText(team.teamName).toLowerCase();
        return requestText.startsWith(`${name}:`)
          || requestText.startsWith(`${name},`)
          || requestText.startsWith(`in ${name},`)
          || requestText.startsWith(`for ${name},`)
          || requestText.startsWith(`on ${name},`);
      })
    : [];
  if (exactPromptTeams.length > 1) {
    throw new Error('More than one accessible team matches that request. Choose one team.');
  }
  if (exactPromptTeams.length === 1) {
    return exactPromptTeams[0].teamId;
  }
  const teamIdentityIsPartial = options.requireManager
    ? access.managerTeamsPartial
    : access.isPartial;
  const teamIdentityError = options.requireManager
    ? access.managerPartialError
    : access.partialError;
  if (teamIdentityIsPartial) {
    if (teamIdentityError instanceof Error) throw teamIdentityError;
    throw new Error('Could not verify all team access. Use an exact team name or team ID and try again.');
  }
  const partiallyNamedTeams = teamName && !exactNamedTeams.length && teamName.length >= 3
    ? eligibleTeams.filter((team) => compactText(team.teamName).toLowerCase().includes(teamName))
    : [];
  const explicitlyMentionedTeams = !teamName && requestText
    ? eligibleTeams.filter((team) => scoreTeamNameMention(requestText, compactText(team.teamName)) > 0)
    : [];
  const explicitMatches = exactNamedTeams.length
    ? exactNamedTeams
    : partiallyNamedTeams.length
      ? partiallyNamedTeams
      : explicitlyMentionedTeams;
  if (explicitMatches.length > 1) {
    throw new Error(`More than one accessible team matches "${compactText(args.teamName) || 'that request'}". Choose one team.`);
  }
  if (explicitMatches.length === 1) {
    return explicitMatches[0].teamId;
  }
  if (teamName) {
    const exactMatches = eligibleTeams.filter((team) => compactText(team.teamName).toLowerCase() === teamName);
    const matchingTeams = exactMatches.length
      ? exactMatches
      : eligibleTeams.filter((team) => compactText(team.teamName).toLowerCase().includes(teamName));
    if (matchingTeams.length > 1) {
      throw new Error(`More than one accessible team matches "${compactText(args.teamName)}". Choose one team.`);
    }
    return matchingTeams[0]?.teamId || null;
  }
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
  const ignoredTokens = new Set(['team', 'club', 'soccer', 'football', 'baseball', 'basketball', 'current']);
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

  const access = await loadAccessibleAiTeams(user);
  let managedTeams: any[] = access.teams.filter((team) => team.canManageTeam);
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
    if (access.isPartial && !exactTeams.length) {
      throw new Error(`Could not verify the managed team "${compactText(args.teamName)}". Use the exact team name or team ID and try again.`);
    }
    const matchingTeams = exactTeams.length
      ? exactTeams
      : managedTeams.filter((team) => compactText(team.teamName).toLowerCase().includes(requestedTeamName));
    if (matchingTeams.length > 1) {
      throw new Error(`More than one managed team matches "${compactText(args.teamName)}". Choose one team.`);
    }
    managedTeams = matchingTeams;
  }
  if (access.isPartial && !requestedTeamId && !requestedTeamName) {
    throw new Error('Could not verify all managed teams. Choose a specific team and try again.');
  }
  if (access.isPartial && requestedTeamName && !managedTeams.length) {
    throw new Error(`Could not verify the managed team "${compactText(args.teamName)}". Choose the exact team and try again.`);
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
  const requestedTeamId = compactText(args.teamId)
    || (compactText(args.teamName) ? await resolveAccessibleTeamId(user, args) : '');
  const requestedPlayerId = compactText(args.playerId || args.childId);
  const requestedPlayerName = compactText(args.playerName || args.childName).toLowerCase();
  const home = await loadParentHome(user);
  const access = await loadAccessibleAiTeams(user);
  if (access.isPartial && !requestedTeamId) {
    throw new Error('Could not verify all player access. Choose a specific team and try again.');
  }
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
    ...access.teams.flatMap((team) => [
      ...(team.detail.players || []),
      ...(team.detail.inactivePlayers || [])
    ].map((player: any) => ({
      teamId: team.teamId,
      playerId: player.id || player.playerId,
      name: player.name || player.playerName,
      teamName: team.teamName
    })))
  ].filter((player: any) => player.teamId && player.playerId);
  const uniquePlayers = Array.from(new Map(players.map((player: any) => [
    `${player.teamId}:${player.playerId}`,
    player
  ])).values());
  const teamPlayers = requestedTeamId
    ? uniquePlayers.filter((player: any) => player.teamId === requestedTeamId)
    : uniquePlayers;
  let matches = requestedPlayerId
    ? teamPlayers.filter((player: any) => player.playerId === requestedPlayerId)
    : [];
  if (!requestedPlayerId && requestedPlayerName) {
    const exactMatches = teamPlayers.filter((player: any) => compactText(player.name).toLowerCase() === requestedPlayerName);
    matches = exactMatches.length
      ? exactMatches
      : teamPlayers.filter((player: any) => compactText(player.name).toLowerCase().includes(requestedPlayerName));
  }
  if (matches.length > 1) {
    throw new Error(`More than one accessible player matches "${compactText(args.playerName || args.playerId)}". Choose the exact player and team.`);
  }
  return matches[0] || null;
}

function resolveTeamDetailPlayer(detail: any, args: Record<string, unknown>) {
  const playerId = compactText(args.playerId || args.childId);
  const playerName = compactText(args.playerName || args.childName).toLowerCase();
  const players = [...(detail.players || []), ...(detail.inactivePlayers || [])];
  if (playerId) return players.find((player: any) => compactText(player.id) === playerId) || null;
  if (!playerName) return null;
  const exactMatches = players.filter((player: any) => compactText(player.name).toLowerCase() === playerName);
  const matchingPlayers = exactMatches.length
    ? exactMatches
    : players.filter((player: any) => compactText(player.name).toLowerCase().includes(playerName));
  if (matchingPlayers.length > 1) {
    throw new Error(`More than one roster player matches "${compactText(args.playerName || args.childName)}". Choose the exact player.`);
  }
  return matchingPlayers[0] || null;
}

function resolvePracticePacketChild(packet: any, args: Record<string, unknown>) {
  const requestedChildId = compactText(args.childId || args.playerId);
  const requestedPlayerName = compactText(args.playerName || args.childName).toLowerCase();
  const children = Array.isArray(packet.children) ? packet.children : [];
  if ((requestedChildId || requestedPlayerName) && !children.length) {
    throw new Error('No linked child was found for this practice packet.');
  }
  const idMatches = requestedChildId
    ? children.filter((candidate: any) => candidate.id === requestedChildId)
    : children;
  const exactNameMatches = requestedPlayerName
    ? idMatches.filter((candidate: any) => compactText(candidate.name).toLowerCase() === requestedPlayerName)
    : [];
  const matchingChildren = requestedPlayerName
    ? exactNameMatches.length
      ? exactNameMatches
      : idMatches.filter((candidate: any) => compactText(candidate.name).toLowerCase().includes(requestedPlayerName))
    : idMatches;
  if (matchingChildren.length > 1) {
    throw new Error('More than one child matches this practice packet. Choose the exact child.');
  }
  const child = matchingChildren[0];
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
    endDate: event.endDate?.toISOString() || null,
    arrivalTime: event.arrivalTime?.toISOString() || null,
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

function parsePrivateAiClockTime(value: unknown) {
  const match = compactText(value).toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const meridiem = match[4];
  if (minutes > 59 || seconds > 59 || (meridiem ? hours < 1 || hours > 12 : hours > 23)) return null;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (meridiem === 'pm' && hours !== 12) hours += 12;
  return { hours, minutes, seconds };
}

function formatPrivateAiLocalDateTime(
  datePart: string,
  timeValue: unknown,
  timeZoneValue: unknown
) {
  const clock = parsePrivateAiClockTime(timeValue);
  if (!clock) throw new Error('The schedule event time is invalid.');
  const [year, month, day] = datePart.split('-').map(Number);
  const desiredLocalEpoch = Date.UTC(year, month - 1, day, clock.hours, clock.minutes, clock.seconds);
  const desiredLocalDate = new Date(desiredLocalEpoch);
  if (
    desiredLocalDate.getUTCFullYear() !== year
    || desiredLocalDate.getUTCMonth() !== month - 1
    || desiredLocalDate.getUTCDate() !== day
  ) {
    throw new Error('The schedule event date is invalid.');
  }
  const timeZone = compactText(timeZoneValue);
  if (!timeZone) {
    return `${datePart}T${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}:${String(clock.seconds).padStart(2, '0')}`;
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
  } catch {
    throw new Error(`The schedule time zone "${timeZone}" is invalid.`);
  }

  let utcEpoch = desiredLocalEpoch;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(utcEpoch))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
    const actualLocalEpoch = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const adjustment = desiredLocalEpoch - actualLocalEpoch;
    utcEpoch += adjustment;
    if (adjustment === 0) break;
  }
  const resolvedParts = Object.fromEntries(
    formatter.formatToParts(new Date(utcEpoch))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  const resolvedLocalEpoch = Date.UTC(
    Number(resolvedParts.year),
    Number(resolvedParts.month) - 1,
    Number(resolvedParts.day),
    Number(resolvedParts.hour),
    Number(resolvedParts.minute),
    Number(resolvedParts.second)
  );
  if (resolvedLocalEpoch !== desiredLocalEpoch) {
    throw new Error(`The schedule event time does not exist in "${timeZone}" because of daylight saving time.`);
  }
  return new Date(utcEpoch).toISOString();
}

function normalizePrivateAiScheduleEventInput(args: Record<string, unknown>) {
  const source = isPlainObject(args.input) ? args.input : args;
  const input = { ...source };
  const rawStartDate = source.startDate ?? source.startsAt ?? source.date;
  const startDateText = compactText(rawStartDate);
  const separateTime = source.time ?? source.startTime;
  const datePart = startDateText.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
  if (datePart && compactText(separateTime)) {
    input.startDate = formatPrivateAiLocalDateTime(
      datePart,
      separateTime,
      source.timeZone ?? source.timezone
    );
  } else if (rawStartDate !== undefined) {
    input.startDate = rawStartDate;
  }
  if (input.endDate === undefined && source.endsAt !== undefined) input.endDate = source.endsAt;
  if (input.arrivalTime === undefined && source.arrival !== undefined) input.arrivalTime = source.arrival;
  if (source.timeZone !== undefined || source.timezone !== undefined) {
    input.timeZone = compactText(source.timeZone ?? source.timezone);
  }
  delete input.time;
  delete input.startTime;
  delete input.timezone;
  delete input.startsAt;
  delete input.date;
  delete input.endsAt;
  delete input.arrival;
  return input;
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

function looksLikeImperativePrivateAiWriteRequest(question: string) {
  const text = normalizePrivateAiIntentText(question);
  const writeVerb = '(?:add|invite|create|update|change|remove|delete|deactivate|reactivate|cancel|schedule|reschedule|move|send|resend|retry|set|mark|record|assign|claim|release|save|import|complete|submit|request|revoke|retire|toggle|enable|disable|approve|reject|review|close|reopen|offer|post|pay|favorite|unfavorite)';
  return new RegExp(`^(?:please\\s+)?${writeVerb}\\b`).test(text)
    || new RegExp(`^(?:can|could|would)\\s+you\\s+(?:please\\s+)?${writeVerb}\\b`).test(text)
    || new RegExp(`^(?:use|using)\\b.{1,180}?(?:[.!;,:]\\s*|\\band\\s+)(?:please\\s+)?${writeVerb}\\b`).test(text)
    || new RegExp(`^(?:for|on)\\b.{1,120}?,\\s*(?:please\\s+)?${writeVerb}\\b`).test(text)
    || new RegExp(`^(?:in\\s+)?[^,;:\\n]{1,120}[,:]\\s*(?:please\\s+)?${writeVerb}\\b`).test(text);
}

function hasPrivateAiWriteToolResult(question: string, toolResults: PrivateAiToolResult[]) {
  return toolResults.some((result) => (
    result.ok
    && result.requiresConfirmation === true
    && Boolean(compactText(result.confirmationId))
    && getPrivateAiToolDefinition(result.name)?.mode === 'write'
    && privateAiWriteToolMatchesQuestion(question, result.name)
  ));
}

function privateAiWriteToolMatchesQuestion(question: string, toolName: string) {
  const expectedToolNames = getExpectedPrivateAiWriteToolNames(question);
  const definition = getPrivateAiToolDefinition(toolName);
  return expectedToolNames !== null
    && Boolean(definition)
    && expectedToolNames.has(definition!.name);
}

function getExpectedPrivateAiWriteToolNames(question: string): Set<string> | null {
  const text = normalizePrivateAiIntentText(question);
  if (/\b(?:resend|retry)\b.{0,80}\b(?:parent|guardian|invite|invitation|email)\b/.test(text)) {
    return new Set(['resend_roster_parent_invite']);
  }
  if (
    /\b(?:invite|invitation)\b.{0,120}\b(?:parent|guardian|mother|father|mom|dad|email)\b/.test(text)
    || /\b(?:parent|guardian|mother|father|mom|dad|email)\b.{0,120}\b(?:invite|invitation|roster)\b/.test(text)
  ) {
    return new Set(['invite_roster_parent']);
  }
  if (looksLikePrivateAiTeamAdminRequest(text)) {
    return new Set(['invite_team_admin']);
  }
  if (
    /\broster\b/.test(text)
    || (
      /\b(?:player|athlete)\b/.test(text)
      && /\b(?:add|remove|delete|deactivate|reactivate|import)\b/.test(text)
      && !/\b(?:profile|tracking|incentive|fee|registration|assignment)\b/.test(text)
    )
    || looksLikePrivateAiRosterMembershipRequest(text)
  ) {
    return new Set(['apply_roster_import']);
  }
  if (
    /\b(?:update|change|set|record)\b/.test(text)
    && /\b(?:game|match)\b/.test(text)
    && /\bscore\b/.test(text)
  ) {
    return new Set(['update_game_score']);
  }
  if (/\b(?:rsvp|attendance response|going|not going|not_going|maybe)\b/.test(text)) {
    if (/\b(?:remind|reminder|send)\b/.test(text)) return new Set(['send_rsvp_reminder']);
    return new Set(['update_rsvp', 'update_rsvps_for_children']);
  }
  if (/\b(?:claim)\b/.test(text) && /\b(?:assignment|task|slot)\b/.test(text)) {
    return new Set(['claim_assignment']);
  }
  if (/\b(?:release)\b/.test(text) && /\b(?:assignment|task|slot)\b/.test(text)) {
    return new Set(['release_assignment']);
  }
  if (/\b(?:assign|assignment)\b/.test(text) && /\b(?:schedule|event|game|practice|role|task)\b/.test(text)) {
    return new Set(['manage_schedule_assignment']);
  }
  if (/\b(?:practice packet|packet)\b/.test(text)) {
    return /\b(?:mark|complete)\b/.test(text)
      ? new Set(['mark_practice_packet_complete'])
      : new Set(['save_practice_packet']);
  }
  if (/\b(?:practice attendance|attendance)\b/.test(text) && /\b(?:mark|record|save|update|set)\b/.test(text)) {
    return new Set(['save_practice_attendance']);
  }
  if (/\b(?:team message|chat message|team chat|message)\b/.test(text) && /\b(?:send|post)\b/.test(text)) {
    return new Set(['send_team_message']);
  }
  if (/\b(?:team email|email)\b/.test(text) && /\b(?:send|resend|retry)\b/.test(text)) {
    return new Set(['send_team_email']);
  }
  if (/\b(?:tracking status|tracking item|requirement)\b/.test(text)) {
    return /\b(?:player|athlete|complete|incomplete|mark|set)\b/.test(text)
      ? new Set(['set_player_tracking_status'])
      : new Set(['save_team_tracking_item']);
  }
  if (/\b(?:team settings?|team name|team sport|league url|livestream url)\b/.test(text)) {
    return new Set(['update_team_settings']);
  }
  if (/\b(?:stat configuration|stat tracker|tracker configuration)\b/.test(text)) {
    return new Set(['save_stat_configuration']);
  }
  if (/\b(?:player profile|athlete profile|medical info|emergency contact)\b/.test(text)) {
    return new Set(['update_player_profile']);
  }
  if (/\b(?:incentive)\b/.test(text)) {
    if (/\b(?:pay|paid|payment)\b/.test(text)) return new Set(['mark_player_incentive_paid']);
    if (/\b(?:retire|remove|delete)\b/.test(text)) return new Set(['retire_player_incentive_rule']);
    if (/\b(?:enable|disable|toggle)\b/.test(text)) return new Set(['toggle_player_incentive_rule']);
    if (/\b(?:cap|maximum|max)\b/.test(text)) return new Set(['set_player_incentive_cap']);
    return new Set(['save_player_incentive_rule']);
  }
  if (/\b(?:ride offer|rideshare|ride request|ride spot|offer a ride)\b/.test(text)) {
    if (/\b(?:request|claim)\b/.test(text)) return new Set(['request_ride_spot']);
    if (/\b(?:cancel|remove)\b/.test(text)) return new Set(['cancel_ride_request']);
    if (/\b(?:close|reopen|status|set)\b/.test(text)) return new Set(['set_ride_offer_status']);
    return new Set(['create_ride_offer']);
  }
  if (/\b(?:household invite|household invitation|household member)\b/.test(text)) {
    return new Set(['create_household_invite']);
  }
  if (/\b(?:family share|share link)\b/.test(text)) {
    if (/\b(?:revoke|remove|delete)\b/.test(text)) return new Set(['revoke_family_share_link']);
    if (/\b(?:calendar)\b/.test(text)) return new Set(['update_family_share_calendars']);
    return new Set(['create_family_share_link']);
  }
  if (/\b(?:access request|parent access)\b/.test(text)) {
    return new Set(['submit_access_request']);
  }
  if (/\b(?:team fee|fee)\b/.test(text)) {
    return new Set(['create_team_fee']);
  }
  if (/\b(?:registration)\b/.test(text) && /\b(?:review|approve|reject|mark|record|update)\b/.test(text)) {
    return new Set(['review_registration']);
  }
  if (/\b(?:drill favorite|favorite drill|favorite\b.{0,40}\bdrill|unfavorite\b.{0,40}\bdrill)\b/.test(text)) {
    return new Set(['set_team_drill_favorite']);
  }
  if (/\b(?:practice timeline|timeline)\b/.test(text)) {
    return new Set(['save_practice_timeline']);
  }
  if (/\b(?:game wrapup|game wrap-up|wrap up the game|complete the game)\b/.test(text)) {
    return new Set(['complete_game_wrapup']);
  }
  const scheduleEventRequest = /\b(?:schedule|game|event|match)\b/.test(text)
    || (
      /\bpractice\b/.test(text)
      && !/\b(?:packet|attendance|timeline|assignment)\b/.test(text)
    );
  if (scheduleEventRequest) {
    if (/\b(?:cancel|delete|remove)\b/.test(text)) {
      return new Set(['cancel_schedule_event']);
    }
    if (/\b(?:update|change|reschedule|move|set)\b/.test(text)) {
      return new Set(['update_schedule_event']);
    }
    if (/\b(?:add|create|save|import|schedule)\b/.test(text)) {
      return new Set(['create_schedule_event', 'apply_schedule_import']);
    }
  }
  return null;
}

function normalizePrivateAiIntentText(question: string) {
  return compactText(question)
    .toLowerCase()
    .replace(/^[\s"'“”‘’`()[\]{}<>]+/, '')
    .trim();
}

function looksLikePrivateAiTeamAdminRequest(text: string) {
  return (
    /\b(?:team admin|administrator)\b/.test(text)
    && /\b(?:invite|add)\b/.test(text)
  ) || (
    /\b(?:invite|add)\s+.{1,120}?\s+(?:to|on)\s+(?:the\s+)?.{1,120}?\s+team\b.{0,80}\b(?:as|to be)\s+(?:an?\s+)?(?:team\s+)?(?:admin|administrator)\b/.test(text)
  );
}

function looksLikePrivateAiRosterMembershipRequest(text: string) {
  const match = text.match(
    /\b(?:add|remove|delete|deactivate|reactivate)\s+(.{1,120}?)\s+(?:to|from|on)\s+(?:the\s+)?(.{1,120}?)\s+(?:team|roster)\b/
  );
  if (!match) return false;
  const requestedMember = compactText(match[1]).toLowerCase();
  if (!requestedMember) return false;
  const trailingQualifier = text.slice((match.index || 0) + match[0].length);
  if (/\b(?:as|with|to be)\b.{0,40}\b(?:admin|administrator|coach|staff|manager)\b/.test(trailingQualifier)) {
    return false;
  }
  return !/\b(?:admin|administrator|coach|staff|manager|game|match|practice|event|schedule|fee|payment|message|email|drill|score|registration|assignment|ride|rideshare)\b/.test(requestedMember);
}

function getPrivateAiPlannerToolCallKey(call: PrivateAiToolCall) {
  const normalizeValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalizeValue);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeValue(value[key])])
    );
  };
  return `${compactText(call.name)}:${JSON.stringify(normalizeValue(call.args))}`;
}

function getPrivateAiPreparedWriteKey(prepared: PrivateAiPreparedWrite) {
  const normalizeValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalizeValue);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeValue(value[key])])
    );
  };
  return `${prepared.definitionName}:${JSON.stringify(normalizeValue(prepared.args))}`;
}

function looksLikeLastGameQuestion(question: string) {
  const text = compactText(question).toLowerCase();
  return /\b(last|previous|most recent|latest|prior)\b/.test(text) && /\b(?:game|match)\b/.test(text);
}

function looksLikeNextGameQuestion(question: string) {
  const text = compactText(question).toLowerCase();
  return /\b(next|upcoming)\b/.test(text) && /\b(?:game|match)\b/.test(text);
}

function buildGroundedNextGameAnswer(result: PrivateAiToolResult | undefined) {
  if (!result?.ok || !isPlainObject(result.data)) return '';
  const events = Array.isArray(result.data.events) ? result.data.events : [];
  const nextGame = events.find((event) => isPlainObject(event) && compactText(event.type).toLowerCase() === 'game');
  if (nextGame) {
    const teamName = compactText(nextGame.teamName) || 'Your team';
    const title = compactText(nextGame.title) || 'a game';
    const dateLabel = compactText(nextGame.dateLabel) || compactText(nextGame.date);
    const timeLabel = compactText(nextGame.timeLabel);
    const location = compactText(nextGame.location);
    const playerName = compactText(nextGame.childName);
    return `${teamName}'s next game is ${dateLabel}${timeLabel ? ` at ${timeLabel}` : ''}: ${title}${location ? ` at ${location}` : ''}${playerName ? ` for ${playerName}` : ''}.`;
  }
  if (result.data.absenceConfirmed === true) {
    return 'I found no upcoming game in the complete schedule for the requested team or player.';
  }
  return 'I could not verify the complete schedule, so I cannot confirm the next game yet.';
}

function clampAnswer(answer: string) {
  return compactText(answer).slice(0, maxAnswerCharacters) || 'I could not find enough information to answer that.';
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
