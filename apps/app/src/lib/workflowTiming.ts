import { recordAppWorkflowTiming } from './telemetry';
import { startPerformanceSpan } from './performanceInstrumentation';

type WorkflowMeta = Record<string, unknown>;

export const WORKFLOW_TIMING = {
  scheduleCreateGame: 'schedule create game',
  scheduleCreatePractice: 'schedule create practice',
  scheduleCreateTournament: 'schedule create tournament',
  scheduleImport: 'schedule import',
  scheduleAiPreview: 'schedule ai preview',
  teamMediaPhotoUpload: 'team media photo upload',
  teamMediaFileUpload: 'team media file upload',
  teamMediaAlbumCreate: 'team media album create',
  teamMediaLinkAdd: 'team media link add',
  standardTrackerLoad: 'standard tracker load',
  standardTrackerRecordStat: 'standard tracker record stat',
  standardTrackerUndoStat: 'standard tracker undo stat'
} as const;

export function startWorkflowTimer(workflowName: string, baseMeta: WorkflowMeta = {}) {
  const started = startPerformanceSpan(workflowName, {
    kind: 'workflow',
    meta: {
      category: 'workflow',
      workflowName,
      ...baseMeta
    }
  });

  return {
    end(meta: WorkflowMeta = {}) {
      const mergedMeta = {
        category: 'workflow',
        workflowName,
        ...baseMeta,
        ...meta
      };
      recordAppWorkflowTiming(workflowName, started.startedAt, mergedMeta);
      started.end(mergedMeta);
    }
  };
}

export async function timeWorkflow<T>(
  workflowName: string,
  baseMeta: WorkflowMeta,
  run: () => Promise<T>
): Promise<T> {
  const timer = startWorkflowTimer(workflowName, baseMeta);
  try {
    const result = await run();
    timer.end();
    return result;
  } catch (error) {
    timer.end({ error });
    throw error;
  }
}
