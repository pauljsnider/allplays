import {
  createCertificate,
  createCertificateBatch,
  getCertificateDefaults,
  getPlayers,
  getTeam,
  getUserByEmail,
  getUserProfile,
  setCertificateDefaults,
  updateCertificateBatch
} from '../../../../js/db.js';
import { buildDefaultSigners, normalizeSigners } from '../../../../js/certificates/signers.js';
import { resolveColors } from '../../../../js/certificates/renderer.js';
import { TEMPLATES } from '../../../../js/certificates/templates.js';
import { hasFullTeamAccess } from '../../../../js/team-access.js';
import type { AuthUser } from './types';

export type CertificateDraftTemplateOption = {
  id: string;
  label: string;
};

export type CertificateDraftPlayer = {
  id: string;
  name: string;
  number: string;
  photoUrl: string | null;
  active: boolean;
};

export type CertificateDraftSharedState = {
  templateId: string;
  teamNameOverride: string;
  awardTitle: string;
  seasonLabel: string;
  footerUrl: string;
  colorMode: 'team' | 'template' | 'custom';
  customColors: {
    borderColor: string;
    accentColor: string;
    textColor: string;
  };
  fonts: Record<string, any>;
  signers: Array<Record<string, any>>;
  foregroundImageRef: Record<string, any> | null;
  backgroundImageRef: Record<string, any> | null;
  backgroundOpacity: number;
  watermarkImageRef: Record<string, any> | null;
  watermarkOpacity: number;
  statsWindow: 5 | 10;
};

export type CertificateDraftComposerModel = {
  team: {
    id: string;
    name: string;
    photoUrl: string | null;
    colors: Record<string, any>;
  };
  players: CertificateDraftPlayer[];
  templates: CertificateDraftTemplateOption[];
  shared: CertificateDraftSharedState;
};

export type SaveCertificateDraftsForAppResult = {
  batchId: string;
  certificateIds: string[];
  webUrl: string;
};

export async function loadCertificateDraftComposer(teamId: string, user: AuthUser | null): Promise<CertificateDraftComposerModel> {
  if (!teamId) {
    throw new Error('Team is required.');
  }
  if (!user?.uid) {
    throw new Error('You must be signed in to create certificate drafts.');
  }

  const [team, roster, defaults] = await Promise.all([
    getTeam(teamId, { includeInactive: true }),
    getPlayers(teamId, { includeInactive: true }),
    getCertificateDefaults(teamId).catch(() => null)
  ]);

  if (!team) {
    throw new Error('Team not found.');
  }
  if (!hasFullTeamAccess(user, team)) {
    throw new Error('You do not have access to create certificate drafts for this team.');
  }

  const players = (Array.isArray(roster) ? roster : [])
    .filter((player: any) => player?.active !== false)
    .map((player: any) => ({
      id: String(player.id || ''),
      name: String(player.name || player.playerName || 'Player'),
      number: String(player.number || ''),
      photoUrl: player.photoUrl ? String(player.photoUrl) : null,
      active: player.active !== false
    }))
    .filter((player) => player.id);

  const signers = Array.isArray(defaults?.signers) && defaults.signers.length
    ? normalizeSigners(defaults.signers)
    : await buildDefaultSigners(team, user, { getUserProfile, getUserByEmail });

  return {
    team: {
      id: teamId,
      name: String(team.name || 'Team'),
      photoUrl: team.photoUrl ? String(team.photoUrl) : null,
      colors: team.colors || {}
    },
    players,
    templates: Object.values(TEMPLATES).map((template: any) => ({
      id: String(template.id || ''),
      label: String(template.displayName || template.id || 'Template')
    })),
    shared: buildInitialSharedState(team, defaults, signers)
  };
}

export async function saveCertificateDraftsForApp({
  teamId,
  user,
  shared,
  selectedPlayers
}: {
  teamId: string;
  user: AuthUser | null;
  shared: CertificateDraftSharedState;
  selectedPlayers: CertificateDraftPlayer[];
}): Promise<SaveCertificateDraftsForAppResult> {
  if (!teamId) {
    throw new Error('Team is required.');
  }
  if (!user?.uid) {
    throw new Error('You must be signed in to create certificate drafts.');
  }

  const team = await getTeam(teamId, { includeInactive: true });
  if (!team) {
    throw new Error('Team not found.');
  }
  if (!hasFullTeamAccess(user, team)) {
    throw new Error('You do not have access to create certificate drafts for this team.');
  }

  const normalizedPlayers = (Array.isArray(selectedPlayers) ? selectedPlayers : [])
    .map((player) => ({
      id: String(player?.id || '').trim(),
      name: String(player?.name || 'Player').trim() || 'Player',
      number: String(player?.number || '').trim(),
      photoUrl: player?.photoUrl ? String(player.photoUrl) : null,
      active: player?.active !== false
    }))
    .filter((player) => player.id);

  if (!normalizedPlayers.length) {
    throw new Error('Select at least one player before creating drafts.');
  }

  const normalizedShared = normalizeSharedState(shared, team);
  const batchId = await createCertificateBatch(teamId, {
    shared: normalizedShared,
    selectedPlayerIds: normalizedPlayers.map((player) => player.id),
    generatedCertificateIds: [],
    status: 'draft'
  });

  const certificateIds: string[] = [];
  for (const player of normalizedPlayers) {
    const certificateId = await createCertificate(teamId, buildCertificatePayloadForApp({
      batchId,
      player,
      shared: normalizedShared,
      team
    }));
    certificateIds.push(certificateId);
  }

  await updateCertificateBatch(teamId, batchId, {
    generatedCertificateIds: certificateIds,
    shared: normalizedShared,
    status: 'draft'
  });
  await setCertificateDefaults(teamId, normalizedShared);

  return {
    batchId,
    certificateIds,
    webUrl: getCertificateStudioUrl(teamId, batchId)
  };
}

