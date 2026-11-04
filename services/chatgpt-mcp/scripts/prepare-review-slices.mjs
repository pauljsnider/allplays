// Local artifacts only: no branches, remote writes, PRs or deployed resources.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const [baseRef, journalRef, interfaceRef, headRef, outputArgument] = process.argv.slice(2);
if (!baseRef || !journalRef || !interfaceRef || !headRef || !outputArgument) throw new Error('Usage: node prepare-review-slices.mjs BASE JOURNAL_HEAD INTERFACE_HEAD HEAD NEW_OUTPUT_DIRECTORY');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (args, cwd = root) => execFileSync('git', args, { cwd, maxBuffer: 150 * 1024 * 1024 });
const commit = (reference) => git(['rev-parse', '--verify', `${reference}^{commit}`]).toString().trim();
const base = commit(baseRef); const journal = commit(journalRef); const interfaces = commit(interfaceRef); const head = commit(headRef);
git(['merge-base', '--is-ancestor', base, journal]); git(['merge-base', '--is-ancestor', journal, interfaces]); git(['merge-base', '--is-ancestor', interfaces, head]);
const output = resolve(outputArgument);
if (existsSync(output)) throw new Error('Use a new output directory; existing artifacts are never overwritten.');
const corePaths = ['functions/notification-attempt-journal.cjs', 'functions/test/notification-attempt-journal.test.cjs', 'tests/unit/notification-attempt-journal-rules.test.js'];
const integrationPaths = [...corePaths, 'functions/schedule-delivery-coordinator.cjs', 'functions/schedule-delivery-providers.cjs',
    'functions/test/schedule-delivery-coordinator.test.cjs', 'functions/test/helpers/notification-journal-fixture.cjs'];
const definitions = [
    { name: 'A-practice-reminders', from: base, to: head, paths: ['apps/app/src/lib/scheduleService.ts', 'apps/app/src/lib/scheduleService.test.ts'], dependencies: [], test: 'Patch application only here; run app scheduleService tests/build before handoff.' },
    { name: 'I1-delivery-journal', from: base, to: journal, paths: corePaths, dependencies: [], test: 'node --test functions/test/notification-attempt-journal.test.cjs' },
    { name: 'I2-delivery-binding-adapters', from: journal, to: interfaces, paths: integrationPaths, dependencies: ['I1-delivery-journal'], test: 'node --test functions/test/notification-attempt-journal.test.cjs functions/test/schedule-delivery-coordinator.test.cjs' },
    { name: 'I3-evidence-status-audience', from: interfaces, to: head, paths: ['functions/schedule-delivery-coordinator.cjs', 'functions/schedule-delivery-evidence.cjs',
        'functions/schedule-delivery-status.cjs', 'functions/schedule-delivery-audience.cjs', 'functions/test/schedule-delivery-security.test.cjs', 'tests/unit/notification-attempt-journal-rules.test.js'],
        dependencies: ['I2-delivery-binding-adapters'], test: 'node --test functions/test/notification-attempt-journal.test.cjs functions/test/schedule-delivery-coordinator.test.cjs functions/test/schedule-delivery-security.test.cjs' }
];
mkdirSync(output);
const records = definitions.map((definition) => {
    const patch = git(['diff', '--binary', '--full-index', definition.from, definition.to, '--', ...definition.paths]);
    if (!patch.length) throw new Error(`Empty slice: ${definition.name}`);
    const filename = `${definition.name}.patch`; writeFileSync(join(output, filename), patch);
    return { ...definition, filename, sha256: createHash('sha256').update(patch).digest('hex') };
});
const temporary = mkdtempSync(join(tmpdir(), 'allplays-review-slices-'));
try {
    const archive = git(['archive', base]);
    for (const chain of [['A-practice-reminders'], ['I1-delivery-journal', 'I2-delivery-binding-adapters', 'I3-evidence-status-audience']]) {
        const directory = join(temporary, chain[0]); mkdirSync(directory);
        execFileSync('tar', ['-x', '-C', directory], { input: archive });
        git(['init', '-q'], directory);
        const indexBefore = readFileSync(join(directory, 'functions/index.js'));
        const rulesBefore = readFileSync(join(directory, 'firestore.rules'));
        for (const name of chain) {
            const record = records.find((entry) => entry.name === name);
            const file = join(output, record.filename);
            git(['apply', '--check', file], directory); git(['apply', file], directory);
            if (name.startsWith('I')) {
                const tests = ['functions/test/notification-attempt-journal.test.cjs'];
                if (name.startsWith('I2') || name.startsWith('I3')) tests.push('functions/test/schedule-delivery-coordinator.test.cjs');
                if (name.startsWith('I3')) tests.push('functions/test/schedule-delivery-security.test.cjs');
                const result = execFileSync(process.execPath, ['--test', ...tests], { cwd: directory, encoding: 'utf8' });
                writeFileSync(join(output, `${name}.tests.log`), result);
            }
            if (!indexBefore.equals(readFileSync(join(directory, 'functions/index.js'))) || !rulesBefore.equals(readFileSync(join(directory, 'firestore.rules')))) throw new Error('Slice changed an activation or rules boundary.');
            record.patchApplied = true; record.isolatedNodeTestsPassed = name.startsWith('I');
        }
    }
    writeFileSync(join(output, 'manifest.json'), JSON.stringify({ base, journal, interfaces, head, createdAt: new Date().toISOString(),
        publication: 'none', limitations: 'Only A/I1/I2/I3 are materialized. Remaining B–H domains need dependency-aware assembly. Emulator tests and app checks must run on each eventual branch.', slices: records }, null, 2) + '\n');
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log(`Prepared and checked ${records.length} local slices at ${output}`);
