function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(value) {
    const date = toDate(value);
    if (!date) return null;
    date.setHours(0, 0, 0, 0);
    return date;
}

function endOfDay(value) {
    const date = toDate(value);
    if (!date) return null;
    date.setHours(23, 59, 59, 999);
    return date;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(value) {
    const date = toDate(value);
    if (!date) return 'TBD';
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatTime(value) {
    const date = toDate(value);
    if (!date) return 'TBD';
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit'
    });
}

function resolveEventType(event) {
    if (event?.isPractice || event?.type === 'practice') return 'practice';
    return 'game';
}

function resolveTitle(event) {
    if (event?.title) return event.title;
    if (event?.opponent) return event.isPractice ? event.opponent : `vs. ${event.opponent}`;
    return resolveEventType(event) === 'practice' ? 'Practice' : 'Game';
}

export function filterScheduleEventsForPrint(events, options = {}) {
    const rangeStart = startOfDay(options.startDate);
    const rangeEnd = endOfDay(options.endDate);
    const eventType = options.eventType || 'all';

    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return [];

    return (events || [])
        .filter((event) => {
            const eventDate = toDate(event?.date || event?.dtstart);
            if (!eventDate || eventDate < rangeStart || eventDate > rangeEnd) return false;
            if (eventType !== 'all' && resolveEventType(event) !== eventType) return false;
            return true;
        })
        .sort((a, b) => toDate(a.date || a.dtstart) - toDate(b.date || b.dtstart));
}

export function promptSchedulePrintOptions(defaults = {}) {
    const today = new Date();
    const defaultStart = defaults.startDate || today.toISOString().slice(0, 10);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const defaultEnd = defaults.endDate || monthEnd.toISOString().slice(0, 10);
    const startDate = window.prompt('Print schedule start date (YYYY-MM-DD)', defaultStart);
    if (!startDate) return null;
    const endDate = window.prompt('Print schedule end date (YYYY-MM-DD)', defaultEnd);
    if (!endDate) return null;
    const blackAndWhite = window.confirm('Print in black and white?');
    return { startDate, endDate, blackAndWhite };
}

export function renderSchedulePrintContainer(events, options = {}) {
    const container = document.createElement('section');
    container.id = 'schedule-print-container';
    container.className = `schedule-print-container${options.blackAndWhite ? ' schedule-print-bw' : ''}`;
    container.setAttribute('aria-hidden', 'true');

    const title = options.title || 'Schedule';
    const rangeLabel = `${formatDate(options.startDate)} - ${formatDate(options.endDate)}`;
    const rows = (events || []).map((event) => {
        const eventDate = toDate(event.date || event.dtstart);
        const eventEnd = toDate(event.end || event.endDate);
        const type = resolveEventType(event);
        const timeLabel = eventEnd ? `${formatTime(eventDate)} - ${formatTime(eventEnd)}` : formatTime(eventDate);
        return `
            <tr>
                <td>${escapeHtml(formatDate(eventDate))}</td>
                <td>${escapeHtml(timeLabel)}</td>
                <td>${escapeHtml(resolveTitle(event))}</td>
                <td>${escapeHtml(event.location || 'TBD')}</td>
                <td>${escapeHtml(type === 'practice' ? 'Practice' : 'Game')}</td>
                <td>${escapeHtml(event.teamName || options.teamName || '')}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="schedule-print-page">
            <header class="schedule-print-header">
                <h1>${escapeHtml(title)}</h1>
                <p>${escapeHtml(rangeLabel)}</p>
            </header>
            <table class="schedule-print-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Time</th>
                        <th>Event</th>
                        <th>Location</th>
                        <th>Type</th>
                        <th>Team</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;

    return container;
}

export function printSchedule(events, options = {}) {
    const printableEvents = filterScheduleEventsForPrint(events, options);
    if (printableEvents.length === 0) {
        window.alert(options.noEventsMessage || 'No schedule events match that print range.');
        return { printed: false, count: 0 };
    }

    const existing = document.getElementById('schedule-print-container');
    if (existing) existing.remove();

    const container = renderSchedulePrintContainer(printableEvents, options);
    document.body.appendChild(container);

    const cleanup = () => {
        container.remove();
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    return { printed: true, count: printableEvents.length, cleanup };
}
