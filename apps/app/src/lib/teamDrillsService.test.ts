import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTeamDrillPayload, deleteTeamDrillForApp, loadTeamDrillsManagementModel, saveTeamDrillForApp } from './teamDrillsService';

const dbMocks = vi.hoisted(() => ({
  createDrill: vi.fn(),
  deleteDrill: vi.fn(),
  getTeam: vi.fn(),
  getTeamDrills: vi.fn(),
  updateDrill: vi.fn(),
  uploadDrillDiagram: vi.fn()
}));

const teamAccessMocks = vi.hoisted(() => ({
  hasFullTeamAccess: vi.fn()
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/team-access.js', () => teamAccessMocks);

describe('teamDrillsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', sport: 'Soccer', ownerId: 'coach-1', adminEmails: ['coach@example.com'] });
    dbMocks.getTeamDrills.mockResolvedValue([]);
    dbMocks.createDrill.mockResolvedValue('drill-1');
    dbMocks.updateDrill.mockResolvedValue(undefined);
    dbMocks.deleteDrill.mockResolvedValue(undefined);
    dbMocks.uploadDrillDiagram.mockResolvedValue('https://img.example.test/diagram.png');
    teamAccessMocks.hasFullTeamAccess.mockReturnValue(true);
  });

  it('builds the same drill payload shape as the legacy editor', () => {
    expect(buildTeamDrillPayload({
      title: '  Rondo 4v2  ',
      type: 'Technical',
      level: 'Intermediate',
      skills: ' passing,  support ,passing ',
      duration: '18',
      players: '8-12',
      cones: '7',
      description: ' Keep the ball moving. ',
      instructions: ' Two-touch max. ',
      youtubeUrl: ' https://example.com/rondo ',
      publishedToCommunity: true
    }, 'Soccer')).toEqual({
      title: 'Rondo 4v2',
      sport: 'Soccer',
      type: 'Technical',
      level: 'Intermediate',
      skills: ['passing', 'support'],
      description: 'Keep the ball moving.',
      instructions: 'Two-touch max.',
      publishedToCommunity: true,
      youtubeUrl: 'https://example.com/rondo',
      setup: {
        duration: 18,
        players: '8-12',
        cones: 7
      }
    });
  });

  it('loads team drills only for managers', async () => {
    dbMocks.getTeamDrills.mockResolvedValue([{ id: 'drill-1', title: 'Keep-away', setup: { duration: 12, players: '8-10', cones: 6 } }]);

    const model = await loadTeamDrillsManagementModel('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] });

    expect(dbMocks.getTeamDrills).toHaveBeenCalledWith('team-1');
    expect(model.canManageDrills).toBe(true);
    expect(model.drills[0]).toEqual(expect.objectContaining({
      id: 'drill-1',
      title: 'Keep-away',
      type: 'Technical',
      level: 'All',
      setup: expect.objectContaining({ duration: 12, players: '8-10', cones: 6 })
    }));
  });

  it('creates a drill, uploads diagrams, and persists the final diagram url list', async () => {
    const file = new File(['diagram'], 'rondo.png', { type: 'image/png' });

    const drillId = await saveTeamDrillForApp('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, 'Soccer', {
      title: 'Rondo',
      type: 'Technical',
      level: 'All',
      skills: 'passing',
      duration: '15',
      players: '8-10',
      cones: '5',
      description: 'Quick passing',
      instructions: 'Keep shape',
      youtubeUrl: '',
      publishedToCommunity: false,
      existingDiagramUrls: ['https://img.example.test/existing.png'],
      diagramFiles: [file]
    });

    expect(drillId).toBe('drill-1');
    expect(dbMocks.createDrill).toHaveBeenCalledWith('team-1', expect.objectContaining({ title: 'Rondo', setup: expect.objectContaining({ duration: 15, cones: 5 }) }));
    expect(dbMocks.uploadDrillDiagram).toHaveBeenCalledWith('team-1', 'drill-1', file);
    expect(dbMocks.updateDrill).toHaveBeenLastCalledWith('drill-1', {
      diagramUrls: ['https://img.example.test/existing.png', 'https://img.example.test/diagram.png']
    });
  });

  it('deletes a drill only when the user still has full team access', async () => {
    await deleteTeamDrillForApp('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, 'drill-1');
    expect(dbMocks.deleteDrill).toHaveBeenCalledWith('drill-1');

    teamAccessMocks.hasFullTeamAccess.mockReturnValue(false);
    await expect(deleteTeamDrillForApp('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, 'drill-1')).rejects.toThrow('You do not have access to manage team drills.');
  });
});
