import DOMPurifyModule from 'dompurify';
import {
  DEFAULT_TEAM_CONVERSATION_ID,
  buildDefaultTeamConversation,
  getConversationDisplayName,
  isDefaultTeamConversation
} from '../../../../js/team-chat-conversations.js';
import {
  MAX_CHAT_MEDIA_SIZE,
  buildChatMediaShareDetails,
  collectThreadMedia,
  getChatMediaActionState,
  getChatMediaDownloadName,
  getMessageAttachments,
  isSafeChatMediaUrl
} from '../../../../js/team-chat-media.js';
import {
  shouldRetryChatLastReadOnViewReturn,
  shouldUpdateChatLastRead
} from '../../../../js/team-chat-last-read.js';

export {
  DEFAULT_TEAM_CONVERSATION_ID,
  MAX_CHAT_MEDIA_SIZE,
  buildChatMediaShareDetails,
  buildDefaultTeamConversation,
  collectThreadMedia,
  getChatMediaActionState,
  getChatMediaDownloadName,
  getMessageAttachments,
  getConversationDisplayName,
  isDefaultTeamConversation,
  isSafeChatMediaUrl,
  shouldRetryChatLastReadOnViewReturn,
  shouldUpdateChatLastRead
};

export type ChatReactionKey = 'thumbs_up' | 'heart' | 'joy' | 'wow' | 'sad' | 'clap';
export type ChatTargetType = 'full_team' | 'staff' | 'individuals';

export type ChatAudienceMetadata = {
  targetType: ChatTargetType;
  recipientIds: string[];
  targetRole: string | null;
};

export type ChatRecipientOption = {
  id: string;
  name: string;
  detail?: string;
  email?: string;
};

export type ChatFormattedPart = {
  type: 'text' | 'link';
  value: string;
  href?: string;
};

export const chatReactions: Array<{ key: ChatReactionKey; emoji: string; label: string }> = [
  { key: 'thumbs_up', emoji: '👍', label: 'Like' },
  { key: 'heart', emoji: '❤️', label: 'Love' },
  { key: 'joy', emoji: '😂', label: 'Funny' },
  { key: 'wow', emoji: '😮', label: 'Wow' },
  { key: 'sad', emoji: '😢', label: 'Sad' },
  { key: 'clap', emoji: '👏', label: 'Clap' }
];

export const chatReactionKeys = new Set(chatReactions.map((reaction) => reaction.key));

