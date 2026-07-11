import {
  getAggregatedStatsForGames,
  getGames,
  getTeam,
  hasFullTeamAccess,
  normalizeSigners,
  resolveColors,
  setCertificateDefaults,
  updateCertificate,
  updateCertificateBatch
} from './adapters/legacyCertificateDraft';
import {
  buildCertificateDescriptionPrompt,
  buildFallbackDescription,
  generateCertificateDescription,
  generateDescriptionsForDrafts,
  selectRecentCompletedGames,
  truncateCertificateDescription
} from './adapters/legacyCertificateNarratives';
import type { CertificateDraftPlayer, CertificateDraftSharedState } from './certificateDraftService';
import type { AuthUser } from './types';

export type CertificateAwardDraft = {
  id: string;
  certificateId: string;
  batchId: string;
  playerId: string;
  recipientName: string;
  playerNumber: string;
  playerPhotoUrl: string | null;
  awardTitle: string;
  description: string;
  descriptionSource: 'ai' | 'fallback' | 'manual';
  descriptionStatus: 'pending' | 'ready' | 'needs-review' | 'error';
  statsWindow: 5 | 10;
  includeInExport: boolean;
  errorMessage: string | null;
  status: 'draft' | 'published';
  customDescriptionHint?: string;
  exportedPngUrl?: string | null;
  exportedPdfUrl?: string | null;
};

export type PublishCertificateAwardsResult = {
  publishedCertificateIds: string[];
  batchIds: string[];
  parentVisibility: Array<{
    teamId: string;
    playerId: string;
    certificateId: string;
    status: 'published';
  }>;
};

export function buildCertificateAwardDraftsForApp({
  batchId,
  certificateIds,
  players,
  shared
}: {
  batchId: string;
  certificateIds: string[];
  players: CertificateDraftPlayer[];
  shared: CertificateDraftSharedState;
}): CertificateAwardDraft[] {
  const ids = Array.isArray(certificateIds) ? certificateIds : [];
  return (Array.isArray(players) ? players : [])
    .map((player, index) => {
      const certificateId = ids[index] || '';
      return {
        id: certificateId || `${batchId || 'draft'}-${player.id || index}`,
        certificateId,
        batchId,
        playerId: String(player.id || '').trim(),
        recipientName: String(player.name || 'Player').trim() || 'Player',
        playerNumber: String(player.number || '').trim(),
        playerPhotoUrl: player.photoUrl || null,
        awardTitle: shared.awardTitle || '',
        description: '',
        descriptionSource: 'ai' as const,
        descriptionStatus: 'pending' as const,
        statsWindow: shared.statsWindow,
        includeInExport: true,
        errorMessage: null,
        status: 'draft' as const,
        customDescriptionHint: player.customDescriptionHint || ''
      };
    })
    .filter((draft) => draft.playerId && draft.certificateId);
}

export function buildCertificateAwardNarrativePromptForApp(context: Record<string, any>) {
  return buildCertificateDescriptionPrompt(context);
}

export async function generateCertificateAwardNarrativesForApp({
  teamId,
  user,
  shared,
  drafts,
  generator = generateCertificateDescription
}: {
  teamId: string;
  user: AuthUser | null;
  shared: CertificateDraftSharedState;
  drafts: CertificateAwardDraft[];
  generator?: (...args: any[]) => Promise<string>;
}): Promise<CertificateAwardDraft[]> {
  if (!teamId) throw new Error('Team is required.');
  if (!user?.uid) throw new Error('You must be signed in to generate certificate narratives.');

  const sourceDrafts = (Array.isArray(drafts) ? drafts : []).filter((draft) => draft?.certificateId);
  if (!sourceDrafts.length) throw new Error('Create certificate drafts before generating narratives.');

  const team = await getTeam(teamId, { includeInactive: true });
  if (!team) throw new Error('Team not found.');
  if (!hasFullTeamAccess(user, team)) {
    throw new Error('You do not have access to generate narratives for this team.');
  }

  let games: any[] = [];
  let totalsByPlayer: Record<string, any> = {};
  let setupError: any = null;
  try {
    games = await getGames(teamId);
    const recentGames = selectRecentCompletedGames(games, shared.statsWindow);
    totalsByPlayer = await getAggregatedStatsForGames(teamId, recentGames.map((game: any) => game.id));
  } catch (error: any) {
    setupError = error;
  }

  if (setupError) {
    return sourceDrafts.map((draft) => applyNarrativeResult(draft, {
      status: 'error',
      source: 'fallback',
      description: draft.description || buildFallbackDescription({
        team,
        player: toPromptPlayer(draft),
        seasonLabel: shared.seasonLabel
      }),
      errorMessage: setupError?.message || 'AI description failed.'
    }));
  }

  const results = await generateDescriptionsForDrafts({
    drafts: sourceDrafts,
    team,
    shared,
    games,
    totalsByPlayer,
    generator,
    concurrency: 2
  });

  return sourceDrafts.map((draft) => applyNarrativeResult(draft, results.get(draft.id)));
}

