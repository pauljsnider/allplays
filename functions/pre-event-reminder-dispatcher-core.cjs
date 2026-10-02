const PRE_EVENT_REMINDER_QUERY_PAGE_SIZE = 50;
const PRE_EVENT_REMINDER_MAX_PAGES_PER_RUN = 10;
const PRE_EVENT_REMINDER_MAX_RUNTIME_MS = 8 * 60 * 1000;

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function getOutcomeCount(outcome, name) {
  const value = outcome?.[name] ?? 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

async function runReminderWorkers({
  items,
  concurrency,
  worker
} = {}) {
  requirePositiveInteger(concurrency, 'concurrency');
  if (typeof worker !== 'function') {
    throw new Error('worker is required.');
  }

  const values = Array.from(items || []);
  if (!values.length) {
    return {
      examinedCount: 0,
      sentCount: 0,
      failedCount: 0
    };
  }

  const results = new Array(values.length);
  const workerCount = Math.min(concurrency, values.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = {
          sent: Boolean(await worker(values[currentIndex], currentIndex)),
          failed: false
        };
      } catch {
        results[currentIndex] = {
          sent: false,
          failed: true
        };
      }
    }
  }));

  return {
    examinedCount: values.length,
    sentCount: results.filter((result) => result.sent).length,
    failedCount: results.filter((result) => result.failed).length
  };
}

/**
 * Drains ordered pages within a cooperative runtime budget.
 * `pagesAttempted` and `examinedCount` describe returned loads and documents,
 * while outcome counts and `lastCursor` advance only after a page is safely
 * complete. Budget checks cannot interrupt callbacks that have already started.
 */
async function drainOrderedPages({
  loadPage,
  processPage,
  pageSize,
  maxPages,
  maxRuntimeMs,
  initialCursor = null,
  getCurrentTimeMs = Date.now
} = {}) {
  if (typeof loadPage !== 'function') {
    throw new Error('loadPage is required.');
  }
  if (typeof processPage !== 'function') {
    throw new Error('processPage is required.');
  }
  requirePositiveInteger(pageSize, 'pageSize');
  requirePositiveInteger(maxPages, 'maxPages');
  requirePositiveInteger(maxRuntimeMs, 'maxRuntimeMs');
  if (typeof getCurrentTimeMs !== 'function') {
    throw new Error('getCurrentTimeMs must be a function.');
  }

  const startedAtMs = getCurrentTimeMs();
  const summary = {
    pagesAttempted: 0,
    examinedCount: 0,
    sentCount: 0,
    failedCount: 0,
    stoppedBecause: 'drained',
    lastCursor: initialCursor
  };
  let cursor = initialCursor;

  while (summary.pagesAttempted < maxPages) {
    if ((getCurrentTimeMs() - startedAtMs) >= maxRuntimeMs) {
      summary.stoppedBecause = 'maxRuntimeMs';
      return summary;
    }

    const pageNumber = summary.pagesAttempted + 1;
    const page = await loadPage({ cursor, limit: pageSize, pageNumber }) || {};
    const docs = Array.isArray(page.docs) ? page.docs : [];
    const nextCursor = page.nextCursor ?? null;

    summary.pagesAttempted = pageNumber;
    summary.examinedCount += docs.length;

    if ((getCurrentTimeMs() - startedAtMs) >= maxRuntimeMs) {
      summary.stoppedBecause = 'maxRuntimeMs';
      return summary;
    }

    if (docs.length) {
      const outcome = await processPage(docs, { pageNumber, cursor, nextCursor }) || {};
      summary.sentCount += getOutcomeCount(outcome, 'sentCount');
      summary.failedCount += getOutcomeCount(outcome, 'failedCount');
    }
    summary.lastCursor = nextCursor;

    if (docs.length < pageSize || nextCursor === null) {
      return summary;
    }

    cursor = nextCursor;
  }

  summary.stoppedBecause = 'maxPages';
  return summary;
}

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
  runReminderWorkers,
  drainOrderedPages,
  drainDueReminderPages
};
