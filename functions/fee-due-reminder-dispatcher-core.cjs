const FEE_REMINDER_QUERY_PAGE_SIZE = 50;
const FEE_REMINDER_MAX_PAGES_PER_QUERY = 10;
const FEE_REMINDER_MAX_RUNTIME_MS = 8 * 60 * 1000;
const FEE_REMINDER_WORKER_CONCURRENCY = 5;

function getReminderDocPath(doc) {
  return String(doc?.ref?.path || doc?.path || doc?.id || '').trim();
}

async function processReminderPage({
  docs,
  processRecipient,
  concurrency,
  summary,
  startedAtMs,
  maxRuntimeMs,
  getNowMs
}) {
  const safeConcurrency = Math.max(1, Math.min(
    Number.isInteger(concurrency) ? concurrency : FEE_REMINDER_WORKER_CONCURRENCY,
    docs.length || 1
  ));
  let nextIndex = 0;

  await Promise.all(Array.from({ length: safeConcurrency }, async () => {
    while (nextIndex < docs.length) {
      if ((getNowMs() - startedAtMs) >= maxRuntimeMs) {
        summary.stoppedBecause = 'maxRuntimeMs';
        return;
      }
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        const value = await processRecipient(docs[currentIndex]);
        summary.results.push({ status: 'fulfilled', value });
        if (value?.failed === true) {
          summary.failed += 1;
        } else if (value) {
          summary.sent += 1;
        }
      } catch (reason) {
        summary.results.push({ status: 'rejected', reason });
        summary.failed += 1;
      }
    }
  }));

  return nextIndex;
}

async function drainFeeReminderQueryPages({
  queryNames = ['leased', 'upcoming'],
  loadPage,
  processRecipient,
  pageSize = FEE_REMINDER_QUERY_PAGE_SIZE,
  maxPagesPerQuery = FEE_REMINDER_MAX_PAGES_PER_QUERY,
  maxRuntimeMs = FEE_REMINDER_MAX_RUNTIME_MS,
  concurrency = FEE_REMINDER_WORKER_CONCURRENCY,
  getNowMs = Date.now,
  initialCursors = {},
  saveCursor
} = {}) {
  if (typeof loadPage !== 'function') {
    throw new Error('loadPage is required.');
  }
  if (typeof processRecipient !== 'function') {
    throw new Error('processRecipient is required.');
  }

  const safePageSize = Math.max(1, Number.isInteger(pageSize) ? pageSize : FEE_REMINDER_QUERY_PAGE_SIZE);
  const safeMaxPages = Math.max(1, Number.isInteger(maxPagesPerQuery)
    ? maxPagesPerQuery
    : FEE_REMINDER_MAX_PAGES_PER_QUERY);
  const safeMaxRuntimeMs = Math.max(1, Number(maxRuntimeMs) || FEE_REMINDER_MAX_RUNTIME_MS);
  const startedAtMs = getNowMs();
  const seenPaths = new Set();
  const summary = {
    examined: 0,
    sent: 0,
    failed: 0,
    deduplicated: 0,
    pagesAttempted: 0,
    queryPages: {},
    stoppedBecause: 'drained',
    results: []
  };

  for (const queryName of queryNames) {
    let cursor = initialCursors?.[queryName] || null;
    let drained = false;
    let pagesAttempted = 0;

    while (pagesAttempted < safeMaxPages) {
      if ((getNowMs() - startedAtMs) >= safeMaxRuntimeMs) {
        summary.stoppedBecause = 'maxRuntimeMs';
        return summary;
      }

      const page = await loadPage({
        queryName,
        cursor,
        limit: safePageSize
      });
      const docs = Array.isArray(page) ? page : (Array.isArray(page?.docs) ? page.docs : []);
      pagesAttempted += 1;
      summary.pagesAttempted += 1;
      summary.queryPages[queryName] = pagesAttempted;
      summary.examined += docs.length;

      if (!docs.length) {
        drained = true;
        if (typeof saveCursor === 'function') {
          await saveCursor({ queryName, cursor: null });
        }
        break;
      }

      const uniqueDocs = [];
      for (const doc of docs) {
        const path = getReminderDocPath(doc);
        if (path && seenPaths.has(path)) {
          summary.deduplicated += 1;
          continue;
        }
        if (path) seenPaths.add(path);
        uniqueDocs.push(doc);
      }

      const processedDocCount = await processReminderPage({
        docs: uniqueDocs,
        processRecipient,
        concurrency,
        summary,
        startedAtMs,
        maxRuntimeMs: safeMaxRuntimeMs,
        getNowMs
      });

      let remainingProcessedDocs = processedDocCount;
      let lastSafeCursor = cursor;
      for (const doc of docs) {
        const path = getReminderDocPath(doc);
        if (path && seenPaths.has(path) && !uniqueDocs.includes(doc)) {
          lastSafeCursor = doc;
          continue;
        }
        if (remainingProcessedDocs <= 0) break;
        remainingProcessedDocs -= 1;
        lastSafeCursor = doc;
      }
      cursor = lastSafeCursor;
      if (typeof saveCursor === 'function' && cursor) {
        await saveCursor({ queryName, cursor });
      }
      if (summary.stoppedBecause === 'maxRuntimeMs') {
        return summary;
      }

      if (docs.length < safePageSize) {
        drained = true;
        if (typeof saveCursor === 'function') {
          await saveCursor({ queryName, cursor: null });
        }
        break;
      }
    }

    if (!drained && pagesAttempted >= safeMaxPages) {
      summary.stoppedBecause = 'maxPages';
    }
  }

  return summary;
}

module.exports = {
  FEE_REMINDER_QUERY_PAGE_SIZE,
  FEE_REMINDER_MAX_PAGES_PER_QUERY,
  FEE_REMINDER_MAX_RUNTIME_MS,
  FEE_REMINDER_WORKER_CONCURRENCY,
  drainFeeReminderQueryPages
};
