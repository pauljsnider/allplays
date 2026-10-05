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
  getAppDataCacheInvalidationToken,
  getParentHomeSecondaryCacheKey,
  getParentScheduleSummaryCacheKey,
  getTeamsSummaryBootstrapCacheKey,
  loadCachedAppData
} from './appDataCache';
import { toAppServiceError } from './appErrors';
import { listParentTeamFeeRecipientsForApp } from './parentFeeRecipientsService';
import { isNativeRuntime } from './nativeRuntime';
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
const homeMaxStaleMs = 5 * 60 * 1000;
const teamsSummaryTtlMs = 30 * 1000;
const logger = createLogger('home');

type ParentSchedulePreviewState = {
  invalidationToken: string;
  callbacks: Set<(schedule: ParentScheduleLoadResult) => void>;
  subscribers: Set<ParentScheduleSummaryOptions>;
  background?: { promise: Promise<ParentScheduleLoadResult>; value: ParentScheduleLoadResult; usableUntil: number };
  latest?: ParentScheduleLoadResult;
  promise?: Promise<ParentScheduleLoadResult>;
};

const parentSchedulePreviewStates = new Map<string, ParentSchedulePreviewState>();
let parentSchedulePreviewRequestId = 0;

type ParentHomeNativeLoadContext = {
  loadProfile: () => Promise<Record<string, unknown>>;
  loadManagedTeams: () => Promise<{ teams: any[]; isPartial: boolean }>;
};

type ParentHomeSummaryBootstrapResult = {
  home: ParentHomeModel;
  schedule: ParentScheduleLoadResult;
  nativeContext?: ParentHomeNativeLoadContext;
};

type ParentHomeSummaryOptions = {
  force?: boolean;
  scheduleScope?: ParentScheduleScope;
  nativeContext?: ParentHomeNativeLoadContext;
  onBackgroundError?: (error: unknown) => void;
};

type ParentScheduleSummaryOptions = ParentHomeSummaryOptions & {
  previewParentChildren?: boolean;
  onPartial?: (schedule: ParentScheduleLoadResult) => void;
  onRefresh?: (schedule: ParentScheduleLoadResult) => void;
};

type ParentHomeSummaryBootstrapOptions = ParentHomeSummaryOptions & {
  onPartial?: (result: ParentHomeSummaryBootstrapResult) => void;
  onRefresh?: (result: ParentHomeSummaryBootstrapResult) => void;
};

type ParentTeamsSummaryBootstrapOptions = {
  force?: boolean;
  onPartial?: (home: ParentHomeModel) => void;
};

function createParentHomeNativeLoadContext(userId: string): ParentHomeNativeLoadContext | undefined {
  if (!isNativeRuntime()) return undefined;
  let profilePromise: Promise<Record<string, unknown>> | null = null;
  let managedTeamsPromise: Promise<{ teams: any[]; isPartial: boolean }> | null = null;
  return {
    loadProfile: () => {
      if (!profilePromise) {
        profilePromise = import('./nativeHomeLoaders').then(({ loadNativeHomeProfile }) => loadNativeHomeProfile(userId));
      }
      return profilePromise;
    },
    loadManagedTeams: () => {
      if (!managedTeamsPromise) {
        managedTeamsPromise = import('./nativeHomeLoaders').then(({ loadNativeHomeManagedTeams }) => (
          loadNativeHomeManagedTeams()
        ));
      }
      return managedTeamsPromise;
    }
  };
}

function normalizeSecondaryError(error: unknown, fallbackMessage: string) {
  return toAppServiceError(error, fallbackMessage);
}

function requireCompleteChatInbox<T extends { isPartial?: boolean }>(chatInbox: T): T {
  if (chatInbox.isPartial === true) {
    throw new Error('Home chat access is incomplete. Try loading Home again.');
  }
  return chatInbox;
}

