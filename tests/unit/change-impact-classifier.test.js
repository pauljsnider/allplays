import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    FULL_LANE,
    SPEC_ONLY_LANE,
    changedPathsBetween,
    classifyChangeImpact,
    isSpecOnlyPath
} from '../../scripts/classify-change-impact.mjs';
import { validateSpecDocument } from '../../scripts/validate-spec-docs.mjs';

describe('change impact classifier', () => {
    it('classifies a large product-spec change by artifact impact rather than size', () => {
        const paths = [
            'spec/league-platform/README.md',
            ...Array.from({ length: 12 }, (_, index) => (
                `spec/league-platform/${String(index + 1).padStart(2, '0')}-feature.md`
            ))
        ];

        expect(classifyChangeImpact(paths)).toMatchObject({
            lane: SPEC_ONLY_LANE,
            specOnly: true
        });
    });

    it.each([
        ['mixed runtime path', ['spec/feature.md', 'js/auth.js']],
        ['workflow path', ['.github/workflows/pr-fast.yml']],
        ['agent instruction', ['spec/AGENTS.md']],
        ['root documentation', ['README.md']],
        ['empty change set', []]
    ])('fails closed for %s', (_label, paths) => {
        expect(classifyChangeImpact(paths)).toMatchObject({ lane: FULL_LANE, specOnly: false });
    });

    it('rejects malformed and traversal-like paths', () => {
        expect(isSpecOnlyPath('spec//feature.md')).toBe(false);
        expect(isSpecOnlyPath('spec/../feature.md')).toBe(false);
        expect(isSpecOnlyPath('spec/feature.MD')).toBe(false);
    });

    it('treats both sides of a runtime-to-spec rename as full impact', () => {
        expect(classifyChangeImpact(['dashboard.html', 'spec/dashboard.md'])).toMatchObject({
            lane: FULL_LANE,
            specOnly: false
        });
    });

    it('expands a detected rename into both changed paths', () => {
        const rootDir = mkdtempSync(join(tmpdir(), 'allplays-impact-git-'));
        execFileSync('git', ['init', '--quiet'], { cwd: rootDir });
        execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: rootDir });
        execFileSync('git', ['config', 'user.name', 'Test'], { cwd: rootDir });
        writeFileSync(join(rootDir, 'dashboard.html'), '<h1>Dashboard</h1>\n');
        execFileSync('git', ['add', '.'], { cwd: rootDir });
        execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: rootDir });
        const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();

        mkdirSync(join(rootDir, 'spec'));
        renameSync(join(rootDir, 'dashboard.html'), join(rootDir, 'spec', 'dashboard.md'));
        execFileSync('git', ['add', '-A'], { cwd: rootDir });
        execFileSync('git', ['commit', '--quiet', '-m', 'rename'], { cwd: rootDir });
        const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();

        expect(changedPathsBetween(baseSha, headSha, { cwd: rootDir })).toEqual([
            'dashboard.html',
            'spec/dashboard.md'
        ]);
    });
});

describe('spec document validator', () => {
    it('accepts regular Markdown with a valid repository-local link', () => {
        const rootDir = mkdtempSync(join(tmpdir(), 'allplays-spec-doc-'));
        mkdirSync(join(rootDir, 'spec'), { recursive: true });
        writeFileSync(join(rootDir, 'spec', 'other.md'), '# Other\n');
        writeFileSync(join(rootDir, 'spec', 'feature.md'), '# Feature\n\nSee [other](./other.md).\n');

        expect(validateSpecDocument('spec/feature.md', { rootDir })).toEqual({
            path: 'spec/feature.md',
            deleted: false
        });
    });

    it('rejects unresolved conflicts and missing local links', () => {
        const rootDir = mkdtempSync(join(tmpdir(), 'allplays-spec-doc-'));
        mkdirSync(join(rootDir, 'spec'), { recursive: true });
        writeFileSync(join(rootDir, 'spec', 'conflict.md'), '<<<<<<< ours\n=======\n>>>>>>> theirs\n');
        writeFileSync(join(rootDir, 'spec', 'link.md'), '# Link\n\n[missing](./missing.md)\n');

        expect(() => validateSpecDocument('spec/conflict.md', { rootDir })).toThrow('merge-conflict');
        expect(() => validateSpecDocument('spec/link.md', { rootDir })).toThrow('missing local Markdown link');
    });
});
