import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/deploy-prod.yml', 'utf8'));
const detector = workflow.jobs['prepare-deploy'].steps.find((step) => step.name === 'Detect Firebase rules changes').run;
const comparisons = [...detector.matchAll(/git diff --quiet "\$firestore_success_sha" "\$(last_success_sha|GITHUB_SHA)" -- ([\s\S]*?); then/g)]
    .map((match) => ({ target: match[1], command: match[0].replace(/; then$/, '') }));
const inputs = [
    'firestore.rules', 'firestore.indexes.json',
    'scripts/compact-firestore-rules.mjs',
    'scripts/build-certificate-defaults-compat-rules.mjs',
    'scripts/new-generation-helper.mjs',
    'package.json', 'package-lock.json', 'firebase.json',
    '.github/workflows/deploy-prod.yml'
];
let repo;
let base;
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'firestore-generation-diff-'));
    git('init', '-q');
    git('config', 'user.name', 'Regression test');
    git('config', 'user.email', 'test@example.invalid');
    for (const name of [...inputs, 'README.md']) {
        mkdirSync(dirname(join(repo, name)), { recursive: true });
        writeFileSync(join(repo, name), 'baseline\n');
    }
    git('add', '.');
    git('commit', '-qm', 'Baseline');
    base = git('rev-parse', 'HEAD');
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('Firestore generated-artifact deployment identity', () => {
    it.each([...inputs.map((name) => [name, 1]), ['README.md', 0]])('classifies %s for both marker promotion and deployment', (name, expected) => {
        git('reset', '--hard', base);
        writeFileSync(join(repo, name), 'changed\n');
        git('add', name);
        git('commit', '-qm', 'Change one generation input');
        const head = git('rev-parse', 'HEAD');
        expect(comparisons.map(({ target }) => target)).toEqual(['last_success_sha', 'GITHUB_SHA']);
        for (const { command, target } of comparisons) {
            const result = spawnSync('bash', ['-c', command], {
                cwd: repo, encoding: 'utf8',
                env: { ...process.env, firestore_success_sha: base, last_success_sha: head, GITHUB_SHA: head }
            });
            expect(result.status, `${target}: ${result.stderr}`).toBe(expected);
        }
    });
});
