import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('messages latest-scroll retries', () => {
    it('keeps a late mobile retry in the pinned latest-scroll schedule', () => {
        const source = readFileSync(path.resolve('apps/app/src/pages/Messages.tsx'), 'utf8');

        expect(source).toContain('[120, 300, 700, 1500].forEach((delay) => {');
    });
});
