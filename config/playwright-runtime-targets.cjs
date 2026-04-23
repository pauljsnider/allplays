const { normalizeSuite } = require('./playwright-suite-strategy.cjs');

const DEFAULT_RUNTIME_TARGETS_MS = Object.freeze({
  smoke: 2 * 60 * 1000,
  critical: 10 * 60 * 1000,
  extended: 15 * 60 * 1000,
  all: 30 * 60 * 1000
});

function parseRuntimeTargetMs(rawValue) {
  const value = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }

  return value;
}

function resolveRuntimeTargetMs(rawEnv = process.env) {
  const explicitTarget = parseRuntimeTargetMs(rawEnv.PLAYWRIGHT_RUNTIME_TARGET_MS);
  if (explicitTarget !== null) {
    return explicitTarget;
  }

  const suite = normalizeSuite(rawEnv.PLAYWRIGHT_SUITE);
  return DEFAULT_RUNTIME_TARGETS_MS[suite] ?? DEFAULT_RUNTIME_TARGETS_MS.all;
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

function summarizeRuntime(report) {
  const topLevelDuration = report?.stats?.duration;
  if (Number.isFinite(topLevelDuration) && topLevelDuration >= 0) {
    return {
      duration: topLevelDuration,
      source: 'stats.duration'
    };
  }

  let fallbackDuration = 0;
  walkSuites(report?.suites, (_spec, test) => {
    const results = Array.isArray(test.results) ? test.results : [];
    fallbackDuration += results.reduce((total, result) => {
      const duration = result?.duration;
      if (!Number.isFinite(duration) || duration < 0) {
        return total;
      }

      return total + duration;
    }, 0);
  });

  return {
    duration: fallbackDuration,
    source: 'results.duration'
  };
}

function isRuntimeWithinBudget(summary, rawLimit) {
  const limit = parseRuntimeTargetMs(rawLimit);
  const normalizedLimit = limit !== null ? limit : DEFAULT_RUNTIME_TARGETS_MS.all;
  return summary.duration <= normalizedLimit;
}

function formatDuration(durationMs) {
  const value = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function resolveRuntimeLabel(rawEnv = process.env) {
  const explicitLabel = typeof rawEnv.PLAYWRIGHT_RUNTIME_LABEL === 'string'
    ? rawEnv.PLAYWRIGHT_RUNTIME_LABEL.trim()
    : '';
  if (explicitLabel) {
    return explicitLabel;
  }

  const suite = normalizeSuite(rawEnv.PLAYWRIGHT_SUITE);
  if (suite === 'all') {
    return 'Playwright suite';
  }

  return `Playwright ${suite} suite`;
}

module.exports = {
  DEFAULT_RUNTIME_TARGETS_MS,
  formatDuration,
  isRuntimeWithinBudget,
  parseRuntimeTargetMs,
  resolveRuntimeLabel,
  resolveRuntimeTargetMs,
  summarizeRuntime
};
