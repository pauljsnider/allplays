import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './types';
import { buildResourcePacketAiTools } from './resourcePacketsAiTools';

const mocks = vi.hoisted(() => ({
  loadResourcePacketStaff: vi.fn(),
  resourcePacketCommand: vi.fn()
}));

vi.mock('./resourcePacketsService', () => ({
  loadResourcePacketFamily: vi.fn(),
  loadResourcePacketStaff: mocks.loadResourcePacketStaff,
  resourcePacketCommand: mocks.resourcePacketCommand,
  resourcePacketsAvailable: vi.fn(() => true)
}));

const user: AuthUser = {
  uid: 'coach-1',
  email: 'coach@example.com',
  displayName: 'Coach',
  roles: ['coach']
};

const historicalItem = {
  resourceId: 'resource-1',
  resourceVersion: 1,
  title: 'Balance drill',
  teachingPoint: 'Stay balanced.',
  url: 'https://example.com/balance-v1'
};

const currentResource = {
  resourceId: 'resource-1',
  version: 2,
  title: 'Balance drill',
  teachingPoint: 'Stay balanced.',
  url: 'https://example.com/balance-v2'
};

describe('resource packet AI tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadResourcePacketStaff.mockResolvedValue({
      cursors: { resources: null, assignments: null, tasks: null, players: null, practices: null, deliveries: null },
      resources: [currentResource],
      assignments: [
        {
          assignmentId: 'packet-1',
          revision: 4,
          publishedVersion: 1,
          title: 'Home footwork',
          notes: 'Five minutes each day.',
          items: [historicalItem],
          playerIds: ['player-1'],
          practiceId: null,
          dueAt: null,
          timeZone: 'UTC'
        }
      ],
      tasks: [],
      players: [{ id: 'player-1', name: 'Player One' }],
      practices: [],
      deliveries: []
    });
  });

  it('pins and previews historical or explicitly selected current media', async () => {
    const tool = buildResourcePacketAiTools().find((candidate) => candidate.name === 'prepare_resource_packet');
    if (!tool || !('prepare' in tool)) throw new Error('Expected the preparation tool.');
    const prepare = tool.prepare;
    if (!prepare) throw new Error('Expected the preparation tool.');
    const baseArgs = {
      teamId: 'team-1',
      action: 'saveDraft',
      assignmentId: 'packet-1',
      title: 'Home footwork',
      resourceIds: ['resource-1'],
      playerIds: ['player-1']
    };

    const explicitlyHistorical = await prepare(user, { ...baseArgs, resourceVersions: [1] });
    expect(explicitlyHistorical.args).toEqual(expect.objectContaining({ resourceVersions: [1] }));
    expect(explicitlyHistorical.previewSummary).toEqual(expect.objectContaining({ items: [historicalItem], resourceVersions: [1] }));

    const unchanged = await prepare(user, baseArgs);
    expect(unchanged.args).toEqual(expect.objectContaining({
      resourceVersions: [1],
      completionPolicy: 'link_opened_legacy'
    }));

    const explicitlyCurrent = await prepare(user, { ...baseArgs, resourceVersions: [2] });
    expect(explicitlyCurrent.args).toEqual(expect.objectContaining({ resourceVersions: [2] }));
    expect(explicitlyCurrent.previewSummary).toEqual(
      expect.objectContaining({
        items: [{ ...currentResource, resourceVersion: 2 }],
        resourceVersions: [2]
      })
    );
  });

  it('uses practice acknowledgment for new AI drafts while preserving an existing policy', async () => {
    mocks.loadResourcePacketStaff.mockResolvedValueOnce({
      cursors: { resources: null, assignments: null, tasks: null, players: null, practices: null, deliveries: null },
      resources: [currentResource],
      assignments: [],
      tasks: [],
      players: [{ id: 'player-1', name: 'Player One' }],
      practices: [],
      deliveries: []
    });
    const tool = buildResourcePacketAiTools().find((candidate) => candidate.name === 'prepare_resource_packet');
    if (!tool || !('prepare' in tool) || !tool.prepare) throw new Error('Expected the preparation tool.');

    const prepared = await tool.prepare(user, {
      teamId: 'team-1',
      action: 'saveDraft',
      title: 'New home practice',
      resourceIds: ['resource-1'],
      playerIds: ['player-1']
    });

    expect(prepared.args).toEqual(expect.objectContaining({ completionPolicy: 'practice_ack' }));
    expect(prepared.previewSummary).toEqual(expect.objectContaining({ completionPolicy: 'practice_ack' }));
  });

  it('preserves practice acknowledgment when AI edits an existing assignment', async () => {
    mocks.loadResourcePacketStaff.mockResolvedValueOnce({
      cursors: { resources: null, assignments: null, tasks: null, players: null, practices: null, deliveries: null },
      resources: [currentResource],
      assignments: [{
        assignmentId: 'packet-practice',
        revision: 2,
        publishedVersion: 1,
        title: 'Existing practice',
        notes: '',
        items: [historicalItem],
        playerIds: ['player-1'],
        practiceId: null,
        dueAt: null,
        timeZone: 'UTC',
        completionPolicy: 'practice_ack'
      }],
      tasks: [],
      players: [{ id: 'player-1', name: 'Player One' }],
      practices: [],
      deliveries: []
    });
    const tool = buildResourcePacketAiTools().find((candidate) => candidate.name === 'prepare_resource_packet');
    if (!tool || !('prepare' in tool) || !tool.prepare) throw new Error('Expected the preparation tool.');

    const prepared = await tool.prepare(user, {
      teamId: 'team-1',
      action: 'saveDraft',
      assignmentId: 'packet-practice',
      title: 'Existing practice',
      resourceIds: ['resource-1'],
      playerIds: ['player-1']
    });

    expect(prepared.args).toEqual(expect.objectContaining({ completionPolicy: 'practice_ack' }));
  });
});