export async function publishCertificateAwardsForApp({
  teamId,
  user,
  shared,
  drafts,
  reviewConfirmed
}: {
  teamId: string;
  user: AuthUser | null;
  shared: CertificateDraftSharedState;
  drafts: CertificateAwardDraft[];
  reviewConfirmed: boolean;
}): Promise<PublishCertificateAwardsResult> {
  if (!teamId) throw new Error('Team is required.');
  if (!user?.uid) throw new Error('You must be signed in to publish certificates.');
  if (!reviewConfirmed) throw new Error('Review and confirm certificate descriptions before publishing.');

  const sourceDrafts = Array.isArray(drafts) ? drafts : [];
  const publishDrafts = sourceDrafts.filter((draft) => draft?.includeInExport !== false);
  if (!publishDrafts.length) throw new Error('Select at least one certificate before publishing.');
  if (publishDrafts.some((draft) => !draft.certificateId)) {
    throw new Error('Create certificate drafts before publishing.');
  }
  const blockedDrafts = publishDrafts.filter((draft) => draft.descriptionStatus !== 'ready');
  if (blockedDrafts.length) {
    const blockedNames = blockedDrafts.map((draft) => draft.recipientName || 'certificate').join(', ');
    throw new Error(`Review or fix certificates marked Needs review or Error before publishing: ${blockedNames}.`);
  }

  const team = await getTeam(teamId, { includeInactive: true });
  if (!team) throw new Error('Team not found.');
  if (!hasFullTeamAccess(user, team)) {
    throw new Error('You do not have access to publish certificates for this team.');
  }

  const publishedCertificateIds: string[] = [];
  for (const draft of publishDrafts) {
    await updateCertificate(
      teamId,
      draft.certificateId,
      buildCertificateAwardPayloadForApp({ draft, shared, team, status: 'published' }),
      { action: 'published' }
    );
    publishedCertificateIds.push(draft.certificateId);
  }

  const batchIds = Array.from(new Set(publishDrafts.map((draft) => draft.batchId).filter(Boolean)));
  for (const batchId of batchIds) {
    const batchDrafts = sourceDrafts.filter((draft) => draft.batchId === batchId && draft.certificateId);
    await updateCertificateBatch(teamId, batchId, {
      generatedCertificateIds: batchDrafts.map((draft) => draft.certificateId),
      shared,
      status: 'published'
    });
  }
  await setCertificateDefaults(teamId, shared);

  return {
    publishedCertificateIds,
    batchIds,
    parentVisibility: publishDrafts.map((draft) => ({
      teamId,
      playerId: draft.playerId,
      certificateId: draft.certificateId,
      status: 'published' as const
    }))
  };
}

export function buildCertificateAwardPayloadForApp({
  draft,
  shared,
  team,
  status = draft.status || 'draft'
}: {
  draft: CertificateAwardDraft;
  shared: CertificateDraftSharedState;
  team: Record<string, any>;
  status?: 'draft' | 'published';
}) {
  return {
    batchId: draft.batchId || null,
    templateId: shared.templateId,
    colorMode: shared.colorMode,
    colors: resolveColors(shared, team),
    teamNameOverride: shared.teamNameOverride || null,
    playerId: draft.playerId || null,
    recipientName: draft.recipientName,
    playerNumber: draft.playerNumber || null,
    playerPhotoUrl: draft.playerPhotoUrl || null,
    awardTitle: draft.awardTitle || null,
    description: truncateCertificateDescription(draft.description || ''),
    descriptionSource: draft.descriptionSource || 'manual',
    statsWindow: draft.statsWindow || shared.statsWindow,
    descriptionTone: shared.descriptionTone,
    seasonLabel: shared.seasonLabel || '',
    footerUrl: shared.footerUrl || '',
    framePurchaseLink: String(shared.framePurchaseLink || '').trim(),
    fonts: shared.fonts || null,
    signers: normalizeSigners(shared.signers),
    foregroundImageRef: shared.foregroundImageRef || null,
    backgroundImageRef: shared.backgroundImageRef || null,
    backgroundOpacity: shared.backgroundOpacity,
    watermarkImageRef: shared.watermarkImageRef || null,
    watermarkOpacity: shared.watermarkOpacity,
    exportedPngUrl: draft.exportedPngUrl || null,
    exportedPdfUrl: draft.exportedPdfUrl || null,
    status
  };
}

function applyNarrativeResult(draft: CertificateAwardDraft, result: Record<string, any> | null | undefined): CertificateAwardDraft {
  if (!result) return draft;
  if (draft.descriptionSource === 'manual' && draft.descriptionStatus === 'ready') {
    return {
      ...draft,
      errorMessage: null
    };
  }
  return {
    ...draft,
    description: truncateCertificateDescription(result.description || draft.description || ''),
    descriptionStatus: normalizeDescriptionStatus(result.status),
    descriptionSource: normalizeDescriptionSource(result.source),
    errorMessage: result.errorMessage || null
  };
}

function toPromptPlayer(draft: CertificateAwardDraft) {
  return {
    id: draft.playerId,
    name: draft.recipientName,
    number: draft.playerNumber,
    customDescriptionHint: draft.customDescriptionHint
  };
}

function normalizeDescriptionStatus(value: unknown): CertificateAwardDraft['descriptionStatus'] {
  return value === 'pending' || value === 'ready' || value === 'needs-review' || value === 'error'
    ? value
    : 'needs-review';
}

function normalizeDescriptionSource(value: unknown): CertificateAwardDraft['descriptionSource'] {
  return value === 'ai' || value === 'manual' || value === 'fallback' ? value : 'fallback';
}