export function buildCertificatePayloadForApp({
  batchId,
  player,
  shared,
  team
}: {
  batchId: string;
  player: CertificateDraftPlayer;
  shared: CertificateDraftSharedState;
  team: Record<string, any>;
}) {
  return {
    batchId,
    templateId: shared.templateId,
    colorMode: shared.colorMode,
    colors: resolveColors(shared, team),
    teamNameOverride: shared.teamNameOverride || null,
    playerId: player.id,
    recipientName: player.name,
    playerNumber: player.number || null,
    playerPhotoUrl: player.photoUrl || null,
    awardTitle: shared.awardTitle || null,
    description: '',
    descriptionSource: 'manual',
    statsWindow: shared.statsWindow,
    seasonLabel: shared.seasonLabel || '',
    footerUrl: shared.footerUrl || '',
    fonts: shared.fonts || null,
    signers: normalizeSigners(shared.signers),
    foregroundImageRef: shared.foregroundImageRef || null,
    backgroundImageRef: shared.backgroundImageRef || null,
    backgroundOpacity: shared.backgroundOpacity,
    watermarkImageRef: shared.watermarkImageRef || null,
    watermarkOpacity: shared.watermarkOpacity,
    status: 'draft'
  };
}

export function getCertificateStudioUrl(teamId: string, batchId: string) {
  const url = new URL('certificates.html', 'https://allplays.ai');
  url.hash = new URLSearchParams({ teamId, batchId }).toString();
  return url.toString();
}

function buildInitialSharedState(team: Record<string, any>, defaults: Record<string, any> | null, signers: Array<Record<string, any>>): CertificateDraftSharedState {
  return normalizeSharedState({
    templateId: defaults?.templateId || 'banner',
    teamNameOverride: defaults?.teamNameOverride || team?.name || 'Team',
    awardTitle: defaults?.awardTitle || '',
    seasonLabel: defaults?.seasonLabel || '',
    footerUrl: defaults?.footerUrl || '',
    colorMode: defaults?.colorMode || (team?.colors ? 'team' : 'template'),
    customColors: {
      ...getDefaultCustomColors(team),
      ...(defaults?.customColors || {})
    },
    fonts: defaults?.fonts || {},
    signers,
    foregroundImageRef: defaults?.foregroundImageRef || null,
    backgroundImageRef: defaults?.backgroundImageRef || null,
    backgroundOpacity: defaults?.backgroundOpacity,
    watermarkImageRef: defaults?.watermarkImageRef || null,
    watermarkOpacity: defaults?.watermarkOpacity,
    statsWindow: defaults?.statsWindow
  }, team);
}

function normalizeSharedState(shared: Partial<CertificateDraftSharedState>, team: Record<string, any>): CertificateDraftSharedState {
  return {
    templateId: String(shared?.templateId || 'banner'),
    teamNameOverride: String(shared?.teamNameOverride || team?.name || 'Team'),
    awardTitle: String(shared?.awardTitle || '').trim(),
    seasonLabel: String(shared?.seasonLabel || '').trim(),
    footerUrl: String(shared?.footerUrl || '').trim(),
    colorMode: shared?.colorMode === 'custom' || shared?.colorMode === 'template' ? shared.colorMode : 'team',
    customColors: {
      ...getDefaultCustomColors(team),
      ...(shared?.customColors || {})
    },
    fonts: shared?.fonts || {},
    signers: normalizeSigners(shared?.signers || []),
    foregroundImageRef: shared?.foregroundImageRef || null,
    backgroundImageRef: shared?.backgroundImageRef || null,
    backgroundOpacity: getFinitePercent(shared?.backgroundOpacity, 18),
    watermarkImageRef: shared?.watermarkImageRef || null,
    watermarkOpacity: getFinitePercent(shared?.watermarkOpacity, 12),
    statsWindow: shared?.statsWindow === 5 ? 5 : 10
  };
}

function getDefaultCustomColors(team: Record<string, any>) {
  return {
    borderColor: String(team?.colors?.secondary || '#d32f3a'),
    accentColor: String(team?.colors?.primary || '#5ec9c5'),
    textColor: '#0f2430'
  };
}

function getFinitePercent(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : fallback;
}
