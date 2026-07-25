import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('private AI chat typography contract', () => {
  it('uses normal body weight for messages and typed chat text', () => {
    const css = readFileSync(join(process.cwd(), 'apps/app/src/styles/index.css'), 'utf8');
    const messageRule = css.match(/\.private-ai-message-text\s*\{([^}]+)\}/)?.[1] || '';
    const composerRule = css.match(/\.chat-composer-textarea\s*\{([^}]+)\}/)?.[1] || '';

    expect(messageRule).toContain('font-weight: 400');
    expect(composerRule).toContain('font-weight: 400');
  });
});
