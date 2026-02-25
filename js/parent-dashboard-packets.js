function toDateSafe(value) {
  if (!value) return null;
  const d = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d?.getTime?.()) ? null : d;
}

export function resolvePracticePacketSessionIdForEvent(event, allPracticePacketSessions = []) {
  if (event?.practiceSessionId) return event.practiceSessionId;
  const sessions = Array.isArray(allPracticePacketSessions) ? allPracticePacketSessions : [];
  if (!sessions.length) return null;

  const eventIds = [event?.eventId, event?.id, event?.calendarEventUid, event?.uid].filter(Boolean);
  if (!eventIds.length) return null;

  const direct = sessions.find((row) => eventIds.includes(row?.eventId));
  if (direct?.sessionId) return direct.sessionId;

  const eventDate = toDateSafe(event?.date);
  const recurringCandidates = sessions.filter((row) =>
    eventIds.some((id) => typeof row?.eventId === 'string' && row.eventId.startsWith(`${id}__`))
  );
  if (!recurringCandidates.length) return null;
  if (!eventDate) return recurringCandidates[0]?.sessionId || null;

  recurringCandidates.sort((a, b) => {
    const at = toDateSafe(a?.date)?.getTime?.() || 0;
    const bt = toDateSafe(b?.date)?.getTime?.() || 0;
    return Math.abs(at - eventDate.getTime()) - Math.abs(bt - eventDate.getTime());
  });
  return recurringCandidates[0]?.sessionId || null;
}
