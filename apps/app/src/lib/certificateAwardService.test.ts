import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCertificateDescriptionPrompt } from '../../../../js/certificates/aiDescriptions.js';
import {
  buildCertificateAwardNarrativePromptForApp,
  buildCertificateAwardPayloadForApp,
  generateCertificateAwardNarrativesForApp,
  publishCertificateAwardsForApp,
  type CertificateAwardDraft
} from './certificateAwardService';
import type { CertificateDraftSharedState } from './certificateDraftService';

const legacyDraftMocks = vi.hoisted(() => ({
  getAggregatedStatsForGames: vi.fn(),
  getGames: vi.fn(),
  getTeam: vi.fn(),
  hasFullTeamAccess: vi.fn(),
  normalizeSigners: vi.fn((signers) => signers),
  resolveColors: vi.fn(() => ({ borderColor: '#111111', accentColor: '#222222', textColor: '#333333' })),
  setCertificateDefaults: vi.fn(),
  updateCertificate: vi.fn(),
  updateCertificateBatch: vi.fn()
}));

vi.mock('./adapters/legacyCertificateDraft', () => legacyDraftMocks);

describe('certificateAwardService', () => {
  const user = {
    uid: 'coach-1',
    email: 'coach@example.com'
  } as any;
  const team = {
    id: 'team-1',
    name: 'Bears',
    sport: 'Soccer',
    colors: {
      primary: '#0055aa',
      secondary: '#ffcc00'
    }
  };
  const shared: CertificateDraftSharedState = {
    templateId: 'banner',
    teamNameOverride: 'Bears',
    awardTitle: 'Most Improved',
    seasonLabel: 'Spring 2026',
    footerUrl: 'www.allplays.ai',
    descriptionTone: 'celebratory and specific',
    colorMode: 'team',
    customColors: {
      borderColor: '#ffcc00',
      accentColor: '#0055aa',
      textColor: '#0f2430'
    },
    fonts: {},
    signers: [{ name: 'Coach One', role: 'Head Coach', signatureStyle: 'script' }],
    foregroundImageRef: null,
    backgroundImageRef: null,
    backgroundOpacity: 18,
    watermarkImageRef: null,
    watermarkOpacity: 12,
    statsWindow: 10
  };
  const draft: CertificateAwardDraft = {
    id: 'cert-1',
    certificateId: 'cert-1',
    batchId: 'batch-1',
    playerId: 'player-1',
    recipientName: 'Pat Star',
    playerNumber: '9',
    playerPhotoUrl: 'https://img/player.png',
    awardTitle: 'Most Improved',
    description: '',
    descriptionSource: 'ai',
    descriptionStatus: 'pending',
    statsWindow: 10,
    includeInExport: true,
    errorMessage: null,
    status: 'draft',
    customDescriptionHint: 'Led warmups with confidence.'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    legacyDraftMocks.getTeam.mockResolvedValue(team);
    legacyDraftMocks.hasFullTeamAccess.mockReturnValue(true);
    legacyDraftMocks.getGames.mockResolvedValue([
      { id: 'game-1', status: 'completed', type: 'game', date: new Date('2026-04-10'), summary: 'Pressed well against Falcons.' },
      { id: 'practice-1', status: 'completed', type: 'practice', date: new Date('2026-04-11'), summary: 'Practice.' }
    ]);
    legacyDraftMocks.getAggregatedStatsForGames.mockResolvedValue({
      'player-1': { goals: 2, assists: 1 }
    });
    legacyDraftMocks.updateCertificate.mockResolvedValue(undefined);
    legacyDraftMocks.updateCertificateBatch.mockResolvedValue(undefined);
    legacyDraftMocks.setCertificateDefaults.mockResolvedValue(undefined);
  });

  it('uses the legacy certificate narrative prompt verbatim', () => {
    const context = {
      team,
      player: {
        name: 'Pat Star',
        number: '9',
        customDescriptionHint: 'Led warmups with confidence.'
      },
      seasonLabel: 'Spring 2026',
      tone: 'celebratory and specific',
      games: [{ opponent: 'Falcons', summary: 'Pressed well against Falcons.' }],
      stats: { goals: 2 }
    };

    expect(buildCertificateAwardNarrativePromptForApp(context)).toBe(buildCertificateDescriptionPrompt(context));
  });

  it('generates editable draft narratives from the same game and stat context as legacy certificates', async () => {
    const generator = vi.fn(async () => 'Pat brought energy, confidence, and smart decisions to every match while supporting teammates and showing steady growth all season.');

    const generated = await generateCertificateAwardNarrativesForApp({
      teamId: 'team-1',
      user,
      shared,
      drafts: [draft],
      generator
    });

    expect(legacyDraftMocks.getAggregatedStatsForGames).toHaveBeenCalledWith('team-1', ['game-1']);
    expect(generator).toHaveBeenCalledWith(expect.objectContaining({
      team,
      seasonLabel: 'Spring 2026',
      tone: 'celebratory and specific',
      stats: { goals: 2, assists: 1 },
      player: expect.objectContaining({
        name: 'Pat Star',
        number: '9',
        customDescriptionHint: 'Led warmups with confidence.'
      })
    }));
    expect(generated[0]).toMatchObject({
      id: 'cert-1',
      descriptionSource: 'ai',
      descriptionStatus: 'ready',
      errorMessage: null
    });
    expect(legacyDraftMocks.updateCertificate).not.toHaveBeenCalled();
  });

  it('keeps drafts safe when AI fails and does not publish without confirmation', async () => {
    const generated = await generateCertificateAwardNarrativesForApp({
      teamId: 'team-1',
      user,
      shared,
      drafts: [draft],
      generator: vi.fn(async () => {
        throw new Error('AI unavailable.');
      })
    });

    expect(generated[0]).toMatchObject({
      id: 'cert-1',
      descriptionSource: 'fallback',
      descriptionStatus: 'error',
      errorMessage: 'AI unavailable.',
      status: 'draft'
    });
    expect(legacyDraftMocks.updateCertificate).not.toHaveBeenCalled();

    await expect(publishCertificateAwardsForApp({
      teamId: 'team-1',
      user,
      shared,
      drafts: generated,
      reviewConfirmed: false
    })).rejects.toThrow('Review and confirm certificate descriptions before publishing.');
    expect(legacyDraftMocks.updateCertificate).not.toHaveBeenCalled();
  });

  it('publishes the same certificate payload shape parent certificate reads expect', async () => {
    const readyDraft = {
      ...draft,
      description: 'Pat brought energy, confidence, and smart decisions to every match.',
      descriptionSource: 'manual' as const,
      descriptionStatus: 'ready' as const
    };

    const result = await publishCertificateAwardsForApp({
      teamId: 'team-1',
      user,
      shared,
      drafts: [readyDraft],
      reviewConfirmed: true
    });

    expect(legacyDraftMocks.updateCertificate).toHaveBeenCalledWith(
      'team-1',
      'cert-1',
      expect.objectContaining({
        batchId: 'batch-1',
        playerId: 'player-1',
        recipientName: 'Pat Star',
        awardTitle: 'Most Improved',
        description: 'Pat brought energy, confidence, and smart decisions to every match.',
        descriptionSource: 'manual',
        status: 'published'
      }),
      { action: 'published' }
    );
    expect(legacyDraftMocks.updateCertificateBatch).toHaveBeenCalledWith('team-1', 'batch-1', expect.objectContaining({
      generatedCertificateIds: ['cert-1'],
      status: 'published'
    }));
    expect(result).toEqual({
      publishedCertificateIds: ['cert-1'],
      batchIds: ['batch-1'],
      parentVisibility: [{
        teamId: 'team-1',
        playerId: 'player-1',
        certificateId: 'cert-1',
        status: 'published'
      }]
    });
  });

  it('builds publish payloads with normalized signers, colors, and truncated descriptions', () => {
    const payload = buildCertificateAwardPayloadForApp({
      draft: {
        ...draft,
        description: 'Pat showed growth and effort. '.repeat(30),
        descriptionSource: 'manual',
        descriptionStatus: 'ready'
      },
      shared,
      team,
      status: 'published'
    });

    expect(legacyDraftMocks.resolveColors).toHaveBeenCalledWith(shared, team);
    expect(legacyDraftMocks.normalizeSigners).toHaveBeenCalledWith(shared.signers);
    expect(payload.description.length).toBeLessThanOrEqual(350);
    expect(payload).toMatchObject({
      playerId: 'player-1',
      signers: shared.signers,
      status: 'published'
    });
  });
});
