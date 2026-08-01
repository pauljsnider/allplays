import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('agent guidance', () => {
    it('uses the canonical product name and only active source/package trees', () => {
        const readme = read('README.md');
        const landing = read('docs/landing-process.md');

        expect(readme).toMatch(/^# ALL PLAYS$/m);
        expect(existsSync('src/app')).toBe(false);
        expect(existsSync('firebase/functions/src')).toBe(false);
        expect(existsSync('firebase/firebase.json')).toBe(false);
        expect(existsSync('apps/app/pnpm-lock.yaml')).toBe(false);
        expect(landing).toContain('controller ownership metadata');
        expect(landing).toContain('do not launch, cancel, or replace CI');
        expect(landing).toContain('must not restore the label or reclaim remediation');
        expect(landing).toContain('explicit operator-requested ownership transfer');
        expect(landing).not.toContain('Removing `external-claim` triggers');
    });

    it('uses AGENTS.md as the shared Claude contract', () => {
        const agents = read('AGENTS.md');
        const claude = read('CLAUDE.md');

        expect(claude).toMatch(/^@AGENTS\.md/m);
        expect(agents).toContain('external-claim');
        expect(agents).toContain('PaulBot');
        expect(agents).toContain('deploy-preview-trusted.yml');
        expect(agents).toContain('deploy-prod.yml');
        expect(agents).toContain('mobile-build');
        expect(agents).toContain('preview-smoke');
        expect(agents).toContain('must not');
        expect(agents).toContain('restore the label or reclaim remediation');
        expect(agents).toContain('explicit operator-requested ownership transfer');
        expect(Buffer.byteLength(agents)).toBeLessThan(32 * 1024);
        expect(existsSync('CODEX.md')).toBe(false);
    });

    it('gives Amazon Q an exact-head review-only contract', () => {
        const rules = read('.amazonq/rules/allplays.md');

        expect(rules).toContain('current PR head SHA only');
        expect(rules).toContain('/q review');
        expect(rules).toContain('[ACTIONABLE:P0]');
        expect(rules).toContain('[NO-ACTION]');
        expect(rules).toContain('review-only by default');
        expect(rules).toContain('PaulBot is the sole landing writer');
    });

    it('provides all seven evidence-backed codebase references', () => {
        const expected = [
            'ARCHITECTURE.md',
            'CONCERNS.md',
            'CONVENTIONS.md',
            'INTEGRATIONS.md',
            'STACK.md',
            'STRUCTURE.md',
            'TESTING.md'
        ];
        const actual = readdirSync('docs/codebase')
            .filter((file) => file.endsWith('.md'))
            .sort();

        expect(actual).toEqual(expected);
        expected.forEach((file) => {
            const content = read(`docs/codebase/${file}`);
            expect(content).toMatch(/^# /);
            expect(content).toMatch(/## .*Evidence/);
            expect(content).not.toMatch(/\[(?:VALUE|FILE|RULE|EXAMPLE|NAME|COMMANDS?|SHORT NOTE)\]/);
        });
    });
});
