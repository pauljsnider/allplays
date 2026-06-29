import { startWorkflowTimer } from './workflowTiming';

export const PARENT_CORE_WORKFLOW_NAME = 'parent core workflow drill in';

type ParentCoreWorkflowMeta = Record<string, unknown>;

type PendingParentCoreWorkflow = {
  timer: ReturnType<typeof startWorkflowTimer>;
  targetPage: string;
  targetRoute: string;
};

let pendingParentCoreWorkflow: PendingParentCoreWorkflow | null = null;

export function startParentCoreWorkflowTimer(meta: ParentCoreWorkflowMeta = {}) {
  const targetRoute = String(meta.targetRoute || '');
  const targetPage = String(meta.targetPage || inferParentCoreTargetPage(targetRoute));
  pendingParentCoreWorkflow = {
    targetPage,
    targetRoute,
    timer: startWorkflowTimer(PARENT_CORE_WORKFLOW_NAME, {
      category: 'workflow',
      source: 'parent_core',
      sourcePage: meta.sourcePage || 'unknown',
      sourceRoute: meta.sourceRoute || getCurrentRoute(),
      targetPage,
      targetRoute,
      trigger: meta.trigger || '',
      actionKind: meta.actionKind || '',
      itemId: meta.itemId || '',
      teamId: meta.teamId || '',
      playerId: meta.playerId || '',
      eventId: meta.eventId || ''
    })
  };
}

export function completeParentCoreWorkflowTimer(targetPage: string, meta: ParentCoreWorkflowMeta = {}) {
  if (!pendingParentCoreWorkflow) return false;
  const normalizedTargetPage = String(targetPage || '').trim();
  if (normalizedTargetPage && pendingParentCoreWorkflow.targetPage !== normalizedTargetPage) {
    return false;
  }

  const pending = pendingParentCoreWorkflow;
  pendingParentCoreWorkflow = null;
  pending.timer.end({
    completedPage: normalizedTargetPage || pending.targetPage,
    completedRoute: meta.completedRoute || getCurrentRoute(),
    expectedTargetRoute: pending.targetRoute,
    ...meta
  });
  return true;
}

export function inferParentCoreTargetPage(targetRoute: string) {
  const route = String(targetRoute || '').split('?')[0].toLowerCase();
  if (route.startsWith('/schedule/') && route.split('/').filter(Boolean).length >= 3) return 'schedule_event';
  if (route.startsWith('/schedule')) return 'schedule';
  if (route.startsWith('/players/')) return 'player';
  if (route.startsWith('/teams')) return 'teams';
  if (route.startsWith('/messages')) return 'messages';
  if (route.startsWith('/parent-tools/fees')) return 'fees';
  if (route.startsWith('/parent-tools')) return 'parent_tools';
  if (route.startsWith('/officials')) return 'officials';
  return 'core_page';
}

export function resetParentCoreWorkflowTimerForTests() {
  pendingParentCoreWorkflow = null;
}

function getCurrentRoute() {
  if (typeof window === 'undefined') return '';
  return window.location.hash || `${window.location.pathname || ''}${window.location.search || ''}`;
}
