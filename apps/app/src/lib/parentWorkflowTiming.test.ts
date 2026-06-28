import { beforeEach, describe, expect, it, vi } from 'vitest';

const workflowMocks = vi.hoisted(() => ({
  end: vi.fn(),
  startWorkflowTimer: vi.fn(() => ({ end: workflowMocks.end }))
}));

vi.mock('./workflowTiming', () => ({
  startWorkflowTimer: workflowMocks.startWorkflowTimer
}));

import {
  PARENT_CORE_WORKFLOW_NAME,
  completeParentCoreWorkflowTimer,
  inferParentCoreTargetPage,
  resetParentCoreWorkflowTimerForTests,
  startParentCoreWorkflowTimer
} from './parentWorkflowTiming';

describe('parentWorkflowTiming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetParentCoreWorkflowTimerForTests();
  });

  it('infers parent core target pages from routes', () => {
    expect(inferParentCoreTargetPage('/schedule/team-1/game-1?section=availability')).toBe('schedule_event');
    expect(inferParentCoreTargetPage('/schedule?teamId=team-1')).toBe('schedule');
    expect(inferParentCoreTargetPage('/players/team-1/player-1')).toBe('player');
    expect(inferParentCoreTargetPage('/parent-tools/fees')).toBe('fees');
    expect(inferParentCoreTargetPage('/messages/team-1')).toBe('messages');
  });

  it('starts and completes one cross-page parent workflow timer', () => {
    startParentCoreWorkflowTimer({
      sourcePage: 'home',
      sourceRoute: '/home',
      targetRoute: '/players/team-1/player-1',
      trigger: 'player_card',
      teamId: 'team-1',
      playerId: 'player-1'
    });

    expect(workflowMocks.startWorkflowTimer).toHaveBeenCalledWith(PARENT_CORE_WORKFLOW_NAME, expect.objectContaining({
      source: 'parent_core',
      sourcePage: 'home',
      sourceRoute: '/home',
      targetPage: 'player',
      targetRoute: '/players/team-1/player-1',
      trigger: 'player_card',
      teamId: 'team-1',
      playerId: 'player-1'
    }));

    expect(completeParentCoreWorkflowTimer('schedule')).toBe(false);
    expect(workflowMocks.end).not.toHaveBeenCalled();

    expect(completeParentCoreWorkflowTimer('player', {
      completedRoute: '/players/team-1/player-1',
      playerName: 'Pat Star'
    })).toBe(true);
    expect(workflowMocks.end).toHaveBeenCalledWith(expect.objectContaining({
      completedPage: 'player',
      completedRoute: '/players/team-1/player-1',
      expectedTargetRoute: '/players/team-1/player-1',
      playerName: 'Pat Star'
    }));
    expect(completeParentCoreWorkflowTimer('player')).toBe(false);
  });
});
