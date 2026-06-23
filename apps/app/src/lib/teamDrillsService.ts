import { addDrillFavorite, DRILL_LEVELS, DRILL_TYPES, getDrill, getDrillFavorites, getDrills, getPublishedDrills, getTeam, hasFullTeamAccess, removeDrillFavorite } from './adapters/legacyTeamDrills';
import type { AuthUser } from './types';

export { buildPracticeAiCoachPrompt } from './practiceAiCoachService';
export type { PracticeAiCoachPrompt, PracticeAiCoachPromptInput } from './practiceAiCoachService';

const drillLibraryPageSize = 12;

export type TeamDrillSummary = {
  id: string;
  title: string;
  sport: string;
  type: string;
  level: string;
  ageGroup: string;
  skills: string[];
  description: string;
  instructions: string;
  youtubeUrl: string;
  diagramUrls: string[];
  attribution: {
    source: string;
    license: string;
    url: string;
  } | null;
  setup: {
    duration: number;
    players: string;
    cones: number;
    balls: string;
    area: string;
    pinnies: string;
  };
};

export type TeamDrillsFilters = {
  searchText?: string;
  type?: string;
  level?: string;
};

export type TeamDrillsLibraryPage = {
  team: {
    id: string;
    name: string;
    sport: string;
  };
  canManageDrills: boolean;
  drills: TeamDrillSummary[];
  favoriteIds: string[];
  nextCursor: unknown | null;
  filters: {
    searchText: string;
    type: string;
    level: string;
  };
};

export type TeamFavoriteDrillsModel = {
  team: {
    id: string;
    name: string;
    sport: string;
  };
  canManageDrills: boolean;
  favoriteIds: string[];
  drills: TeamDrillSummary[];
};

type TeamDrillLibraryCursor = {
  communityCursor: unknown | null;
  pendingDrills: any[];
};

function normalizeString(value: unknown) {
  return String(value || '').trim();
}

function normalizeWholeNumber(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeSkills(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(new Set(raw.map((skill) => String(skill || '').trim()).filter(Boolean)));
}

function normalizeFilterValue(value: unknown, allowedValues: string[]) {
  const normalized = normalizeString(value);
  return allowedValues.includes(normalized) ? normalized : '';
}

function normalizeSearchText(value: unknown) {
  return normalizeString(value).toLowerCase();
}

function normalizeLibraryCursor(cursor: unknown): TeamDrillLibraryCursor {
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
    return {
      communityCursor: cursor || null,
      pendingDrills: []
    };
  }

  if (!Object.prototype.hasOwnProperty.call(cursor, 'communityCursor') && !Object.prototype.hasOwnProperty.call(cursor, 'pendingDrills')) {
    return {
      communityCursor: cursor,
      pendingDrills: []
    };
  }

  const candidate = cursor as { communityCursor?: unknown; pendingDrills?: unknown };
  return {
    communityCursor: candidate.communityCursor || null,
    pendingDrills: Array.isArray(candidate.pendingDrills) ? candidate.pendingDrills : []
  };
}

function createNextCursor(communityCursor: unknown, pendingDrills: any[]) {
  if (!communityCursor && !pendingDrills.length) return null;
  return {
    communityCursor: communityCursor || null,
    pendingDrills
  };
}

async function loadTeamAccess(teamId: string, user: AuthUser | null) {
  if (!teamId) throw new Error('Missing team context.');

  const team = await Promise.resolve(getTeam(teamId));
  if (!team?.id) throw new Error('Team not found.');

  return {
    team: {
      id: team.id,
      name: normalizeString(team.name) || 'Team',
      sport: normalizeString(team.sport) || 'Soccer'
    },
    canManageDrills: hasFullTeamAccess(user, team)
  };
}

export function filterDrillSummaries(drills: TeamDrillSummary[], filters: TeamDrillsFilters = {}) {
  const searchText = normalizeSearchText(filters.searchText);
  const type = normalizeFilterValue(filters.type, DRILL_TYPES as string[]);
  const level = normalizeFilterValue(filters.level, DRILL_LEVELS as string[]);

  return (Array.isArray(drills) ? drills : []).filter((drill) => {
    if (type && drill.type !== type) return false;
    if (level && drill.level !== level) return false;
    if (!searchText) return true;

    return drill.title.toLowerCase().includes(searchText)
      || drill.description.toLowerCase().includes(searchText)
      || drill.instructions.toLowerCase().includes(searchText)
      || drill.skills.some((skill) => skill.toLowerCase().includes(searchText));
  });
}

