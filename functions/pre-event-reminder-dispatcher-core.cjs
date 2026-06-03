const PRE_EVENT_REMINDER_QUERY_PAGE_SIZE = 50;
const PRE_EVENT_REMINDER_MAX_PAGES_PER_RUN = 10;
const PRE_EVENT_REMINDER_MAX_RUNTIME_MS = 8 * 60 * 1000;

async function drainDueReminderPages({
  loadPage,
  processReminder,
  now = new Date(),
  maxPages = PRE_EVENT_REMINDER_MAX_PAGES_PER_RUN,
  maxRuntimeMs = PRE_EVENT_REMINDER_MAX_RUNTIME_MS
} = {}) {
  if (typeof loadPage !== 'function') {
    throw new Error('loadPage is required.');
  }
  if (typeof processReminder !== 'function') {
    throw new Error('processReminder is required.');
  }

  const safeStartedAtMs = Date.now();
  const dueIso = now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString();
  const summary = {
    dueIso,
    pagesAttempted: 0,
    stoppedBecause: 'drained',
    lastCursor: null,
    results: []
  };

  let cursor = null;
  let hitPageCap = true;
  while (summary.pagesAttempted < maxPages) {
    if ((Date.now() - safeStartedAtMs) >= maxRuntimeMs) {
      summary.stoppedBecause = 'maxRuntimeMs';
      break;
    }

    const page = await loadPage({
      dueIso,
      limit: PRE_EVENT_REMINDER_QUERY_PAGE_SIZE,
      cursor
    }) || {};
    const docs = Array.isArray(page.docs) ? page.docs : [];
    summary.pagesAttempted += 1;

    if (!docs.length) {
      summary.lastCursor = cursor;
      hitPageCap = false;
      break;
    }

    for (const doc of docs) {
      if ((Date.now() - safeStartedAtMs) >= maxRuntimeMs) {
        summary.stoppedBecause = 'maxRuntimeMs';
        return summary;
      }
      const result = await processReminder(doc, { dueIso, page: summary.pagesAttempted });
      summary.results.push(result);
    }

    cursor = page.nextCursor || docs[docs.length - 1] || null;
    summary.lastCursor = cursor;

    if (docs.length < PRE_EVENT_REMINDER_QUERY_PAGE_SIZE) {
      hitPageCap = false;
      break;
    }
  }

  if (hitPageCap && summary.pagesAttempted >= maxPages && summary.stoppedBecause === 'drained') {
    summary.stoppedBecause = 'maxPages';
  }

  return summary;
}

module.exports = {
  PRE_EVENT_REMINDER_QUERY_PAGE_SIZE,
  PRE_EVENT_REMINDER_MAX_PAGES_PER_RUN,
  PRE_EVENT_REMINDER_MAX_RUNTIME_MS,
  drainDueReminderPages
};
