import { listParentTeamFeeRecipients } from './adapters/legacyHomeFees';
import { normalizeParentFeeRecord } from './adapters/legacyHomeFees';
import { loadChatInbox } from './chatService';
import { startUxTimer } from './uxTiming';
import {
  buildParentHomeModel,
  type ParentHomeInboxTeam,
  type ParentHomeModel
} from './homeLogic';
import { createLogger } from './logger';
import {
  getParentHomeSecondaryCacheKey,
  getParentScheduleSummaryCacheKey,
  getTeamsSummaryBootstrapCacheKey,
  loadCachedAppData
} from './appDataCache';
import { toAppServiceError, type AppServiceError } from './appErrors';
import {
  hydrateParentScheduleDetails,
  loadParentSchedule,
  loadParentScheduleScope,
  type ParentScheduleLoadResult,
  type ParentScheduleScope
} from './scheduleService';
import type { AuthUser } from './types';

const homeSummaryTtlMs = 45 * 1000;
const homeSecondaryTtlMs = 30 * 1000;
const teamsSummaryTtlMs = 30 * 1000;
const logger = createLogger('home');

type ParentHomeSummaryBootstrapResult = {
  home: ParentHomeModel;
  schedule: ParentScheduleLoadResult;
};

type ParentHomeSummaryOptions = {
  force?: boolean;
  scheduleScope?: ParentScheduleScope;
};

type ParentHomeSummaryBootstrapOptions = ParentHomeSummaryOptions & {
  onPartial?: (result: ParentHomeSummaryBootstrapResult) => void;
};

function rethrowIfPermissionError(error: unknown, fallbackMessage: string) {
  const appError = toAppServiceError(error, fallbackMessage);
  if (appError.type === 'permission') {
    throw appError;
  }
  return appError;
}

function throwIfAllSecondarySlicesFailed(errors: AppServiceError[]) {
  if (errors.length >= 3) {
    throw errors[0];
  }
}

export async function loadParentHome(user: AuthUser | null): Promise<ParentHomeModel> {
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  const schedule = await loadParentScheduleSummary(user);
  const [chatInbox, rawFees] = await Promise.all([
    loadChatInbox(user).catch((error) => {
      throw toAppServiceError(error, 'Unable to load Home chat.');
    }),
    Promise.resolve(listParentTeamFeeRecipients(user.uid, schedule.children)).catch((error) => {
      throw toAppServiceError(error, 'Unable to load Home fees.');
    })
  ]);

  return buildParentHomeModel({
    children: schedule.children,
    events: schedule.events,
    inboxTeams: normalizeInboxTeams(chatInbox.teams || []),
    fees: (rawFees || []).map((fee: any) => normalizeParentFeeRecord(fee))
  });
}

export async function loadParentHomeSummary(
  user: AuthUser | null,
  options: ParentHomeSummaryOptions = {}
): Promise<ParentHomeModel> {
  const summary = await loadParentHomeSummaryBootstrap(user, options);
  return summary.home;
}

export async function loadParentHomeSummaryBootstrap(
  user: AuthUser | null,
  options: ParentHomeSummaryBootstrapOptions = {}
): Promise<ParentHomeSummaryBootstrapResult> {
  if (!user?.uid) {
    const schedule = { children: [], events: [] };
    return {
      home: buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] }),
      schedule
    };
  }

  const toBootstrapResult = (schedule: ParentScheduleLoadResult): ParentHomeSummaryBootstrapResult => ({
    home: buildParentHomeModel({
      children: schedule.children,
      events: schedule.events,
      inboxTeams: normalizeStaffTeams(schedule),
      fees: []
    }),
    schedule
  });
  const schedule = await loadParentScheduleSummary(user, {
    force: options.force,
    scheduleScope: options.scheduleScope,
    ...(options.onPartial ? {
      onPartial: (partialSchedule) => options.onPartial?.(toBootstrapResult(partialSchedule))
    } : {})
  });
  return toBootstrapResult(schedule);
}

export async function loadParentTeamsSummary(user: AuthUser | null, options: { force?: boolean } = {}): Promise<ParentHomeModel> {
  const summary = await loadParentTeamsSummaryBootstrap(user, options);
  return summary.home;
}

export async function loadParentTeamsSummaryBootstrap(
  user: AuthUser | null,
  options: { force?: boolean } = {}
): Promise<{ home: ParentHomeModel; scheduleScope: ParentScheduleScope }> {
  if (!user?.uid) {
    return {
      home: buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] }),
      scheduleScope: { profile: {}, children: [] }
    };
  }

  return loadCachedAppData(
    getTeamsSummaryBootstrapCacheKey(user.uid),
    async () => {
      const timer = startUxTimer('teams summary load');
      try {
        const [chatInbox, scheduleScope] = await Promise.all([
          loadChatInbox(user, { includeLastMessages: false }).catch((error) => {
            throw toAppServiceError(error, 'Unable to load teams.');
          }),
          loadParentScheduleScope(user)
        ]);
        const model = buildParentHomeModel({
          children: scheduleScope.children,
          events: [],
          inboxTeams: normalizeInboxTeams(chatInbox.teams || []),
          fees: []
        });
        timer.end({
          children: scheduleScope.children.length,
          teams: model.teams.length,
          inboxTeams: chatInbox.teams?.length || 0
        });
        return {
          home: model,
          scheduleScope
        };
      } catch (error: any) {
        timer.end({ error: error?.message || 'Unable to load team summary.' });
        throw error;
      }
    },
    { ttlMs: teamsSummaryTtlMs, force: options.force, persist: false }
  );
}