const aiMentionRegex = /@all\s*plays/ig;
const urlRegex = /(\bhttps?:\/\/[^\s<]+[^\s<.,;:!?"'\])>]|\bwww\.[^\s<]+[^\s<.,;:!?"'\])>])/gi;
const allowedChatHtmlTags = new Set(['strong', 'em', 'del', 'code', 'a', 'span']);
const chatHtmlSanitizeConfig = {
  ALLOWED_TAGS: ['strong', 'em', 'del', 'code', 'a', 'span'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  ALLOW_DATA_ATTR: false
};

type DomPurifyInstance = {
  sanitize: (html: string, config?: Record<string, unknown>) => string;
};

type DomPurifyFactory = (window: Window) => DomPurifyInstance;

function getDomPurify(): DomPurifyInstance | null {
  const candidate = DOMPurifyModule as unknown as DomPurifyInstance | DomPurifyFactory;
  if (typeof (candidate as DomPurifyInstance).sanitize === 'function') {
    return candidate as DomPurifyInstance;
  }
  if (typeof candidate === 'function' && typeof window !== 'undefined') {
    return (candidate as DomPurifyFactory)(window);
  }
  return null;
}

export function toChatDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value?.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatChatTime(value: any) {
  const date = toChatDate(value);
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatChatDay(value: any) {
  const date = toChatDate(value);
  if (!date) return '';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatInboxTime(value: any) {
  const date = toChatDate(value);
  if (!date) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - messageDay.getTime()) / 86400000);
  if (diffDays === 0) return formatChatTime(date);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function normalizeChatReactions(message: any): Partial<Record<ChatReactionKey, string[]>> {
  const source = message && typeof message.reactions === 'object' && message.reactions ? message.reactions : {};
  const normalized: Partial<Record<ChatReactionKey, string[]>> = {};

  chatReactions.forEach(({ key, emoji }) => {
    const byKey = Array.isArray(source[key]) ? source[key] : [];
    const byEmoji = Array.isArray(source[emoji]) ? source[emoji] : [];
    const users = Array.from(new Set([...byKey, ...byEmoji].map((uid) => String(uid || '').trim()).filter(Boolean)));
    if (users.length > 0) {
      normalized[key] = users;
    }
  });

  return normalized;
}

export function getReactionNames(users: string[] = [], currentUserId = '', userNames: Record<string, string> = {}) {
  const names = users.map((uid) => {
    if (uid === currentUserId) return 'You';
    return userNames[uid] || `User ${uid.slice(0, 6)}`;
  });
  if (names.length <= 4) return names.join(', ');
  return `${names.slice(0, 4).join(', ')} +${names.length - 4} more`;
}

export function getRecipientOptionId(kind: 'player' | 'user' | 'email', value: string) {
  return `${kind}:${String(value || '').trim()}`;
}

function isEmailLike(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function getChatMemberDisplayName(member: Record<string, any> = {}, fallback = 'Member') {
  const nameCandidates = [
    member.name,
    member.fullName,
    member.displayName,
    member.profileName,
    member.profileFullName,
    member.profileDisplayName,
    member.parentName,
    member.guardianName
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const name = nameCandidates.find((value) => !isEmailLike(value));
  if (name) return name;

  const email = String(member.email || member.parentEmail || member.guardianEmail || '').trim();
  return email || fallback;
}

export function getRecipientOptionLabel(option: ChatRecipientOption) {
  return option.detail ? `${option.name} (${option.detail})` : option.name;
}

export function buildChatAudienceMetadata({
  selectedConversation,
  selectedConversationId,
  selectedRecipientTarget,
  selectedRecipientIds
}: {
  selectedConversation?: any;
  selectedConversationId: string;
  selectedRecipientTarget: ChatTargetType;
  selectedRecipientIds: string[];
}): ChatAudienceMetadata {
  if (isStaffConversation(selectedConversation)) {
    return {
      targetType: 'staff',
      recipientIds: [],
      targetRole: 'staff'
    };
  }

  if (selectedConversation && !isDefaultTeamConversation(selectedConversationId)) {
    return {
      targetType: 'individuals',
      recipientIds: Array.isArray(selectedConversation.participantIds) ? selectedConversation.participantIds : [],
      targetRole: null
    };
  }

  if (selectedRecipientTarget === 'staff') {
    return {
      targetType: 'staff',
      recipientIds: [],
      targetRole: 'staff'
    };
  }

  const recipientIds = Array.from(new Set((selectedRecipientIds || []).map((id) => String(id || '').trim()).filter(Boolean))).sort();
  if (selectedRecipientTarget === 'individuals' && recipientIds.length > 0) {
    return {
      targetType: 'individuals',
      recipientIds,
      targetRole: null
    };
  }

  return {
    targetType: 'full_team',
    recipientIds: [],
    targetRole: null
  };
}

export function buildEmailAudienceMetadata({
  selectedConversation,
  selectedConversationId,
  selectedRecipientTarget,
  selectedRecipientIds,
  recipientOptions = []
}: {
  selectedConversation?: any;
  selectedConversationId: string;
  selectedRecipientTarget: ChatTargetType;
  selectedRecipientIds: string[];
  recipientOptions?: ChatRecipientOption[];
}): ChatAudienceMetadata {
  if (isStaffConversation(selectedConversation)) {
    return {
      targetType: 'staff',
      recipientIds: [],
      targetRole: 'staff'
    };
  }

  if (selectedConversation && !isDefaultTeamConversation(selectedConversationId)) {
    const optionIds = new Set(recipientOptions.map((option) => option.id));
    const participantIds: unknown[] = Array.isArray(selectedConversation.participantIds) ? selectedConversation.participantIds : [];
    const normalizedRecipientIds = Array.from(new Set<string>(participantIds.flatMap((id: unknown) => {
      const raw = String(id || '').trim();
      if (!raw) return [];
      if (raw.toLowerCase().startsWith('email:')) return [getRecipientOptionId('email', raw.slice(6))];
      if (raw.toLowerCase().startsWith('user:')) return [getRecipientOptionId('user', raw.slice(5))];
      return [raw, getRecipientOptionId('user', raw)];
    })));
    const recipientIds = optionIds.size > 0
      ? normalizedRecipientIds.filter((id: string) => optionIds.has(id))
      : normalizedRecipientIds;
    return {
      targetType: 'individuals',
      recipientIds,
      targetRole: null
    };
  }

  return buildChatAudienceMetadata({
    selectedConversation,
    selectedConversationId,
    selectedRecipientTarget,
    selectedRecipientIds
  });
}

export function getAudienceSummaryText(metadata: ChatAudienceMetadata, recipientOptions: ChatRecipientOption[] = []) {
  if (metadata.targetType === 'staff') {
    return 'Staff only';
  }
  if (metadata.targetType === 'individuals') {
    const selected = recipientOptions.filter((option) => metadata.recipientIds.includes(option.id));
    if (selected.length === 0) {
      return 'Selected members';
    }
    if (selected.length <= 3) {
      return selected.map(getRecipientOptionLabel).join(', ');
    }
    return `${selected.slice(0, 3).map(getRecipientOptionLabel).join(', ')} +${selected.length - 3} more`;
  }
  return 'Full team';
}

export function isStaffConversation(conversation?: any) {
  const participantRoles = Array.isArray(conversation?.participantRoles) ? conversation.participantRoles : [];
  return participantRoles.some((role: unknown) => String(role || '').trim().toLowerCase() === 'staff');
}

export function hasAllPlaysMention(text: string) {
  return /@all\s*plays/i.test(text || '');
}

export function extractAllPlaysQuestion(text: string) {
  return String(text || '').replace(aiMentionRegex, '').trim();
}

export function getMessageSenderLabel(message: any, currentUserId = '') {
  if (message?.ai === true) return message.aiName || 'ALL PLAYS';
  if (message?.senderId && message.senderId === currentUserId) return 'You';
  return message?.senderName || message?.senderEmail || 'Unknown';
}

export function getMessagePreviewText(message: any) {
  if (!message) return 'No messages yet';
  if (message.deleted === true) return 'Message removed';
  const attachments = getMessageAttachments(message);
  const text = String(message.text || '').trim();
  if (text) return text.replace(/\s+/g, ' ').slice(0, 140);
  if (attachments.length > 1) return `${attachments.length} attachments`;
  if (attachments.length === 1) return attachments[0].type === 'video' ? 'Video' : 'Photo';
  return 'No message text';
}

export function isChatUrlSafe(href: string) {
  if (!href) return false;
  try {
    const url = new URL(href, 'https://allplays.local');
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isChatComposerLinkSafe(href: string) {
  const normalized = String(href || '').trim();
  if (!normalized) return false;
  if (!/^https?:\/\//i.test(normalized)) return false;
  return isChatUrlSafe(normalized);
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeFormattedChatHtml(html: string) {
  const purifier = getDomPurify();
  if (purifier) {
    return purifier.sanitize(html, chatHtmlSanitizeConfig);
  }

  return sanitizeFormattedChatHtmlFallback(html);
}

function sanitizeFormattedChatHtmlFallback(html: string) {
  let safeAnchorDepth = 0;

  return String(html || '').replace(/<\/?([a-z][a-z0-9-]*)(\s[^>]*)?>/gi, (tag, rawTagName, rawAttributes = '') => {
    const tagName = String(rawTagName || '').toLowerCase();
    if (!allowedChatHtmlTags.has(tagName)) return '';
    if (tag.startsWith('</')) {
      if (tagName === 'a') {
        if (safeAnchorDepth < 1) return '';
        safeAnchorDepth -= 1;
      }
      return `</${tagName}>`;
    }
    if (tagName === 'a') {
      const sanitizedAnchorTag = sanitizeChatAnchorTag(rawAttributes);
      if (sanitizedAnchorTag) {
        safeAnchorDepth += 1;
      }
      return sanitizedAnchorTag;
    }
    if (tagName === 'span') {
      return /\bclass=(["'])chat-mention\1/i.test(rawAttributes) ? '<span class="chat-mention">' : '<span>';
    }
    return `<${tagName}>`;
  });
}

function sanitizeChatAnchorTag(rawAttributes: string) {
  const attributes = String(rawAttributes || '');
  const hrefMatch = attributes.match(/^\s*href=(["'])([^"'\s>]+)\1(?:\s+target=(["'])_blank\3)?(?:\s+rel=(["'])noopener noreferrer\4)?\s*$/i);
  const href = hrefMatch ? hrefMatch[2] : '';
  if (!isChatUrlSafe(href)) return '';
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`;
}

export const __chatHtmlTestUtils = {
  sanitizeFormattedChatHtmlFallback
};

export function formatChatMessageHtml(text: string) {
  let formatted = escapeHtml(text || '');

  formatted = formatted.replace(/(^|\n)\s*[-*]\s+(?=\S)/g, '$1&bull; ');
  formatted = formatted.replace(
    /@all\s*plays/gi,
    '<span class="chat-mention">@ALL PLAYS</span>'
  );
  formatted = formatted.replace(urlRegex, (url) => {
    const href = url.startsWith('www.') ? `https://${url}` : url;
    if (!isChatUrlSafe(href)) return url;
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
  });
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');
  formatted = formatted.replace(/~([^~]+)~/g, '<del>$1</del>');

  return sanitizeFormattedChatHtml(formatted);
}

export function getSortedChatMessages(messages: any[] = []) {
  return messages.slice().sort((a, b) => {
    const aTime = toChatDate(a?.createdAt)?.getTime() || 0;
    const bTime = toChatDate(b?.createdAt)?.getTime() || 0;
    return aTime - bTime;
  });
}

export function mergeChatMessageLists(...messageLists: any[][]) {
  const byId = new Map<string, any>();
  messageLists.flat().forEach((message) => {
    const id = String(message?.id || '');
    if (!id) return;
    byId.set(id, message);
  });
  return getSortedChatMessages([...byId.values()]);
}