export async function loadTeamDrillLibraryPage(
  teamId: string,
  user: AuthUser | null,
  filters: TeamDrillsFilters & { cursor?: unknown | null } = {}
): Promise<TeamDrillsLibraryPage> {
  const access = await loadTeamAccess(teamId, user);

  if (!access.canManageDrills) {
    return {
      ...access,
      drills: [],
      favoriteIds: [],
      nextCursor: null,
      filters: {
        searchText: normalizeString(filters.searchText),
        type: normalizeFilterValue(filters.type, DRILL_TYPES as string[]),
        level: normalizeFilterValue(filters.level, DRILL_LEVELS as string[])
      }
    };
  }

  const normalizedFilters = {
    searchText: normalizeString(filters.searchText),
    type: normalizeFilterValue(filters.type, DRILL_TYPES as string[]),
    level: normalizeFilterValue(filters.level, DRILL_LEVELS as string[])
  };
  const cursorState = normalizeLibraryCursor(filters.cursor);
  const isPaginatedRequest = Boolean(filters.cursor);
  const shouldLoadCommunityPage = !isPaginatedRequest || Boolean(cursorState.communityCursor) || !cursorState.pendingDrills.length;

  const [favoriteIds, page, publishedDrills] = await Promise.all([
    Promise.resolve(getDrillFavorites(teamId)),
    shouldLoadCommunityPage
      ? Promise.resolve(getDrills({
        sport: access.team.sport,
        type: normalizedFilters.type || undefined,
        level: normalizedFilters.level || undefined,
        searchText: normalizedFilters.searchText || undefined,
        limitCount: drillLibraryPageSize,
        startAfterDoc: cursorState.communityCursor
      }))
      : Promise.resolve({ drills: [], lastDoc: null }),
    isPaginatedRequest
      ? Promise.resolve([])
      : Promise.resolve(getPublishedDrills({
        sport: access.team.sport,
        type: normalizedFilters.type || undefined,
        level: normalizedFilters.level || undefined,
        searchText: normalizedFilters.searchText || undefined,
        limitCount: drillLibraryPageSize
      }))
  ]);

  const mergedDrills = [
    ...(Array.isArray(cursorState.pendingDrills) ? cursorState.pendingDrills : []),
    ...(Array.isArray(page?.drills) ? page.drills : []),
    ...(Array.isArray(publishedDrills) ? publishedDrills : [])
  ];
  const uniqueDrills = Array.from(new Map(mergedDrills.map((drill) => [normalizeString(drill?.id), drill])).entries())
    .filter(([id]) => Boolean(id))
    .map(([, drill]) => drill)
    .sort((left, right) => normalizeString(left?.title).localeCompare(normalizeString(right?.title)));
  const visibleDrills = uniqueDrills.slice(0, drillLibraryPageSize);
  const pendingDrills = uniqueDrills.slice(drillLibraryPageSize);

  return {
    ...access,
    drills: visibleDrills.map(toTeamDrillSummary),
    favoriteIds: Array.isArray(favoriteIds) ? favoriteIds.map((id) => normalizeString(id)).filter(Boolean) : [],
    nextCursor: createNextCursor(page?.lastDoc || null, pendingDrills),
    filters: normalizedFilters
  };
}

export async function loadFavoriteDrills(teamId: string, user: AuthUser | null): Promise<TeamFavoriteDrillsModel> {
  const access = await loadTeamAccess(teamId, user);

  if (!access.canManageDrills) {
    return {
      ...access,
      favoriteIds: [],
      drills: []
    };
  }

  const favoriteIds = await Promise.resolve(getDrillFavorites(teamId));
  const favoriteDrills = await Promise.all((Array.isArray(favoriteIds) ? favoriteIds : []).map((drillId) => Promise.resolve(getDrill(drillId))));

  const drills = favoriteDrills
    .filter((drill) => drill && normalizeString(drill.sport) === access.team.sport)
    .map((drill) => toTeamDrillSummary(drill))
    .sort((left, right) => left.title.localeCompare(right.title));

  return {
    ...access,
    favoriteIds: Array.isArray(favoriteIds) ? favoriteIds.map((id) => normalizeString(id)).filter(Boolean) : [],
    drills
  };
}

export async function setTeamDrillFavorite(teamId: string, user: AuthUser | null, drillId: string, shouldFavorite: boolean) {
  const access = await loadTeamAccess(teamId, user);
  if (!access.canManageDrills) throw new Error('You do not have access to manage drill favorites.');

  const normalizedDrillId = normalizeString(drillId);
  if (!normalizedDrillId) throw new Error('Missing drill context.');

  if (shouldFavorite) {
    await Promise.resolve(addDrillFavorite(teamId, normalizedDrillId));
    return;
  }

  await Promise.resolve(removeDrillFavorite(teamId, normalizedDrillId));
}

function toTeamDrillSummary(drill: any): TeamDrillSummary {
  return {
    id: normalizeString(drill?.id),
    title: normalizeString(drill?.title) || 'Untitled drill',
    sport: normalizeString(drill?.sport) || 'Soccer',
    type: normalizeString(drill?.type) || 'Technical',
    level: normalizeString(drill?.level) || 'All',
    ageGroup: normalizeString(drill?.ageGroup) || 'All',
    skills: normalizeSkills(drill?.skills),
    description: normalizeString(drill?.description),
    instructions: normalizeString(drill?.instructions),
    youtubeUrl: normalizeString(drill?.youtubeUrl),
    diagramUrls: Array.isArray(drill?.diagramUrls) ? drill.diagramUrls.filter(Boolean).map((url: unknown) => String(url)) : [],
    attribution: drill?.attribution ? {
      source: normalizeString(drill.attribution.source),
      license: normalizeString(drill.attribution.license),
      url: normalizeString(drill.attribution.url)
    } : null,
    setup: {
      duration: Math.max(1, normalizeWholeNumber(drill?.setup?.duration, 10)),
      players: normalizeString(drill?.setup?.players),
      cones: Math.max(0, normalizeWholeNumber(drill?.setup?.cones, 0)),
      balls: normalizeString(drill?.setup?.balls),
      area: normalizeString(drill?.setup?.area),
      pinnies: normalizeString(drill?.setup?.pinnies)
    }
  };
}