export async function loadParentHomeWithSecondaryData(
  user: AuthUser | null,
  options: {
    force?: boolean;
    schedule?: ParentScheduleLoadResult;
    onPartial?: (model: ParentHomeModel) => void;
  } = {}
): Promise<ParentHomeModel> {
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  const onPartial = typeof options.onPartial === 'function' ? options.onPartial : null;
  const cacheKey = getParentHomeSecondaryCacheKey(user.uid);
  return loadCachedAppData(cacheKey, async () => {
    const schedule = options.schedule || await loadParentScheduleSummary(user, { force: options.force });
    const { children, events } = schedule;
    let partialState = {
      children,
      events,
      inboxTeams: [] as ParentHomeInboxTeam[],
      fees: [] as any[]
    };

    const emit = (patch: Partial<typeof partialState>) => {
      partialState = { ...partialState, ...patch };
      onPartial?.(buildParentHomeModel(partialState));
    };

    // Stream each secondary slice independently so Home renders schedule cards
    // immediately and fills in chat badges / fee items / hydrated RSVP states as
    // each arrives, instead of blocking on all of them before any update (#2037).
    // A per-slice failure degrades that card rather than gating the whole page.
    const secondaryErrors: AppServiceError[] = [];
    const results = await Promise.allSettled([
      hydrateParentScheduleDetails(schedule, user).then((hydratedSchedule) => {
        const nextSchedule = hydratedSchedule || schedule;
        const patch = {
          children: Array.isArray(nextSchedule.children) ? nextSchedule.children : children,
          events: Array.isArray(nextSchedule.events) ? nextSchedule.events : events
        };
        emit(patch);
        return patch;
      }).catch((error) => {
        const appError = rethrowIfPermissionError(error, 'Unable to hydrate Home schedule.');
        secondaryErrors.push(appError);
        logger.warn('Schedule hydration failed.', { error: appError });
        return null;
      }),
      loadChatInbox(user).then((chatInbox) => {
        const nextInboxTeams = normalizeInboxTeams(chatInbox.teams || []);
        emit({ inboxTeams: nextInboxTeams });
        return nextInboxTeams;
      }).catch((error) => {
        const appError = rethrowIfPermissionError(error, 'Unable to load Home chat.');
        secondaryErrors.push(appError);
        logger.warn('Chat inbox failed.', { error: appError });
        return [];
      }),
      Promise.resolve(listParentTeamFeeRecipients(user.uid, children)).then((rawFees) => {
        const nextFees = (rawFees || []).map((fee: any) => normalizeParentFeeRecord(fee));
        emit({ fees: nextFees });
        return nextFees;
      }).catch((error) => {
        const appError = rethrowIfPermissionError(error, 'Unable to load Home fees.');
        secondaryErrors.push(appError);
        logger.warn('Fees failed.', { error: appError });
        return [];
      })
    ]);

    const permissionFailure = results.find((result) => result.status === 'rejected');
    if (permissionFailure?.status === 'rejected') {
      throw permissionFailure.reason;
    }
    throwIfAllSecondarySlicesFailed(secondaryErrors);

    const [scheduleResult, chatResult, feesResult] = results;
    return buildParentHomeModel({
      children: scheduleResult.status === 'fulfilled' && scheduleResult.value ? scheduleResult.value.children : partialState.children,
      events: scheduleResult.status === 'fulfilled' && scheduleResult.value ? scheduleResult.value.events : partialState.events,
      inboxTeams: chatResult.status === 'fulfilled' ? chatResult.value : partialState.inboxTeams,
      fees: feesResult.status === 'fulfilled' ? feesResult.value : partialState.fees
    });
  }, { ttlMs: homeSecondaryTtlMs, force: options.force });
}

export async function loadParentScheduleSummary(
  user: AuthUser | null,
  options: ParentHomeSummaryOptions & { onPartial?: (schedule: ParentScheduleLoadResult) => void } = {}
): Promise<ParentScheduleLoadResult> {
  if (!user?.uid) return { children: [], events: [] };
  return loadCachedAppData(
    getParentScheduleSummaryCacheKey(user.uid),
    () => loadParentSchedule(user, {
      hydrateDetails: false,
      expandStaffPlayers: false,
      parentScope: options.scheduleScope,
      ...(options.onPartial ? { onPartial: options.onPartial } : {})
    }),
    {
      ttlMs: homeSummaryTtlMs,
      force: options.force,
      shouldCache: (result) => result?.isPartial !== true
    }
  );
}

function normalizeStaffTeams(schedule: ParentScheduleLoadResult): ParentHomeInboxTeam[] {
  return (schedule.staffTeams || []).map((team) => ({
    id: team.teamId,
    name: team.teamName,
    role: 'Coach',
    unreadCount: 0
  }));
}

function normalizeInboxTeams(teams: any[]): ParentHomeInboxTeam[] {
  return (teams || []).map((team: any) => ({
    id: team.id,
    name: team.name || 'Team',
    role: team.role || 'Parent',
    sport: team.sport || null,
    photoUrl: team.photoUrl || null,
    unreadCount: Number(team.unreadCount || 0),
    active: team.active,
    archived: team.archived,
    status: team.status
  }));
}
