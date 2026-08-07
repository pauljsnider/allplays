import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativeFirebaseConfig } from './firebaseRuntimeConfig';

describe('nativeFirebaseConfig', () => {
  it('matches the canonical checked-in runtime configuration', () => {
    const runtimeConfigPath = [
      path.resolve(process.cwd(), '.well-known/allplays-runtime-config.json'),
      path.resolve(process.cwd(), '../..', '.well-known/allplays-runtime-config.json')
    ].find((candidate) => existsSync(candidate));

    if (!runtimeConfigPath) throw new Error('Canonical Firebase runtime config was not found.');
    const runtimeConfig = JSON.parse(readFileSync(runtimeConfigPath, 'utf8'));

    expect(nativeFirebaseConfig).toEqual(runtimeConfig.firebase);
  });
});
