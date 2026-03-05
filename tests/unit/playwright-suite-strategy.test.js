import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  SUITE_TAGS,
  normalizeSuite,
  parseShardValue,
  resolveShard,
  resolveSuiteGrep,
  resolveSuiteSelection
} = require('../../config/playwright-suite-strategy.cjs');

describe('playwright suite strategy', () => {
  it('exports stable suite tags', () => {
    expect(SUITE_TAGS).toEqual({
      smoke: '@smoke',
      critical: '@critical',
      extended: '@extended'
    });
  });

  it('normalizes undefined suite to all', () => {
    expect(normalizeSuite(undefined)).toBe('all');
  });

  it('normalizes mixed-case suite names', () => {
    expect(normalizeSuite('  CrItIcAl ')).toBe('critical');
  });

  it('falls back invalid suite names to all', () => {
    expect(normalizeSuite('nightly')).toBe('all');
  });

  it('resolves @smoke grep expression', () => {
    const grep = resolveSuiteGrep('smoke');
    expect(grep).toBeInstanceOf(RegExp);
    expect(grep.test('home page loads @smoke')).toBe(true);
    expect(grep.test('auth guardrail @critical')).toBe(false);
  });

  it('returns undefined grep for all-suite selection', () => {
    expect(resolveSuiteGrep('all')).toBeUndefined();
  });

  it('parses valid shard values', () => {
    expect(parseShardValue('2/3')).toEqual({ current: 2, total: 3 });
  });

  it('rejects invalid shard formats', () => {
    expect(parseShardValue('2-of-3')).toBeNull();
  });

  it('rejects out-of-range shard indexes', () => {
    expect(parseShardValue('3/2')).toBeNull();
  });

  it('prefers explicit PLAYWRIGHT_SHARD env value', () => {
    const shard = resolveShard({
      PLAYWRIGHT_SHARD: '1/4',
      PLAYWRIGHT_SHARD_INDEX: '2',
      PLAYWRIGHT_SHARD_TOTAL: '4'
    });

    expect(shard).toEqual({ current: 1, total: 4 });
  });

  it('builds shard from index and total env values', () => {
    const shard = resolveShard({
      PLAYWRIGHT_SHARD_INDEX: '2',
      PLAYWRIGHT_SHARD_TOTAL: '5'
    });

    expect(shard).toEqual({ current: 2, total: 5 });
  });

  it('resolves suite selection payload from env', () => {
    const selection = resolveSuiteSelection({ PLAYWRIGHT_SUITE: 'extended' });

    expect(selection.suite).toBe('extended');
    expect(selection.grep).toBeInstanceOf(RegExp);
    expect(selection.grep.test('security isolation @extended')).toBe(true);
  });
});
