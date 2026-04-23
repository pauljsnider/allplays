const QUARANTINE_TAG = '@quarantine';
const DEFAULT_FLAKE_RATE_LIMIT = 0.02;

function isTruthy(rawValue) {
  if (typeof rawValue !== 'string') {
    return false;
  }

  const value = rawValue.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function shouldIncludeQuarantine(rawEnv = process.env) {
  return isTruthy(rawEnv.PLAYWRIGHT_INCLUDE_QUARANTINE);
}

function resolveGrepInvert(rawEnv = process.env) {
  if (shouldIncludeQuarantine(rawEnv)) {
    return undefined;
  }

  return new RegExp(QUARANTINE_TAG);
}

function buildReporters(rawEnv = process.env) {
  const reporters = rawEnv.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]];

  const outputFile = typeof rawEnv.PLAYWRIGHT_JSON_OUTPUT_FILE === 'string'
    ? rawEnv.PLAYWRIGHT_JSON_OUTPUT_FILE.trim()
    : '';

  if (outputFile) {
    reporters.push(['json', { outputFile }]);
  }

  return reporters;
}

function walkSuites(suites, visit) {
  if (!Array.isArray(suites)) {
    return;
  }

  suites.forEach((suite) => {
    if (Array.isArray(suite.specs)) {
      suite.specs.forEach((spec) => {
        if (Array.isArray(spec.tests)) {
          spec.tests.forEach((test) => visit(spec, test));
        }
      });
    }

    walkSuites(suite.suites, visit);
  });
}

function summarizeReport(report) {
  const summary = {
    total: 0,
    executed: 0,
    expected: 0,
    unexpected: 0,
    flaky: 0,
    skipped: 0,
    retried: 0,
    retryAttempts: 0,
    flakyTests: [],
    flakeRate: 0
  };

  walkSuites(report?.suites, (spec, test) => {
    summary.total += 1;

    if (test.status === 'skipped') {
      summary.skipped += 1;
      return;
    }

    summary.executed += 1;

    if (test.status === 'expected') {
      summary.expected += 1;
    } else if (test.status === 'unexpected') {
      summary.unexpected += 1;
    } else if (test.status === 'flaky') {
      summary.flaky += 1;
      summary.flakyTests.push({
        file: spec.file,
        title: spec.title,
        projectName: test.projectName
      });
    }

    const results = Array.isArray(test.results) ? test.results : [];
    const retries = results.filter((result) => Number.isInteger(result.retry) && result.retry > 0);
    if (retries.length > 0) {
      summary.retried += 1;
      summary.retryAttempts += retries.length;
    }
  });

  summary.flakeRate = summary.executed > 0 ? summary.flaky / summary.executed : 0;
  return summary;
}

function isFlakeRateWithinBudget(summary, rawLimit = DEFAULT_FLAKE_RATE_LIMIT) {
  const limit = Number.isFinite(rawLimit) ? rawLimit : Number.parseFloat(String(rawLimit));
  const normalizedLimit = Number.isFinite(limit) && limit >= 0 ? limit : DEFAULT_FLAKE_RATE_LIMIT;
  return summary.flakeRate <= normalizedLimit;
}

function formatRate(rate) {
  return `${(rate * 100).toFixed(2)}%`;
}

module.exports = {
  DEFAULT_FLAKE_RATE_LIMIT,
  QUARANTINE_TAG,
  buildReporters,
  formatRate,
  isFlakeRateWithinBudget,
  resolveGrepInvert,
  shouldIncludeQuarantine,
  summarizeReport
};
