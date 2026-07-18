import { describe, expect, it } from 'vitest';
import { assertNativeAuthBackendPolicy } from './nativeAuthBackendPolicy';

describe('native auth backend policy', () => {
  it('accepts the production ALL PLAYS project in native builds', () => {
    expect(() => assertNativeAuthBackendPolicy({
      projectId: 'game-flow-c6311',
      buildMode: 'production'
    })).not.toThrow();
  });

  it('rejects emulator-to-production credential crossover', () => {
    expect(() => assertNativeAuthBackendPolicy({
      projectId: 'game-flow-c6311',
      emulatorConfigured: true,
      buildMode: 'native-debug'
    })).toThrow('disabled while the Firebase Auth emulator is configured');
  });

  it('rejects foreign Firebase projects outside unit tests', () => {
    expect(() => assertNativeAuthBackendPolicy({
      projectId: 'other-project',
      buildMode: 'production'
    })).toThrow('not configured for the ALL PLAYS Firebase project');
  });

  it('allows isolated project ids only in unit tests', () => {
    expect(() => assertNativeAuthBackendPolicy({
      projectId: 'test-project',
      buildMode: 'test'
    })).not.toThrow();
  });
});
