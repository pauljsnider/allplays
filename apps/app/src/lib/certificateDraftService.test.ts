import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCertificatePayloadForApp,
  getCertificateStudioUrl,
  loadCertificateDraftComposer,
  saveCertificateDraftsForApp,
  type CertificateDraftSharedState
} from './certificateDraftService';

const dbMocks = vi.hoisted(() => ({
  createCertificate: vi.fn(),
  createCertificateBatch: vi.fn(),
  getAggregatedStatsForGames: vi.fn(),
  getCertificate: vi.fn(),
  getCertificateDefaults: vi.fn(),
  getGames: vi.fn(),
  getPlayers: vi.fn(),
  getTeam: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserProfile: vi.fn(),
  setCertificateDefaults: vi.fn(),
  updateCertificate: vi.fn(),
  updateCertificateBatch: vi.fn()
}));

const signersMocks = vi.hoisted(() => ({
  buildDefaultSigners: vi.fn(),
  normalizeSigners: vi.fn((signers) => signers)
}));

const rendererMocks = vi.hoisted(() => ({
  resolveColors: vi.fn(() => ({ borderColor: '#111111', accentColor: '#222222', textColor: '#333333' }))
}));

const teamAccessMocks = vi.hoisted(() => ({
  hasFullTeamAccess: vi.fn()
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/certificates/signers.js', () => signersMocks);
vi.mock('../../../../js/certificates/renderer.js', () => rendererMocks);
vi.mock('../../../../js/certificates/templates.js', () => ({
  TEMPLATES: {
    banner: { id: 'banner', displayName: 'Banner' },
    header: { id: 'header', displayName: 'Header' }
  }
}));
vi.mock('../../../../js/team-access.js', () => teamAccessMocks);

describe('certificateDraftService', () => {
  const user = {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach One'
  } as any;
  const team = {
    id: 'team-1',
    name: 'Bears',
    photoUrl: 'https://img/team-logo.png',
    colors: {
      primary: '#0055aa',
      secondary: '#ffcc00'
    }
  };
  const roster = [
    { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://img/player-1.png', active: true },
    { id: 'player-2', name: 'Sam Bench', number: '12', active: false }
  ];
  const shared: CertificateDraftSharedState = {
    templateId: 'banner',
    teamNameOverride: 'Bears',
    awardTitle: 'Most Improved',
    seasonLabel: 'Spring 2026',
    footerUrl: 'www.allplays.ai',
    framePurchaseLink: 'https://frames.example.test/team-store',
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

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue(team);
    dbMocks.getPlayers.mockResolvedValue(roster);
    dbMocks.getCertificateDefaults.mockResolvedValue(null);
    dbMocks.getUserProfile.mockResolvedValue(null);
    dbMocks.getUserByEmail.mockResolvedValue(null);
    dbMocks.createCertificateBatch.mockResolvedValue('batch-1');
    dbMocks.createCertificate
      .mockResolvedValueOnce('cert-1')
      .mockResolvedValueOnce('cert-2');
    dbMocks.updateCertificateBatch.mockResolvedValue(undefined);
    dbMocks.setCertificateDefaults.mockResolvedValue(undefined);
    signersMocks.buildDefaultSigners.mockResolvedValue(shared.signers);
    teamAccessMocks.hasFullTeamAccess.mockReturnValue(true);
  });

  it('loads active roster players and certificate defaults for the app composer', async () => {
    const model = await loadCertificateDraftComposer('team-1', user);

    expect(teamAccessMocks.hasFullTeamAccess).toHaveBeenCalledWith(user, team);
    expect(model.players).toEqual([
      {
        id: 'player-1',
        name: 'Pat Star',
        number: '9',
        photoUrl: 'https://img/player-1.png',
        active: true,
        customDescriptionHint: ''
      }
    ]);
    expect(model.templates).toEqual([
      { id: 'banner', label: 'Banner' },
      { id: 'header', label: 'Header' }
    ]);
    expect(model.shared.signers).toEqual(shared.signers);
  });

  it('defaults the foreground image to the team logo when no certificate defaults are saved', async () => {
    const model = await loadCertificateDraftComposer('team-1', user);

    expect(model.shared.foregroundImageRef).toEqual({
      url: 'https://img/team-logo.png',
      source: 'team-logo'
    });
  });

  it('preserves an explicit empty foreground image choice from saved defaults', async () => {
    dbMocks.getCertificateDefaults.mockResolvedValue({
      foregroundImageRef: null
    });

    const model = await loadCertificateDraftComposer('team-1', user);

    expect(model.shared.foregroundImageRef).toBeNull();
  });

  it('hydrates the app frame purchase link from saved certificate defaults', async () => {
    dbMocks.getCertificateDefaults.mockResolvedValue({
      framePurchaseLink: ' https://frames.example.test/team-store '
    });

    const model = await loadCertificateDraftComposer('team-1', user);

    expect(model.shared.framePurchaseLink).toBe('https://frames.example.test/team-store');
  });

  it('creates one draft certificate per selected player and returns a web studio batch URL', async () => {
    const result = await saveCertificateDraftsForApp({
      teamId: 'team-1',
      user,
      shared,
      selectedPlayers: [
        {
          id: 'player-1',
          name: 'Pat Star',
          number: '9',
          photoUrl: 'https://img/player-1.png',
          active: true
        },
        {
          id: 'player-2',
          name: 'Alex Ace',
          number: '3',
          photoUrl: null,
          active: true
        }
      ]
    });

    expect(dbMocks.createCertificateBatch).toHaveBeenCalledWith('team-1', expect.objectContaining({
      status: 'draft',
      selectedPlayerIds: ['player-1', 'player-2']
    }));
    expect(dbMocks.createCertificate).toHaveBeenNthCalledWith(1, 'team-1', expect.objectContaining({
      batchId: 'batch-1',
      playerId: 'player-1',
      recipientName: 'Pat Star',
      awardTitle: 'Most Improved',
      description: '',
      status: 'draft'
    }));
    expect(dbMocks.createCertificate).toHaveBeenNthCalledWith(2, 'team-1', expect.objectContaining({
      batchId: 'batch-1',
      playerId: 'player-2',
      recipientName: 'Alex Ace'
    }));
    expect(dbMocks.updateCertificateBatch).toHaveBeenCalledWith('team-1', 'batch-1', expect.objectContaining({
      generatedCertificateIds: ['cert-1', 'cert-2'],
      status: 'draft'
    }));
    expect(dbMocks.setCertificateDefaults).toHaveBeenCalledWith('team-1', expect.objectContaining({
      templateId: 'banner',
      awardTitle: 'Most Improved',
      framePurchaseLink: 'https://frames.example.test/team-store'
    }));
    expect(result).toEqual({
      batchId: 'batch-1',
      certificateIds: ['cert-1', 'cert-2'],
      webUrl: 'https://allplays.ai/certificates.html#teamId=team-1&batchId=batch-1'
    });
  });

  it('builds team-only and batch continuation URLs for the web awards studio', () => {
    expect(getCertificateStudioUrl('team 1')).toBe('https://allplays.ai/certificates.html#teamId=team+1');
    expect(getCertificateStudioUrl('team 1', 'batch/1')).toBe('https://allplays.ai/certificates.html#teamId=team+1&batchId=batch%2F1');
  });

  it('builds a draft payload that matches the saved web studio shape', () => {
    const payload = buildCertificatePayloadForApp({
      batchId: 'batch-1',
      player: {
        id: 'player-1',
        name: 'Pat Star',
        number: '9',
        photoUrl: 'https://img/player-1.png',
        active: true
      },
      shared,
      team
    });

    expect(rendererMocks.resolveColors).toHaveBeenCalledWith(shared, team);
    expect(payload).toMatchObject({
      batchId: 'batch-1',
      templateId: 'banner',
      colorMode: 'team',
      colors: {
        borderColor: '#111111',
        accentColor: '#222222',
        textColor: '#333333'
      },
      teamNameOverride: 'Bears',
      playerId: 'player-1',
      recipientName: 'Pat Star',
      playerNumber: '9',
      playerPhotoUrl: 'https://img/player-1.png',
      awardTitle: 'Most Improved',
      description: '',
      descriptionSource: 'manual',
      seasonLabel: 'Spring 2026',
      footerUrl: 'www.allplays.ai',
      framePurchaseLink: 'https://frames.example.test/team-store',
      descriptionTone: 'celebratory and specific',
      status: 'draft'
    });
  });
});
