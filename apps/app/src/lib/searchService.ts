import { isTeamActive } from '../../../../js/team-visibility.js';
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from '../../../../js/firebase.js';
import { loadParentHomeSummary } from './homeService';
import { searchHelpKnowledge } from './helpKnowledgeService';
import type { AuthState, AuthUser, UserRole } from './types';

const teamsCacheTtlMs = 10 * 60 * 1000;
const playerSearchQueryLimit = 20;
const playerSearchTeamLimit = 8;
const teamSearchQueryLimit = 20;

let cachedTeams: AppSearchTeam[] | null = null;
let cachedTeamsLoadedAt = 0;
let cachedTeamsUserKey = '';
let cachedTeamsPromise: Promise<AppSearchTeam[]> | null = null;
let cachedTeamsPromiseUserKey = '';
const playerSearchCache = new Map<string, PlayerSearchCacheEntry>();

type PlayerSearchCacheEntry = {
  scopeKey: string;
  normalizedQuery: string;
  isNumeric: boolean;
  players?: AppSearchPlayer[];
  sourceDocs?: any[];
  exhaustiveForNarrowerQueries?: boolean;
  promise?: Promise<AppSearchPlayer[]>;
};

export type AppSearchKind = 'action' | 'team' | 'player' | 'social' | 'help';

export type AppSearchItem = {
  id: string;
  kind: AppSearchKind;
  title: string;
  subtitle: string;
  route?: string;
  href?: string;
  roles?: string[];
  snippet?: string;
};

export type AppSearchTeam = {
  id: string;
  name: string;
  sport?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  isPublic?: boolean;
  active?: boolean;
  archived?: boolean;
  status?: string | null;
  ownerId?: string | null;
  adminEmails?: string[];
  photoUrl?: string | null;
  fromAppAccess?: boolean;
  streamAccessMode?: string | null;
  streamVolunteerEmails?: string[];
  teamPermissions?: {
    streaming?: {
      mode?: string | null;
      memberIds?: string[];
    } | null;
  } | null;
};

export type AppSearchPlayer = AppSearchItem & {
  kind: 'player';
  teamId: string;
  playerId: string;
};

export type AppSearchHelp = AppSearchItem & {
  kind: 'help';
  href: string;
  roles: string[];
  snippet: string;
};

export type AppSearchHelpRoleFilter = 'All' | UserRole | 'member' | string;
export type AppSearchHelpRole = UserRole | 'member';

const allSearchHelpRoles: AppSearchHelpRole[] = ['parent', 'coach', 'admin', 'platformAdmin', 'member'];

export function normalizeSearchQuery(queryText: string) {
  return String(queryText || '').trim().toLowerCase();
}

export function splitSearchTokens(queryText: string) {
  const normalized = normalizeSearchQuery(queryText);
  return normalized ? normalized.split(/\s+/g).filter(Boolean) : [];
}

export function scoreSearchText(text: string, tokens: string[]) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) return 0;

  let score = 0;
  for (const token of tokens) {
    const index = haystack.indexOf(token);
    if (index === -1) return -1;
    score += index === 0 ? 50 : 10;
    score += Math.max(0, 20 - index);
  }
  return score;
}

export function buildAppSearchActions(auth: Pick<AuthState, 'user' | 'isAdmin' | 'isPlatformAdmin'>): AppSearchItem[] {
  const actions: AppSearchItem[] = [
    {
      id: 'browse-teams',
      kind: 'action',
      title: 'Browse Teams',
      subtitle: 'Explore public teams on ALL PLAYS',
      route: auth.user ? '/teams/browse' : undefined,
      href: auth.user ? undefined : 'https://allplays.ai/teams.html'
    }
  ];

  if (!auth.user) {
    actions.push(
      {
        id: 'sign-in',
        kind: 'action',
        title: 'Sign In',
        subtitle: 'Log in to your account',
        route: '/auth'
      },
      {
        id: 'get-started',
        kind: 'action',
        title: 'Get Started',
        subtitle: 'Create an account',
        route: '/auth?mode=signup'
      }
    );
    return actions;
  }

  actions.push(
    {
      id: 'dashboard',
      kind: 'action',
      title: 'Dashboard',
      subtitle: 'Go to your ALL PLAYS home',
      route: '/home'
    },
    {
      id: 'my-teams',
      kind: 'action',
      title: 'My Teams',
      subtitle: 'Open your team hubs',
      route: '/teams'
    },
    {
      id: 'schedule',
      kind: 'action',
      title: 'Schedule',
      subtitle: 'Games, practices, availability, rides, and packets',
      route: '/schedule'
    },
    {
      id: 'messages',
      kind: 'action',
      title: 'Messages',
      subtitle: 'Team chat and staff threads',
      route: '/messages'
    },
    {
      id: 'social-feed',
      kind: 'social',
      title: 'Social Feed',
      subtitle: 'Sports moments from teams, players, and friends',
      route: '/home?section=feed'
    },
    {
      id: 'find-friends',
      kind: 'social',
      title: 'Find Friends',
      subtitle: 'Search adult accounts and manage friend requests',
      route: '/home?section=friends'
    },
    {
      id: 'create-social-post',
      kind: 'social',
      title: 'Post Moment',
      subtitle: 'Share a photo, game recap, player stat, or team update',
      route: '/home?section=feed&social=create'
    },
    {
      id: 'profile',
      kind: 'action',
      title: 'Profile',
      subtitle: 'Account settings and notifications',
      route: '/profile'
    }
  );

  if (auth.isAdmin || auth.isPlatformAdmin || auth.user.isAdmin === true) {
    actions.push({
      id: 'admin-dashboard',
      kind: 'action',
      title: 'Admin Dashboard',
      subtitle: 'Platform admin tools on the current website',
      href: 'https://allplays.ai/admin.html'
    });
  }

  return actions;
}

