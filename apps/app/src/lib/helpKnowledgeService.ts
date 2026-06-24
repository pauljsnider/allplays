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
  normalizedTitle: string;
  normalizedSummary: string;
  normalizedFile: string;
  normalizedText: string;
  snippetSentences: string[];
};

type HelpKnowledgeQueryCacheEntry = {
  key: string;
  results: HelpKnowledgeResult[];
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
const helpSearchQueryCacheMaxEntries = 40;

let helpDocsCache: HelpKnowledgeDoc[] | null = null;
const helpSearchQueryCache = new Map<string, HelpKnowledgeQueryCacheEntry>();
const helpKnowledgeDebugState = {
  queryCacheHits: 0,
  snippetBuilds: 0,
  sentenceSplits: 0
};

export function getSearchHelpRoles(helpRoleFilter?: unknown): string[] {
  const role = normalizeRoles([helpRoleFilter]).find((normalizedRole) => searchableHelpRoles.includes(normalizedRole));
  if (!role) return [...searchableHelpRoles];
  return [role];
}

export function getHelpKnowledgeDocs(): HelpKnowledgeDoc[] {
  if (helpDocsCache) return helpDocsCache;

  helpDocsCache = helpKnowledgeIndex
    .map((doc) => buildHelpKnowledgeDoc(doc))
    .sort((a, b) => a.title.localeCompare(b.title));

  return helpDocsCache;
}

export function searchHelpKnowledge({
  query,
  roles = [],
  roleFilter,
  limit = 5
}: {
  query: string;
  roles?: string[];
  roleFilter?: HelpKnowledgeRoleFilter;
  limit?: number;
}): HelpKnowledgeResult[] {
  const docs = getHelpKnowledgeDocs();
  const cleanQuery = compactText(query);
  const queryTokens = tokenize(cleanQuery);
  const normalizedQuery = cleanQuery.toLowerCase();
  const roleTokens = normalizeRoles(roles);
  const [normalizedRoleFilter] = normalizeRoles([roleFilter]);
  const hasExplicitQuery = normalizedQuery.length > 0;
  const maxResults = Math.min(Math.max(Number(limit) || 5, 1), Math.max(docs.length, 1));
  const cacheKey = JSON.stringify({
    query: normalizedQuery,
    roles: roleTokens,
    roleFilter: normalizedRoleFilter || '',
    limit: maxResults
  });
  const cachedResults = helpSearchQueryCache.get(cacheKey);
  if (cachedResults) {
    helpKnowledgeDebugState.queryCacheHits += 1;
    return cachedResults.results;
  }

  const scoredResults = docs
    .filter((doc) => normalizedRoleFilter
      ? roleFilterMatches(doc.roles, normalizedRoleFilter)
      : (!roleTokens.length || roleMatches(doc.roles, roleTokens)))
    .map((doc) => ({
      doc,
      score: scoreHelpDoc(doc, normalizedQuery, queryTokens, roleTokens)
    }))
    .filter((result) => result.score > 0 || !hasExplicitQuery)
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
    .slice(0, maxResults)
    .map(({ doc, score }) => ({
      id: doc.id,
      title: doc.title,
      file: doc.file,
      url: doc.url,
      roles: doc.roles,
      summary: doc.summary,
      snippet: buildSnippet(doc, queryTokens),
      score
    }));

  setHelpSearchQueryCache(cacheKey, scoredResults);
  return scoredResults;
}

function buildHelpKnowledgeDoc(doc: HelpKnowledgeIndexDoc): HelpKnowledgeDoc {
  const normalizedText = compactText(doc.text);
  return {
    ...doc,
    url: new URL(doc.file, allPlaysOrigin).toString(),
    roles: normalizeRoles(doc.roles),
    normalizedTitle: doc.title.toLowerCase(),
    normalizedSummary: doc.summary.toLowerCase(),
    normalizedFile: doc.file.toLowerCase(),
    normalizedText: normalizedText.toLowerCase(),
    snippetSentences: splitSnippetSentences(normalizedText)
  };
}

function scoreHelpDoc(doc: HelpKnowledgeDoc, query: string, tokens: string[], roles: string[]) {
  if (!tokens.length) {
    if (query) return 0;
    return roleMatches(doc.roles, roles) ? 2 : 1;
  }

  const title = doc.normalizedTitle;
  const summary = doc.normalizedSummary;
  const file = doc.normalizedFile;
  const text = doc.normalizedText;
  let score = 0;
  let hasQueryMatch = false;
  const phrase = query.toLowerCase();

  if (phrase.length > 8) {
    if (title.includes(phrase)) {
      score += 28;
      hasQueryMatch = true;
    }
    if (summary.includes(phrase)) {
      score += 18;
      hasQueryMatch = true;
    }
    if (text.includes(phrase)) {
      score += 10;
      hasQueryMatch = true;
    }
  }

  tokens.forEach((token) => {
    if (title.includes(token)) {
      score += 9;
      hasQueryMatch = true;
    }
    if (summary.includes(token)) {
      score += 5;
      hasQueryMatch = true;
    }
    if (file.includes(token)) {
      score += 4;
      hasQueryMatch = true;
    }
    if (text.includes(token)) {
      score += Math.min(countOccurrences(text, token), 6);
      hasQueryMatch = true;
    }
  });

  if (!hasQueryMatch) return 0;
  if (roleMatches(doc.roles, roles)) score += 2;

  return score;
}

function buildSnippet(doc: HelpKnowledgeDoc, tokens: string[]) {
  const text = compactText(doc.text);
  if (!text) return doc.summary;

  helpKnowledgeDebugState.snippetBuilds += 1;
  const lowerTokens = tokens.map((token) => token.toLowerCase());
  const match = doc.snippetSentences.find((sentence) => lowerTokens.some((token) => sentence.toLowerCase().includes(token)))
    || doc.snippetSentences[0]
    || text;

  return match.length > 420 ? `${match.slice(0, 417).trim()}...` : match;
}

function splitSnippetSentences(text: string) {
  helpKnowledgeDebugState.sentenceSplits += 1;
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => compactText(sentence))
    .filter((sentence) => sentence.length > 40);
}

function setHelpSearchQueryCache(key: string, results: HelpKnowledgeResult[]) {
  helpSearchQueryCache.set(key, { key, results });
  if (helpSearchQueryCache.size <= helpSearchQueryCacheMaxEntries) return;

  const oldestKey = helpSearchQueryCache.keys().next().value;
  if (oldestKey) {
    helpSearchQueryCache.delete(oldestKey);
  }
}

function normalizeRoles(roles: unknown[]) {
  const normalized = roles
    .map((role) => compactText(role).toLowerCase())
    .flatMap((role) => role === 'platformadmin' || role === 'platform admin' ? ['platformadmin', 'admin'] : [role])
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

export function resetHelpKnowledgeCachesForTests() {
  helpDocsCache = null;
  helpSearchQueryCache.clear();
  helpKnowledgeDebugState.queryCacheHits = 0;
  helpKnowledgeDebugState.snippetBuilds = 0;
  helpKnowledgeDebugState.sentenceSplits = 0;
}

export function getHelpKnowledgeDebugStateForTests() {
  return { ...helpKnowledgeDebugState };
}
