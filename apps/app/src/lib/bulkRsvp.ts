import {
  canSubmitScheduleEventRsvp,
  normalizeRsvpResponse,
  type ParentScheduleEvent,
  type RsvpResponse
} from './scheduleLogic';

export const maxBulkRsvpEvents = 50;
export const maxGroupedRsvpPlayerIds = 10;
/** Keep each bulk RSVP persistence workflow small enough to avoid client-side write bursts. */
export const bulkRsvpSubmissionConcurrency = 4;
const recentlyStartedEventWindowMs = 3 * 60 * 60 * 1000;

function getEligibleBulkRsvpCandidates(
  events: ParentScheduleEvent[],
  now = new Date()
) {
  const seenEventKeys = new Set<string>();
  return [...events]
    .filter((event) => (
      event.isLinkedParentChild === true
      && Boolean(event.childId)
      && !event.childId.startsWith('staff-team-')
      && canSubmitScheduleEventRsvp(event)
      && event.date.getTime() >= now.getTime() - recentlyStartedEventWindowMs
    ))
    .sort((left, right) => left.date.getTime() - right.date.getTime())
    .filter((event) => {
      if (seenEventKeys.has(event.eventKey)) return false;
      seenEventKeys.add(event.eventKey);
      return true;
    });
}

export async function runBulkRsvpSubmissionQueue<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = bulkRsvpSubmissionConcurrency
) {
  const results = new Array<R>(items.length);
  const maxConcurrency = Math.max(1, Math.floor(concurrency) || 1);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, items.length) }, runWorker)
  );
  return results;
}

export function getBulkRsvpCandidates(
  events: ParentScheduleEvent[],
  now = new Date()
) {
  return getEligibleBulkRsvpCandidates(events, now)
    .slice(0, maxBulkRsvpEvents);
}

export function getInitialBulkRsvpCandidates(
  events: ParentScheduleEvent[],
  visibleGroupLimit: number,
  now = new Date()
) {
  const candidates = getEligibleBulkRsvpCandidates(events, now);
  const normalizedLimit = Math.max(0, Math.floor(visibleGroupLimit));
  const visibleGroupKeys = new Set(
    groupBulkRsvpEvents(candidates)
      .slice(0, normalizedLimit)
      .map((group) => `${group[0]?.teamId}::${group[0]?.id}`)
  );
  return candidates.filter((event) => visibleGroupKeys.has(`${event.teamId}::${event.id}`));
}

export function getNeededBulkRsvpEventKeys(events: ParentScheduleEvent[]) {
  return events
    .filter((event) => normalizeRsvpResponse(event.myRsvp) === 'not_responded')
    .map((event) => event.eventKey);
}

export function getBulkRsvpNoteReadyCandidates(events: ParentScheduleEvent[]) {
  return events.filter((event) => event.myRsvpNoteHydrated === true);
}

export function groupBulkRsvpEvents(events: ParentScheduleEvent[]) {
  const groups = new Map<string, ParentScheduleEvent[]>();
  events.forEach((event) => {
    const key = `${event.teamId}::${event.id}`;
    groups.set(key, [...(groups.get(key) || []), event]);
  });
  return [...groups.values()];
}

export function groupBulkRsvpSubmissions(
  selectedEvents: ParentScheduleEvent[],
  scheduleEvents: ParentScheduleEvent[]
) {
  const scheduleCountByEvent = new Map<string, number>();
  scheduleEvents.forEach((event) => {
    const key = `${event.teamId}::${event.id}`;
    scheduleCountByEvent.set(key, (scheduleCountByEvent.get(key) || 0) + 1);
  });

  return groupBulkRsvpEvents(selectedEvents).flatMap((group) => {
    const first = group[0];
    if (!first) return [];
    const scheduleCount = scheduleCountByEvent.get(`${first.teamId}::${first.id}`) || 0;
    const savedNotes = new Set(group.map((event) => String(event.myRsvpNote || '').trim()));
    if (
      group.length > 1
      && group.length <= maxGroupedRsvpPlayerIds
      && group.length === scheduleCount
      && savedNotes.size === 1
    ) {
      return [group];
    }
    return group.map((event) => [event]);
  });
}

export function applyBulkRsvpResponse(
  events: ParentScheduleEvent[],
  eventKeys: Set<string>,
  response: Exclude<RsvpResponse, 'not_responded'>
) {
  return events.map((event) => (
    eventKeys.has(event.eventKey)
      ? { ...event, myRsvp: response }
      : event
  ));
}

export function getBulkRsvpResultMessage(
  savedCount: number,
  failedCount: number,
  response: Exclude<RsvpResponse, 'not_responded'>
) {
  const responseLabel = response === 'not_going' ? "can't go" : response;
  if (!failedCount) {
    return `${savedCount} ${savedCount === 1 ? 'RSVP' : 'RSVPs'} saved as ${responseLabel}.`;
  }
  return `${savedCount} saved; ${failedCount} ${failedCount === 1 ? 'RSVP needs' : 'RSVPs need'} another try.`;
}
