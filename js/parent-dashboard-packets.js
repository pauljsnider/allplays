function toDateSafe(value) {
  if (!value) return null;
  const d = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d?.getTime?.()) ? null : d;
}

function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
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

export function resolvePracticePacketContextForEvent(event, allPracticePacketSessions = []) {
  const sessions = Array.isArray(allPracticePacketSessions) ? allPracticePacketSessions : [];
  if (!event || !sessions.length) {
    return { sessionId: null, homePacket: null };
  }

  const directSessionId = resolvePracticePacketSessionIdForEvent(event, sessions);
  if (directSessionId) {
    const direct = sessions.find((row) => row?.sessionId === directSessionId) || null;
    return { sessionId: directSessionId, homePacket: direct?.homePacket || null };
  }

  const teamId = String(event?.teamId || '').trim();
  const eventDate = toDateSafe(event?.date);
  if (!teamId || !eventDate) {
    return { sessionId: null, homePacket: null };
  }

  // Fallback when eventId/session linkage is missing: use nearest same-team session on the same day.
  const eventStart = new Date(eventDate);
  eventStart.setHours(0, 0, 0, 0);
  const eventEnd = new Date(eventStart);
  eventEnd.setDate(eventEnd.getDate() + 1);
  const eventTitle = normalizeTitle(event?.title || '');

  const sameTeamDay = sessions.filter((row) => {
    if (String(row?.teamId || '').trim() !== teamId) return false;
    const rowDate = toDateSafe(row?.date);
    if (!rowDate) return false;
    return rowDate >= eventStart && rowDate < eventEnd;
  });

  if (!sameTeamDay.length) {
    return { sessionId: null, homePacket: null };
  }

  sameTeamDay.sort((a, b) => {
    const at = toDateSafe(a?.date)?.getTime?.() || 0;
    const bt = toDateSafe(b?.date)?.getTime?.() || 0;
    const aDiff = Math.abs(at - eventDate.getTime());
    const bDiff = Math.abs(bt - eventDate.getTime());
    if (aDiff !== bDiff) return aDiff - bDiff;

    const aTitle = normalizeTitle(a?.title || '');
    const bTitle = normalizeTitle(b?.title || '');
    const aTitleMatch = eventTitle && aTitle && aTitle === eventTitle ? 0 : 1;
    const bTitleMatch = eventTitle && bTitle && bTitle === eventTitle ? 0 : 1;
    if (aTitleMatch !== bTitleMatch) return aTitleMatch - bTitleMatch;

    return at - bt;
  });

  const chosen = sameTeamDay[0] || null;
  return {
    sessionId: chosen?.sessionId || null,
    homePacket: chosen?.homePacket || null
  };
}
