import {
  createConfig,
  createTeam,
  getDefaultDiamondStatConfigForSport,
  getDefaultStatConfigForSport,
  getStatConfigPresetOptions
} from './adapters/legacyTeamCreation';
import { clearAppDataCache, getTeamsSummaryBootstrapCacheKey } from './appDataCache';
import {
  configureDiamondTeam,
  type DiamondCaptureMode,
  type DiamondSport
} from './diamondScorebookService';
import { listDiamondRulesProfiles } from './diamondScorebook/rules';
import type { AuthUser } from './types';

export type CreateTeamDiamondSetup = {
  enabled: boolean;
  rulesProfileId?: string;
  rulesProfileVersion?: number;
  captureMode?: DiamondCaptureMode;
};

export type CreateTeamForAppInput = {
  name: string;
  sport: string;
  zip?: string;
  isPublic?: boolean;
  diamondScorebook?: CreateTeamDiamondSetup;
};

export type CreateTeamForAppResult = {
  teamId: string;
  defaultStatConfigCreated: boolean;
  defaultStatConfigError: string | null;
  diamondScorebookConfigured: boolean;
  diamondScorebookError: string | null;
};

export type CreateTeamDiamondProfileOption = {
  id: string;
  version: number;
  label: string;
  sport: DiamondSport;
};

const fallbackSportOptions = ['Basketball', 'Soccer', 'Baseball', 'Softball', 'Football', 'Volleyball'];

export function getCreateTeamSportOptions({ includeDiamondSports = false } = {}) {
  const presetSports = getStatConfigPresetOptions()
    .map((option) => cleanString((option as { baseType?: unknown })?.baseType))
    .filter((sport) => sport && sport.toLowerCase() !== 'custom');
  const options = [...(presetSports.length ? presetSports : fallbackSportOptions)];
  if (includeDiamondSports) options.push('Fastpitch');
  return [...new Set(options)];
}

export function getCreateTeamDiamondProfileOptions(sport: unknown): CreateTeamDiamondProfileOption[] {
  const diamondSport = getDiamondSport(sport);
  if (!diamondSport) return [];
  return listDiamondRulesProfiles()
    .filter((profile) => profile.sport === diamondSport)
    .map((profile) => ({
      id: profile.id,
      version: profile.version,
      label: profile.name,
      sport: profile.sport
    }));
}

export async function configureCreatedTeamDiamondForApp(teamIdValue: unknown, sportValue: unknown, diamondOptions: CreateTeamDiamondSetup) {
  const teamId = cleanString(teamIdValue);
  if (!teamId) throw new Error('Team is required to enable Diamond Scorebook v2.');

  const sport = cleanString(sportValue);
  const diamondSport = getDiamondSport(sport);
  if (!diamondSport || diamondOptions?.enabled !== true) {
    throw new Error('Choose a supported Diamond sport and enable Diamond Scorebook v2.');
  }

  const availableProfiles = getCreateTeamDiamondProfileOptions(sport);
  const requestedProfile = availableProfiles.find(
    (profile) =>
      profile.id === cleanString(diamondOptions.rulesProfileId) && profile.version === Number(diamondOptions.rulesProfileVersion ?? 1)
  );
  const selectedProfile = requestedProfile || availableProfiles.find((profile) => profile.id === `${diamondSport}-youth`);
  if (!selectedProfile) throw new Error('No supported Diamond rules profile is available for this sport.');

  await configureDiamondTeam(teamId, diamondSport, selectedProfile.id, {
    enabled: true,
    rulesProfileVersion: selectedProfile.version,
    captureMode: diamondOptions.captureMode === 'full' ? 'full' : 'quick'
  });
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
    ownerEmailLower: cleanString(user.email).toLowerCase(),
    adminEmails: []
  }));

  if (!teamId) {
    throw new Error('Team could not be created.');
  }

  clearAppDataCache(getTeamsSummaryBootstrapCacheKey(user.uid));

  let defaultStatConfigCreated = false;
  let defaultStatConfigError: string | null = null;
  const diamondSport = getDiamondSport(sport);
  const diamondOptions = input.diamondScorebook;
  const diamondSetupRequested = Boolean(diamondSport && diamondOptions?.enabled === true);
  try {
    const defaultStatConfig = diamondSetupRequested ? getDefaultDiamondStatConfigForSport(sport) : getDefaultStatConfigForSport(sport);
    if (defaultStatConfig) {
      await createConfig(teamId, defaultStatConfig);
      defaultStatConfigCreated = true;
    }
  } catch (error: any) {
    defaultStatConfigError = error?.message || 'Unable to create the default stat config.';
  }

  let diamondScorebookConfigured = false;
  let diamondScorebookError: string | null = null;
  if (diamondSport && diamondSetupRequested && diamondOptions) {
    try {
      await configureCreatedTeamDiamondForApp(teamId, sport, diamondOptions);
      diamondScorebookConfigured = true;
    } catch (error: any) {
      diamondScorebookError = error?.message || 'Unable to enable Diamond Scorebook v2.';
      // Diamond is intentionally optional and policy-gated. A missing, disabled,
      // or unreadable rollout policy must never roll back a usable team or its
      // existing legacy tracker configuration.
    }
  }

  return {
    teamId,
    defaultStatConfigCreated,
    defaultStatConfigError,
    diamondScorebookConfigured,
    diamondScorebookError
  };
}

function cleanString(value: unknown) {
  return String(value || '').trim();
}

function normalizeTeamZip(value: unknown) {
  const digits = cleanString(value).replace(/[^0-9]/g, '');
  return digits.length >= 5 ? digits.slice(0, 9) : '';
}

function getDiamondSport(value: unknown): DiamondSport | null {
  const sport = cleanString(value).toLowerCase();
  if (sport === 'baseball') return 'baseball';
  if (sport === 'softball' || sport === 'fastpitch' || sport === 'fastpitch softball') return 'fastpitch';
  return null;
}
