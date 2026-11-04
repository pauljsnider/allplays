// Local artifacts only: no branches, remote writes, PRs or deployed resources.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const [baseRef, journalRef, interfaceRef, securityRef, hardeningRef, headRef, outputArgument] = process.argv.slice(2);
if (!baseRef || !journalRef || !interfaceRef || !securityRef || !hardeningRef || !headRef || !outputArgument) throw new Error('Usage: node prepare-review-slices.mjs BASE JOURNAL_HEAD INTERFACE_HEAD SECURITY_HEAD HARDENING_HEAD HEAD NEW_OUTPUT_DIRECTORY');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (args, cwd = root) => execFileSync('git', args, { cwd, maxBuffer: 150 * 1024 * 1024 });
const commit = (reference) => git(['rev-parse', '--verify', `${reference}^{commit}`]).toString().trim();
const base = commit(baseRef); const journal = commit(journalRef); const interfaces = commit(interfaceRef); const security = commit(securityRef); const hardening = commit(hardeningRef); const head = commit(headRef);
const history = [base, journal, interfaces, security, hardening, head];
history.slice(1).forEach((value, index) => git(['merge-base', '--is-ancestor', history[index], value]));
const output = resolve(outputArgument);
if (existsSync(output)) throw new Error('Use a new output directory; existing artifacts are never overwritten.');
const corePaths = ['functions/notification-attempt-journal.cjs', 'functions/test/notification-attempt-journal.test.cjs', 'tests/unit/notification-attempt-journal-rules.test.js'];
const integrationPaths = [...corePaths, 'functions/schedule-delivery-coordinator.cjs', 'functions/schedule-delivery-providers.cjs',
    'functions/test/schedule-delivery-coordinator.test.cjs', 'functions/test/helpers/notification-journal-fixture.cjs'];
const definitions = [
    { name: 'A-practice-reminders', from: base, to: head, paths: ['apps/app/src/lib/scheduleService.ts', 'apps/app/src/lib/scheduleService.test.ts'], dependencies: [], test: 'Patch application only here; run app scheduleService tests/build before handoff.' },
    { name: 'I1-delivery-journal', from: base, to: journal, paths: corePaths, dependencies: [], test: 'node --test functions/test/notification-attempt-journal.test.cjs' },
    { name: 'I2-delivery-binding-adapters', from: journal, to: interfaces, paths: integrationPaths, dependencies: ['I1-delivery-journal'], test: 'node --test functions/test/notification-attempt-journal.test.cjs functions/test/schedule-delivery-coordinator.test.cjs' },
    { name: 'I3-evidence-status-audience', from: interfaces, to: security, paths: ['functions/schedule-delivery-coordinator.cjs', 'functions/schedule-delivery-evidence.cjs',
        'functions/schedule-delivery-status.cjs', 'functions/schedule-delivery-audience.cjs', 'functions/test/schedule-delivery-security.test.cjs', 'tests/unit/notification-attempt-journal-rules.test.js'],
        dependencies: ['I2-delivery-binding-adapters'], test: 'node --test functions/test/notification-attempt-journal.test.cjs functions/test/schedule-delivery-coordinator.test.cjs functions/test/schedule-delivery-security.test.cjs' },
    ...[['J1-authority-hardening', security, hardening], ['J2-local-broker-evidence', hardening, head]].map(([name, from, to]) => ({ name, from, to,
        paths: git(['diff', '--name-only', from, to]).toString().trim().split('\n'), dependencies: [name.startsWith('J1') ? `integration:${security}` : 'J1-authority-hardening'],
        test: 'All MCP unit/protocol tests plus notification evidence/sender Node suites; emulator validation remains separate.' }))
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
    for (const [chainBase, chain] of [[base, ['A-practice-reminders']], [base, ['I1-delivery-journal', 'I2-delivery-binding-adapters', 'I3-evidence-status-audience']], [security, ['J1-authority-hardening', 'J2-local-broker-evidence']]]) {
        const archive = git(['archive', chainBase]);
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
            if (name.startsWith('J')) {
                for (const relative of ['node_modules', 'services/chatgpt-mcp/node_modules']) {
                    if (!existsSync(join(directory, relative))) symlinkSync(join(root, relative), join(directory, relative), 'dir');
                }
                const tests = readdirSync(join(directory, 'tests/unit')).filter((file) => /^chatgpt-mcp-.*\.test\.js$/.test(file) && !file.endsWith('-rules.test.js')).map((file) => `tests/unit/${file}`);
                const result = execFileSync(join(root, 'node_modules/.bin/vitest'), ['run', ...tests, '--reporter=dot'], { cwd: directory, encoding: 'utf8' });
                writeFileSync(join(output, `${name}.mcp-tests.log`), result);
                const nodeResult = execFileSync(process.execPath, ['--test', 'functions/test/notification-attempt-journal.test.cjs', 'functions/test/schedule-delivery-coordinator.test.cjs', 'functions/test/schedule-delivery-security.test.cjs', 'functions/test/diamond-scorebook-notification-sender.test.cjs'], { cwd: directory, encoding: 'utf8' });
                writeFileSync(join(output, `${name}.tests.log`), nodeResult);
                record.isolatedMcpTestsPassed = true;
            }
            if (!indexBefore.equals(readFileSync(join(directory, 'functions/index.js'))) || !rulesBefore.equals(readFileSync(join(directory, 'firestore.rules')))) throw new Error('Slice changed an activation or rules boundary.');
            record.patchApplied = true; record.isolatedNodeTestsPassed = /^[IJ]/.test(name);
        }
    }
    writeFileSync(join(output, 'manifest.json'), JSON.stringify({ base, journal, interfaces, security, hardening, head, createdAt: new Date().toISOString(),
        publication: 'none', limitations: 'A/I1/I2/I3 apply to the original base; J1/J2 require the full security integration checkpoint. B–H domains still need dependency-aware assembly. Emulator tests and app checks must run on each eventual branch.', slices: records }, null, 2) + '\n');
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log(`Prepared and checked ${records.length} local slices at ${output}`);
