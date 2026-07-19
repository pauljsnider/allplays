import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');

describe('edit schedule external calendar rendering', () => {
  it('escapes remote ICS text before inserting calendar cards into innerHTML', () => {
    const start = source.indexOf('function renderCalendarEvent(');
    const end = source.indexOf('function buildPracticePlanHref(', start);
    const renderBlock = source.slice(start, end);

    expect(renderBlock).toContain('${escapeHtml(eventTitle)}');
    expect(renderBlock).toContain('${escapeHtml(locationLabel)}');
    expect(renderBlock).toContain('href="${escapeHtml(locationHref)}"');
    expect(renderBlock).not.toContain('${isPractice ? practiceTitle');
    expect(renderBlock).not.toContain('>${event.location ||');
  });

  it('uses a delegated click handler instead of serializing ICS fields into inline JavaScript', () => {
    expect(source).toContain('class="track-calendar-event-btn');
    expect(source).toContain("container.querySelectorAll('.track-calendar-event-btn')");
    expect(source).toContain('window.trackCalendarEvent(calendarEvent);');
    expect(source).not.toContain('onclick="window.trackCalendarEvent(');
    expect(source).not.toContain('JSON.stringify(event.calendarEvent)');
  });
});
