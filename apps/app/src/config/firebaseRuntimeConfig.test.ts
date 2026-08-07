import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nativeFirebaseConfig } from './firebaseRuntimeConfig';

describe('nativeFirebaseConfig', () => {
  it('matches the canonical checked-in runtime configuration', () => {
    const runtimeConfigPath = fileURLToPath(
      new URL('../../../../.well-known/allplays-runtime-config.json', import.meta.url)
    );
    const runtimeConfig = JSON.parse(readFileSync(runtimeConfigPath, 'utf8'));

    expect(nativeFirebaseConfig).toEqual(runtimeConfig.firebase);
  });
});