export async function loadParentHome(user: AuthUser | null): Promise<ParentHomeModel> {
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  const schedule = await loadParentScheduleSummary(user);
  const [chatInbox, rawFees] = await Promise.all([
    loadChatInbox(user).then(requireCompleteChatInbox).catch((error) => {
      throw toAppServiceError(error, 'Unable to load Home chat.');
    }),
    listParentTeamFeeRecipientsForApp(user.uid, schedule.children).catch((error) => {
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

export async function loadParentSearchTeamsSummary(user: AuthUser | null): Promise<ParentHomeModel> {
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  const scheduleScope = await loadParentScheduleScope(user);
  if (scheduleScope.isPartial === true) {
    throw toAppServiceError(
      new Error('Search team access discovery is incomplete. Try searching again.'),
      'Unable to load search teams.'
    );
  }

  return buildParentHomeModel({
    children: scheduleScope.children,
    events: [],
    inboxTeams: normalizeStaffTeams({
      children: [],
      events: [],
      staffTeams: scheduleScope.staffTeams
    }),
    fees: []
  });
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

  const nativeContext = options.nativeContext || createParentHomeNativeLoadContext(user.uid);
  const toBootstrapResult = (schedule: ParentScheduleLoadResult): ParentHomeSummaryBootstrapResult => ({
    home: buildParentHomeModel({
      children: schedule.children,
      events: schedule.events,
      inboxTeams: normalizeStaffTeams(schedule),
      fees: []
    }),
    schedule,
    ...(nativeContext ? { nativeContext } : {})
  });
  const schedule = await loadParentScheduleSummary(user, {
    previewParentChildren: true,
    force: options.force,
    scheduleScope: options.scheduleScope,
    nativeContext,
    ...(options.onPartial ? {
      onPartial: (partialSchedule) => options.onPartial?.(toBootstrapResult(partialSchedule))
    } : {}),
    ...(options.onRefresh ? {
      onRefresh: (refreshedSchedule) => options.onRefresh?.(toBootstrapResult(refreshedSchedule))
    } : {}),
    ...(options.onBackgroundError ? {
      onBackgroundError: options.onBackgroundError
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
  options: ParentTeamsSummaryBootstrapOptions = {}
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
        let availableChatTeams: any[] = [];
        let availableScheduleScope: ParentScheduleScope | null = null;
        const emitAvailableTeams = () => {
          const model = buildParentHomeModel({
            children: availableScheduleScope?.children || [],
            events: [],
            inboxTeams: mergeTeamSummaries(
              normalizeStaffTeams({ children: [], events: [], staffTeams: availableScheduleScope?.staffTeams }),
              normalizeInboxTeams(availableChatTeams)
            ),
            fees: []
          });
          // A verified nonempty result can unblock the chooser while slower,
          // unrelated family-scope reads finish. Empty or failed slices stay
          // fail-closed until the complete bootstrap result is known.
          if (model.teams.length > 0) options.onPartial?.(model);
        };
        const [chatInboxResult, scheduleScope] = await Promise.all([
          loadChatInbox(user, { includeLastMessages: false })
            .then(requireCompleteChatInbox)
            .then((chatInbox) => {
              availableChatTeams = chatInbox.teams || [];
              emitAvailableTeams();
              return { chatInbox, error: null };
            })
            .catch((error) => ({
              chatInbox: { teams: [] },
              error: toAppServiceError(error, 'Unable to load team chat.')
            })),
          loadParentScheduleScope(user)
            .then((scheduleScope) => {
              availableScheduleScope = scheduleScope;
              emitAvailableTeams();
              return scheduleScope;
            })
            .catch((error) => {
              throw toAppServiceError(error, 'Unable to load teams.');
            })
        ]);
        const hasDiscoveredTeams = scheduleScope.children.length > 0 || Boolean(scheduleScope.staffTeams?.length);
        if (scheduleScope.isPartial === true && !hasDiscoveredTeams) {
          if (chatInboxResult.error) {
            throw chatInboxResult.error;
          }
          throw toAppServiceError(
            new Error('Team access discovery is incomplete. Try loading teams again.'),
            'Unable to load teams.'
          );
        }
        if (chatInboxResult.error) {
          logger.warn('Team chat summary failed; using schedule access for the team chooser.', {
            error: chatInboxResult.error
          });
        }
        const model = buildParentHomeModel({
          children: scheduleScope.children,
          events: [],
          inboxTeams: mergeTeamSummaries(
            normalizeStaffTeams({ children: [], events: [], staffTeams: scheduleScope.staffTeams }),
            normalizeInboxTeams(chatInboxResult.chatInbox.teams || [])
          ),
          fees: []
        });
        timer.end({
          children: scheduleScope.children.length,
          teams: model.teams.length,
          inboxTeams: chatInboxResult.chatInbox.teams?.length || 0,
          chatPartial: Boolean(chatInboxResult.error)
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
    {
      ttlMs: teamsSummaryTtlMs,
      force: options.force,
      persist: false,
      shouldCache: (result) => result.scheduleScope.isPartial !== true
    }
  );
}

export async function loadParentHomeWithSecondaryData(
  user: AuthUser | null,
  options: {
    force?: boolean;
    schedule?: ParentScheduleLoadResult;
    nativeContext?: ParentHomeNativeLoadContext;
    onPartial?: (model: ParentHomeModel) => void;
    onBackgroundError?: (error: unknown) => void;
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
    // A failed slice leaves the streamed preview available, but the final load
    // rejects so Home labels it retryable and never caches empty fallback data
    // as authoritative chat, fee, or schedule state.
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
        const appError = normalizeSecondaryError(error, 'Unable to hydrate Home schedule.');
        logger.warn('Schedule hydration failed.', { error: appError });
        throw appError;
      }),
      loadChatInbox(user, options.nativeContext ? {
        nativeProfileLoader: options.nativeContext.loadProfile,
        nativeManagedTeamsLoader: options.nativeContext.loadManagedTeams
      } : {}).then((chatInbox) => {
        const nextInboxTeams = normalizeInboxTeams(chatInbox.teams || []);
        emit({ inboxTeams: nextInboxTeams });
        requireCompleteChatInbox(chatInbox);
        return nextInboxTeams;
      }).catch((error) => {
        const appError = normalizeSecondaryError(error, 'Unable to load Home chat.');
        logger.warn('Chat inbox failed.', { error: appError });
        throw appError;
      }),
      listParentTeamFeeRecipientsForApp(user.uid, children).then((rawFees) => {
        const nextFees = (rawFees || []).map((fee: any) => normalizeParentFeeRecord(fee));
        emit({ fees: nextFees });
        return nextFees;
      }).catch((error) => {
        const appError = normalizeSecondaryError(error, 'Unable to load Home fees.');
        logger.warn('Fees failed.', { error: appError });
        throw appError;
      })
    ]);

    const failedSlice = results.find((result) => result.status === 'rejected');
    if (failedSlice?.status === 'rejected') {
      throw failedSlice.reason;
    }

    const [scheduleResult, chatResult, feesResult] = results;
    return buildParentHomeModel({
      children: scheduleResult.status === 'fulfilled' && scheduleResult.value ? scheduleResult.value.children : partialState.children,
      events: scheduleResult.status === 'fulfilled' && scheduleResult.value ? scheduleResult.value.events : partialState.events,
      inboxTeams: chatResult.status === 'fulfilled' ? chatResult.value : partialState.inboxTeams,
      fees: feesResult.status === 'fulfilled' ? feesResult.value : partialState.fees
    });
  }, {
    ttlMs: homeSecondaryTtlMs,
    force: options.force,
    maxStaleMs: homeMaxStaleMs,
    staleWhileRevalidate: true,
    onRefresh: onPartial || undefined,
    onRefreshError: options.onBackgroundError
  });
}

export async function loadParentScheduleSummary(
  user: AuthUser | null,
  options: ParentScheduleSummaryOptions = {}
): Promise<ParentScheduleLoadResult> {
  if (!user?.uid) return { children: [], events: [] };
  const hasScopedStaffTeams = Boolean(options.scheduleScope?.staffTeams?.length);
  const cacheKey = getParentScheduleSummaryCacheKey(user.uid);
  const force = Boolean(options.force || hasScopedStaffTeams);
  const invalidationToken = getAppDataCacheInvalidationToken(cacheKey);
  if (options.previewParentChildren && !force) {
    const activePreview = parentSchedulePreviewStates.get(cacheKey);
    if (activePreview?.promise && activePreview.invalidationToken === invalidationToken) {
      activePreview.subscribers.add(options);
      if (activePreview.background) {
        return Date.now() < activePreview.background.usableUntil
          ? activePreview.background.value
          : activePreview.background.promise;
      }
      registerParentSchedulePreviewCallback(activePreview, options.onPartial);
      return activePreview.promise;
    }
  }

  const previewState: ParentSchedulePreviewState | undefined = options.previewParentChildren
    ? { invalidationToken, callbacks: new Set<(schedule: ParentScheduleLoadResult) => void>(), subscribers: new Set([options]) }
    : undefined;
  if (previewState) registerParentSchedulePreviewCallback(previewState, options.onPartial);
  let initializing = true;
  const initialPartials: ParentScheduleLoadResult[] = [];
  const cleanup = () => {
    if (!previewState) return;
    previewState.callbacks.clear();
    previewState.subscribers.clear();
    if (parentSchedulePreviewStates.get(cacheKey) === previewState) parentSchedulePreviewStates.delete(cacheKey);
  };
  let terminalSubscribers: ParentScheduleSummaryOptions[] | undefined;
  const settlePreview = () => {
    if (!terminalSubscribers) {
      terminalSubscribers = [...(previewState?.subscribers ?? [])];
      // Terminal callbacks can synchronously reload Home. Detach before fanout
      // so reentry reads the committed cache and cannot extend this dispatch.
      cleanup();
    }
    return terminalSubscribers;
  };
  if (previewState) parentSchedulePreviewStates.set(cacheKey, previewState);
  const previewScope = previewState ? `home-parent-preview:${++parentSchedulePreviewRequestId}` : undefined;
  const loadPromise = loadCachedAppData(
    cacheKey,
    () => loadParentSchedule(user, {
      hydrateDetails: false,
      expandStaffPlayers: false,
      previewParentChildren: options.previewParentChildren,
      ...(options.scheduleScope ? { parentScope: options.scheduleScope } : {}),
      ...(options.nativeContext ? {
        nativeProfileLoader: options.nativeContext.loadProfile,
        nativeStaffTeamsLoader: options.nativeContext.loadManagedTeams
      } : {}),
      ...(previewState
        ? { onPartial: (schedule: ParentScheduleLoadResult) => {
          if (initializing) initialPartials.push(schedule);
          else if (!previewState.background) emitParentSchedulePreview(previewState, schedule);
        } }
        : options.onPartial ? { onPartial: options.onPartial } : {})
    }),
    {
      ttlMs: homeSummaryTtlMs,
      force,
      inFlightScope: previewScope,
      maxStaleMs: homeMaxStaleMs,
      staleWhileRevalidate: true,
      onBackgroundLoad: previewState ? (request) => {
        previewState.background = request;
      } : undefined,
      onRefresh: previewState
        ? (schedule) => settlePreview().forEach((subscriber) => subscriber.onPartial?.(schedule))
        : options.onPartial,
      onBackgroundRefresh: previewState
        ? (schedule) => settlePreview().forEach((subscriber) => subscriber.onRefresh?.(schedule))
        : options.onRefresh,
      onRefreshError: previewState
        ? (error) => settlePreview().forEach((subscriber) => subscriber.onBackgroundError?.(error))
        : options.onBackgroundError,
      shouldCache: (result) => result?.isPartial !== true
    }
  );
  initializing = false;
  if (previewState) {
    previewState.promise = loadPromise;
    if (!previewState.background) initialPartials.forEach((schedule) => emitParentSchedulePreview(previewState, schedule));
  }
  try {
    return await loadPromise;
  } finally {
    if (!previewState?.background) cleanup();
  }
}

function registerParentSchedulePreviewCallback(
  state: ParentSchedulePreviewState,
  callback?: (schedule: ParentScheduleLoadResult) => void
) {
  if (!callback) return;
  state.callbacks.add(callback);
  if (state.latest) callback(state.latest);
}

function emitParentSchedulePreview(state: ParentSchedulePreviewState, schedule: ParentScheduleLoadResult) {
  state.latest = schedule;
  state.callbacks.forEach((callback) => callback(schedule));
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

function mergeTeamSummaries(
  staffTeams: ParentHomeInboxTeam[],
  inboxTeams: ParentHomeInboxTeam[]
): ParentHomeInboxTeam[] {
  const teamsById = new Map(staffTeams.map((team) => [team.id, team]));
  inboxTeams.forEach((team) => {
    const staffTeam = teamsById.get(team.id);
    teamsById.set(team.id, {
      ...staffTeam,
      ...team,
      role: staffTeam?.role || team.role
    });
  });
  return [...teamsById.values()];
}
