import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getDrills: vi.fn(),
  getPracticeSessionByEvent: vi.fn(),
  getTeam: vi.fn(),
  getTeamDrills: vi.fn(),
  updatePracticeSession: vi.fn(),
  upsertPracticeSessionForEvent: vi.fn()
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/team-access.js', () => ({ hasFullTeamAccess: vi.fn(() => true) }));

import {
  appendPracticeTimelineLiveNoteForApp,
  createPracticeTimelineBlockFromOption,
  getPracticeTimelineTotalMinutes,
  loadPracticeTimelineModel,
  savePracticeTimelineForApp
} from './practiceTimelineService';

describe('practiceTimelineService', () => {
  const user = { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', sport: 'Soccer', ownerId: 'coach-1' });
    dbMocks.getDrills.mockResolvedValue([]);
    dbMocks.getTeamDrills.mockResolvedValue([]);
    dbMocks.getPracticeSessionByEvent.mockResolvedValue(null);
    dbMocks.upsertPracticeSessionForEvent.mockResolvedValue('session-1');
  });

  it('loads sorted timeline blocks plus community and team drill options', async () => {
    dbMocks.getPracticeSessionByEvent.mockResolvedValue({
      id: 'session-1',
      blocks: [
        { order: 2, drillId: 'drill-3', drillTitle: 'Scrimmage', duration: 20, type: 'Game' },
        { order: 0, drillId: 'drill-1', drillTitle: 'Warm-up', duration: 10, type: 'Warm-up' }
      ]
    });
    dbMocks.getDrills.mockResolvedValue({ drills: [{ id: 'drill-1', title: 'Warm-up', type: 'Warm-up', setup: { duration: 10 } }], lastDoc: null });
    dbMocks.getTeamDrills.mockResolvedValue([{ id: 'drill-9', title: 'Pattern play', type: 'Tactical', setup: { duration: 15 } }]);

    const result = await loadPracticeTimelineModel('team-1', 'practice-1', user);

    expect(result.sessionId).toBe('session-1');
    expect(result.blocks.map((block) => block.drillTitle)).toEqual(['Warm-up', 'Scrimmage']);
    expect(result.drillOptions.map((option) => `${option.source}:${option.title}`)).toEqual(['community:Warm-up', 'team:Pattern play']);
  });

  it('serializes normalized blocks with total duration when saving a timeline', async () => {
    const blockOne = createPracticeTimelineBlockFromOption({ id: 'drill-1', title: 'Warm-up', type: 'Warm-up', duration: 10, description: '', source: 'community' }, 0);
    const blockTwo = createPracticeTimelineBlockFromOption({ id: 'drill-2', title: 'Finishing', type: 'Technical', duration: 15, description: 'Shots', source: 'team' }, 1);
    blockTwo.notes = 'Finish with weak foot';

    const sessionId = await savePracticeTimelineForApp({
      teamId: 'team-1',
      eventId: 'practice-1',
      user,
      blocks: [blockOne, blockTwo],
      date: new Date('2026-06-11T18:00:00Z'),
      location: 'Main Field',
      title: 'Thursday Practice'
    });

    expect(sessionId).toBe('session-1');
    expect(getPracticeTimelineTotalMinutes([blockOne, blockTwo])).toBe(25);
    expect(dbMocks.upsertPracticeSessionForEvent).toHaveBeenCalledWith(
      'team-1',
      'practice-1',
      expect.objectContaining({
        duration: 25,
        location: 'Main Field',
        blocks: [
          expect.objectContaining({ order: 0, drillTitle: 'Warm-up', duration: 10 }),
          expect.objectContaining({ order: 1, drillTitle: 'Finishing', notes: 'Finish with weak foot' })
        ]
      })
    );
  });

  it('appends live notes onto the current block before persisting', async () => {
    const block = createPracticeTimelineBlockFromOption({ id: 'drill-1', title: 'Warm-up', type: 'Warm-up', duration: 10, description: '', source: 'community' }, 0);

    const result = await appendPracticeTimelineLiveNoteForApp({
      teamId: 'team-1',
      eventId: 'practice-1',
      user,
      blocks: [block],
      blockIndex: 0,
      text: 'Keep the tempo high',
      type: 'text'
    });

    expect(result.blocks[0].notesLog).toEqual([
      expect.objectContaining({ type: 'text', text: 'Keep the tempo high' })
    ]);
    expect(dbMocks.upsertPracticeSessionForEvent).toHaveBeenCalledWith(
      'team-1',
      'practice-1',
      expect.objectContaining({
        blocks: [
          expect.objectContaining({
            notesLog: [expect.objectContaining({ text: 'Keep the tempo high' })]
          })
        ]
      })
    );
  });
});
