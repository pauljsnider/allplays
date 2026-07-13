import {
  createConfig,
  createTeam,
  getDefaultStatConfigForSport,
  getStatConfigPresetOptions
} from './adapters/legacyTeamCreation';
import { clearAppDataCache, getTeamsSummaryBootstrapCacheKey } from './appDataCache';
import type { AuthUser } from './types';

export type CreateTeamForAppInput = {
  name: string;
  sport: string;
  zip?: string;
  isPublic?: boolean;
};

export type CreateTeamForAppResult = {
  teamId: string;
  defaultStatConfigCreated: boolean;
  defaultStatConfigError: string | null;
};

const fallbackSportOptions = ['Basketball', 'Soccer', 'Baseball', 'Softball', 'Football', 'Volleyball'];

export function getCreateTeamSportOptions() {
  const presetSports = getStatConfigPresetOptions()
    .map((option) => cleanString((option as { baseType?: unknown })?.baseType))
    .filter((sport) => sport && sport.toLowerCase() !== 'custom');
  const options = presetSports.length ? presetSports : fallbackSportOptions;
  return [...new Set(options)];
}

export async function createTeamForApp(user: AuthUser | null, input: CreateTeamForAppInput): Promise<CreateTeamForAppResult> {
  if (!user?.uid) {
    throw new Error('Sign in to create a team.');
  }

  const name = cleanString(input?.name);
  if (!name) throw new Error('Team name is required.');

  const sport = cleanString(input?.sport);
  if (!sport) throw new Error('Sport is required.');

  const teamId = cleanString(await createTeam({
    name,
    sport,
    zip: normalizeTeamZip(input?.zip),
    isPublic: input?.isPublic !== false,
    ownerId: user.uid,
    ownerEmail: cleanString(user.email),
    adminEmails: []
  }));

  if (!teamId) {
    throw new Error('Team could not be created.');
  }

  clearAppDataCache(getTeamsSummaryBootstrapCacheKey(user.uid));

  try {
    const defaultStatConfig = getDefaultStatConfigForSport(sport);
    if (!defaultStatConfig) {
      return {
        teamId,
        defaultStatConfigCreated: false,
        defaultStatConfigError: null
      };
    }

    await createConfig(teamId, defaultStatConfig);
    return {
      teamId,
      defaultStatConfigCreated: true,
      defaultStatConfigError: null
    };
  } catch (error: any) {
    return {
      teamId,
      defaultStatConfigCreated: false,
      defaultStatConfigError: error?.message || 'Unable to create the default stat config.'
    };
  }
}

function cleanString(value: unknown) {
  return String(value || '').trim();
}

function normalizeTeamZip(value: unknown) {
  const digits = cleanString(value).replace(/[^0-9]/g, '');
  return digits.length >= 5 ? digits.slice(0, 9) : '';
}
