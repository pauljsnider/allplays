import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const functionsSource = fs.readFileSync(path.join(repoRoot, 'functions/index.js'), 'utf8');

describe('functions deployable exports contract', () => {
    it('does not assign Cloud Function triggers into the _internal test export group', () => {
        // Firebase deploy treats every nested exported trigger as a grouped
        // function named `_internal-<key>`. Leading underscores are invalid
        // function names, so a single trigger assigned into exports._internal
        // fails the ENTIRE production deploy (hosting, rules, functions).
        // Tests invoke triggers via their top-level exports; _internal is for
        // plain helper functions only.
        expect(functionsSource).not.toMatch(/exports\._internal\.notify\w+\s*=/);
        expect(functionsSource).not.toMatch(/exports\._internal\.\w+\s*=\s*functions\./);
    });

    it('keeps the _internal helper bag free of top-level trigger re-exports', () => {
        const triggerNames = [...functionsSource.matchAll(/^exports\.(\w+)\s*=\s*\1;\s*$/gm)]
            .map((match) => match[1])
            .filter((name) => /^notify/.test(name));
        for (const name of triggerNames) {
            expect(functionsSource, `${name} must not also be exported under exports._internal`)
                .not.toContain(`exports._internal.${name}`);
        }
    });
});
