import {
  canSubmitScheduleEventRsvp,
  normalizeRsvpResponse,
  type ParentScheduleEvent,
  type RsvpResponse
} from './scheduleLogic';

export const maxBulkRsvpEvents = 50;
const recentlyStartedEventWindowMs = 3 * 60 * 60 * 1000;

export function getBulkRsvpCandidates(
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
    })
    .slice(0, maxBulkRsvpEvents);
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
    if (group.length > 1 && group.length === scheduleCount && savedNotes.size === 1) {
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
