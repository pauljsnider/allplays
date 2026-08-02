import type { ParentScheduleLoadResult } from './scheduleService';

type ScheduleEventDetailHandoff = {
  userId: string;
  teamId: string;
  eventId: string;
  result: ParentScheduleLoadResult;
};

let pendingHandoff: ScheduleEventDetailHandoff | null = null;

export function storeScheduleEventDetailHandoff(
  userId: string,
  teamId: string,
  eventId: string,
  result: ParentScheduleLoadResult
) {
  pendingHandoff = { userId, teamId, eventId, result };
}

export function consumeScheduleEventDetailHandoff(userId: string, teamId: string, eventId: string) {
  const handoff = pendingHandoff;
  pendingHandoff = null;

  if (
    !handoff
    || handoff.userId !== userId
    || handoff.teamId !== teamId
    || handoff.eventId !== eventId
  ) {
    return null;
  }

  return handoff.result;
}

export function peekScheduleEventDetailHandoff(userId: string, teamId: string, eventId: string) {
  if (
    !pendingHandoff
    || pendingHandoff.userId !== userId
    || pendingHandoff.teamId !== teamId
    || pendingHandoff.eventId !== eventId
  ) {
    return null;
  }

  return pendingHandoff.result;
}

export function clearScheduleEventDetailHandoffForTest() {
  pendingHandoff = null;
}