export function getKnownAppSearchTeams(user: AuthUser | null): AppSearchTeam[] {
  const teamsById = new Map<string, AppSearchTeam>();

  (Array.isArray(user?.parentOf) ? user?.parentOf : []).forEach((entry: any) => {
    const teamId = cleanString(entry?.teamId || entry?.id);
    if (!teamId) return;
    const teamName = cleanString(entry?.teamName || entry?.name) || 'Team';
    teamsById.set(teamId, {
      id: teamId,
      name: teamName,
      sport: cleanString(entry?.sport),
      zip: cleanString(entry?.zip),
      city: cleanString(entry?.city),
      state: cleanString(entry?.state),
      active: entry?.active,
      archived: entry?.archived,
      status: cleanString(entry?.status),
      photoUrl: getFirstUrl(entry?.photoUrl, entry?.teamPhotoUrl, entry?.logoUrl, entry?.imageUrl),
      fromAppAccess: true
    });
  });

  return Array.from(teamsById.values()).filter(isTeamActive).sort((a, b) => a.name.localeCompare(b.name));
}

export function computeAppSearchResults({
  queryText,
  auth,
  teams,
  players,
  helpRoleFilter
}: {
  queryText: string;
  auth: Pick<AuthState, 'user' | 'isAdmin' | 'isPlatformAdmin'> & Partial<Pick<AuthState, 'roles' | 'isParent' | 'isCoach'>>;
  teams: AppSearchTeam[];
  players: AppSearchPlayer[];
  helpRoleFilter?: AppSearchHelpRoleFilter;
}) {
  const tokens = splitSearchTokens(queryText);
  const actions = buildAppSearchActions(auth);

  const matchedActions = tokens.length === 0
    ? actions
    : rankSearchItems(actions, tokens);

  const teamItems = teams.map(teamToSearchItem);
  const matchedTeams = tokens.length === 0
    ? teamItems.slice(0, 20)
    : rankSearchItems(teamItems, tokens).slice(0, 20);
  const matchedHelp = buildAppSearchHelpResults(queryText, auth, helpRoleFilter);
  const matchedPlayers = players.slice(0, 20);

  return {
    actions: matchedActions,
    teams: matchedTeams,
    help: matchedHelp,
    players: matchedPlayers,
    flat: [...matchedActions, ...matchedTeams, ...matchedHelp, ...matchedPlayers]
  };
}

