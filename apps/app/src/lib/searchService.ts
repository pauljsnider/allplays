import { getTeams } from '../../../../js/db.js';
import {
  db,
  collectionGroup,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from '../../../../js/firebase.js';
import { loadParentHome } from './homeService';
import type { AuthState, AuthUser } from './types';

const teamsCacheTtlMs = 10 * 60 * 1000;

let cachedTeams: AppSearchTeam[] | null = null;
let cachedTeamsLoadedAt = 0;

export type AppSearchKind = 'action' | 'team' | 'player' | 'social';

export type AppSearchItem = {
  id: string;
  kind: AppSearchKind;
  title: string;
  subtitle: string;
  route?: string;
  href?: string;
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
  ownerId?: string | null;
  adminEmails?: string[];
  photoUrl?: string | null;
  fromAppAccess?: boolean;
};

export type AppSearchPlayer = AppSearchItem & {
  kind: 'player';
  teamId: string;
  playerId: string;
};

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
      href: 'https://allplays.ai/teams.html'
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

export function computeAppSearchResults({
  queryText,
  auth,
  teams,
  players
}: {
  queryText: string;
  auth: Pick<AuthState, 'user' | 'isAdmin' | 'isPlatformAdmin'>;
  teams: AppSearchTeam[];
  players: AppSearchPlayer[];
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

  return {
    actions: matchedActions,
    teams: matchedTeams,
    players: players.slice(0, 20),
    flat: [...matchedActions, ...matchedTeams, ...players.slice(0, 20)]
  };
}

export async function loadAppSearchTeams(user: AuthUser | null): Promise<AppSearchTeam[]> {
  const now = Date.now();
  if (cachedTeams && now - cachedTeamsLoadedAt < teamsCacheTtlMs) {
    return cachedTeams;
  }

  const [siteTeamsResult, homeTeamsResult] = await Promise.allSettled([
    Promise.resolve(getTeams()),
    user ? loadParentHome(user) : Promise.resolve(null)
  ]);

  const teamsById = new Map<string, AppSearchTeam>();

  if (siteTeamsResult.status === 'fulfilled') {
    normalizeTeams(siteTeamsResult.value).forEach((team) => {
      if (canUserDiscoverTeamInAppSearch(team, user)) teamsById.set(team.id, team);
    });
  }

  if (homeTeamsResult.status === 'fulfilled' && homeTeamsResult.value) {
    (homeTeamsResult.value.teams || []).forEach((team: any) => {
      if (!team?.teamId) return;
      if (team.active === false) return;
      const existing = teamsById.get(team.teamId);
      teamsById.set(team.teamId, {
        ...existing,
        id: team.teamId,
        name: team.teamName || existing?.name || 'Team',
        sport: team.sport || existing?.sport || '',
        zip: existing?.zip || '',
        city: existing?.city || '',
        state: existing?.state || '',
        isPublic: existing?.isPublic,
        active: team.active ?? existing?.active,
        ownerId: existing?.ownerId,
        adminEmails: existing?.adminEmails || [],
        photoUrl: team.photoUrl || existing?.photoUrl || null,
        fromAppAccess: true
      });
    });
  }

  if (!teamsById.size) {
    const firstError = siteTeamsResult.status === 'rejected'
      ? siteTeamsResult.reason
      : homeTeamsResult.status === 'rejected'
        ? homeTeamsResult.reason
        : null;
    if (firstError) throw firstError;
  }

  cachedTeams = Array.from(teamsById.values())
    .sort((a, b) => a.name.localeCompare(b.name));
  cachedTeamsLoadedAt = now;
  return cachedTeams;
}

export async function searchAppPlayers(queryText: string, teamsById: Map<string, AppSearchTeam>, user: AuthUser | null): Promise<AppSearchPlayer[]> {
  const rawQuery = String(queryText || '').trim();
  if (rawQuery.length < 2) return [];

  const tokens = splitSearchTokens(rawQuery);
  const searchTokens = Array.from(new Set(tokens.slice(0, 2)));
  const prefixes = Array.from(new Set(
    searchTokens.flatMap((token) => [token, token.toLowerCase(), titleCaseWord(token)])
  )).filter(Boolean).slice(0, 6);
  const isNumeric = /^[0-9]+$/.test(rawQuery);

  const playersRef = collectionGroup(db, 'players');
  const playerQueries = prefixes.map((prefix) => getDocs(query(
    playersRef,
    orderBy('name'),
    where('name', '>=', prefix),
    where('name', '<=', `${prefix}\uf8ff`),
    limit(20)
  )));

  if (isNumeric) {
    playerQueries.push(getDocs(query(
      playersRef,
      orderBy('number'),
      where('number', '>=', rawQuery),
      where('number', '<=', `${rawQuery}\uf8ff`),
      limit(20)
    )));
  }

  const snapshots = await Promise.allSettled(playerQueries);
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

  return Array.from(byPath.values())
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

export function resetAppSearchCacheForTests() {
  cachedTeams = null;
  cachedTeamsLoadedAt = 0;
}

function rankSearchItems<T extends AppSearchItem>(items: T[], tokens: string[]) {
  return items
    .map((item) => ({ item, score: scoreSearchText(`${item.title} ${item.subtitle}`, tokens) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
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
      ownerId: cleanString(team?.ownerId),
      adminEmails: Array.isArray(team?.adminEmails) ? team.adminEmails : [],
      photoUrl: getFirstUrl(team?.photoUrl, team?.teamPhotoUrl, team?.logoUrl, team?.imageUrl)
    }))
    .filter((team) => team.id);
}

function canUserDiscoverTeamInAppSearch(team: AppSearchTeam, user: AuthUser | null) {
  if (!team) return false;
  if (team.active === false) return false;
  if (team.fromAppAccess) return true;
  if (team.isPublic !== false) return true;
  if (!user) return false;
  if (user.isAdmin === true) return true;
  if (team.ownerId && team.ownerId === user.uid) return true;
  const email = cleanString(user.email).toLowerCase();
  const adminEmails = (team.adminEmails || []).map((entry) => cleanString(entry).toLowerCase()).filter(Boolean);
  if (email && adminEmails.includes(email)) return true;
  return Array.isArray(user.parentOf) && user.parentOf.some((link: any) => cleanString(link?.teamId) === team.id);
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
