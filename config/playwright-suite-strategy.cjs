const SUITE_TAGS = Object.freeze({
  smoke: '@smoke',
  critical: '@critical',
  extended: '@extended'
});

function normalizeSuite(rawValue) {
  if (typeof rawValue !== 'string') {
    return 'all';
  }

  const value = rawValue.trim().toLowerCase();
  if (value === 'smoke' || value === 'critical' || value === 'extended' || value === 'all') {
    return value;
  }

  return 'all';
}

function resolveSuiteGrep(rawSuite) {
  const suite = normalizeSuite(rawSuite);
  if (suite === 'all') {
    return undefined;
  }

  return new RegExp(SUITE_TAGS[suite]);
}

function parseShardValue(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }

  const match = rawValue.trim().match(/^(\d+)\/(\d+)$/);
  if (!match) {
    return null;
  }

  const current = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  if (!Number.isInteger(current) || !Number.isInteger(total) || total < 1 || current < 1 || current > total) {
    return null;
  }

  return { current, total };
}

function parsePositiveInt(rawValue) {
  const value = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

function resolveShard(rawEnv = process.env) {
  const explicitShard = parseShardValue(rawEnv.PLAYWRIGHT_SHARD);
  if (explicitShard) {
    return explicitShard;
  }

  const current = parsePositiveInt(rawEnv.PLAYWRIGHT_SHARD_INDEX);
  const total = parsePositiveInt(rawEnv.PLAYWRIGHT_SHARD_TOTAL);
  if (!current || !total || current > total) {
    return undefined;
  }

  return { current, total };
}

function resolveSuiteSelection(rawEnv = process.env) {
  const suite = normalizeSuite(rawEnv.PLAYWRIGHT_SUITE);
  return {
    suite,
    grep: resolveSuiteGrep(suite)
  };
}

module.exports = {
  SUITE_TAGS,
  normalizeSuite,
  parseShardValue,
  resolveShard,
  resolveSuiteGrep,
  resolveSuiteSelection
};
