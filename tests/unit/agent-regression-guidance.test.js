import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guidance = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');

describe('agent regression guidance', () => {
    it('binds sensitive-state migrations to every reader sanitizer container', () => {
        expect(guidance).toContain("reader's sanitizer/private-field constants");
        expect(guidance).toContain('each flat alias, nested-object alias, and array-entry alias as the only historical private state');
        expect(guidance).toContain('prove detection, private copy, and scrub each run');
    });

    it('requires local file validation before a durable upload owner is created', () => {
        expect(guidance).toContain('MIME type, nonzero size, byte limit, and required metadata');
        expect(guidance).toContain('before creating that durable owner');
        expect(guidance).toContain('validation-before-owner and write-before-upload call-order tests');
    });
});