export async function loadAppSearchTeams(user: AuthUser | null): Promise<AppSearchTeam[]> {
  const now = Date.now();
  const userCacheKey = getAppSearchUserCacheKey(user);
  if (cachedTeams && cachedTeamsUserKey === userCacheKey && now - cachedTeamsLoadedAt < teamsCacheTtlMs) {
    return cachedTeams;
  }

  if (cachedTeamsPromise && cachedTeamsPromiseUserKey === userCacheKey) {
    return cachedTeamsPromise;
  }

  if (!user) {
    cachedTeams = [];
    cachedTeamsLoadedAt = now;
    cachedTeamsUserKey = userCacheKey;
    return cachedTeams;
  }

  cachedTeamsPromiseUserKey = userCacheKey;
  cachedTeamsPromise = (async () => {
    const [directAccessTeamsResult, homeTeamsResult, streamVolunteerTeamsResult] = await Promise.allSettled([
      loadDirectAccessSearchTeams(user),
      user ? loadParentHomeSummary(user) : Promise.resolve(null),
      user ? loadStreamVolunteerSearchTeams(user) : Promise.resolve([])
    ]);

    const teamsById = new Map<string, AppSearchTeam>();

    if (directAccessTeamsResult.status === 'fulfilled') {
      normalizeTeams(directAccessTeamsResult.value).forEach((team) => {
        if (canUserDiscoverTeamInAppSearch(team, user)) teamsById.set(team.id, team);
      });
    }

    if (homeTeamsResult.status === 'fulfilled' && homeTeamsResult.value) {
      await mergeParentHomeSearchTeams(teamsById, homeTeamsResult.value.teams || [], user);
    }

    if (streamVolunteerTeamsResult.status === 'fulfilled') {
      normalizeTeams(streamVolunteerTeamsResult.value).forEach((team) => {
        if (canUserDiscoverTeamInAppSearch(team, user)) teamsById.set(team.id, team);
      });
    }

    if (!teamsById.size) {
      const firstError = directAccessTeamsResult.status === 'rejected'
        ? directAccessTeamsResult.reason
        : homeTeamsResult.status === 'rejected'
          ? homeTeamsResult.reason
          : streamVolunteerTeamsResult.status === 'rejected'
            ? streamVolunteerTeamsResult.reason
            : null;
      if (firstError) throw firstError;
    }

    cachedTeams = Array.from(teamsById.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    cachedTeamsLoadedAt = Date.now();
    cachedTeamsUserKey = userCacheKey;
    return cachedTeams;
  })();

  try {
    return await cachedTeamsPromise;
  } finally {
    if (cachedTeamsPromiseUserKey === userCacheKey) {
      cachedTeamsPromise = null;
      cachedTeamsPromiseUserKey = '';
    }
  }
}

export async function searchAppTeams(queryText: string, appAccessTeams: AppSearchTeam[], user: AuthUser | null): Promise<AppSearchTeam[]> {
  const rawQuery = String(queryText || '').trim();
  if (rawQuery.length < 2) return appAccessTeams.slice(0, teamSearchQueryLimit);

  const firstToken = splitSearchTokens(rawQuery)[0] || '';
  if (!firstToken) return appAccessTeams.slice(0, teamSearchQueryLimit);

  const prefixes = Array.from(new Set([
    firstToken,
    titleCaseWord(firstToken)
  ].filter(Boolean))).slice(0, 2);

  const publicTeamQueries = prefixes.map((prefix) => getDocs(query(
    collection(db, 'teams'),
    where('isPublic', '==', true),
    orderBy('name'),
    where('name', '>=', prefix),
    where('name', '<=', `${prefix}\uf8ff`),
    limit(teamSearchQueryLimit)
  )));

  const localTeamsById = new Map(appAccessTeams.map((team) => [team.id, team]));
  const snapshots = await Promise.allSettled(publicTeamQueries);
  const rejected = snapshots.filter((snapshot) => snapshot.status === 'rejected').map((snapshot: any) => snapshot.reason).filter(Boolean);
  const hasFulfilled = snapshots.some((snapshot) => snapshot.status === 'fulfilled');

  snapshots.forEach((snapshot: any) => {
    if (snapshot.status !== 'fulfilled') return;
    normalizeTeams((snapshot.value?.docs || []).map((doc: any) => ({ id: doc.id, ...(typeof doc.data === 'function' ? doc.data() || {} : {}) }))).forEach((team) => {
      if (canUserDiscoverTeamInAppSearch(team, user)) {
        localTeamsById.set(team.id, team);
      }
    });
  });

  const rankedTeams = rankTeamsForQuery(Array.from(localTeamsById.values()), rawQuery).slice(0, teamSearchQueryLimit);
  if (rankedTeams.length || hasFulfilled || rejected.length === 0) {
    return rankedTeams;
  }

  throw rejected[0];
}

export async function searchAppPlayers(queryText: string, teamsById: Map<string, AppSearchTeam>, user: AuthUser | null): Promise<AppSearchPlayer[]> {
  const rawQuery = String(queryText || '').trim();
  if (rawQuery.length < 2) return [];

  const normalizedQuery = normalizeSearchQuery(rawQuery);
  const tokens = splitSearchTokens(rawQuery);
  const searchTokens = Array.from(new Set(tokens.slice(0, 2)));
  const prefixes = Array.from(new Set(
    searchTokens.flatMap((token) => [token, titleCaseWord(token)])
  )).filter(Boolean).slice(0, 6);
  const isNumeric = /^[0-9]+$/.test(rawQuery);
  const scopeKey = getPlayerSearchScopeKey(teamsById, user);
  const cacheKey = `${scopeKey}::${normalizedQuery}`;
  const cachedEntry = playerSearchCache.get(cacheKey);

  if (cachedEntry?.players) return cachedEntry.players;
  if (cachedEntry?.promise) return cachedEntry.promise;

  if (!isNumeric) {
    const cachedPrefixEntry = findReusablePlayerSearchCacheEntry(scopeKey, normalizedQuery);
    if (cachedPrefixEntry?.sourceDocs) {
      const players = buildAppSearchPlayersFromDocs(cachedPrefixEntry.sourceDocs, teamsById, user, tokens);
      playerSearchCache.set(cacheKey, {
        scopeKey,
        normalizedQuery,
        isNumeric,
        players,
        sourceDocs: cachedPrefixEntry.sourceDocs,
        exhaustiveForNarrowerQueries: true
      });
      return players;
    }
  }

  const playerSearchPromise = loadPlayerSearchDocs(rawQuery, prefixes, isNumeric, teamsById)
    .then(({ docs, exhaustiveForNarrowerQueries }) => {
      const players = buildAppSearchPlayersFromDocs(docs, teamsById, user, tokens);
      playerSearchCache.set(cacheKey, {
        scopeKey,
        normalizedQuery,
        isNumeric,
        players,
        sourceDocs: docs,
        exhaustiveForNarrowerQueries
      });
      return players;
    })
    .catch((error) => {
      playerSearchCache.delete(cacheKey);
      throw error;
    });

  playerSearchCache.set(cacheKey, {
    scopeKey,
    normalizedQuery,
    isNumeric,
    promise: playerSearchPromise
  });

  return playerSearchPromise;
}

function buildAppSearchHelpResults(
  queryText: string,
  auth: Pick<AuthState, 'user' | 'isAdmin' | 'isPlatformAdmin'> & Partial<Pick<AuthState, 'roles' | 'isParent' | 'isCoach'>>,
  helpRoleFilter: AppSearchHelpRoleFilter = 'all'
): AppSearchHelp[] {
  const normalized = normalizeSearchQuery(queryText);
  if (normalized.length < 2) return [];

  const rawHelpRoleFilter = cleanString(helpRoleFilter);
  const usesDisplayHelpRoleFilter = rawHelpRoleFilter !== '' && rawHelpRoleFilter[0] !== rawHelpRoleFilter[0].toLowerCase();
  const normalizedRoleFilter = normalizeAppSearchHelpRoleFilter(helpRoleFilter);
  const helpSearchRequest = usesDisplayHelpRoleFilter
    ? {
        query: queryText,
        roles: getSearchHelpRoles(auth, helpRoleFilter),
        limit: 5
      }
    : {
        query: queryText,
        roles: getSearchHelpAuthRoles(auth),
        roleFilter: normalizedRoleFilter,
        limit: 5
      };

  return searchHelpKnowledge(helpSearchRequest)
    .filter((result) => normalizedRoleFilter === 'all' || helpResultMatchesRole(result.roles, normalizedRoleFilter))
    .map((result) => ({
      id: `help:${result.id}`,
      kind: 'help' as const,
      title: result.title,
      subtitle: result.snippet || result.summary,
      route: `/help/${encodeURIComponent(result.id)}`,
      href: result.url,
      roles: result.roles,
      snippet: result.snippet
    }));
}


function getSearchHelpAuthRoles(auth: Pick<AuthState, 'user' | 'isAdmin' | 'isPlatformAdmin'> & Partial<Pick<AuthState, 'roles' | 'isParent' | 'isCoach'>>): UserRole[] {
  const roles = new Set<UserRole>();
  (auth.roles || auth.user?.roles || []).forEach((role) => {
    const normalizedRole = normalizeAppSearchHelpRoleFilter(role);
    if (normalizedRole && normalizedRole !== 'all') roles.add(normalizedRole as UserRole);
  });
  if (auth.isAdmin || auth.user?.isAdmin || auth.isPlatformAdmin) roles.add('admin');
  if (auth.isParent) roles.add('parent');
  if (auth.isCoach) roles.add('coach');
  return [...roles];
}

export function getSearchHelpRoles(
  auth: Pick<AuthState, 'user' | 'isAdmin' | 'isPlatformAdmin'> & Partial<Pick<AuthState, 'roles' | 'isParent' | 'isCoach'>>,
  helpRoleFilter?: AppSearchHelpRoleFilter
): AppSearchHelpRole[] {
  const normalizedFilter = normalizeSearchHelpRole(helpRoleFilter);
  if (normalizedFilter === 'all') return allSearchHelpRoles;
  if (normalizedFilter) return [normalizedFilter];

  const roles = new Set<AppSearchHelpRole>();
  (auth.roles || auth.user?.roles || []).forEach((role) => {
    const normalizedRole = normalizeSearchHelpRole(role);
    if (normalizedRole && normalizedRole !== 'all') roles.add(normalizedRole);
  });
  if (auth.isAdmin || auth.user?.isAdmin) roles.add('admin');
  if (auth.isPlatformAdmin) roles.add('platformAdmin');
  if (auth.isParent) roles.add('parent');
  if (auth.isCoach) roles.add('coach');
  return [...roles];
}

function normalizeAppSearchHelpRoleFilter(role: unknown): Exclude<AppSearchHelpRoleFilter, 'platformAdmin'> | '' {
  const normalized = normalizeSearchHelpRole(role);
  return normalized === 'platformAdmin' ? 'admin' : normalized;
}

function normalizeSearchHelpRole(role: unknown): AppSearchHelpRole | 'all' | '' {
  const normalized = cleanString(role).toLowerCase();
  if (!normalized) return '';
  if (normalized === 'all') return 'all';
  if (normalized === 'administrator') return 'admin';
  if (normalized === 'parents') return 'parent';
  if (normalized === 'coaches') return 'coach';
  if (normalized === 'platformadmin' || normalized === 'platform admin') return 'platformAdmin';
  if (normalized === 'parent' || normalized === 'coach' || normalized === 'admin' || normalized === 'member') return normalized;
  return '';
}

function helpResultMatchesRole(resultRoles: string[] = [], helpRoleFilter: Exclude<AppSearchHelpRoleFilter, 'platformAdmin'>) {
  const normalizedRoles = resultRoles.map((role) => cleanString(role).toLowerCase());
  return normalizedRoles.includes('all') || normalizedRoles.includes(helpRoleFilter);
}

export function resetAppSearchCacheForTests() {
  cachedTeams = null;
  cachedTeamsLoadedAt = 0;
  cachedTeamsUserKey = '';
  cachedTeamsPromise = null;
  cachedTeamsPromiseUserKey = '';
  playerSearchCache.clear();
}

async function mergeParentHomeSearchTeams(teamsById: Map<string, AppSearchTeam>, homeTeams: any[], user: AuthUser | null) {
  const fallbackTeams: any[] = [];

  (Array.isArray(homeTeams) ? homeTeams : []).forEach((team: any) => {
    const teamId = cleanString(team?.teamId || team?.id);
    if (!teamId) return;
    if (!isTeamActive(team)) return;

    const existing = teamsById.get(teamId);
    if (existing) {
      teamsById.set(teamId, buildParentHomeSearchTeam(team, existing));
      return;
    }

    fallbackTeams.push({ ...team, teamId });
  });

  if (!fallbackTeams.length) return;

  const snapshots = await Promise.allSettled(
    fallbackTeams.map((team) => getDoc(doc(db, 'teams', team.teamId)))
  );

  snapshots.forEach((snapshot: any, index) => {
    if (snapshot.status !== 'fulfilled') return;
    const teamDoc = snapshot.value;
    if (!teamDoc?.exists?.()) return;

    const homeTeam = fallbackTeams[index];
    const [firestoreTeam] = normalizeTeams([{ id: homeTeam.teamId, ...(typeof teamDoc.data === 'function' ? teamDoc.data() || {} : {}) }]);
    if (!firestoreTeam || !isTeamActive(firestoreTeam)) return;

    const searchTeam = buildParentHomeSearchTeam(homeTeam, firestoreTeam);
    if (canUserDiscoverTeamInAppSearch(searchTeam, user)) {
      teamsById.set(searchTeam.id, searchTeam);
    }
  });
}

async function loadDirectAccessSearchTeams(user: AuthUser): Promise<AppSearchTeam[]> {
  const uid = cleanString(user.uid);
  const email = cleanString(user.email).toLowerCase();
  if (!uid && !email) return [];

  const teamsRef = collection(db, 'teams');
  const directQueries = [];
  if (uid) {
    directQueries.push(getDocs(query(teamsRef, where('ownerId', '==', uid))));
  }
  if (email) {
    directQueries.push(getDocs(query(teamsRef, where('adminEmails', 'array-contains', email))));
  }

  const snapshots = await Promise.allSettled(directQueries);
  const rejected = snapshots.filter((snapshot) => snapshot.status === 'rejected').map((snapshot: any) => snapshot.reason).filter(Boolean);
  const hasFulfilled = snapshots.some((snapshot) => snapshot.status === 'fulfilled');

  if (!hasFulfilled && rejected.length) {
    throw rejected[0];
  }

  const teamsById = new Map<string, any>();
  snapshots.forEach((snapshot: any) => {
    if (snapshot.status !== 'fulfilled') return;
    (snapshot.value?.docs || []).forEach((doc: any) => {
      teamsById.set(doc.id, { id: doc.id, ...(typeof doc.data === 'function' ? doc.data() || {} : {}) });
    });
  });

  return normalizeTeams(Array.from(teamsById.values()));
}

function buildParentHomeSearchTeam(homeTeam: any, baseTeam?: AppSearchTeam): AppSearchTeam {
  const teamId = cleanString(homeTeam?.teamId || homeTeam?.id || baseTeam?.id);
  return {
    ...baseTeam,
    id: teamId,
    name: cleanString(homeTeam?.teamName || homeTeam?.name) || baseTeam?.name || 'Team',
    sport: cleanString(homeTeam?.sport) || baseTeam?.sport || '',
    zip: baseTeam?.zip || '',
    city: baseTeam?.city || '',
    state: baseTeam?.state || '',
    isPublic: baseTeam?.isPublic,
    active: homeTeam?.active ?? baseTeam?.active,
    archived: homeTeam?.archived ?? baseTeam?.archived,
    status: cleanString(homeTeam?.status) || baseTeam?.status,
    ownerId: baseTeam?.ownerId,
    adminEmails: baseTeam?.adminEmails || [],
    photoUrl: getFirstUrl(homeTeam?.photoUrl, baseTeam?.photoUrl),
    fromAppAccess: true,
    streamAccessMode: baseTeam?.streamAccessMode,
    streamVolunteerEmails: baseTeam?.streamVolunteerEmails || [],
    teamPermissions: baseTeam?.teamPermissions || null
  };
}

async function loadStreamVolunteerSearchTeams(user: AuthUser): Promise<AppSearchTeam[]> {
  const uid = cleanString(user.uid);
  const email = cleanString(user.email).toLowerCase();
  if (!uid && !email) return [];

  const teamsRef = collection(db, 'teams');
  const teamQueries = [];
  if (uid) {
    teamQueries.push(getDocs(query(
      teamsRef,
      where('teamPermissions.streaming.memberIds', 'array-contains', uid)
    )));
  }
  if (email) {
    teamQueries.push(getDocs(query(
      teamsRef,
      where('streamVolunteerEmails', 'array-contains', email)
    )));
  }

  const snapshots = await Promise.allSettled(teamQueries);
  const rejected = snapshots.filter((snapshot) => snapshot.status === 'rejected').map((snapshot: any) => snapshot.reason).filter(Boolean);
  const hasFulfilled = snapshots.some((snapshot) => snapshot.status === 'fulfilled');

  if (!hasFulfilled && rejected.length) {
    throw rejected[0];
  }

  const teamsById = new Map<string, any>();
  snapshots.forEach((snapshot: any) => {
    if (snapshot.status !== 'fulfilled') return;
    (snapshot.value?.docs || []).forEach((doc: any) => {
      teamsById.set(doc.id, { id: doc.id, ...(typeof doc.data === 'function' ? doc.data() || {} : {}) });
    });
  });

  return normalizeTeams(Array.from(teamsById.values()));
}

function rankSearchItems<T extends AppSearchItem>(items: T[], tokens: string[]) {
  return items
    .map((item) => ({ item, score: scoreSearchText(`${item.title} ${item.subtitle}`, tokens) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

function rankTeamsForQuery(teams: AppSearchTeam[], queryText: string) {
  const tokens = splitSearchTokens(queryText);
  const itemsById = new Map<string, AppSearchTeam>();
  const rankedItems = rankSearchItems(
    teams.map((team) => {
      itemsById.set(team.id, team);
      return teamToSearchItem(team);
    }),
    tokens
  );
  return rankedItems
    .map((item) => itemsById.get(item.id.replace(/^team:/, '')))
    .filter(Boolean) as AppSearchTeam[];
}

function teamToSearchItem(team: AppSearchTeam): AppSearchItem {
  return {
    id: `team:${team.id}`,
    kind: 'team',
    title: team.name || 'Team',
    subtitle: [team.sport, team.zip || [team.city, team.state].filter(Boolean).join(', ')].filter(Boolean).join(' • '),
    route: `/teams/${encodeURIComponent(team.id)}`
  };
}

function normalizeTeams(teams: any[]): AppSearchTeam[] {
  return (Array.isArray(teams) ? teams : [])
    .map((team) => ({
      id: cleanString(team?.id || team?.teamId),
      name: cleanString(team?.name || team?.teamName) || 'Team',
      sport: cleanString(team?.sport),
      zip: cleanString(team?.zip),
      city: cleanString(team?.city),
      state: cleanString(team?.state),
      isPublic: team?.isPublic,
      active: team?.active,
      archived: team?.archived,
      status: cleanString(team?.status),
      ownerId: cleanString(team?.ownerId),
      adminEmails: Array.isArray(team?.adminEmails) ? team.adminEmails : [],
      photoUrl: getFirstUrl(team?.photoUrl, team?.teamPhotoUrl, team?.logoUrl, team?.imageUrl),
      streamAccessMode: cleanString(team?.streamAccessMode),
      streamVolunteerEmails: Array.isArray(team?.streamVolunteerEmails) ? team.streamVolunteerEmails : [],
      teamPermissions: normalizeSearchTeamPermissions(team?.teamPermissions)
    }))
    .filter((team) => team.id);
}

function canUserDiscoverTeamInAppSearch(team: AppSearchTeam, user: AuthUser | null) {
  if (!team) return false;
  if (!isTeamActive(team)) return false;
  if (team.fromAppAccess) return true;
  if (team.isPublic !== false) return true;
  if (!user) return false;
  if (user.isAdmin === true) return true;
  if (team.ownerId && team.ownerId === user.uid) return true;
  const email = cleanString(user.email).toLowerCase();
  const adminEmails = (team.adminEmails || []).map((entry) => cleanString(entry).toLowerCase()).filter(Boolean);
  if (email && adminEmails.includes(email)) return true;
  if (canUserDiscoverTeamViaSelectedStreaming(team, user, email)) return true;
  return Array.isArray(user.parentOf) && user.parentOf.some((link: any) => cleanString(link?.teamId) === team.id);
}

function canUserDiscoverTeamViaSelectedStreaming(team: AppSearchTeam, user: AuthUser, email: string) {
  const streamingMode = normalizeAccessMode(team.teamPermissions?.streaming?.mode);
  if (streamingMode === 'selected') {
    const memberIds = Array.isArray(team.teamPermissions?.streaming?.memberIds)
      ? team.teamPermissions.streaming.memberIds
      : [];
    if (memberIds.map((entry) => cleanString(entry)).filter(Boolean).includes(cleanString(user.uid))) {
      return true;
    }
  }

  const legacyMode = normalizeAccessMode(team.streamAccessMode);
  if ((legacyMode === 'selected' || legacyMode === 'selected_volunteers') && email) {
    const volunteerEmails = (team.streamVolunteerEmails || [])
      .map((entry) => cleanString(entry).toLowerCase())
      .filter(Boolean);
    return volunteerEmails.includes(email);
  }

  return false;
}

function normalizeSearchTeamPermissions(teamPermissions: any) {
  const streaming = teamPermissions?.streaming;
  if (!streaming || typeof streaming !== 'object') return null;
  return {
    streaming: {
      mode: cleanString(streaming.mode),
      memberIds: Array.isArray(streaming.memberIds) ? streaming.memberIds : []
    }
  };
}

function normalizeAccessMode(value: unknown) {
  return cleanString(value).toLowerCase();
}

function getAppSearchUserCacheKey(user: AuthUser | null) {
  if (!user) return 'signed-out';
  return `${cleanString(user.uid)}:${cleanString(user.email).toLowerCase()}`;
}

function getPlayerSearchScopeKey(teamsById: Map<string, AppSearchTeam>, user: AuthUser | null) {
  return `${getAppSearchUserCacheKey(user)}::${Array.from(teamsById.keys()).sort().join(',')}`;
}

function findReusablePlayerSearchCacheEntry(scopeKey: string, normalizedQuery: string) {
  let bestMatch: PlayerSearchCacheEntry | null = null;

  for (const entry of playerSearchCache.values()) {
    if (entry.scopeKey !== scopeKey || entry.isNumeric || !entry.players || !entry.sourceDocs || !entry.exhaustiveForNarrowerQueries) continue;
    if (!normalizedQuery.startsWith(entry.normalizedQuery) || normalizedQuery === entry.normalizedQuery) continue;
    if (!canReusePlayerSearchPrefixes(entry.normalizedQuery, normalizedQuery)) continue;
    if (!bestMatch || entry.normalizedQuery.length > bestMatch.normalizedQuery.length) {
      bestMatch = entry;
    }
  }

  return bestMatch;
}

function canReusePlayerSearchPrefixes(cachedQuery: string, nextQuery: string) {
  const cachedTokens = splitSearchTokens(cachedQuery).slice(0, 2);
  const nextTokens = splitSearchTokens(nextQuery).slice(0, 2);

  if (!cachedTokens.length || nextTokens.length < cachedTokens.length) return false;
  if (nextTokens.length > cachedTokens.length) return false;

  return cachedTokens.every((token, index) => nextTokens[index]?.startsWith(token));
}

function buildPlayerSearchDocsFromSnapshots(snapshots: any[], nameQueryCount: number, isNumeric: boolean) {
  const rejected = snapshots.filter((snapshot) => snapshot.status === 'rejected').map((snapshot: any) => snapshot.reason).filter(Boolean);
  const hasFulfilled = snapshots.some((snapshot) => snapshot.status === 'fulfilled');

  if (!hasFulfilled && rejected.length) {
    throw rejected[0];
  }

  const byPath = new Map<string, any>();
  snapshots.forEach((snapshot: any) => {
    if (snapshot.status !== 'fulfilled') return;
    (snapshot.value?.docs || []).forEach((doc: any) => {
      byPath.set(doc.ref?.path || doc.id, doc);
    });
  });

  const exhaustiveForNarrowerQueries = !isNumeric
    && rejected.length === 0
    && snapshots.slice(0, nameQueryCount).every((snapshot: any) => snapshot.status === 'fulfilled' && (snapshot.value?.docs || []).length < playerSearchQueryLimit);

  return {
    docs: Array.from(byPath.values()),
    exhaustiveForNarrowerQueries,
    rejected
  };
}

function getPlayerSearchTeamIds(rawQuery: string, teamsById: Map<string, AppSearchTeam>) {
  const searchableTeams = Array.from(teamsById.values()).filter((team) => cleanString(team?.id));
  if (!searchableTeams.length) return [];

  const privateTeams = searchableTeams.filter((team) => team?.isPublic === false);
  const publicTeams = searchableTeams.filter((team) => team?.isPublic !== false);
  const tokens = splitSearchTokens(rawQuery);
  const rankedPublicTeams = tokens.length === 0
    ? publicTeams
    : publicTeams
      .map((team) => ({
        team,
        score: scoreSearchText([team.name, team.sport, team.zip, team.city, team.state].filter(Boolean).join(' '), tokens)
      }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.team);

  return [...privateTeams, ...rankedPublicTeams]
    .slice(0, playerSearchTeamLimit)
    .map((team) => team.id)
    .filter(Boolean);
}

async function loadPlayerSearchDocsByTeam(rawQuery: string, prefixes: string[], isNumeric: boolean, teamsById: Map<string, AppSearchTeam>) {
  const cappedTeamIds = getPlayerSearchTeamIds(rawQuery, teamsById);
  if (cappedTeamIds.length === 0) {
    return { docs: [], exhaustiveForNarrowerQueries: false, rejected: [] };
  }

  const nameQueryCount = prefixes.length * cappedTeamIds.length;
  const snapshots = await Promise.allSettled(cappedTeamIds.flatMap((teamId) => {
    const playersRef = collection(db, `teams/${teamId}/players`);
    const scopedQueries = prefixes.map((prefix) => getDocs(query(
      playersRef,
      orderBy('name'),
      where('name', '>=', prefix),
      where('name', '<=', `${prefix}\uf8ff`),
      limit(playerSearchQueryLimit)
    )));

    if (isNumeric) {
      scopedQueries.push(getDocs(query(
        playersRef,
        orderBy('number'),
        where('number', '>=', rawQuery),
        where('number', '<=', `${rawQuery}\uf8ff`),
        limit(playerSearchQueryLimit)
      )));
    }

    return scopedQueries;
  }));

  return buildPlayerSearchDocsFromSnapshots(snapshots, nameQueryCount, isNumeric);
}

async function loadPlayerSearchDocs(rawQuery: string, prefixes: string[], isNumeric: boolean, teamsById: Map<string, AppSearchTeam> = new Map()) {
  return loadPlayerSearchDocsByTeam(rawQuery, prefixes, isNumeric, teamsById);
}

function buildAppSearchPlayersFromDocs(docs: any[], teamsById: Map<string, AppSearchTeam>, user: AuthUser | null, tokens: string[]) {
  return docs
    .flatMap((doc) => {
      const data = typeof doc.data === 'function' ? doc.data() || {} : {};
      const { teamId, playerId } = parseTeamAndPlayerIdFromPath(doc.ref?.path || '');
      if (!teamId || !playerId) return [];
      if (!canUserDiscoverPlayerInAppSearch(teamId, teamsById, user)) return [];

      const team = teamsById.get(teamId);
      const name = cleanString(data.name || data.playerName) || 'Player';
      const number = cleanString(data.number);
      return [{
        id: `player:${teamId}:${playerId}`,
        kind: 'player' as const,
        title: `${number ? `#${number} ` : ''}${name}`,
        subtitle: team?.name || teamId,
        route: `/players/${encodeURIComponent(teamId)}/${encodeURIComponent(playerId)}`,
        teamId,
        playerId
      }];
    })
    .map((item) => ({ item, score: scoreSearchText(item.title, tokens) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => (b.score - a.score) || (a.item.title.length - b.item.title.length))
    .slice(0, 20)
    .map((entry) => entry.item);
}

function canUserDiscoverPlayerInAppSearch(teamId: string, teamsById: Map<string, AppSearchTeam>, user: AuthUser | null) {
  const team = teamsById.get(teamId);
  return team ? canUserDiscoverTeamInAppSearch(team, user) : false;
}

function parseTeamAndPlayerIdFromPath(path: string) {
  const parts = String(path || '').split('/');
  const teamIndex = parts.indexOf('teams');
  const playerIndex = parts.indexOf('players');
  if (teamIndex === -1 || playerIndex === -1) return { teamId: '', playerId: '' };
  return {
    teamId: parts[teamIndex + 1] || '',
    playerId: parts[playerIndex + 1] || ''
  };
}

function titleCaseWord(value: string) {
  const str = cleanString(value).toLowerCase();
  return str ? str[0].toUpperCase() + str.slice(1) : '';
}

function cleanString(value: unknown) {
  return String(value || '').trim();
}

function getFirstUrl(...values: unknown[]) {
  for (const value of values) {
    const url = cleanString(value);
    if (/^https?:\/\//i.test(url)) return url;
  }
  return null;
}
