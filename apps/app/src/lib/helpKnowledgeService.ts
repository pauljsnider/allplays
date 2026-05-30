import { helpKnowledgeIndex, type HelpKnowledgeIndexDoc } from './helpKnowledgeIndex';

export type HelpKnowledgeResult = {
  id: string;
  title: string;
  file: string;
  url: string;
  roles: string[];
  summary: string;
  snippet: string;
  score: number;
};

export type HelpKnowledgeRoleFilter = string;

type HelpKnowledgeDoc = HelpKnowledgeIndexDoc & {
  id: string;
  title: string;
  file: string;
  url: string;
  roles: string[];
  summary: string;
  text: string;
};

const searchableHelpRoles = ['admin', 'coach', 'member', 'parent'];
const allPlaysOrigin = 'https://allplays.ai/';
const stopWords = new Set([
  'about',
  'after',
  'again',
  'all',
  'and',
  'are',
  'can',
  'does',
  'for',
  'from',
  'get',
  'have',
  'how',
  'into',
  'need',
  'our',
  'the',
  'this',
  'that',
  'to',
  'use',
  'what',
  'when',
  'where',
  'with',
  'you',
  'your'
]);

let helpDocsCache: HelpKnowledgeDoc[] | null = null;

export function getSearchHelpRoles(helpRoleFilter?: unknown): string[] {
  const [role] = normalizeRoles([helpRoleFilter]);
  if (!role || role === 'all') return [...searchableHelpRoles];
  return searchableHelpRoles.includes(role) ? [role] : [...searchableHelpRoles];
}

export function getHelpKnowledgeDocs(): HelpKnowledgeDoc[] {
  if (helpDocsCache) return helpDocsCache;

  helpDocsCache = helpKnowledgeIndex
    .map((doc) => ({
      ...doc,
      url: new URL(doc.file, allPlaysOrigin).toString(),
      roles: normalizeRoles(doc.roles)
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return helpDocsCache;
}

export function searchHelpKnowledge({
  query,
  roles = [],
  roleFilter = 'all',
  limit = 5
}: {
  query: string;
  roles?: string[];
  roleFilter?: HelpKnowledgeRoleFilter;
  limit?: number;
}): HelpKnowledgeResult[] {
  const cleanQuery = compactText(query);
  const queryTokens = tokenize(cleanQuery);
  const roleTokens = normalizeRoles(roles);
  const [normalizedRoleFilter] = normalizeRoles([roleFilter]);
  const maxResults = Math.min(Math.max(Number(limit) || 5, 1), 8);

  return getHelpKnowledgeDocs()
    .filter((doc) => roleFilterMatches(doc.roles, normalizedRoleFilter))
    .map((doc) => {
      const score = scoreHelpDoc(doc, cleanQuery, queryTokens, roleTokens);
      return {
        id: doc.id,
        title: doc.title,
        file: doc.file,
        url: doc.url,
        roles: doc.roles,
        summary: doc.summary,
        snippet: buildSnippet(doc, queryTokens),
        score
      };
    })
    .filter((result) => result.score > 0 || !queryTokens.length)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, maxResults);
}

function scoreHelpDoc(doc: HelpKnowledgeDoc, query: string, tokens: string[], roles: string[]) {
  if (!tokens.length) {
    return roleMatches(doc.roles, roles) ? 2 : 1;
  }

  const title = doc.title.toLowerCase();
  const summary = doc.summary.toLowerCase();
  const file = doc.file.toLowerCase();
  const text = doc.text.toLowerCase();
  let score = roleMatches(doc.roles, roles) ? 2 : 0;
  const phrase = query.toLowerCase();

  if (phrase.length > 8) {
    if (title.includes(phrase)) score += 28;
    if (summary.includes(phrase)) score += 18;
    if (text.includes(phrase)) score += 10;
  }

  tokens.forEach((token) => {
    if (title.includes(token)) score += 9;
    if (summary.includes(token)) score += 5;
    if (file.includes(token)) score += 4;
    if (text.includes(token)) score += Math.min(countOccurrences(text, token), 6);
  });

  return score;
}

function buildSnippet(doc: HelpKnowledgeDoc, tokens: string[]) {
  const text = compactText(doc.text);
  if (!text) return doc.summary;

  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => compactText(sentence))
    .filter((sentence) => sentence.length > 40);
  const lowerTokens = tokens.map((token) => token.toLowerCase());
  const match = sentences.find((sentence) => lowerTokens.some((token) => sentence.toLowerCase().includes(token)))
    || sentences[0]
    || text;

  return match.length > 420 ? `${match.slice(0, 417).trim()}...` : match;
}

function normalizeRoles(roles: unknown[]) {
  const normalized = roles
    .map((role) => compactText(role).toLowerCase())
    .map((role) => role === 'administrator' || role === 'admins' || role === 'administrators' ? 'admin' : role)
    .map((role) => role === 'parents' ? 'parent' : role)
    .map((role) => role === 'coaches' ? 'coach' : role)
    .filter(Boolean);
  return [...new Set(normalized)];
}

function roleMatches(docRoles: string[], userRoles: string[]) {
  if (!userRoles.length) return false;
  const roles = docRoles.map((role) => role.toLowerCase());
  return roles.includes('all') || userRoles.some((role) => roles.includes(role));
}

function roleFilterMatches(docRoles: string[], roleFilter: string | undefined) {
  if (!roleFilter || roleFilter === 'all') return true;
  const roles = docRoles.map((role) => role.toLowerCase());
  return roles.includes('all') || roles.includes(roleFilter);
}

function tokenize(value: string) {
  return [...new Set(compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token)))];
}

function countOccurrences(value: string, token: string) {
  let count = 0;
  let index = value.indexOf(token);
  while (index !== -1 && count < 20) {
    count += 1;
    index = value.indexOf(token, index + token.length);
  }
  return count;
}

function compactText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
