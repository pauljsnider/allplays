import { beforeEach, describe, expect, it, vi } from 'vitest';

const telemetryMocks = vi.hoisted(() => ({
  recordAppWorkflowTiming: vi.fn()
}));

const performanceMocks = vi.hoisted(() => ({
  end: vi.fn(),
  startPerformanceSpan: vi.fn((_label: string) => ({
    startedAt: 250,
    traceName: 'ap_workflow_test',
    end: performanceMocks.end
  }))
}));

vi.mock('./telemetry', () => telemetryMocks);
vi.mock('./performanceInstrumentation', () => performanceMocks);

import { WORKFLOW_TIMING, startWorkflowTimer, timeWorkflow } from './workflowTiming';

describe('workflowTiming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares stable workflow labels for app operations', () => {
    expect(WORKFLOW_TIMING).toMatchObject({
      scheduleCreateGame: 'schedule create game',
      scheduleImport: 'schedule import',
      teamMediaPhotoUpload: 'team media photo upload',
      standardTrackerRecordStat: 'standard tracker record stat'
    });
  });

  it('records workflow telemetry and performance spans with merged metadata', () => {
    const timer = startWorkflowTimer(WORKFLOW_TIMING.scheduleCreateGame, {
      route: 'schedule'
    });
    timer.end({ refreshed: true });

    expect(telemetryMocks.recordAppWorkflowTiming).toHaveBeenCalledWith(
      WORKFLOW_TIMING.scheduleCreateGame,
      250,
      expect.objectContaining({
        category: 'workflow',
        workflowName: WORKFLOW_TIMING.scheduleCreateGame,
        route: 'schedule',
        refreshed: true
      })
    );
    expect(performanceMocks.end).toHaveBeenCalledWith(expect.objectContaining({
      workflowName: WORKFLOW_TIMING.scheduleCreateGame,
      refreshed: true
    }));
  });

  it('records failed timed workflows before rethrowing', async () => {
    const failure = new Error('Nope');

    await expect(timeWorkflow('failing workflow', { route: 'test' }, async () => {
      throw failure;
    })).rejects.toThrow('Nope');

    expect(telemetryMocks.recordAppWorkflowTiming).toHaveBeenCalledWith(
      'failing workflow',
      250,
      expect.objectContaining({
        route: 'test',
        error: failure
      })
    );
  });
});
